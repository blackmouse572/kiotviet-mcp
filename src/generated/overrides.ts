export interface ToolOverride {
  /** Replace the generated description (kept short, agent-readable). */
  description?: string;
  /** Replace the generated JSON Schema entirely. */
  inputSchema?: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  /** Hide this tool from the MCP `tools/list` response. */
  hidden?: boolean;
}

/**
 * Hand-curated patches on top of the build-time generator output. Only
 * include entries when the generated schema is bad enough that an agent
 * would struggle, or when a tool should be hidden from BYO callers.
 */
export const OVERRIDES: Record<string, ToolOverride> = {
  "products.list": {
    description: "List products with optional filtering by name/code/category and paging.",
    inputSchema: {
      type: "object",
      properties: {
        params: {
          type: "object",
          properties: {
            pageSize: { type: "integer", minimum: 1, maximum: 100 },
            currentItem: { type: "integer", minimum: 0 },
            code: { type: "string" },
            name: { type: "string" },
            categoryId: { type: "integer" },
            includeInventory: { type: "boolean" },
          },
          additionalProperties: true,
        },
      },
      required: [],
    },
  },
  "products.search": {
    description: "Search products by name or code; paging via params.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        params: { type: "object", additionalProperties: true },
      },
      required: ["query"],
    },
  },
  "customers.list": {
    description: "List customers with optional filtering and paging.",
    inputSchema: {
      type: "object",
      properties: { params: { type: "object", additionalProperties: true } },
      required: [],
    },
  },
  "invoices.list": {
    description: "List invoices with optional filtering and paging.",
    inputSchema: {
      type: "object",
      properties: { params: { type: "object", additionalProperties: true } },
      required: [],
    },
  },
  "orders.list": {
    description: "List orders with optional filtering and paging.",
    inputSchema: {
      type: "object",
      properties: { params: { type: "object", additionalProperties: true } },
      required: [],
    },
  },

  // Hide endpoints we don't want BYO callers to fire.
  "webhooks.create": { hidden: true },
  "webhooks.delete": { hidden: true },
  "webhooks.update": { hidden: true },
};
