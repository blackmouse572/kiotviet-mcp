import { Hono } from "hono";
import { z } from "zod";
import type { Env, Runtime, WorkersBindings } from "./env";
import type { Lock, TokenStore } from "./store/types";
import { open, seal } from "./auth/envelope";
import { verify, HMAC_SIGNATURE_HEADER, HMAC_TIMESTAMP_HEADER } from "./auth/hmac";
import { renderConsentPage } from "./auth/consent-page";
import { getOrRefresh, TokenExchangeError } from "./kiotviet/token";
import { clientFor } from "./kiotviet/client";
import { handleMcpRequest } from "./mcp/server";
import { loadCatalog } from "./catalog";
import type { SdkContext } from "./kiotviet/client";
import type { CachedToken } from "./store/types";
import { CATALOG_PROFILE_HEADER, parseCatalogProfile } from "./tool-metadata";

export type ClientFactory = (
  creds: { retailer: string; clientId: string; clientSecret: string },
  cachedToken: CachedToken,
) => SdkContext;

export interface AppDeps {
  env: Env;
  runtime: Runtime;
  store: TokenStore;
  lock: Lock;
  bindings?: WorkersBindings;
  clientFactory?: ClientFactory;
}

const LinkBody = z.object({
  retailer: z.string().min(1),
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  iss: z.enum(["managed", "byo"]).default("managed"),
});

