/**
 * Tool profiles (0.10): the default "core" profile registers a small,
 * decisive surface (~12 tools) covering the complete value loop —
 * adopt → runtime/context → create → check — plus the connector entry
 * points and the human-in-the-loop clarify/promote path. The "full"
 * profile registers the entire authoring system.
 *
 * Selection (first match wins):
 *   1. Explicit option passed to createServer({ profile })
 *   2. BRANDSYSTEM_PROFILE environment variable ("core" | "full")
 *   3. Default: "core"
 *
 * Rationale: 43 tools compete for agent attention and first-tool
 * selection accuracy; most consumers need the loop, not the authoring
 * depth. Authoring flows (sessions 2-4 interviews, deep extraction
 * control, repo connector, drift analytics) opt in via full.
 */

export type ToolProfile = "core" | "full";

export const CORE_TOOL_NAMES: ReadonlySet<string> = new Set([
  "brand_start",
  "brand_status",
  "brand_runtime",
  "brand_context",
  "brand_check",
  "brand_preflight",
  "brand_report",
  "brand_export",
  "brand_clarify",
  "brand_compile",
  "brand_brandcode_auth",
  "brand_brandcode_connect",
]);

export function resolveProfile(explicit?: string): ToolProfile {
  const candidate = explicit ?? process.env.BRANDSYSTEM_PROFILE ?? "core";
  const normalized = candidate.trim().toLowerCase();
  if (normalized === "full") return "full";
  if (normalized === "core" || normalized === "") return "core";
  // Unknown value: fail toward the larger surface rather than silently
  // hiding tools a user asked for by name.
  console.error(
    `[brandsystem-mcp] Unknown BRANDSYSTEM_PROFILE "${candidate}" — using "full". Valid values: core, full.`
  );
  return "full";
}
