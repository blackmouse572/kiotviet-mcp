# Tool catalog generator

The worker exposes every public method on `kiotviet-client-sdk`'s `KiotVietClient` as an MCP tool. The raw catalog is generated at build time (`scripts/generate-tools.ts`) and then enriched at boot by:

- `src/generated/overrides.ts` — schema tightening + hard hides.
- `src/tool-metadata.ts` — LLM-friendly descriptions + profile membership (`curated` vs `full`).

## Run it

```bash
bun run gen:tools
```

Produces `src/generated/tools.json` with one entry per `KiotVietClient.<namespace>.<method>`. Current output: **119 generated tools across 21 namespaces**.

Re-run whenever:
- `kiotviet-client-sdk` is bumped (`bun add kiotviet-client-sdk@<new>` then `bun run gen:tools`).
- An override stops matching a tool name (rename, removal).

Wire it into CI to fail on drift:

```bash
bun run gen:tools && git diff --exit-code src/generated/tools.json
```

Validate curated metadata and stale overrides:

```bash
bun run check:catalog
```

## How it works (`scripts/generate-tools.ts`)

1. Loads `node_modules/kiotviet-client-sdk/dist/client.d.ts` via `ts-morph`.
2. Walks `readonly` properties on `KiotVietClient` whose type ends in `Handler` (e.g. `readonly products: ProductHandler`).
3. For each handler, loads the handler's `.d.ts` (path resolved from the import in `client.d.ts`) and enumerates public methods.
4. For each method, emits:
   - `name` — `"<namespace>.<method>"` (e.g. `products.list`).
   - `description` — JSDoc text above the method, with `@param`/`@returns` lines stripped.
   - `dispatch` — `{namespace, method}`. The runtime uses this to call `ctx.client[namespace][method](...)`.
   - `params` — positional parameter descriptors `{name, type, optional}`.
   - `inputSchema` — JSON Schema with one property per parameter. `paramTypeToSchema` maps primitives + `Record<string, any>` + arrays directly; everything else falls into `{type: "object", additionalProperties: true, "x-kv-rawType": "<original ts source>"}` as a "this needs an override" beacon.

The dispatcher reads `params` in order and maps them positionally:

```ts
// src/mcp/dispatch.ts
const positional = tool.params.map((p) => args[p.name]);
return method.apply(handler, positional);
```

So a tool like `products.search(query, params?)` is called as `products.search(args.query, args.params)`.

## Schema overrides (`src/generated/overrides.ts`)

The generator is intentionally conservative — it never invents a schema it can't justify from the SDK's `.d.ts`. Overrides are the patch layer:

```ts
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
    },
  },
  "webhooks.create": { hidden: true },
  // …
};
```

Three things an override can do:
- `description?` — replace the raw generated description before fallback rendering.
- `inputSchema?` — replace the whole schema. Agents lean on this heavily; tighten it when the generator emitted `additionalProperties: true`.
- `hidden?: true` — drop the tool from `tools/list` (used for `webhooks.*` mutators in v1).

`src/catalog.ts` merges them at module load. There's no override mechanism for *renaming* a tool — match the generator's output exactly.

## LLM metadata (`src/tool-metadata.ts`)

This is the layer agents actually read first. Each curated tool gets a structured guide with:

- `purpose`
- `useWhen`
- `avoidWhen`
- `requiredInputs`
- `optionalInputs`
- `returns`
- `safety`
- `pitfalls`

At runtime the guide is rendered into a consistent description string so MCP clients get task-oriented text instead of SDK-style API text.

Profile behavior:

- `curated` — default. Only tools with validated LLM metadata are exposed.
- `full` — all non-hidden tools are exposed. Tools without curated metadata fall back to `Advanced tool. API-derived description: ...`.

Request the full profile with:

```http
x-kiotviet-tool-profile: full
```

on both `/mcp` and `/tools`.

## Adding an override

1. Run `bun run gen:tools`, find the tool in `src/generated/tools.json` and verify its name.
2. If needed, add schema/hide rules in `src/generated/overrides.ts`.
3. Add an LLM-ready guide in `src/tool-metadata.ts` if the tool should be in the curated profile.
4. `bun test` — this now also runs `bun run check:catalog`.

## Workflow for a new SDK version

```bash
bun add kiotviet-client-sdk@<new-version>
bun run gen:tools
bun test
git diff src/generated/tools.json   # eyeball additions / removals
```

If the SDK renamed a tool, the existing override or metadata entry becomes stale. `bun run check:catalog` fails on stale keys so you can clean them up before shipping.
