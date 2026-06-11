KiotViet MCP Server on Cloudflare Workers (Approach F)

Context

Eccho needs a KiotViet integration so workspaces can drive their KiotViet shops (products, customers, invoices, orders, etc.) from the chatbot. Composio doesn't cover KiotViet, so we're building a first-party MCP server that lives alongside it in eccho's tool registry.

The integration must support two caller contexts:





Eccho-managed — a workspace links a KiotViet shop in eccho's UI; eccho's chatbot uses it as a tool source.



BYO (bring-your-own) — third-party MCP clients (Claude Desktop, Cursor, etc.) connect directly to the same worker by pasting their own clientId/secret in a worker-hosted consent page.

Two non-negotiables shaped the design:





Eccho's tool layer must not gain a KiotViet-specific auth flow. Eccho already integrates composio with a thin "opaque handle per connected account" pattern. Every new MCP source (KiotViet, future Shopify/TikTok/Lazada/Shopee) must use the same shape — otherwise apps/api grows N protocol-specific auth implementations.



No shared in-memory map keyed by clientId. Anyone who learns a clientId could otherwise traverse to another shop's session. Whatever lookup the worker performs must be keyed by a high-entropy artifact attackers cannot guess from clientId alone.

The chosen architecture (Approach F below) makes the Cloudflare worker behave as a self-contained mini-composio: it owns all KiotViet protocol mess and exposes opaque bearers; eccho stores those bearers exactly like it stores connectedAccountId for composio.

Architecture — Approach F: Stateless worker, sealed-envelope bearer

Core idea: the MCP bearer is itself an encrypted envelope containing the shop's KiotViet credentials. The worker never persists credential material at rest — it decrypts on each request, executes, and discards. The only durable state is a short-lived access-token cache (lower-value than raw creds; bounded TTL).

bearer = enc_with_worker_key({
  retailer:     "abcstore",
  clientId:     "...",
  clientSecret: "...",
  iss:          "eccho" | "byo",
  exp:          unix_seconds
})

From eccho's perspective the bearer is just an opaque string — identical contract to composio's connectedAccountId.

Linking flows

Eccho-managed link





User opens workspace settings → "Connect KiotViet shop" → enters retailer, clientId, clientSecret.



apps/api POSTs creds to worker /internal/link (HMAC-signed by eccho with a shared secret).



Worker validates by exchanging once against id.kiotviet.vn/connect/token. On success, mints the sealed envelope bearer and returns it.



apps/api stores the bearer in tool.mcpCredential via the existing envelopeEncrypt utility — same column composio/operator MCPs already use.

BYO link





Claude Desktop / Cursor user adds https://kiotviet-mcp.<eccho-domain>/sse as an MCP server.



First call returns 401 with OAuth metadata pointing at worker /authorize.



Worker hosts a consent page that collects retailer + clientId + clientSecret.



Same validation + mint path as eccho-managed; bearer returned to the MCP client.

Tool call (single path for both caller contexts)

Caller → Worker /mcp     Authorization: Bearer <envelope>
Worker:
  creds = decrypt_with_worker_key(envelope)   # request-scoped memory only
  if creds.exp < now: return 401
  tok = tokenCache.getOrRefresh(creds)        # KV-backed, single-flight via DO
  return sdk(creds.retailer, tok).dispatch(toolName, args)

Storage on the worker





No credential storage. Bearers are self-contained envelopes.



Token cache only — Cloudflare KV namespace KIOTVIET_TOKENS, keyed by sha256(clientId + clientSecret), value { access_token, expires_at } with KV TTL matching token lifetime.



Refresh single-flight — a Durable Object class TokenRefreshAgent, addressed by the same hash, serialises refresh calls under concurrency. The DO holds no creds; it accepts creds-per-call and only persists the resulting token.



Optional revocation denylist (deferred to v1.1) — KV namespace KIOTVIET_REVOKED, list of bearer hashes; checked at the top of /mcp. v1 ships without it; revocation = rotate worker keypair.

