const enc = new TextEncoder();

export interface HmacHeaders {
  timestamp: string;
  signature: string;
}

export const HMAC_TIMESTAMP_HEADER = "x-link-timestamp";
export const HMAC_SIGNATURE_HEADER = "x-link-signature";

function toBufferSource(b: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(b.byteLength);
  new Uint8Array(ab).set(b);
  return ab;
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", toBufferSource(enc.encode(secret)), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const out = await crypto.subtle.digest("SHA-256", toBufferSource(bytes));
  return bytesToHex(new Uint8Array(out));
}

function bytesToHex(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += b[i]!.toString(16).padStart(2, "0");
  return s;
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("invalid hex");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

export async function buildCanonical(timestamp: string, method: string, path: string, body: string): Promise<string> {
  const bodyHash = await sha256Hex(enc.encode(body));
  return `${timestamp}\n${method.toUpperCase()}\n${path}\n${bodyHash}`;
}

export async function sign(secret: string, timestamp: string, method: string, path: string, body: string): Promise<string> {
  const key = await importKey(secret);
  const canonical = await buildCanonical(timestamp, method, path, body);
  const sig = await crypto.subtle.sign("HMAC", key, toBufferSource(enc.encode(canonical)));
  return bytesToHex(new Uint8Array(sig));
}

export interface VerifyOptions {
  windowSec?: number;
  nowSec?: number;
}

export async function verify(
  secret: string,
  headers: { timestamp?: string; signature?: string },
  method: string,
  path: string,
  body: string,
  opts: VerifyOptions = {},
): Promise<boolean> {
  if (!headers.timestamp || !headers.signature) return false;
  const ts = Number(headers.timestamp);
  if (!Number.isFinite(ts)) return false;
  const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const window = opts.windowSec ?? 60;
  if (Math.abs(now - ts) > window) return false;
  let providedSig: Uint8Array;
  try {
    providedSig = hexToBytes(headers.signature);
  } catch {
    return false;
  }
  const key = await importKey(secret);
  const canonical = await buildCanonical(headers.timestamp, method, path, body);
  return crypto.subtle.verify("HMAC", key, toBufferSource(providedSig), toBufferSource(enc.encode(canonical)));
}