export function buildApp(deps: AppDeps) {
  const app = new Hono();
  const { env } = deps;
  const makeClient: ClientFactory = deps.clientFactory ?? ((creds, cachedToken) => clientFor(creds, cachedToken));
  const resolveProfile = (raw: string | undefined) => parseCatalogProfile(raw, env.DEFAULT_TOOL_PROFILE);

  app.get("/healthz", (c) =>
    c.json({
      ok: true,
      runtime: deps.runtime,
      tools: loadCatalog(env.DEFAULT_TOOL_PROFILE).length,
    }),
  );

  // GET /tools — HMAC-required catalog, used by the trusted backend during integration discovery.
  app.get("/tools", async (c) => {
    const ok = await verify(
      env.LINK_HMAC_SECRET,
      {
        timestamp: c.req.header(HMAC_TIMESTAMP_HEADER),
        signature: c.req.header(HMAC_SIGNATURE_HEADER),
      },
      "GET",
      "/tools",
      "",
    );
    if (!ok) return c.json({ error: "invalid signature" }, 401);
    const profile = resolveProfile(c.req.header(CATALOG_PROFILE_HEADER));
    if (!profile) return c.json({ error: `invalid tool profile; use curated or full in ${CATALOG_PROFILE_HEADER}` }, 400);
    return c.json({
      tools: loadCatalog(profile).map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    });
  });

  // POST /internal/link — managed link path (called by a trusted backend).
  app.post("/internal/link", async (c) => {
    const raw = await c.req.text();
    const ok = await verify(
      env.LINK_HMAC_SECRET,
      {
        timestamp: c.req.header(HMAC_TIMESTAMP_HEADER),
        signature: c.req.header(HMAC_SIGNATURE_HEADER),
      },
      "POST",
      "/internal/link",
      raw,
    );
    if (!ok) return c.json({ error: "invalid signature" }, 401);

    let parsed: z.infer<typeof LinkBody>;
    try {
      parsed = LinkBody.parse(JSON.parse(raw));
    } catch (err) {
      return c.json({ error: "bad request", detail: String(err) }, 400);
    }

    try {
      await getOrRefresh(
        { clientId: parsed.clientId, clientSecret: parsed.clientSecret },
        { store: deps.store, lock: deps.lock, tokenUrl: env.KIOTVIET_TOKEN_URL },
      );
    } catch (err) {
      if (err instanceof TokenExchangeError) {
        return c.json({ error: "credentials rejected by KiotViet", status: err.status }, 400);
      }
      return c.json({ error: "validation failed" }, 502);
    }

    const exp = Math.floor(Date.now() / 1000) + env.BEARER_TTL_SECONDS;
    const bearer = seal(
      {
        retailer: parsed.retailer,
        clientId: parsed.clientId,
        clientSecret: parsed.clientSecret,
        iss: parsed.iss,
        exp,
      },
      env.MCP_BEARER_PK,
    );
    return c.json({ bearer, expiresAt: exp });
  });

  // GET /authorize — BYO consent page.
  app.get("/authorize", (c) =>
    c.html(
      renderConsentPage({
        redirectUri: c.req.query("redirect_uri") ?? undefined,
        state: c.req.query("state") ?? undefined,
      }),
    ),
  );

  // POST /authorize — issue bearer for BYO callers.
  app.post("/authorize", async (c) => {
    const form = await c.req.formData();
    const retailer = String(form.get("retailer") ?? "").trim();
    const clientId = String(form.get("clientId") ?? "").trim();
    const clientSecret = String(form.get("clientSecret") ?? "").trim();
    const redirectUri = String(form.get("redirect_uri") ?? "").trim() || undefined;
    const state = String(form.get("state") ?? "").trim() || undefined;
    if (!retailer || !clientId || !clientSecret) {
      return c.html(renderConsentPage({ redirectUri, state, error: "All fields are required." }), 400);
    }

    try {
      await getOrRefresh(
        { clientId, clientSecret },
        { store: deps.store, lock: deps.lock, tokenUrl: env.KIOTVIET_TOKEN_URL },
      );
    } catch (err) {
      const msg = err instanceof TokenExchangeError ? "Credentials rejected by KiotViet." : "Could not reach KiotViet.";
      return c.html(renderConsentPage({ redirectUri, state, error: msg }), 400);
    }

    const exp = Math.floor(Date.now() / 1000) + env.BEARER_TTL_SECONDS;
    const bearer = seal(
      { retailer, clientId, clientSecret, iss: "byo", exp },
      env.MCP_BEARER_PK,
    );

    if (redirectUri) {
      const url = new URL(redirectUri);
      url.searchParams.set("code", bearer);
      if (state) url.searchParams.set("state", state);
      return c.redirect(url.toString());
    }
    return c.html(
      `<!doctype html><html><body style="font-family:system-ui;max-width:480px;margin:5vh auto;padding:0 1rem;">
        <h1>Connected</h1>
        <p>Paste the bearer below into your MCP client.</p>
        <textarea rows="6" style="width:100%;font-family:monospace;">${bearer}</textarea>
      </body></html>`,
    );
  });

  // POST /mcp — MCP Streamable HTTP entrypoint.
  app.all("/mcp", async (c) => {
    const profile = resolveProfile(c.req.header(CATALOG_PROFILE_HEADER));
    if (!profile) return c.json({ error: `invalid tool profile; use curated or full in ${CATALOG_PROFILE_HEADER}` }, 400);
    const auth = c.req.header("authorization") ?? "";
    const bearer = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
    if (!bearer) return c.json({ error: "missing bearer" }, 401);

    let payload;
    try {
      payload = open(bearer, env.MCP_BEARER_PK, env.MCP_BEARER_SK);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "bad bearer";
      return c.json({ error: "invalid bearer", detail: msg }, 401);
    }

    let cachedToken;
    try {
      cachedToken = await getOrRefresh(
        { clientId: payload.clientId, clientSecret: payload.clientSecret },
        { store: deps.store, lock: deps.lock, tokenUrl: env.KIOTVIET_TOKEN_URL },
      );
    } catch (err) {
      if (err instanceof TokenExchangeError) {
        return c.json({ error: "kiotviet rejected credentials", status: err.status }, 502);
      }
      return c.json({ error: "kiotviet upstream failure" }, 502);
    }

    const sdkCtx = makeClient(
      { retailer: payload.retailer, clientId: payload.clientId, clientSecret: payload.clientSecret },
      cachedToken,
    );
    return handleMcpRequest(c.req.raw, { client: sdkCtx.client, retailer: sdkCtx.retailer, profile });
  });

  return app;
}
