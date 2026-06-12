import { describe, expect, test } from "bun:test";
import { findTool, loadCatalog } from "../src/catalog";

describe("catalog profiles", () => {
  test("curated profile exposes only llm-ready tools", () => {
    const curated = loadCatalog("curated");
    const names = curated.map((tool) => tool.name);

    expect(names).toContain("products.list");
    expect(names).toContain("orders.getByDateRange");
    expect(names).not.toContain("bankAccounts.getById");
    expect(names).not.toContain("webhooks.create");
  });

  test("full profile keeps advanced tools with explicit fallback text", () => {
    const tool = findTool("bankAccounts.getById", "full");
    expect(tool).toBeDefined();
    expect(tool?.description).toContain("Advanced tool. API-derived description:");
  });

  test("curated descriptions are rendered in the llm-friendly format", () => {
    const tool = findTool("products.list", "curated");
    expect(tool).toBeDefined();
    expect(tool?.description).toContain("Purpose:");
    expect(tool?.description).toContain("Use when:");
    expect(tool?.description).toContain("Safety:");
    expect(tool?.description).toContain("Watch for:");
  });
});