Tool catalog generation (build-time)

The worker exposes every public method of kiotviet-client-sdk as an MCP tool. Generated at build time:





CI step pnpm tsx scripts/generate-tools.ts reads node_modules/kiotviet-client-sdk/**/*.d.ts via ts-morph.



For each public method on the SDK client, emits { name, description, inputSchema, dispatch: { namespace, method } } into src/generated/tools.json.



Worker bundles the JSON; at boot it registers all tools through @modelcontextprotocol/sdk.



Dispatch handler: (name, args, ctx) => ctx.sdk[dispatch.namespace][dispatch.method](args).

Adding a new SDK version = bump dep, rerun generator in CI, redeploy.

Crypto details





Worker bearer key — Ed25519 keypair stored in Cloudflare Workers Secrets (MCP_BEARER_SK, MCP_BEARER_PK). Envelope format: NaCl sealedbox (X25519 + XSalsa20-Poly1305) so only the worker can decrypt.



HMAC for /internal/link — shared symmetric secret between apps/api and worker, stored as ECCHO_LINK_HMAC in Workers Secrets and as an eccho env var. Bodies signed with HMAC-SHA256(timestamp + method + path + body); timestamp window 60s to block replay.



Token cache values are themselves AES-256-GCM encrypted with a separate Workers secret TOKEN_CACHE_KEY so leaked KV alone doesn't yield usable tokens.

Components and files

New Cloudflare worker (new app in monorepo)

Create apps/mcp-kiotviet/ as a new workspace package:

apps/mcp-kiotviet/
├── wrangler.toml                  # Workers config, KV + DO bindings
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                   # Worker entry — routes /mcp, /authorize, /internal/link
│   ├── mcp/
│   │   ├── server.ts              # MCP server setup (@modelcontextprotocol/sdk)
│   │   └── dispatch.ts            # Tool dispatch into SDK
│   ├── auth/
│   │   ├── envelope.ts            # seal/open bearer envelopes
│   │   ├── hmac.ts                # /internal/link signature verify
│   │   └── consent-page.html      # BYO /authorize UI
│   ├── kiotviet/
│   │   ├── client.ts              # SDK factory + Retailer header
│   │   └── token.ts               # client_credentials exchange + cache read/write
│   ├── durable-objects/
│   │   └── token-refresh-agent.ts # Single-flight refresh DO
│   └── generated/
│       └── tools.json             # Built by scripts/generate-tools.ts
├── scripts/
│   └── generate-tools.ts          # ts-morph SDK introspection → tools.json
└── tests/
    ├── envelope.test.ts
    ├── token-cache.test.ts
    └── e2e.test.ts                # Wrangler dev + miniflare

Reused libraries: @modelcontextprotocol/sdk, @cloudflare/workers-oauth-provider, kiotviet-client-sdk, ts-morph (dev only), tweetnacl (sealed boxes), zod.

Eccho-side changes (apps/api)

Mirror the existing OperatorToolkitInstaller pattern — verified in apps/api/src/modules/tool/installers/.

New / modified files:





apps/api/src/modules/tool/enums/mcp-provider.enum.ts — add ENUM_MCP_PROVIDER.KIOTVIET.



apps/api/src/modules/tool/interfaces/tool-source.interface.ts — add a 'KIOTVIET' variant to the ToolSource discriminated union (carries mcpServerUrl, no extra fields; the bearer lives in tool.mcpCredential).



apps/api/src/modules/tool/installers/kiotviet-toolkit-installer.ts — new installer implementing ToolkitInstaller:





begin(ctx) — returns the worker /authorize URL (for BYO-style link from eccho UI), OR for direct-link UX, accepts creds and POSTs to worker /internal/link.



complete(session, params) — receives bearer from callback, persists tool with mcpServerUrl = WORKER_URL and mcpCredential = envelopeEncrypt(bearer).



