import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BrandDir } from "../lib/brand-dir.js";
import { buildResponse, safeParseParams } from "../lib/response.js";
import {
  applyConflictResolution,
  findConflicts,
  getConfiguredSourcePriority,
  type SourceCatalogFile,
} from "../lib/source-catalog.js";
import { ERROR_CODES } from "../types/index.js";

const paramsShape = {
  mode: z.enum(["show", "resolve"]),
  field: z.string().optional().describe('Specific field to inspect or resolve, e.g. "colors.primary".'),
  source: z.enum(["web", "visual", "figma", "guidelines", "manual"]).optional().describe('Which source should win in resolve mode, e.g. "guidelines".'),
};

const ParamsSchema = z.object(paramsShape);
type Params = z.infer<typeof ParamsSchema>;

async function handler(input: Params) {
  const brandDir = new BrandDir(process.cwd());
  if (!(await brandDir.exists())) {
    return buildResponse({
      what_happened: "No .brand/ directory found",
      next_steps: ["Run brand_start or brand_init first to create the brand system"],
      data: { error: ERROR_CODES.NOT_INITIALIZED },
    });
  }

  if (!(await brandDir.hasSourceCatalog())) {
    return buildResponse({
      what_happened: "No source-catalog.json found",
      next_steps: [
        "Run brand_extract_web, brand_extract_figma, brand_extract_visual, brand_extract_site, or brand_extract_pdf first",
      ],
      data: { conflicts: [] },
    });
  }

  const config = await brandDir.readConfig();
  const sourcePriority = getConfiguredSourcePriority(config);
  const catalog = await brandDir.readSourceCatalog<SourceCatalogFile>();
  const conflicts = findConflicts(catalog, sourcePriority, input.field);

  if (input.mode === "show") {
    return buildResponse({
      what_happened: conflicts.length > 0 ? `Found ${conflicts.length} source conflict(s)` : "No source conflicts found",
      next_steps: conflicts.length > 0
        ? ["Run brand_resolve_conflicts with mode \"resolve\", the field, and the source that should win"]
        : ["Run brand_compile if you want to refresh tokens and design artifacts"],
      data: {
        conflicts: conflicts.map((conflict) => ({
          field: conflict.field,
          sources: conflict.sources.map((source) => ({
            source: source.source,
            value: source.value,
            confidence: source.confidence,
          })),
          recommended: conflict.recommended,
        })),
      },
    });
  }

  if (!input.field || !input.source) {
    return buildResponse({
      what_happened: "field and source are required for resolve mode",
      next_steps: ["Call brand_resolve_conflicts with mode=\"show\" first to inspect the available conflicts"],
      data: { error: ERROR_CODES.VALIDATION_FAILED },
    });
  }

  const targetConflict = conflicts.find((conflict) => conflict.field === input.field);
  if (!targetConflict) {
    return buildResponse({
      what_happened: `No conflict found for ${input.field}`,
      next_steps: ["Run brand_resolve_conflicts with mode=\"show\" to inspect the current conflicts"],
      data: { conflicts: [] },
    });
  }

  const winningRecord = targetConflict.sources.find((source) => source.source === input.source);
  if (!winningRecord) {
    return buildResponse({
      what_happened: `Source ${input.source} is not available for ${input.field}`,
      next_steps: ["Choose one of the sources returned by mode=\"show\""],
      data: { error: ERROR_CODES.VALIDATION_FAILED },
    });
  }

  const identity = await brandDir.readCoreIdentity();
  const updated = applyConflictResolution(identity, input.field, winningRecord);
  await brandDir.writeCoreIdentity(updated);

  return buildResponse({
    what_happened: `Resolved ${input.field} in favor of ${input.source}`,
    next_steps: [
      "Run brand_compile to refresh tokens, DESIGN.md, and runtime artifacts after the resolution",
    ],
    data: {
      field: input.field,
      resolved_to: input.source,
      value: winningRecord.value,
    },
  });
}

export function register(server: McpServer) {
  server.tool(
    "brand_resolve_conflicts",
    "Inspect and resolve disagreements between brand sources — when web extraction says one primary color, Figma says another, and the PDF guidelines say a third. Mode 'show' lists every conflicting field across web/visual/figma/guidelines/manual sources with each source's value, confidence, and the recommended winner per brand.config.yaml source_priority. Mode 'resolve' commits one source as the winner for a specific field (requires field + source). Use when brand_audit reports conflicts, after ingesting multiple sources, or when colors/fonts/logos look inconsistent in compiled outputs. Returns the conflict list in show mode, or the updated field value in resolve mode. Run brand_compile after resolving to refresh tokens and runtime artifacts. NOT for validating .brand/ structure (use brand_audit) or scoring content (use brand_audit_content).",
    paramsShape,
    { title: "Resolve extraction conflicts", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    async (args) => {
      const result = safeParseParams(ParamsSchema, args);
      if (!result.success) return result.response;
      return handler(result.data);
    },
  );
}
