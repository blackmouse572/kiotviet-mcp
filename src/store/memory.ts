import type { CachedToken, Lock, TokenStore } from "./types";

interface Entry {
  value: CachedToken;
  expiresAtMs: number;
}

export class MemoryStore implements TokenStore {
  private readonly map = new Map<string, Entry>();

  async get(key: string): Promise<CachedToken | undefined> {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (e.expiresAtMs <= Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    return e.value;
  }

  async set(key: string, value: CachedToken, ttlSec: number): Promise<void> {
    this.map.set(key, { value, expiresAtMs: Date.now() + ttlSec * 1000 });
  }
}

export class InProcessLock implements Lock {
  private readonly inFlight = new Map<string, Promise<unknown>>();

  async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.inFlight.get(key) as Promise<T> | undefined;
    if (existing) return existing;
    const p = (async () => {
      try {
        return await fn();
      } finally {
        this.inFlight.delete(key);
      }
    })();
    this.inFlight.set(key, p);
    return p;
  }
}