discover(tool) — GETs worker /tools (HMAC-signed), returns the MCP action manifest, stores in tool.discoveredActions (existing JSONB column).



reauth(ctx) — same as begin.



apps/api/src/modules/tool/installers/installer-registry.service.ts — register the new installer keyed by ENUM_MCP_PROVIDER.KIOTVIET.



apps/api/src/common/kiotviet-mcp/kiotviet-mcp.module.ts — small module exposing KiotvietMcpClient that wraps HMAC signing for outbound calls to the worker (/internal/link, /tools). Pattern mirrors apps/api/src/common/composio/composio.module.ts.



Env additions in apps/api:





KIOTVIET_MCP_WORKER_URL — e.g. https://kiotviet-mcp.<eccho-domain>



KIOTVIET_MCP_HMAC_SECRET — matches worker's ECCHO_LINK_HMAC

Pattern repeated across files: every new installer file follows the OperatorToolkitInstaller shape — same constructor signature, same method names, same DTO conventions. Do not enumerate every line; mirror it.

Frontend (apps/app)

Add a "Connect KiotViet" entry in the tools/integrations UI alongside the existing composio and operator-MCP entries. The interaction model is identical to operator-MCP linking from the user's perspective: form → submit → success state. Reuse the existing RouteFocusModal / RouteDrawer patterns described in .github/instructions/app/routing-and-modals.instructions.md.

Database

No new tables or migrations needed. The existing tool table already has:





mcp_provider (enum) — adding a new value



mcp_server_url (text) — worker URL



mcp_credential (text) — envelope-encrypted bearer



discovered_actions (jsonb) — tool manifest cache

Adding an enum value requires the same migration pattern used elsewhere in the codebase — check constraint (per the recent commit 5cd9a525 fix(migration): use check constraint instead of PG enum for status column).

Open follow-ups (NOT in v1)





Per-bearer revocation denylist — adds KV lookup per request, defer until a customer asks.



Webhook/event ingress from KiotViet — out of scope for the MCP tool-call model.



OAuth-provider consent flow polish for BYO — v1 uses a minimal HTML form; v1.1 can add branding / multi-step.



Token cache warming / preflight refresh — v1 refreshes lazily on cache miss or expiry.



Generator coverage for SDK methods with complex unions — start with the simple-shape methods; flag complex ones and curate manually if generator emits low-quality schemas.

Verification

End-to-end checks before merging:





Generator — pnpm --filter mcp-kiotviet run gen:tools produces src/generated/tools.json with ≥1 tool per SDK namespace; commit drift caught in CI.



Local worker — wrangler dev against Miniflare; tests/e2e.test.ts covers:





/internal/link rejects bad HMAC, accepts valid one, returns a bearer.



/mcp with that bearer lists tools and successfully invokes products.list against KiotViet's sandbox (or a recorded mock for offline runs).



Expired bearer returns 401; tampered bearer returns 401.



Concurrent tools/call during token expiry triggers exactly one /connect/token exchange (DO single-flight assertion).



Envelope — unit tests for seal/open, including wrong-key rejection and exp enforcement.



Eccho installer — apps/api integration test that:





Calls KiotvietToolkitInstaller.begin → complete against the local worker, persists a ToolEntity, verifies mcpCredential round-trips through envelopeEncrypt.



Calls discover(tool) and asserts discoveredActions matches the worker's /tools response.



Invokes a discovered action through the existing tool-invocation service and asserts the HTTP call to the worker carried the decrypted bearer.



Manual BYO smoke — add the deployed worker URL to Claude Desktop, complete the consent page with a sandbox shop, run list_products from a chat. Confirm bearer is opaque to the client and works across sessions until expiry.



Key rotation drill — rotate MCP_BEARER_SK, confirm all existing bearers return 401, confirm re-link mints fresh bearers — establishes the v1 revocation story.
