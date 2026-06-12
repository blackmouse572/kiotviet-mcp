import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { buildApp, type ClientFactory } from "../src/app";
import { parseEnv } from "../src/env";
import { InProcessLock, MemoryStore } from "../src/store/memory";
import { generateKeyPairHex } from "../src/auth/envelope";
import { sign, HMAC_SIGNATURE_HEADER, HMAC_TIMESTAMP_HEADER } from "../src/auth/hmac";
import { CATALOG_PROFILE_HEADER } from "../src/tool-metadata";

const HMAC_SECRET = "shared-secret-for-tests-do-not-use-x";

const FAKE_PRODUCTS = {
  total: 1,
  pageSize: 20,
  currentItem: 0,
  data: [{ id: 1, code: "P-001", name: "Test Product" }],
};

const fakeClientFactory: ClientFactory = (creds) => ({
  retailer: creds.retailer,
  client: {
    products: {
      list: async () => FAKE_PRODUCTS,
      getById: async () => FAKE_PRODUCTS.data[0],
      search: async () => FAKE_PRODUCTS,
    },
    customers: { list: async () => ({ total: 0, data: [] }) },
  } as any,
});

function makeEnv() {
  const kp = generateKeyPairHex();
  return parseEnv({
    MCP_BEARER_PK: kp.publicKey,
    MCP_BEARER_SK: kp.secretKey,
    LINK_HMAC_SECRET: HMAC_SECRET,
    KIOTVIET_TOKEN_URL: "https://id.kiotviet.vn/connect/token",
    BEARER_TTL_SECONDS: "3600",
  });
}

interface FetchMockOptions {
  token?: { access_token: string; expires_in: number };
  productsResponse?: unknown;
  rejectAuth?: boolean;
}

