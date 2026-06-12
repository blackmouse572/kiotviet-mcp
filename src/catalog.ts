import generated from "./generated/tools.json" with { type: "json" };
import { OVERRIDES } from "./generated/overrides";
import { DEFAULT_CATALOG_PROFILE, renderGuideDescription, TOOL_METADATA, type CatalogProfile } from "./tool-metadata";

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

const GENERATED_TOOL_NAMES = new Set((generated as GeneratedFile).tools.map((tool) => tool.name));

function buildCatalog(profile: CatalogProfile): CatalogTool[] {
  const file = generated as GeneratedFile;
  const out: CatalogTool[] = [];
  for (const t of file.tools) {
    const ov = OVERRIDES[t.name];
    if (ov?.hidden) continue;
    const metadata = TOOL_METADATA[t.name];
    if (profile === "curated" && !metadata?.profiles.includes("curated")) continue;
    out.push({
      ...t,
      description: renderGuideDescription(t.name, ov?.description ?? t.description, metadata),
      inputSchema: ov?.inputSchema ?? t.inputSchema,
    });
  }
  return out;
}

const catalogs = {
  curated: buildCatalog("curated"),
  full: buildCatalog("full"),
} satisfies Record<CatalogProfile, CatalogTool[]>;

const maps = {
  curated: new Map<string, CatalogTool>(),
  full: new Map<string, CatalogTool>(),
} satisfies Record<CatalogProfile, Map<string, CatalogTool>>;

for (const profile of Object.keys(catalogs) as CatalogProfile[]) {
  for (const tool of catalogs[profile]) maps[profile].set(tool.name, tool);
}

export function loadCatalog(profile: CatalogProfile = DEFAULT_CATALOG_PROFILE): CatalogTool[] {
  return catalogs[profile];
}

export function findTool(name: string, profile: CatalogProfile = DEFAULT_CATALOG_PROFILE): CatalogTool | undefined {
  return maps[profile].get(name);
}

export function getGeneratedToolNames(): string[] {
  return [...GENERATED_TOOL_NAMES];
}
