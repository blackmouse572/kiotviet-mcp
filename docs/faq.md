# FAQ

Distilled from real conversations. Skim by question; each answer points at the file you'd touch if you want to dig further.

## Bearers & auth

### How long does a bearer last?

`BEARER_TTL_SECONDS` — default **90 days** (`7776000`). Set it in `.env` (Bun) or `wrangler.toml` `[vars]` (Workers). Schema is `src/env.ts`.

### What happens when a bearer expires?

`/mcp` returns `401 {"error": "invalid bearer", "detail": "expired"}`. The decode rejects on `payload.exp < now` in `src/auth/envelope.ts:open`. Caller must re-link to get a fresh envelope.

### Does the bearer auto-renew?

**No** (v1). The bearer is opaque to its holder, so the worker has no defined way to push a fresh one back. The KiotViet access token *inside* the worker's cache **does** renew automatically (every ~24h, single-flight). See `docs/auth.md` and [Pattern A in the conversation that produced this doc] for a rolling-refresh header proposal.

### Does the user have to re-enter credentials every time?

**No** — only once per shop. The bearer covers 90 days; KiotViet token refresh inside the worker is invisible. Re-entry only happens at link time, when the bearer expires, or when the user explicitly revokes.

### Why does the user have to type `clientId` / `clientSecret` at all?

KiotViet's API only exposes the `client_credentials` OAuth grant — there's no end-user authorization flow we can delegate to. So **somebody** has to type the API credentials once. The user gets them from `<retailer>.kiotviet.vn` → Settings → Integrations → API.

### Where can the user find their KiotViet credentials?

KiotViet admin dashboard → Settings → Integrations → API → "Create application". The `retailer` is the subdomain (`<retailer>.kiotviet.vn`).

### How does eccho (or any trusted backend) authenticate to the worker?

**HMAC-SHA256 over `timestamp + method + path + sha256(body)`** with the shared `LINK_HMAC_SECRET`. Headers: `x-link-timestamp`, `x-link-signature`. 60-second clock skew window. See `src/auth/hmac.ts` and `docs/auth.md`.

### How does Claude (BYO) authenticate to the worker?

It presents `Authorization: Bearer <envelope>` on `/mcp`. The bearer was issued by the worker's own `/authorize` consent page (or `POST /internal/link` for the managed flow). The MCP-spec OAuth discovery dance (well-known endpoints, dynamic client registration, code-for-token exchange) is **not** wired up yet — see `docs/setup.md` §6.

### Can I revoke a single bearer?

**Not in v1.** The plan calls this out as a deferred follow-up (`plan.md` § "Open follow-ups"). v1's revocation story is **rotate `MCP_BEARER_SK`**, which 401s every outstanding bearer at once. If you need per-bearer revocation, you'd add a KV denylist of bearer hashes consulted at the top of `/mcp`.

## Runtime & deployment

### Does the worker need Cloudflare?

No. It runs on Bun (`bun run dev`) with in-memory storage, or on Cloudflare Workers (KV + DO) for edge prod. Same code path; `src/index.ts` auto-picks based on the presence of the `KIOTVIET_TOKENS` KV binding.

### Can I run without Cloudflare KV + Durable Objects?

Yes — that's the default. The runtime picker in `src/index.ts:pickStorage` falls back to `MemoryStore` + `InProcessLock` when no `KIOTVIET_TOKENS` binding is present. No env flag, no config change. Works in:

- **Bun on a single VM / container** — `bun src/index.ts` behind nginx/caddy/Cloudflare Tunnel for TLS.
- **`wrangler dev`** with the KV/DO sections in `wrangler.toml` left commented.
- **`wrangler deploy`** without ever creating a KV namespace — runs at the edge, just with per-isolate caches.

What you give up without KV+DO:

1. **Cache is per-process.** A restart triggers fresh `client_credentials` exchanges (cheap, ~200ms each).
2. **No cross-instance sharing.** N replicas → up to N parallel token exchanges per shop on cold start. Still single-flight per-replica.
3. **No cross-region sharing.** Multi-region Workers deployments cold-start independently per region.

What you keep:

- Bearer validation works identically — stateless, all truth is sealed inside the bearer.
- Single-flight within a single isolate (in-process Promise map).
- Tool catalog (bundled at build time, no runtime fetching).

When to graduate to KV+DO:

- Thousands of active shops where cold-isolate churn becomes wasteful.
- KiotViet starts rate-limiting your `client_credentials` calls.
- Multi-region edge deployment where region-local caches feel wasteful.
- You want forensic visibility into token issuance via KV's write log.

