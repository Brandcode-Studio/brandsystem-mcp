import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BrandDir } from "../lib/brand-dir.js";
import { buildResponse } from "../lib/response.js";
import { generateAndPersistDesignArtifacts } from "../lib/design-synthesis.js";
import { ERROR_CODES } from "../types/index.js";

const paramsShape = {
  source: z.enum(["evidence", "current-brand"]).optional()
    .describe("Source of truth for synthesis. Default prefers extraction evidence when available, otherwise current-brand."),
  overwrite: z.boolean().default(true)
    .describe("If false and DESIGN.md + design-synthesis.json already exist, return the existing artifacts without rewriting."),
};

const ParamsSchema = z.object(paramsShape);
type Params = z.infer<typeof ParamsSchema>;

async function handler(input: Params) {
  const brandDir = new BrandDir(process.cwd());

  if (!(await brandDir.exists())) {
    return buildResponse({
      what_happened: "No .brand/ directory found",
      next_steps: ["Run brand_start first to create the brand system"],
      data: { error: ERROR_CODES.NOT_INITIALIZED },
    });
  }

  const requestedEvidence = input.source === "evidence";
  const hasEvidence = await brandDir.hasExtractionEvidence();

  const result = await generateAndPersistDesignArtifacts(brandDir, {
    source: input.source,
    overwrite: input.overwrite,
  });

  return buildResponse({
    what_happened: input.overwrite === false && result.files_written.length === 0
      ? "Loaded existing design synthesis artifacts"
      : "Generated DESIGN.md and design-synthesis.json from the current brand state",
    next_steps: [
      "Use DESIGN.md as the portable agent-facing design brief",
      "Use design-synthesis.json when you need structured radius/shadow/layout/personality signals",
      ...(requestedEvidence && !hasEvidence ? ["Extraction evidence was not available, so the synthesis fell back to current-brand mode."] : []),
    ],
    data: {
      source_requested: input.source ?? "auto",
      source_used: result.source_used,
      files_written: result.files_written.length > 0 ? result.files_written : ["design-synthesis.json", "DESIGN.md"],
      design_synthesis_file: ".brand/design-synthesis.json",
      design_markdown_file: ".brand/DESIGN.md",
      evidence_summary: result.synthesis.evidence,
      personality: result.synthesis.personality,
      ambiguities: result.synthesis.ambiguities,
    },
  });
}

export function register(server: McpServer) {
  server.tool(
    "brand_generate_designmd",
    "Generate DESIGN.md (portable agent-facing design brief) and design-synthesis.json (structured radius, shadow, spacing, layout, motion, component, and personality signals) from the current brand system. Reads extraction-evidence.json when available for grounded visual signals; falls back to core-identity.yaml and tokens.json after manual edits. Use after brand_extract_site or brand_extract_visual to synthesize multi-page evidence into a single design brief. Use after brand_compile if evidence is unavailable. Returns file paths and synthesis source used. Read-only except for writing the two output files. NOT for extracting brand identity — use brand_extract_web or brand_extract_visual first.",
    paramsShape,
    async (args) => {
      const parsed = ParamsSchema.safeParse(args);
      if (!parsed.success) {
        return buildResponse({
          what_happened: `Invalid parameters: ${parsed.error.message}`,
          next_steps: ["Check the source and overwrite parameters"],
          data: { error: parsed.error.format() },
        });
      }
      return handler(parsed.data);
    },
  );
}
