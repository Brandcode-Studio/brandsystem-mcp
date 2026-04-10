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
    "Generate a grounded DESIGN.md and structured design-synthesis.json from the current brand system. Prefers rendered extraction evidence when available, but can fall back to the current core brand state after manual edits or compile steps.",
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
