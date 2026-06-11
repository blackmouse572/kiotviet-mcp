import type { CachedToken, TokenStore } from "./types";

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

function bytesToB64(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]!);
  return btoa(s);
}

function b64ToBytes(s: string): Uint8Array {
  const b = atob(s);
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

function toAb(b: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(b.byteLength);
  new Uint8Array(ab).set(b);
  return ab;
}

async function importAesKey(hex: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", toAb(hexToBytes(hex)), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

async function encrypt(plain: string, hexKey: string): Promise<string> {
  const key = await importAesKey(hexKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: toAb(iv) }, key, toAb(new TextEncoder().encode(plain))),
  );
  const blob = new Uint8Array(iv.length + ct.length);
  blob.set(iv, 0);
  blob.set(ct, iv.length);
  return bytesToB64(blob);
}

async function decrypt(b64: string, hexKey: string): Promise<string> {
  const blob = b64ToBytes(b64);
  const iv = blob.slice(0, 12);
  const ct = blob.slice(12);
  const key = await importAesKey(hexKey);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: toAb(iv) }, key, toAb(ct));
  return new TextDecoder().decode(pt);
}

export class WorkersKVStore implements TokenStore {
  constructor(private readonly kv: KVNamespace, private readonly cacheKeyHex?: string) {}

  async get(key: string): Promise<CachedToken | undefined> {
    const raw = await this.kv.get(key);
    if (!raw) return undefined;
    const json = this.cacheKeyHex ? await decrypt(raw, this.cacheKeyHex) : raw;
    try {
      return JSON.parse(json) as CachedToken;
    } catch {
      return undefined;
    }
  }

  async set(key: string, value: CachedToken, ttlSec: number): Promise<void> {
    const json = JSON.stringify(value);
    const payload = this.cacheKeyHex ? await encrypt(json, this.cacheKeyHex) : json;
    const expirationTtl = Math.max(60, Math.floor(ttlSec));
    await this.kv.put(key, payload, { expirationTtl });
  }
}
