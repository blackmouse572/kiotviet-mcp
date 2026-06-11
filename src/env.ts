import { z } from "zod";

export const EnvSchema = z.object({
  MCP_BEARER_PK: z.string().regex(/^[0-9a-f]{64}$/i, "must be 32-byte hex"),
  MCP_BEARER_SK: z.string().regex(/^[0-9a-f]{64}$/i, "must be 32-byte hex"),
  LINK_HMAC_SECRET: z.string().min(16),
  TOKEN_CACHE_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/i)
    .optional(),
  BEARER_TTL_SECONDS: z.coerce.number().int().positive().default(60 * 60 * 24 * 90),
  KIOTVIET_TOKEN_URL: z.string().url().default("https://id.kiotviet.vn/connect/token"),
  PORT: z.coerce.number().int().positive().default(8787),
  PUBLIC_BASE_URL: z.string().url().optional(),
});

export type Env = z.infer<typeof EnvSchema>;

export interface WorkersBindings {
  KIOTVIET_TOKENS?: KVNamespace;
  TOKEN_REFRESH_AGENT?: DurableObjectNamespace;
}

export type Runtime = "workers" | "memory";

export function detectRuntime(bindings: WorkersBindings | undefined): Runtime {
  return bindings && bindings.KIOTVIET_TOKENS ? "workers" : "memory";
}

export function parseEnv(raw: Record<string, string | undefined>): Env {
  return EnvSchema.parse(raw);
}
