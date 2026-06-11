#!/usr/bin/env bun
import { Project, SyntaxKind, type ClassDeclaration, type MethodDeclaration } from "ts-morph";
import path from "node:path";

interface ParamDescriptor {
  name: string;
  type: string;
  optional: boolean;
}

export interface ToolDescriptor {
  name: string;
  description: string;
  dispatch: { namespace: string; method: string };
  params: ParamDescriptor[];
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required: string[];
  };
}

const SDK_ROOT = path.resolve("node_modules/kiotviet-client-sdk");
const CLIENT_DTS = path.join(SDK_ROOT, "dist/client.d.ts");
const OUT = path.resolve("src/generated/tools.json");

function paramTypeToSchema(raw: string): { schema: unknown; ok: boolean } {
  let t = raw.trim();
  while (/^Partial<.+>$/.test(t)) t = t.slice("Partial<".length, -1).trim();
  if (/^number$/.test(t)) return { schema: { type: "number" }, ok: true };
  if (/^string$/.test(t)) return { schema: { type: "string" }, ok: true };
  if (/^boolean$/.test(t)) return { schema: { type: "boolean" }, ok: true };
  if (/^Record<string,\s*any>$/.test(t)) {
    return { schema: { type: "object", additionalProperties: true }, ok: true };
  }
  if (/\[\]$/.test(t) || /^Array</.test(t)) {
    return { schema: { type: "array", items: {} }, ok: true };
  }
  return { schema: { type: "object", additionalProperties: true, "x-kv-rawType": t }, ok: false };
}

function describeMethod(method: MethodDeclaration): string {
  const ranges = method.getLeadingCommentRanges();
  if (!ranges.length) return "";
  const text = ranges[ranges.length - 1]!.getText();
  return text
    .replace(/^\s*\/\*\*?/, "")
    .replace(/\*\/\s*$/, "")
    .split("\n")
    .map((line) => line.replace(/^\s*\*\s?/, ""))
    .filter((line) => !line.startsWith("@param") && !line.startsWith("@returns"))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractHandlerMethods(handler: ClassDeclaration, namespace: string): ToolDescriptor[] {
  const out: ToolDescriptor[] = [];
  for (const method of handler.getMethods()) {
    const name = method.getName();
    if (name.startsWith("_") || name === "constructor") continue;
    if (method.hasModifier(SyntaxKind.PrivateKeyword) || method.hasModifier(SyntaxKind.ProtectedKeyword)) continue;

    const params: ParamDescriptor[] = method.getParameters().map((p) => ({
      name: p.getName(),
      type: p.getTypeNode()?.getText() ?? p.getType().getText(),
      optional: p.isOptional() || p.hasInitializer(),
    }));

    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const p of params) {
      const { schema } = paramTypeToSchema(p.type);
      properties[p.name] = schema;
      if (!p.optional) required.push(p.name);
    }

    out.push({
      name: `${namespace}.${name}`,
      description: describeMethod(method) || `${namespace}.${name}`,
      dispatch: { namespace, method: name },
      params,
      inputSchema: { type: "object", properties, required },
    });
  }
  return out;
}

async function main() {
  const project = new Project({ tsConfigFilePath: "tsconfig.json", skipAddingFilesFromTsConfig: true });
  const clientFile = project.addSourceFileAtPath(CLIENT_DTS);
  const klass = clientFile.getClass("KiotVietClient");
  if (!klass) throw new Error("KiotVietClient class not found in SDK d.ts");

  const namespaces: { property: string; handlerName: string; handlerFile: string }[] = [];
  for (const prop of klass.getProperties()) {
    if (!prop.hasModifier(SyntaxKind.ReadonlyKeyword)) continue;
    const typeNode = prop.getTypeNode();
    if (!typeNode) continue;
    const handlerName = typeNode.getText();
    if (!handlerName.endsWith("Handler")) continue;
    const imp = clientFile
      .getImportDeclarations()
      .find((d) => d.getNamedImports().some((n) => n.getName() === handlerName));
    if (!imp) continue;
    const rel = imp.getModuleSpecifierValue();
    namespaces.push({
      property: prop.getName(),
      handlerName,
      handlerFile: path.resolve(path.dirname(CLIENT_DTS), rel + ".d.ts"),
    });
  }

  const tools: ToolDescriptor[] = [];
  for (const ns of namespaces) {
    const handlerFile = project.addSourceFileAtPath(ns.handlerFile);
    const handlerClass = handlerFile.getClass(ns.handlerName);
    if (!handlerClass) {
      console.warn(`skipping ${ns.property}: handler class ${ns.handlerName} not found`);
      continue;
    }
    tools.push(...extractHandlerMethods(handlerClass, ns.property));
  }

  tools.sort((a, b) => a.name.localeCompare(b.name));
  const out = {
    generatedAt: new Date(0).toISOString(),
    sdk: { name: "kiotviet-client-sdk" },
    tools,
  };
  await Bun.write(OUT, JSON.stringify(out, null, 2) + "\n");
  console.log(`wrote ${tools.length} tools across ${namespaces.length} namespaces to ${OUT}`);
}

if (import.meta.main) {
  await main();
}