function installFetchMock(opts: FetchMockOptions = {}) {
  const original = globalThis.fetch;
  const calls: { url: string; method: string; body?: string }[] = [];
  const tokenPayload = opts.token ?? { access_token: "TEST_TOKEN", expires_in: 3600 };
  const productsPayload = opts.productsResponse ?? {
    total: 1,
    pageSize: 20,
    currentItem: 0,
    data: [{ id: 1, code: "P-001", name: "Test Product" }],
  };

  globalThis.fetch = (async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : input?.url ?? "";
    const method = init?.method?.toUpperCase() ?? (typeof input === "object" && input?.method ? input.method.toUpperCase() : "GET");
    calls.push({ url, method, body: init?.body });

    if (url.includes("/connect/token")) {
      if (opts.rejectAuth) return new Response("bad creds", { status: 401 });
      return new Response(JSON.stringify(tokenPayload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.includes("/products") || url.match(/v2\/products/)) {
      return new Response(JSON.stringify(productsPayload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

let mock: ReturnType<typeof installFetchMock> | undefined;

afterEach(() => {
  mock?.restore();
  mock = undefined;
});

async function signedFetch(env: ReturnType<typeof makeEnv>, method: string, path: string, body: string) {
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = await sign(env.LINK_HMAC_SECRET, ts, method, path, body);
  return { ts, sig };
}

describe("e2e", () => {
  test("happy path: link → bearer → tools/list → tools/call", async () => {
    const env = makeEnv();
    mock = installFetchMock();
    const app = buildApp({ env, runtime: "memory", store: new MemoryStore(), lock: new InProcessLock(), clientFactory: fakeClientFactory });

    const linkBody = JSON.stringify({
      retailer: "abcstore",
      clientId: "client-id-1",
      clientSecret: "client-secret-1",
      iss: "managed",
    });
    const { ts, sig } = await signedFetch(env, "POST", "/internal/link", linkBody);

    const linkRes = await app.fetch(
      new Request("http://x/internal/link", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [HMAC_TIMESTAMP_HEADER]: ts,
          [HMAC_SIGNATURE_HEADER]: sig,
        },
        body: linkBody,
      }),
    );
    expect(linkRes.status).toBe(200);
    const linkJson = (await linkRes.json()) as { bearer: string };
    expect(linkJson.bearer).toBeTruthy();

    const initBody = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } },
    });
    const initRes = await app.fetch(
      new Request("http://x/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${linkJson.bearer}`,
        },
        body: initBody,
      }),
    );
    expect(initRes.status).toBe(200);
    const initJson = (await initRes.json()) as { result?: { serverInfo: { name: string } } };
    expect(initJson.result?.serverInfo.name).toBe("kiotviet-mcp");

    const listBody = JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const listRes = await app.fetch(
      new Request("http://x/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${linkJson.bearer}`,
        },
        body: listBody,
      }),
    );
    expect(listRes.status).toBe(200);
    const listJson = (await listRes.json()) as { result: { tools: { name: string; description: string }[] } };
    const names = listJson.result.tools.map((t) => t.name);
    expect(names).toContain("products.list");
    expect(names).not.toContain("bankAccounts.getById");
    expect(names).not.toContain("webhooks.create");
    expect(listJson.result.tools.find((t) => t.name === "products.list")?.description).toContain("Purpose:");

    const callBody = JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: "products.list", arguments: { params: { pageSize: 20 } } },
    });
    const callRes = await app.fetch(
      new Request("http://x/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${linkJson.bearer}`,
        },
        body: callBody,
      }),
    );
    expect(callRes.status).toBe(200);
    const callJson = (await callRes.json()) as { result: { content: { type: string; text: string }[]; isError?: boolean } };
    if (callJson.result.isError) console.error("tool call error:", callJson.result.content[0]?.text);
    expect(callJson.result.isError).not.toBe(true);
    expect(callJson.result.content[0]?.text).toContain("Test Product");

    const tokenCalls = mock!.calls.filter((c) => c.url.includes("/connect/token"));
    expect(tokenCalls.length).toBe(1);
  });

  test("/mcp rejects missing bearer", async () => {
    const env = makeEnv();
    mock = installFetchMock();
    const app = buildApp({ env, runtime: "memory", store: new MemoryStore(), lock: new InProcessLock(), clientFactory: fakeClientFactory });
    const res = await app.fetch(new Request("http://x/mcp", { method: "POST", body: "{}" }));
    expect(res.status).toBe(401);
  });

  test("/internal/link rejects bad HMAC", async () => {
    const env = makeEnv();
    mock = installFetchMock();
    const app = buildApp({ env, runtime: "memory", store: new MemoryStore(), lock: new InProcessLock(), clientFactory: fakeClientFactory });
    const body = JSON.stringify({ retailer: "x", clientId: "x", clientSecret: "x", iss: "managed" });
    const res = await app.fetch(
      new Request("http://x/internal/link", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [HMAC_TIMESTAMP_HEADER]: String(Math.floor(Date.now() / 1000)),
          [HMAC_SIGNATURE_HEADER]: "deadbeef",
        },
        body,
      }),
    );
    expect(res.status).toBe(401);
  });

  test("/internal/link returns 400 when KiotViet rejects credentials", async () => {
    const env = makeEnv();
    mock = installFetchMock({ rejectAuth: true });
    const app = buildApp({ env, runtime: "memory", store: new MemoryStore(), lock: new InProcessLock(), clientFactory: fakeClientFactory });
    const body = JSON.stringify({ retailer: "x", clientId: "x", clientSecret: "x", iss: "managed" });
    const { ts, sig } = await signedFetch(env, "POST", "/internal/link", body);
    const res = await app.fetch(
      new Request("http://x/internal/link", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [HMAC_TIMESTAMP_HEADER]: ts,
          [HMAC_SIGNATURE_HEADER]: sig,
        },
        body,
      }),
    );
    expect(res.status).toBe(400);
  });

  test("/tools requires HMAC", async () => {
    const env = makeEnv();
    mock = installFetchMock();
    const app = buildApp({ env, runtime: "memory", store: new MemoryStore(), lock: new InProcessLock(), clientFactory: fakeClientFactory });
    const unauth = await app.fetch(new Request("http://x/tools"));
    expect(unauth.status).toBe(401);

    const { ts, sig } = await signedFetch(env, "GET", "/tools", "");
    const ok = await app.fetch(
      new Request("http://x/tools", {
        headers: { [HMAC_TIMESTAMP_HEADER]: ts, [HMAC_SIGNATURE_HEADER]: sig },
      }),
    );
    expect(ok.status).toBe(200);
    const json = (await ok.json()) as { tools: { name: string }[] };
    expect(json.tools.map((tool) => tool.name)).toContain("products.list");
    expect(json.tools.map((tool) => tool.name)).not.toContain("bankAccounts.getById");
  });

  test("/tools and /mcp can opt into the full profile", async () => {
    const env = makeEnv();
    mock = installFetchMock();
    const app = buildApp({ env, runtime: "memory", store: new MemoryStore(), lock: new InProcessLock(), clientFactory: fakeClientFactory });

    const body = JSON.stringify({ retailer: "x", clientId: "x", clientSecret: "x", iss: "managed" });
    const { ts, sig } = await signedFetch(env, "POST", "/internal/link", body);
    const linkRes = await app.fetch(
      new Request("http://x/internal/link", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [HMAC_TIMESTAMP_HEADER]: ts,
          [HMAC_SIGNATURE_HEADER]: sig,
        },
        body,
      }),
    );
    const linkJson = (await linkRes.json()) as { bearer: string };

    const fullHeaders = await signedFetch(env, "GET", "/tools", "");
    const fullToolsRes = await app.fetch(
      new Request("http://x/tools", {
        headers: {
          [HMAC_TIMESTAMP_HEADER]: fullHeaders.ts,
          [HMAC_SIGNATURE_HEADER]: fullHeaders.sig,
          [CATALOG_PROFILE_HEADER]: "full",
        },
      }),
    );
    expect(fullToolsRes.status).toBe(200);
    const fullToolsJson = (await fullToolsRes.json()) as { tools: { name: string }[] };
    expect(fullToolsJson.tools.map((tool) => tool.name)).toContain("bankAccounts.getById");

    const listBody = JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    const fullListRes = await app.fetch(
      new Request("http://x/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          authorization: "Bearer " + linkJson.bearer,
          [CATALOG_PROFILE_HEADER]: "full",
        },
        body: listBody,
      }),
    );
    expect(fullListRes.status).toBe(200);
    const fullListJson = (await fullListRes.json()) as { result: { tools: { name: string }[] } };
    expect(fullListJson.result.tools.map((tool) => tool.name)).toContain("bankAccounts.getById");
  });

  test("/mcp rejects tools outside the curated profile", async () => {
    const env = makeEnv();
    mock = installFetchMock();
    const app = buildApp({ env, runtime: "memory", store: new MemoryStore(), lock: new InProcessLock(), clientFactory: fakeClientFactory });

    const linkBody = JSON.stringify({
      retailer: "abcstore",
      clientId: "client-id-1",
      clientSecret: "client-secret-1",
      iss: "managed",
    });
    const { ts, sig } = await signedFetch(env, "POST", "/internal/link", linkBody);
    const linkRes = await app.fetch(
      new Request("http://x/internal/link", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [HMAC_TIMESTAMP_HEADER]: ts,
          [HMAC_SIGNATURE_HEADER]: sig,
        },
        body: linkBody,
      }),
    );
    const linkJson = (await linkRes.json()) as { bearer: string };

    const callBody = JSON.stringify({
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: { name: "bankAccounts.getById", arguments: { accountId: 1 } },
    });
    const callRes = await app.fetch(
      new Request("http://x/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          authorization: "Bearer " + linkJson.bearer,
        },
        body: callBody,
      }),
    );
    expect(callRes.status).toBe(200);
    const callJson = (await callRes.json()) as { result: { isError?: boolean; content: { text: string }[] } };
    expect(callJson.result.isError).toBe(true);
    expect(callJson.result.content[0]?.text).toContain("unknown tool: bankAccounts.getById");
  });

  test("GET /authorize renders consent page", async () => {
    const env = makeEnv();
    mock = installFetchMock();
    const app = buildApp({ env, runtime: "memory", store: new MemoryStore(), lock: new InProcessLock(), clientFactory: fakeClientFactory });
    const res = await app.fetch(new Request("http://x/authorize"));
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Connect KiotViet shop");
  });
});
