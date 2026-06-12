import type { KiotVietClient } from "kiotviet-client-sdk";
import { findTool } from "../catalog";
import type { CatalogProfile } from "../tool-metadata";

export interface DispatchContext {
  client: KiotVietClient;
  retailer: string;
  profile: CatalogProfile;
}

/**
 * Calls the SDK method named by `toolName` with arguments shaped by the
 * tool's catalog `params` order. Arg names that don't appear in `args`
 * resolve to `undefined`.
 */
export async function dispatch(toolName: string, args: Record<string, unknown> | undefined, ctx: DispatchContext): Promise<unknown> {
  const tool = findTool(toolName, ctx.profile);
  if (!tool) throw new ToolNotFoundError(toolName);

  const handler = (ctx.client as unknown as Record<string, Record<string, (...a: unknown[]) => unknown>>)[tool.dispatch.namespace];
  if (!handler) throw new DispatchError(`namespace ${tool.dispatch.namespace} not on client`);
  const method = handler[tool.dispatch.method];
  if (typeof method !== "function") throw new DispatchError(`method ${tool.dispatch.method} not on ${tool.dispatch.namespace}`);

  const a = args ?? {};
  const positional = tool.params.map((p) => a[p.name]);
  return method.apply(handler, positional);
}

export class ToolNotFoundError extends Error {
  constructor(name: string) {
    super(`unknown tool: ${name}`);
    this.name = "ToolNotFoundError";
  }
}

export class DispatchError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "DispatchError";
  }
}
