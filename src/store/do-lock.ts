import type { Lock } from "./types";

/**
 * Durable Object class — single-flight refresh per key, scoped by name.
 *
 * `wrangler.toml` wires this to the `TOKEN_REFRESH_AGENT` binding. The DO
 * doesn't persist anything itself; it just serialises concurrent refreshes
 * by holding a per-instance Promise.
 */
export class TokenRefreshAgent {
  private inflight = new Map<string, Promise<Response>>();

  constructor(_state: DurableObjectState, _env: unknown) {}

  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") return new Response("method not allowed", { status: 405 });
    const url = new URL(request.url);
    const key = url.searchParams.get("k") ?? "";
    const body = await request.text();

    const existing = this.inflight.get(key);
    if (existing) {
      const clone = (await existing).clone();
      return clone;
    }
    const p = (async () => {
      try {
        // The caller does the actual fetch; the DO just deduplicates.
        // We respond with the body that was supplied — semantically a barrier.
        return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
      } finally {
        // Hold for a brief moment to coalesce in-flight requests, then drop.
        setTimeout(() => this.inflight.delete(key), 50);
      }
    })();
    this.inflight.set(key, p);
    return (await p).clone();
  }
}

/**
 * Process-level Lock built on top of a DurableObject namespace. We still
 * dedupe in-process first (so a single isolate's concurrent requests
 * collapse without a DO round trip), then defer to the DO for cross-isolate
 * coordination — best effort because the DO can't observe the caller's
 * Promise; the caller still runs `fn` itself.
 */
export class WorkersDOLock implements Lock {
  private readonly local = new Map<string, Promise<unknown>>();

  constructor(private readonly ns: DurableObjectNamespace) {}

  async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.local.get(key) as Promise<T> | undefined;
    if (existing) return existing;
    const stub = this.ns.get(this.ns.idFromName(key));
    const p = (async () => {
      try {
        // Touch the DO so all isolates point at the same shard; the actual
        // refresh runs locally inside `fn`. The DO serves as a singleton
        // address, not as the executor — token fetches must run in worker
        // isolates so they can use `fetch` against KiotViet's IDP.
        await stub.fetch(`https://do/refresh?k=${encodeURIComponent(key)}`, { method: "POST", body: "{}" }).catch(() => undefined);
        return await fn();
      } finally {
        this.local.delete(key);
      }
    })();
    this.local.set(key, p);
    return p;
  }
}
