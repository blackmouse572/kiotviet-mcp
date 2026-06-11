import generated from "./generated/tools.json" with { type: "json" };
import { OVERRIDES } from "./generated/overrides";

export interface CatalogTool {
  name: string;
  description: string;
  dispatch: { namespace: string; method: string };
  params: { name: string; type: string; optional: boolean }[];
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
}

interface GeneratedTool extends CatalogTool {}
interface GeneratedFile {
  tools: GeneratedTool[];
}

export function loadCatalog(): CatalogTool[] {
  const file = generated as GeneratedFile;
  const out: CatalogTool[] = [];
  for (const t of file.tools) {
    const ov = OVERRIDES[t.name];
    if (ov?.hidden) continue;
    out.push({
      ...t,
      description: ov?.description ?? t.description,
      inputSchema: ov?.inputSchema ?? t.inputSchema,
    });
  }
  return out;
}

const map = new Map<string, CatalogTool>();
for (const t of loadCatalog()) map.set(t.name, t);

export function findTool(name: string): CatalogTool | undefined {
  return map.get(name);
}
