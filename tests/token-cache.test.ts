import { describe, test, expect } from "bun:test";
import { getOrRefresh, fetchToken, credsKey, TokenExchangeError } from "../src/kiotviet/token";
import { InProcessLock, MemoryStore } from "../src/store/memory";

const CREDS = { clientId: "client-1", clientSecret: "secret-1" };
const TOKEN_URL = "https://id.kiotviet.vn/connect/token";

function fakeFetch(payload: { access_token: string; expires_in: number }, ok = true, status = 200): typeof fetch {
  let calls = 0;
  const f = (async () => {
    calls += 1;
    return new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  (f as any).calls = () => calls;
  return f;
}

describe("token cache", () => {
  test("credsKey is deterministic", async () => {
    const k1 = await credsKey(CREDS);
    const k2 = await credsKey(CREDS);
    expect(k1).toBe(k2);
    expect(k1.length).toBe(64);
  });

  test("hits cache on second call", async () => {
    const store = new MemoryStore();
    const lock = new InProcessLock();
    const fetchImpl = fakeFetch({ access_token: "tok-A", expires_in: 3600 });

    const first = await getOrRefresh(CREDS, { store, lock, tokenUrl: TOKEN_URL, fetchImpl });
    const second = await getOrRefresh(CREDS, { store, lock, tokenUrl: TOKEN_URL, fetchImpl });

    expect(first.access_token).toBe("tok-A");
    expect(second.access_token).toBe("tok-A");
    expect((fetchImpl as any).calls()).toBe(1);
  });

  test("single-flight under concurrent calls", async () => {
    const store = new MemoryStore();
    const lock = new InProcessLock();
    let calls = 0;
    const slowFetch = (async () => {
      calls += 1;
      await new Promise((r) => setTimeout(r, 25));
      return new Response(JSON.stringify({ access_token: "tok-B", expires_in: 3600 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const results = await Promise.all(
      Array.from({ length: 50 }, () => getOrRefresh(CREDS, { store, lock, tokenUrl: TOKEN_URL, fetchImpl: slowFetch })),
    );

    expect(results.every((r) => r.access_token === "tok-B")).toBe(true);
    expect(calls).toBe(1);
  });

  test("propagates token exchange errors", async () => {
    const errFetch = (async () => new Response("bad creds", { status: 401 })) as unknown as typeof fetch;
    await expect(fetchToken(CREDS, TOKEN_URL, errFetch)).rejects.toBeInstanceOf(TokenExchangeError);
  });
});
