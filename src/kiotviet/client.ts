import { KiotVietClient } from "kiotviet-client-sdk";
import type { CachedToken } from "../store/types";

export interface SdkContext {
  retailer: string;
  client: KiotVietClient;
}

export interface ClientFactoryDeps {
  /** Seconds before reported `expires_at` we treat the token as fresh. */
  earlyRefreshSec?: number;
}

/**
 * Build a KiotVietClient bound to one retailer + pre-populated with a cached
 * access token. We reach into the SDK's private TokenManager state — if the
 * SDK ever renames those fields, the SDK will fall through and run its own
 * client_credentials exchange on first call (slower but correct).
 */
export function clientFor(
  creds: { retailer: string; clientId: string; clientSecret: string },
  cachedToken: CachedToken,
  deps: ClientFactoryDeps = {},
): SdkContext {
  const client = new KiotVietClient({
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
    retailerName: creds.retailer,
  });

  const tm = (client as unknown as { tokenManager?: Record<string, unknown> }).tokenManager;
  if (tm) {
    const early = (deps.earlyRefreshSec ?? 0) * 1000;
    tm._accessToken = cachedToken.access_token;
    tm._tokenExpiresAt = cachedToken.expires_at * 1000 - early;
  }

  return { retailer: creds.retailer, client };
}
