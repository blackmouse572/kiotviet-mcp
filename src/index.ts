#!/usr/bin/env bun
import { buildApp } from "./app";
import { detectRuntime, parseEnv, type WorkersBindings } from "./env";
import { InProcessLock, MemoryStore } from "./store/memory";
import { WorkersKVStore } from "./store/workers-kv";
import { WorkersDOLock, TokenRefreshAgent } from "./store/do-lock";
import type { Lock, TokenStore } from "./store/types";
import 'dotenv/config';

export { TokenRefreshAgent };

function pickStorage(bindings: WorkersBindings | undefined, env: ReturnType<typeof parseEnv>): { store: TokenStore; lock: Lock } {
  if (bindings?.KIOTVIET_TOKENS) {
    const store = new WorkersKVStore(bindings.KIOTVIET_TOKENS, env.TOKEN_CACHE_KEY);
    const lock = bindings.TOKEN_REFRESH_AGENT
      ? new WorkersDOLock(bindings.TOKEN_REFRESH_AGENT)
      : new InProcessLock();
    return { store, lock };
  }
  return { store: new MemoryStore(), lock: new InProcessLock() };
}

function buildHandlerFromEnvLike(envObj: Record<string, string | undefined>, bindings?: WorkersBindings) {
  const env = parseEnv(envObj);
  const runtime = detectRuntime(bindings);
  const { store, lock } = pickStorage(bindings, env);
  return buildApp({ env, runtime, store, lock, bindings });
}

/**
 * Cloudflare Workers and Bun both call this default export:
 *
 * - Cloudflare Workers passes `(request, env, ctx)` where `env` is the bindings object.
 * - Bun's auto-server passes `(request)` — env is read from `process.env` (which Bun
 *   has already populated from `.env`). Bindings are absent → in-memory storage.
 *
 * `port` is read so Bun's auto-serve honours `PORT` from `.env`.
 */
export default {
  port: Number(process.env.PORT ?? 8787),

  async fetch(request: Request, envOrBindings?: Record<string, string | undefined> & WorkersBindings): Promise<Response> {
    const hasWorkerBindings = !!envOrBindings && typeof envOrBindings === "object" && "KIOTVIET_TOKENS" in envOrBindings;
    if (hasWorkerBindings) {
      const app = buildHandlerFromEnvLike(envOrBindings as Record<string, string | undefined>, envOrBindings);
      return app.fetch(request);
    }
    // Bun runtime (or Workers without KV binding): use process.env, no bindings.
    const app = buildHandlerFromEnvLike(process.env);
    return app.fetch(request);
  },
};
