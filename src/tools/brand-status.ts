import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BrandDir } from "../lib/brand-dir.js";
import { buildResponse } from "../lib/response.js";
import type { Confidence } from "../types/index.js";

async function handler() {
  const brandDir = new BrandDir(process.cwd());

  if (!(await brandDir.exists())) {
    return buildResponse({
      what_happened: "No .brand/ directory found",
      next_steps: ["Run brand_init to create a new brand system"],
      data: { error: "not_found" },
    });
  }

  const config = await brandDir.readConfig();
  const identity = await brandDir.readCoreIdentity();

  const allConfidences: Confidence[] = [
    ...identity.colors.map((c) => c.confidence),
    ...identity.typography.map((t) => t.confidence),
    ...identity.logo.map((l) => l.confidence),
    ...(identity.spacing ? [identity.spacing.confidence] : []),
  ];
  const confidenceDist = {
    confirmed: allConfidences.filter((c) => c === "confirmed").length,
    high: allConfidences.filter((c) => c === "high").length,
    medium: allConfidences.filter((c) => c === "medium").length,
    low: allConfidences.filter((c) => c === "low").length,
  };

  const lines: string[] = [
    `Brand System: ${config.client_name}`,
    `Session: ${config.session}`,
    `Schema: ${config.schema_version}`,
    "",
    "── Identity ──────────────────────────",
    `Colors:     ${identity.colors.length} entries${identity.colors.length === 0 ? " ⚠ empty" : ""}`,
  ];

  if (identity.colors.length > 0) {
    const primary = identity.colors.find((c) => c.role === "primary");
    lines.push(`  Primary:  ${primary ? `${primary.value} (${primary.confidence})` : "⚠ not identified"}`);
    const roles = [...new Set(identity.colors.map((c) => c.role))].join(", ");
    lines.push(`  Roles:    ${roles}`);
  }

  lines.push(`Typography: ${identity.typography.length} entries${identity.typography.length === 0 ? " ⚠ empty" : ""}`);
  if (identity.typography.length > 0) {
    const families = [...new Set(identity.typography.map((t) => t.family))].join(", ");
    lines.push(`  Families: ${families}`);
  }

  lines.push(`Logo:       ${identity.logo.length} assets${identity.logo.length === 0 ? " ⚠ none found" : ""}`);
  for (const logo of identity.logo) {
    lines.push(`  ${logo.type}: ${logo.variants.length} variant(s) (${logo.confidence})`);
  }

  lines.push(`Spacing:    ${identity.spacing ? `${identity.spacing.base_unit || "detected"} (${identity.spacing.confidence})` : "⚠ not detected"}`);

  lines.push("");
  lines.push("── Confidence ────────────────────────");
  lines.push(`  Confirmed: ${confidenceDist.confirmed}  High: ${confidenceDist.high}  Medium: ${confidenceDist.medium}  Low: ${confidenceDist.low}`);

  lines.push("");
  lines.push("── Sessions ──────────────────────────");
  lines.push(`Session 1: Core Identity        ${identity.colors.length > 0 || identity.typography.length > 0 ? "✓ In progress" : "○ Empty"}`);
  lines.push("Session 2: Full Visual Identity ○ Not started");
  lines.push("Session 3: Core Messaging       ○ Not started");
  lines.push("Session 4: Content Strategy     ○ Not started");
  lines.push("Session 5: Full Governance      ○ Not started");
  lines.push("Session 6: Content Operations   ○ Not started");

  const nextSteps: string[] = [];
  if (identity.colors.length === 0 && identity.typography.length === 0) {
    if (config.website_url) {
      nextSteps.push(`Run brand_extract_web with url "${config.website_url}"`);
    } else {
      nextSteps.push("Run brand_extract_web with your website URL");
    }
  }
  if (config.figma_file_key && identity.colors.every((c) => c.source !== "figma")) {
    nextSteps.push(`Run brand_extract_figma with figma_file_key "${config.figma_file_key}"`);
  }
  if (identity.colors.length > 0 && identity.typography.length > 0) {
    nextSteps.push("Run brand_compile to generate tokens.json and surface clarification items");
  }

  return buildResponse({
    what_happened: "Brand system status retrieved",
    next_steps: nextSteps.length > 0 ? nextSteps : ["Brand system is up to date"],
    data: { status: lines.join("\n") },
  });
}

export function register(server: McpServer) {
  server.tool(
    "brand_status",
    "Show the current state of the .brand/ directory. Reports extraction completeness, confidence distribution, and what's missing. Use this to check progress or resume a previous session.",
    async () => handler()
  );
}
