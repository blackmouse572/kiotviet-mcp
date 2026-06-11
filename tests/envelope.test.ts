import { describe, test, expect } from "bun:test";
import { seal, open, generateKeyPairHex, type BearerPayload } from "../src/auth/envelope";

const future = Math.floor(Date.now() / 1000) + 3600;
const past = Math.floor(Date.now() / 1000) - 60;

function samplePayload(exp = future): BearerPayload {
  return {
    retailer: "abcstore",
    clientId: "client-abc",
    clientSecret: "secret-xyz",
    iss: "managed",
    exp,
  };
}

describe("envelope", () => {
  test("round-trips a payload", () => {
    const kp = generateKeyPairHex();
    const env = seal(samplePayload(), kp.publicKey);
    const out = open(env, kp.publicKey, kp.secretKey);
    expect(out.retailer).toBe("abcstore");
    expect(out.clientSecret).toBe("secret-xyz");
    expect(out.iss).toBe("managed");
  });

  test("rejects with wrong secret key", () => {
    const kp1 = generateKeyPairHex();
    const kp2 = generateKeyPairHex();
    const env = seal(samplePayload(), kp1.publicKey);
    expect(() => open(env, kp1.publicKey, kp2.secretKey)).toThrow();
  });

  test("rejects expired payload", () => {
    const kp = generateKeyPairHex();
    const env = seal(samplePayload(past), kp.publicKey);
    expect(() => open(env, kp.publicKey, kp.secretKey)).toThrow(/expired/);
  });

  test("rejects tampered ciphertext", () => {
    const kp = generateKeyPairHex();
    const env = seal(samplePayload(), kp.publicKey);
    const flipped = env.slice(0, -2) + (env.slice(-2) === "AA" ? "BB" : "AA");
    expect(() => open(flipped, kp.publicKey, kp.secretKey)).toThrow();
  });

  test("rejects malformed input", () => {
    const kp = generateKeyPairHex();
    expect(() => open("not-base64-!", kp.publicKey, kp.secretKey)).toThrow();
    expect(() => open("AAAA", kp.publicKey, kp.secretKey)).toThrow();
  });
});
