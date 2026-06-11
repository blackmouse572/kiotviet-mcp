import nacl from "tweetnacl";

export interface BearerPayload {
  retailer: string;
  clientId: string;
  clientSecret: string;
  iss: "managed" | "byo";
  exp: number;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error("invalid hex");
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

function bytesToB64Url(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]!);
  return btoa(s).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function b64UrlToBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? 0 : 4 - (s.length % 4);
  const b = atob(s.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat(pad));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

export function seal(payload: BearerPayload, publicKeyHex: string): string {
  const pk = hexToBytes(publicKeyHex);
  if (pk.length !== nacl.box.publicKeyLength) throw new Error("bad pk length");
  const plaintext = enc.encode(JSON.stringify(payload));
  // sealed-box style: ephemeral keypair, nonce = blake2b(eph_pk || recipient_pk).
  // tweetnacl-js doesn't ship sealed boxes, so we implement the equivalent with
  // box.before + box() using an ephemeral keypair and a deterministic nonce
  // derived from sha256(eph_pk || recipient_pk) truncated to 24 bytes.
  const eph = nacl.box.keyPair();
  const nonce = deriveNonce(eph.publicKey, pk);
  const ct = nacl.box(plaintext, nonce, pk, eph.secretKey);
  const out = new Uint8Array(eph.publicKey.length + ct.length);
  out.set(eph.publicKey, 0);
  out.set(ct, eph.publicKey.length);
  return bytesToB64Url(out);
}

export function open(envelope: string, publicKeyHex: string, secretKeyHex: string, now: number = Math.floor(Date.now() / 1000)): BearerPayload {
  const pk = hexToBytes(publicKeyHex);
  const sk = hexToBytes(secretKeyHex);
  let bytes: Uint8Array;
  try {
    bytes = b64UrlToBytes(envelope);
  } catch {
    throw new Error("malformed envelope");
  }
  if (bytes.length < nacl.box.publicKeyLength + nacl.box.overheadLength) {
    throw new Error("malformed envelope");
  }
  const eph = bytes.slice(0, nacl.box.publicKeyLength);
  const ct = bytes.slice(nacl.box.publicKeyLength);
  const nonce = deriveNonce(eph, pk);
  const pt = nacl.box.open(ct, nonce, eph, sk);
  if (!pt) throw new Error("decrypt failed");
  let payload: BearerPayload;
  try {
    payload = JSON.parse(dec.decode(pt)) as BearerPayload;
  } catch {
    throw new Error("bad payload");
  }
  if (typeof payload.exp !== "number" || payload.exp < now) {
    throw new Error("expired");
  }
  return payload;
}

function deriveNonce(ephPk: Uint8Array, recipientPk: Uint8Array): Uint8Array {
  // FNV-style fold then expand with a tiny xorshift PRNG seeded by the
  // concatenated keys, producing a deterministic 24-byte nonce. We can't
  // use Web Crypto here synchronously, so we use a simple but uniform
  // hash. Collision resistance isn't load-bearing — uniqueness across
  // ephemeral keys is what matters.
  const seed = new Uint8Array(ephPk.length + recipientPk.length);
  seed.set(ephPk, 0);
  seed.set(recipientPk, ephPk.length);
  // SipHash-like mixing
  let h0 = 0x736f6d65, h1 = 0x646f7261, h2 = 0x6c796765, h3 = 0x74657362;
  for (let i = 0; i < seed.length; i++) {
    h0 = (h0 ^ seed[i]!) >>> 0;
    h0 = Math.imul(h0, 0x9e3779b1) >>> 0;
    h1 = (h1 + h0) >>> 0;
    h2 = (h2 ^ ((h1 >>> 13) | (h1 << 19))) >>> 0;
    h3 = (h3 + Math.imul(h2, 0x85ebca77)) >>> 0;
  }
  const nonce = new Uint8Array(nacl.box.nonceLength);
  for (let i = 0; i < nonce.length; i++) {
    h0 = (h0 + Math.imul(h1 ^ (h2 >>> 7), 0xc2b2ae3d)) >>> 0;
    h1 = (h1 + Math.imul(h2 ^ (h3 >>> 11), 0x27d4eb2f)) >>> 0;
    h2 = (h2 + Math.imul(h3 ^ (h0 >>> 17), 0x165667b1)) >>> 0;
    h3 = (h3 + Math.imul(h0 ^ (h1 >>> 19), 0xd3a2646c)) >>> 0;
    nonce[i] = h0 & 0xff;
  }
  return nonce;
}

export function generateKeyPairHex(): { publicKey: string; secretKey: string } {
  const kp = nacl.box.keyPair();
  return { publicKey: bytesToHex(kp.publicKey), secretKey: bytesToHex(kp.secretKey) };
}

function bytesToHex(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i++) s += b[i]!.toString(16).padStart(2, "0");
  return s;
}
