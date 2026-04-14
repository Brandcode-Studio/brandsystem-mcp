import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BrandDir } from "../lib/brand-dir.js";
import { buildResponse, safeParseParams } from "../lib/response.js";
import { extractPdfBrandData } from "../lib/pdf-extractor.js";
import { mergeColorWithPriority, mergeTypographyWithPriority } from "../lib/confidence.js";
import { buildSourceCatalogRecords, getConfiguredSourcePriority, upsertSourceCatalog } from "../lib/source-catalog.js";
import { ERROR_CODES } from "../types/index.js";

const paramsShape = {
  file_path: z.string().min(1).describe("Path to a PDF brand guidelines document."),
  pages: z.string().default("all").describe('Page range to parse: "all", "3", or "1-5".'),
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

  const config = await brandDir.readConfig();
  const sourcePriority = getConfiguredSourcePriority(config);
  const identity = await brandDir.readCoreIdentity();
  let extracted;
  try {
    extracted = await extractPdfBrandData(input.file_path, input.pages);
  } catch (error) {
    return buildResponse({
      what_happened: `PDF extraction failed for ${input.file_path}`,
      next_steps: [
        "Check that the file exists and is a readable PDF",
        "If the PDF is image-only, try a selectable-text export or narrower page range",
      ],
      data: {
        success: false,
        error: ERROR_CODES.FETCH_FAILED,
        details: error instanceof Error ? error.message : String(error),
      },
    });
  }

  let colors = [...identity.colors];
  for (const color of extracted.colors) {
    colors = mergeColorWithPriority(colors, color, sourcePriority);
  }

  let typography = [...identity.typography];
  for (const entry of extracted.typography) {
    typography = mergeTypographyWithPriority(typography, entry, sourcePriority);
  }

  const spacing = extracted.spacing && (
    !identity.spacing
    || sourcePriority.indexOf("guidelines") <= sourcePriority.indexOf(identity.spacing.source)
  )
    ? extracted.spacing
    : identity.spacing;

  await brandDir.writeCoreIdentity({
    ...identity,
    colors,
    typography,
    spacing,
  });

  await upsertSourceCatalog(
    brandDir,
    buildSourceCatalogRecords({
      colors: extracted.colors,
      typography: extracted.typography,
      spacing: extracted.spacing,
    }),
  );

  return buildResponse({
    what_happened: `PDF guideline extraction complete for ${extracted.filePath}`,
    next_steps: [
      "Review the extracted colors, typography, spacing, and rule snippets",
      "Run brand_resolve_conflicts with mode \"show\" to inspect differences against existing sources",
      "Run brand_compile to refresh tokens, DESIGN.md, and runtime artifacts",
    ],
    data: {
      success: true,
      file_path: extracted.filePath,
      pages: extracted.pages,
      page_count: extracted.pageCount,
      extracted: {
        colors: extracted.colors,
        typography: extracted.typography,
        spacing: extracted.spacing,
        logos: extracted.logos,
        brand_rules: extracted.rules,
      },
    },
  });
}

export function register(server: McpServer) {
  server.tool(
    "brand_extract_pdf",
    "Extract brand colors, typography, spacing, and guideline rules from a PDF brand guidelines document. Merges extracted values into core-identity.yaml as source='guidelines', which can outrank web extraction based on brand.config.yaml source_priority.",
    paramsShape,
    async (args) => {
      const result = safeParseParams(ParamsSchema, args);
      if (!result.success) return result.response;
      return handler(result.data);
    },
  );
}
