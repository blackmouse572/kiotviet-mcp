# Setup

Two supported runtimes, same code path:

| Runtime | When | Storage | Single-flight |
|---|---|---|---|
| **Bun** (`bun run dev`) | Local dev, tests, self-hosted | In-memory `Map` | In-process Promise map |
| **Cloudflare Workers** (`wrangler dev` / `wrangler deploy`) | Production | KV namespace `KIOTVIET_TOKENS` | Durable Object `TokenRefreshAgent` |

The picker lives in `src/index.ts`: if `env.KIOTVIET_TOKENS` (a KV binding) is present it switches on, otherwise it falls back to memory. No config flag.

## 1. Install

```bash
bun install
bun run gen:tools   # writes src/generated/tools.json (committed, but safe to re-run)
```

## 2. Configure secrets

```bash
cp .env.example .env
```

Fill in:

| Var | What | How to generate |
|---|---|---|
| `MCP_BEARER_PK` | Envelope public key (hex, 32 bytes) | `bun -e 'import {generateKeyPairHex} from "./src/auth/envelope"; console.log(generateKeyPairHex())'` |
| `MCP_BEARER_SK` | Matching secret key | (same command — emits both) |
| `LINK_HMAC_SECRET` | Shared secret with the trusted backend that signs `/internal/link` + `/tools` | `openssl rand -hex 32` |
| `TOKEN_CACHE_KEY` (optional) | AES-256-GCM key wrapping KV values | `openssl rand -hex 32` |

Workers parity:

```bash
wrangler secret put MCP_BEARER_PK
wrangler secret put MCP_BEARER_SK
wrangler secret put LINK_HMAC_SECRET
wrangler secret put TOKEN_CACHE_KEY   # optional
```

## 3. Run locally (Bun)

```bash
bun run dev
# kiotviet-mcp listening on http://localhost:8787
```

Smoke check:

```bash
curl http://localhost:8787/healthz
# {"ok":true,"runtime":"memory","tools":116}
```

Issue a bearer via the managed-link path (HMAC-signed):

```bash
bun -e '
import { sign } from "./src/auth/hmac";
const body = JSON.stringify({
  retailer: "abcstore",
  clientId: "89ec7ea7-e662-4d83-811e-2268ff961231",
  clientSecret: "F66386F43AE5C9A4EFB65797D3A59C4AEB535C10",
  iss: "managed",
});
const ts = String(Math.floor(Date.now() / 1000));
const sig = await sign(process.env.LINK_HMAC_SECRET, ts, "POST", "/internal/link", body);
const res = await fetch("http://localhost:8787/internal/link", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-link-timestamp": ts,
    "x-link-signature": sig,
  },
  body,
});
console.log(await res.json());
'
```

List tools through MCP:

```bash
BEARER=<bearer-from-above>
curl -s http://localhost:8787/mcp \
  -H "authorization: Bearer $BEARER" \
  -H "content-type: application/json" \
  -H "accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | jq '.result.tools | length'
```

## 4. Run with Workers bindings (`wrangler dev`)

Uncomment the KV + DO sections in `wrangler.toml` and create the namespace:

```bash
wrangler kv namespace create KIOTVIET_TOKENS
# paste the returned `id` into wrangler.toml
wrangler dev
```

`wrangler dev` runs via miniflare and gives you KV + DO with the same code path used in production.

## 5. Deploy

```bash
wrangler deploy
```

Operational tasks:

- **Rotate envelope keypair** — `wrangler secret put MCP_BEARER_SK` (and `MCP_BEARER_PK`). All existing bearers immediately return 401 — this is the v1 revocation story. Re-link from the trusted backend to mint fresh bearers.
- **Bump SDK** — see `docs/generator.md` for the bump → regenerate → test loop.
- **Inspect the catalog** — `curl -s ${WORKER}/tools -H "..."` (HMAC-signed) returns the post-override list. Use this to confirm what's actually exposed in prod.

## 6. BYO client setup (Claude Desktop / Cursor)

Add the worker URL to the client config:

```json
{
  "mcpServers": {
    "kiotviet": {
      "url": "https://kiotviet-mcp.<your-domain>/mcp"
    }
  }
}
```

On first connect, the client follows the OAuth pointer to `/authorize`, presents the form, and the worker returns the bearer via the standard redirect path. The bearer is opaque to the client.

## 7. Tests

```bash
bun test
# 21 pass / 0 fail
```

`tests/e2e.test.ts` runs the full HTTP flow against an injected fake SDK; `tests/token-cache.test.ts` covers single-flight; `tests/envelope.test.ts` + `tests/hmac.test.ts` cover the crypto primitives. No network access required.

For a real-network sandbox check, run the curl flow in §3 against a KiotViet sandbox retailer.

## Common failures

| Symptom | Likely cause |
|---|---|
| `/internal/link` → `401 invalid signature` | Clock skew >60s, or `LINK_HMAC_SECRET` mismatch between worker and the calling backend. |
| `/internal/link` → `400 credentials rejected by KiotViet` | Wrong clientId/secret, or retailer mismatch on KiotViet's side. |
| `/mcp` → `401 invalid bearer` | Envelope signed with a different `MCP_BEARER_PK`, or `exp` passed. Re-link. |
| `tools/call` → `{isError: true, "Authentication Failed: ... 401"}` | Cached token rejected by KiotViet (revoked). Wait for TTL or call `POST /internal/link` again to force a fresh exchange. |
| `tools/list` is missing a tool you expect | Either the override has `hidden: true`, or the SDK upgrade dropped it. Check `src/generated/tools.json`. |
