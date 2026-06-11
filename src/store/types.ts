export interface CachedToken {
  access_token: string;
  expires_at: number;
}

export interface TokenStore {
  get(key: string): Promise<CachedToken | undefined>;
  set(key: string, value: CachedToken, ttlSec: number): Promise<void>;
}

export interface Lock {
  withLock<T>(key: string, fn: () => Promise<T>): Promise<T>;
}
