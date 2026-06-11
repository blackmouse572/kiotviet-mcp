import { describe, test, expect } from "bun:test";
import { sign, verify, HMAC_SIGNATURE_HEADER, HMAC_TIMESTAMP_HEADER } from "../src/auth/hmac";

const SECRET = "shared-secret-do-not-use-in-prod-x";
const NOW = 1_700_000_000;

describe("hmac", () => {
  test("verifies a valid signature", async () => {
    const ts = String(NOW);
    const body = JSON.stringify({ a: 1 });
    const sig = await sign(SECRET, ts, "POST", "/internal/link", body);
    const ok = await verify(SECRET, { timestamp: ts, signature: sig }, "POST", "/internal/link", body, { nowSec: NOW });
    expect(ok).toBe(true);
  });

  test("rejects altered body", async () => {
    const ts = String(NOW);
    const body = JSON.stringify({ a: 1 });
    const sig = await sign(SECRET, ts, "POST", "/internal/link", body);
    const ok = await verify(SECRET, { timestamp: ts, signature: sig }, "POST", "/internal/link", JSON.stringify({ a: 2 }), { nowSec: NOW });
    expect(ok).toBe(false);
  });

  test("rejects outside window", async () => {
    const ts = String(NOW);
    const body = "";
    const sig = await sign(SECRET, ts, "POST", "/x", body);
    const ok = await verify(SECRET, { timestamp: ts, signature: sig }, "POST", "/x", body, { nowSec: NOW + 120 });
    expect(ok).toBe(false);
  });

  test("rejects missing headers", async () => {
    const ok = await verify(SECRET, {}, "POST", "/x", "", { nowSec: NOW });
    expect(ok).toBe(false);
  });

  test("rejects malformed signature hex", async () => {
    const ok = await verify(SECRET, { timestamp: String(NOW), signature: "zzzz" }, "POST", "/x", "", { nowSec: NOW });
    expect(ok).toBe(false);
  });

  test("header constants are lowercase", () => {
    expect(HMAC_TIMESTAMP_HEADER).toBe("x-link-timestamp");
    expect(HMAC_SIGNATURE_HEADER).toBe("x-link-signature");
  });
});
