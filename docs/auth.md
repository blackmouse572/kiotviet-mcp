# Auth model

Two caller contexts hit the same worker. Both end up holding **an opaque sealed-envelope bearer** that the worker can decrypt to recover the underlying KiotViet credentials at request time. The worker stores no credentials at rest.

## The bearer

```
bearer = NaCl-sealed-box(
  encode_json({
    retailer:     "abcstore",
    clientId:     "...",
    clientSecret: "...",
    iss:          "managed" | "byo",
    exp:          <unix-seconds>,
  }),
  pk = MCP_BEARER_PK
)
```

- Sealed via `tweetnacl` with an ephemeral X25519 keypair and a nonce derived from `(eph_pk || recipient_pk)` — see `src/auth/envelope.ts`.
- Returned base64url-encoded.
- Only the worker (which holds `MCP_BEARER_SK`) can `open` it.
- `open` rejects on bad decrypt, malformed JSON, or `exp < now`.

To **rotate**: generate a new keypair, deploy with both keys (open tries both for a grace window if you wire it that way — v1 ships single-key, so all existing bearers 401 after rotation, which is also the v1 revocation story).

Generate a keypair locally:

```bash
bun -e 'import {generateKeyPairHex} from "./src/auth/envelope"; console.log(generateKeyPairHex())'
```

## Managed-link flow (`POST /internal/link`)

A trusted backend (your product's API) mints bearers on behalf of tenants that connected a KiotViet shop in your UI.

```
backend ──HMAC-signed POST {retailer, clientId, clientSecret, iss:"managed"}──▶ worker
                                                                                │
                                                   validates via client_credentials
                                                                                │
                                                             ◀── { bearer, expiresAt }
```

- Request is signed with `HMAC-SHA256(LINK_HMAC_SECRET, timestamp + "\n" + method + "\n" + path + "\n" + sha256(body))`.
- Headers: `x-link-timestamp` (unix seconds), `x-link-signature` (hex).
- 60-second clock skew window; rejects everything else with `401`.
- On success, the worker calls KiotViet's `client_credentials` endpoint once to validate the creds, then seals the envelope with `exp = now + BEARER_TTL_SECONDS`.
- The backend stores the returned bearer against the tenant — treat it like any opaque OAuth token (envelope-encrypt at rest if you can).

Reference signer (mirrors `src/auth/hmac.ts`):

```ts
import { sign } from "./src/auth/hmac";

const ts = String(Math.floor(Date.now() / 1000));
const body = JSON.stringify({ retailer, clientId, clientSecret, iss: "managed" });
const sig = await sign(process.env.LINK_HMAC_SECRET!, ts, "POST", "/internal/link", body);

await fetch(`${WORKER_URL}/internal/link`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-link-timestamp": ts,
    "x-link-signature": sig,
  },
  body,
});
```

## BYO flow (`GET /authorize`, `POST /authorize`)

For third-party MCP clients (Claude Desktop, Cursor) the worker hosts a minimal consent form:

1. Client adds `https://<worker>/mcp` as a server URL.
2. On 401 + OAuth metadata pointer, client opens `GET /authorize?redirect_uri=…&state=…`.
3. User submits retailer + clientId + clientSecret to `POST /authorize`.
4. Worker validates against KiotViet, seals the envelope with `iss: "byo"`, and either:
   - redirects to `redirect_uri?code=<bearer>&state=<state>`, or
   - falls back to an HTML page that displays the bearer for manual paste.

The consent page is a single string template — `src/auth/consent-page.ts`. No JS, no third-party assets. v1.1 can grow branding / multi-step.

## Tool call (`POST /mcp`)

Single code path for both caller contexts:

```
Authorization: Bearer <envelope>

1.  open(envelope, MCP_BEARER_SK)              # request-scoped memory only
2.  if expired → 401
3.  getOrRefresh({clientId, clientSecret})     # KV-cached, single-flight
4.  clientFor({retailer, ...}, cachedToken)    # SDK instance, token pre-injected
5.  MCP Streamable-HTTP transport → tools/list, tools/call, …
6.  client + decrypted creds are dropped when the request finishes
```

Errors:
- `401 invalid bearer` — bad/tampered envelope, wrong key, or `exp` passed.
- `502 kiotviet rejected credentials` — KiotViet returned non-2xx on `client_credentials`; bearer is structurally fine but creds were revoked upstream.
- Per-tool errors come back as `{result: {isError: true, content: [...]}}` over MCP, not HTTP errors.

## `/tools` for backend discovery

`GET /tools` is HMAC-protected and returns the current catalog (post-overrides). A trusted backend can call it to cache the manifest at integration setup time, instead of forcing every tenant to re-walk the SDK at runtime.
