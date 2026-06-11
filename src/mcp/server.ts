import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { loadCatalog } from "../catalog";
import { dispatch, type DispatchContext } from "./dispatch";

export interface BuildServerDeps {
  ctx: DispatchContext;
}

export function buildMcpServer(deps: BuildServerDeps): Server {
  const server = new Server(
    { name: "kiotviet-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );
  const catalog = loadCatalog();

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: catalog.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    try {
      const result = await dispatch(req.params.name, req.params.arguments ?? {}, deps.ctx);
      return {
        content: [
          {
            type: "text",
            text: typeof result === "string" ? result : JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [{ type: "text", text: message }],
      };
    }
  });

  return server;
}

export async function handleMcpRequest(request: Request, ctx: DispatchContext): Promise<Response> {
  const server = buildMcpServer({ ctx });
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  try {
    return await transport.handleRequest(request);
  } finally {
    await server.close().catch(() => undefined);
  }
}
