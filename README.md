# kiotviet-mcp

A first-party **Model Context Protocol** server that fronts the [KiotViet Retail Public API](https://www.kiotviet.vn/) and exposes every method of [`kiotviet-client-sdk`](https://www.npmjs.com/package/kiotviet-client-sdk) as an MCP tool.

The server is **runtime-portable**: the same code runs as a Bun process (in-memory storage) for local/self-hosted deployments, and as a Cloudflare Worker (KV + Durable Objects) for edge production deployments. The picker is automatic — if a `KIOTVIET_TOKENS` KV binding is present, the worker uses it; otherwise it falls back to memory.

## Introduction

It serves two caller contexts behind a single endpoint:

- **Managed link** — a trusted backend HMAC-posts a tenant's KiotViet credentials to `/internal/link` and gets back an opaque bearer it can store like any third-party OAuth token.
- **BYO (bring-your-own)** — third-party MCP clients (Claude Desktop, Cursor, ...) point at `/mcp`, follow the OAuth pointer to a hosted consent page, and receive the same bearer shape.

Both flows produce an **opaque sealed-envelope bearer** — the bearer is itself an encrypted blob containing the KiotViet credentials. The worker decrypts on each request, executes, and discards. No credentials are persisted at rest; the only durable state is a short-lived access-token cache.

## Features

- 🔐 **Stateless credential storage** — bearer = NaCl sealed-box envelope; rotate the keypair to revoke every outstanding bearer.
- 🌐 **Runtime-portable** — Bun (in-memory) or Cloudflare Workers (KV + Durable Objects), no code differences.
- 🛠️ **Profiled tool catalog** — `ts-morph` introspects `KiotVietClient` and emits **119 generated tools across 21 namespaces**. The runtime exposes a **21-tool curated default profile** with LLM-friendly descriptions, while the **full profile** keeps all **116 non-hidden tools** for advanced callers.
- ⚡ **Single-flight token refresh** — in-process Promise map locally; Durable Object per-key serialisation in Workers. Concurrent tool calls during expiry trigger exactly one `client_credentials` exchange.
- 🪝 **HMAC-signed admin surface** — `/internal/link` and `/tools` are gated by a shared secret with your backend; `/mcp` is gated by the sealed bearer.
- 🧪 **Test-first** — unit + e2e coverage for envelope crypto, HMAC, token cache concurrency, catalog profiles, and the full `link → tools/list → tools/call` flow against an injected fake SDK.

## Getting started

### Prerequisites

- [Bun](https://bun.sh) ≥ 1.3
- (Production only) Cloudflare Workers account + `wrangler`

### Install

```bash
bun install
bun run gen:tools     # writes src/generated/tools.json
```

### Configure

```bash
cp .env.example .env
```

Then fill in:

| Var | What |
|---|---|
| `MCP_BEARER_PK` / `MCP_BEARER_SK` | Envelope keypair (32-byte hex each) |
| `LINK_HMAC_SECRET` | Shared secret used by your backend to sign `/internal/link` and `/tools` requests |
| `DEFAULT_TOOL_PROFILE` *(optional)* | `curated` (default) for the smaller LLM-friendly catalog, or `full` for every non-hidden tool |
| `TOKEN_CACHE_KEY` *(optional)* | Wraps KV-cached tokens with AES-256-GCM |

Generate a keypair:

```bash
bun -e 'import {generateKeyPairHex} from "./src/auth/envelope"; console.log(generateKeyPairHex())'
```

### Run locally (Bun)

```bash
bun run dev
# kiotviet-mcp listening on http://localhost:8787
```

```bash
curl http://localhost:8787/healthz
# {"ok":true,"runtime":"memory","tools":21}
```

### Deploy to Cloudflare Workers

Uncomment the KV + DO sections in `wrangler.toml`, then:

```bash
wrangler kv namespace create KIOTVIET_TOKENS
wrangler secret put MCP_BEARER_PK
wrangler secret put MCP_BEARER_SK
wrangler secret put LINK_HMAC_SECRET
wrangler deploy
```

Full step-by-step (including `wrangler dev` with miniflare, key rotation, troubleshooting) → **[docs/setup.md](./docs/setup.md)**.

## How to use

### From an MCP client (BYO)

Point the client at `https://<worker>/mcp`. On first call the client follows the OAuth pointer to the consent page, where the user pastes their KiotViet `retailer`, `clientId`, and `clientSecret`. The worker validates against KiotViet's IDP, mints a sealed bearer, and the client stores it like any other OAuth token.

By default the server exposes the curated LLM-friendly tool profile. Advanced callers can request the full profile by sending `x-kiotviet-tool-profile: full` on both `/mcp` and `/tools`.

```json
{
  "mcpServers": {
    "kiotviet": { "url": "https://kiotviet-mcp.<your-domain>/mcp" }
  }
}
```

### From a trusted backend (managed link)

Mint bearers server-side for tenants who connected a KiotViet shop in your product UI. The worker validates the credentials against KiotViet's IDP, seals an envelope, and returns it — store it like any opaque per-account token.

```ts
import { sign } from "./src/auth/hmac";

const body = JSON.stringify({ retailer, clientId, clientSecret });
const ts = String(Math.floor(Date.now() / 1000));
const sig = await sign(LINK_HMAC_SECRET, ts, "POST", "/internal/link", body);

const { bearer } = await fetch(`${WORKER_URL}/internal/link`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-link-timestamp": ts,
    "x-link-signature": sig,
  },
  body,
}).then((r) => r.json());

// Persist `bearer` against the tenant (envelope-encrypt at rest if you can).
```

Then any tool call goes through `/mcp` with `Authorization: Bearer <bearer>`. The worker takes care of token cache, refresh, SDK construction, and dispatch.

### Test it end-to-end

```bash
bun test
```

The e2e suite runs the full HTTP path against an injected fake SDK — no network required.

## Project layout

```
src/
├── app.ts              # Hono routes: /mcp /internal/link /authorize /tools /healthz
├── index.ts            # Entrypoint — picks Bun or Workers runtime
├── env.ts              # Zod env schema + runtime detection
├── auth/               # Envelope crypto, HMAC, consent page
├── kiotviet/           # SDK factory + client_credentials exchange
├── mcp/                # MCP Server + dispatch into SDK handlers
├── store/              # TokenStore + Lock — memory + Workers KV/DO impls
├── catalog.ts          # Merges generated tools with overrides
└── generated/
    ├── tools.json      # Output of `bun run gen:tools` (committed)
    └── overrides.ts    # Hand-curated description / schema / hidden patches
scripts/
└── generate-tools.ts   # ts-morph SDK introspection
tests/
└── envelope / hmac / token-cache / e2e
```

## Documentation

| Topic | File |
|---|---|
| Auth model — bearer envelope, HMAC flow, BYO consent, error map | [docs/auth.md](./docs/auth.md) |
| Security model — trust boundaries, key material, threat model, ops checklist | [docs/security.md](./docs/security.md) |
| Tool catalog — generator internals, override layer, SDK-bump workflow | [docs/generator.md](./docs/generator.md) |
| Setup — Bun vs Workers, dev/deploy/rotation, troubleshooting | [docs/setup.md](./docs/setup.md) |
| FAQ — quick answers to common questions | [docs/faq.md](./docs/faq.md) |
| Environment variables | [.env.example](./.env.example) |

## License

Internal — see `LICENSE`.
