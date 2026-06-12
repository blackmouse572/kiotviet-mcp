#!/usr/bin/env bun
import generated from "../src/generated/tools.json" with { type: "json" };
import { OVERRIDES } from "../src/generated/overrides";
import { TOOL_METADATA, type ToolGuide } from "../src/tool-metadata";

interface GeneratedToolFile {
  tools: { name: string }[];
}

const generatedNames = new Set((generated as GeneratedToolFile).tools.map((tool) => tool.name));
const errors: string[] = [];

function hasValues(values: string[]): boolean {
  return values.length > 0 && values.every((value) => value.trim().length > 0);
}

function validateGuide(name: string, guide: ToolGuide) {
  if (!guide.purpose.trim()) errors.push(`${name}: guide.purpose is required`);
  if (!guide.useWhen.trim()) errors.push(`${name}: guide.useWhen is required`);
  if (!guide.avoidWhen.trim()) errors.push(`${name}: guide.avoidWhen is required`);
  if (!hasValues(guide.requiredInputs)) errors.push(`${name}: guide.requiredInputs must contain non-empty values`);
  if (!hasValues(guide.optionalInputs)) errors.push(`${name}: guide.optionalInputs must contain non-empty values`);
  if (!guide.returns.trim()) errors.push(`${name}: guide.returns is required`);
  if (!guide.safety.trim()) errors.push(`${name}: guide.safety is required`);
  if (!hasValues(guide.pitfalls)) errors.push(`${name}: guide.pitfalls must contain non-empty values`);
}

for (const overrideName of Object.keys(OVERRIDES)) {
  if (!generatedNames.has(overrideName)) errors.push(`stale override entry: ${overrideName}`);
}

for (const [toolName, metadata] of Object.entries(TOOL_METADATA)) {
  if (!generatedNames.has(toolName)) errors.push(`stale metadata entry: ${toolName}`);
  if (metadata.profiles.length === 0) errors.push(`${toolName}: metadata.profiles must not be empty`);
  validateGuide(toolName, metadata.guide);
}

const curatedToolNames = Object.entries(TOOL_METADATA)
  .filter(([, metadata]) => metadata.profiles.includes("curated"))
  .map(([name]) => name);

if (curatedToolNames.length === 0) errors.push("expected at least one curated tool");

if (errors.length) {
  console.error("Catalog validation failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `Catalog validation passed: ${curatedToolNames.length} curated tools, ${Object.keys(TOOL_METADATA).length} metadata entries, ${Object.keys(OVERRIDES).length} overrides.`,
);
