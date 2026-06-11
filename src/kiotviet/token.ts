import type { CachedToken, Lock, TokenStore } from "../store/types";

export interface KiotvietCreds {
  clientId: string;
  clientSecret: string;
}

export interface TokenCacheDeps {
  store: TokenStore;
  lock: Lock;
  tokenUrl: string;
  fetchImpl?: typeof fetch;
  nowSec?: () => number;
  earlyRefreshSec?: number;
}

const enc = new TextEncoder();

export async function credsKey(creds: KiotvietCreds): Promise<string> {
  const buf = enc.encode(`${creds.clientId}|${creds.clientSecret}`);
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(buf);
  const out = await crypto.subtle.digest("SHA-256", ab);
  return bytesToHex(new Uint8Array(out));
}

function bytesToHex(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += b[i]!.toString(16).padStart(2, "0");
  return s;
}

export async function fetchToken(creds: KiotvietCreds, tokenUrl: string, fetchImpl: typeof fetch = fetch): Promise<CachedToken> {
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    scope: "PublicApi.Access",
  });
  const res = await fetchImpl(tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new TokenExchangeError(res.status, text);
  }
  const json = (await res.json()) as { access_token: string; expires_in: number };
  if (!json.access_token || typeof json.expires_in !== "number") {
    throw new TokenExchangeError(res.status, "malformed token response");
  }
  return {
    access_token: json.access_token,
    expires_at: Math.floor(Date.now() / 1000) + json.expires_in,
  };
}

export class TokenExchangeError extends Error {
  constructor(public readonly status: number, public readonly body: string) {
    super(`token exchange failed (${status})`);
    this.name = "TokenExchangeError";
  }
}

export async function getOrRefresh(creds: KiotvietCreds, deps: TokenCacheDeps): Promise<CachedToken> {
  const now = deps.nowSec ? deps.nowSec() : Math.floor(Date.now() / 1000);
  const early = deps.earlyRefreshSec ?? 60;
  const key = await credsKey(creds);

  const cached = await deps.store.get(key);
  if (cached && cached.expires_at - early > now) return cached;

  return deps.lock.withLock(key, async () => {
    const again = await deps.store.get(key);
    if (again && again.expires_at - early > now) return again;
    const fresh = await fetchToken(creds, deps.tokenUrl, deps.fetchImpl);
    const ttl = Math.max(30, fresh.expires_at - now - early);
    await deps.store.set(key, fresh, ttl);
    return fresh;
  });
}
