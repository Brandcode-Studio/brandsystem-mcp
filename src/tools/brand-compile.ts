import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BrandDir } from "../lib/brand-dir.js";
import { buildResponse } from "../lib/response.js";
import { compileDTCG } from "../lib/dtcg-compiler.js";
import { needsClarification } from "../lib/confidence.js";
import type { ClarificationItem } from "../types/index.js";

async function handler() {
  const brandDir = new BrandDir(process.cwd());

  if (!(await brandDir.exists())) {
    return buildResponse({
      what_happened: "No .brand/ directory found",
      next_steps: ["Run brand_init first"],
      data: { error: "not_initialized" },
    });
  }

  const config = await brandDir.readConfig();
  const identity = await brandDir.readCoreIdentity();

  const tokens = compileDTCG(identity, config.client_name);
  await brandDir.writeTokens(tokens);

  const clarifications: ClarificationItem[] = [];
  let itemId = 0;

  if (!identity.colors.some((c) => c.role === "primary")) {
    clarifications.push({
      id: `clarify-${++itemId}`,
      field: "colors.primary",
      question: "No primary brand color identified. Which color is your primary brand color?",
      source: "compilation",
      priority: "high",
    });
  }

  for (const color of identity.colors) {
    if (needsClarification(color.confidence)) {
      clarifications.push({
        id: `clarify-${++itemId}`,
        field: `colors.${color.role}`,
        question: `Color ${color.value} (${color.name}) has low confidence. Is this correct and what role does it play?`,
        source: color.source,
        priority: "medium",
      });
    }
  }

  if (identity.typography.length === 0) {
    clarifications.push({
      id: `clarify-${++itemId}`,
      field: "typography",
      question: "No fonts detected. What font family does your brand use?",
      source: "compilation",
      priority: "high",
    });
  }

  for (const typo of identity.typography) {
    if (needsClarification(typo.confidence)) {
      clarifications.push({
        id: `clarify-${++itemId}`,
        field: `typography.${typo.family}`,
        question: `Font "${typo.family}" has low confidence. Is this your brand font?`,
        source: typo.source,
        priority: "medium",
      });
    }
  }

  if (identity.logo.length === 0) {
    clarifications.push({
      id: `clarify-${++itemId}`,
      field: "logo",
      question: "No logo detected. Provide your logo as SVG for best results.",
      source: "compilation",
      priority: "high",
    });
  }

  const unknownColors = identity.colors.filter((c) => c.role === "unknown");
  if (unknownColors.length > 0) {
    clarifications.push({
      id: `clarify-${++itemId}`,
      field: "colors.roles",
      question: `${unknownColors.length} color(s) have no assigned role: ${unknownColors.map((c) => c.value).join(", ")}. What role does each play?`,
      source: "compilation",
      priority: "medium",
    });
  }

  await brandDir.writeClarifications({ schema_version: "0.1.0", items: clarifications });

  const brandTokens = tokens.brand as Record<string, unknown>;
  const colorTokenCount = Object.keys((brandTokens.color as Record<string, unknown>) || {}).length;
  const typoTokenCount = Object.keys((brandTokens.typography as Record<string, unknown>) || {}).length;

  return buildResponse({
    what_happened: `Compiled brand system for "${config.client_name}"`,
    next_steps: [
      clarifications.length > 0
        ? `${clarifications.length} item(s) need clarification — review needs-clarification.yaml`
        : "No clarification items — system is clean",
      "Run brand_audit to validate the compiled output",
      "Run brand_status to see the full picture",
    ],
    data: {
      files_written: ["tokens.json", "needs-clarification.yaml"],
      tokens: { colors: colorTokenCount, typography: typoTokenCount, total: colorTokenCount + typoTokenCount },
      clarifications: {
        total: clarifications.length,
        high_priority: clarifications.filter((c) => c.priority === "high").length,
        items: clarifications.map((c) => `[${c.priority}] ${c.question}`),
      },
    },
  });
}

export function register(server: McpServer) {
  server.tool(
    "brand_compile",
    "Compile all extracted brand data into final outputs. Generates DTCG tokens.json from core-identity.yaml and surfaces unresolved items in needs-clarification.yaml. Use AFTER running extraction tools (brand_extract_web and/or brand_extract_figma).",
    async () => handler()
  );
}