Adding them later is non-breaking — uncomment the `wrangler.toml` blocks, `wrangler kv namespace create KIOTVIET_TOKENS`, redeploy. Existing bearers keep working. **One caveat**: in-memory mode on Workers (no KV) is wasteful because Workers isolates are short-lived — cache evaporates every few minutes. For sustained Workers traffic, KV is genuinely cheaper. For Bun / VM / long-lived containers, memory is fine.

### Why isn't `bun run dev` picking up `.env`?

It is — but `src/index.ts` defaults its server config via `export default { port, fetch }`. Make sure your `.env` has the required keys (`MCP_BEARER_PK`, `MCP_BEARER_SK`, `LINK_HMAC_SECRET`) — zod will reject otherwise and the server will return a Bun fallback error page. If port 8787 is in use you'll see `EADDRINUSE` — kill the previous instance with `lsof -ti :8787 | xargs kill -9`.

### Does the dev server need HTTPS?

Locally no — `http://localhost:8787` is fine for the managed-link flow. For BYO (MCP OAuth) you'll want HTTPS so browsers don't block the consent redirect. Use a tunnel (cloudflared, ngrok) or deploy via `wrangler`.

## Tools & catalog

### Where do the 116 tools come from?

`scripts/generate-tools.ts` walks `KiotVietClient` in `kiotviet-client-sdk` via ts-morph and emits one tool per public handler method into `src/generated/tools.json`. `src/generated/overrides.ts` patches descriptions, refines schemas, and hides sensitive endpoints (`webhooks.create/update/delete`). Final count comes from the merge in `src/catalog.ts`.

### How do I add a new tool?

You don't — bump the SDK version, run `bun run gen:tools`, and the new tool appears in the catalog automatically. If the auto-generated schema is too loose, patch it in `src/generated/overrides.ts`. Full workflow in `docs/generator.md`.

### Why doesn't my override change `tools.json`?

By design. `tools.json` is the generator's deterministic output; `overrides.ts` is a runtime patch layer applied in `src/catalog.ts`. This keeps `git diff src/generated/tools.json` clean for SDK drift in CI, and lets you regenerate without losing hand edits.

### How do I hide a tool from BYO callers?

Add an entry in `src/generated/overrides.ts`:

```ts
"webhooks.create": { hidden: true },
```

`loadCatalog()` drops it from both `tools/list` and dispatch.

## Operations

### How do I rotate the bearer keypair?

```bash
wrangler secret put MCP_BEARER_PK
wrangler secret put MCP_BEARER_SK
```

Every outstanding bearer immediately returns 401. Re-link from the trusted backend (managed flow) or via `/authorize` (BYO) to mint fresh bearers.

### How do I see what tools are exposed in prod?

```bash
curl -s ${WORKER}/tools \
  -H "x-link-timestamp: <ts>" \
  -H "x-link-signature: <sig>"
```

Returns the post-override catalog. Same payload as the `tools/list` MCP method.

### What happens during a KiotViet outage?

- `getOrRefresh` raises `TokenExchangeError` when KiotViet returns non-2xx.
- `/internal/link` translates that to `400 credentials rejected by KiotViet` (during initial validation).
- `/mcp` translates that to `502 kiotviet rejected credentials` (during runtime refresh).
- Cached tokens keep serving until they expire; if KiotViet stays down past their TTL, all calls fail until KiotViet recovers.

### How do I monitor in production?

`/healthz` returns `{ok, runtime, tools}`. For deeper observability, instrument `src/kiotviet/token.ts:getOrRefresh` (cache hits/misses, fetch errors) and `src/app.ts` route handlers (401 reasons, dispatch errors). v1 ships without metrics — wire your platform's logger of choice.

## Anything else

### Can I run it as a stdio MCP server?

Not currently — the SDK transport is Streamable HTTP only. If you want stdio (Claude Desktop without `mcp-remote`), wrap the in-process Hono app with `StdioServerTransport` and reuse `buildMcpServer`. Maybe 30 lines.

### Where do I look first when something breaks?

| Symptom | Read |
|---|---|
| `/internal/link` → 401 | `src/auth/hmac.ts:verify` + check `LINK_HMAC_SECRET` matches on both sides + check clock skew |
| `/mcp` → 401 | `src/auth/envelope.ts:open` (key rotation? expired bearer?) |
| `tools/call` → `isError: true` | The text inside `content[0].text` is the SDK error verbatim — look there, not in worker logs |
| Empty tool list | Check `src/generated/overrides.ts` for `hidden: true` entries; check `src/generated/tools.json` for SDK drift |
| Hot reload doesn't pick up changes | `bun run dev` uses `--hot`; if you edited `wrangler.toml`, restart manually |
