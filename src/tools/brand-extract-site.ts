import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BrandDir } from "../lib/brand-dir.js";
import { buildResponse } from "../lib/response.js";
import { extractSite, isVisualExtractionAvailable } from "../lib/visual-extractor.js";
import { persistSiteExtraction } from "../lib/site-evidence.js";
import { ERROR_CODES } from "../types/index.js";

const paramsShape = {
  url: z.string().url().describe("Website URL to deeply extract brand evidence from (e.g. 'https://acme.com')."),
  page_limit: z.number().int().min(1).max(5).default(5)
    .describe("Maximum number of representative pages to sample. Default 5."),
  merge: z.boolean().default(true)
    .describe("If true and .brand/ exists, merge extracted colors/fonts into core-identity.yaml and persist extraction-evidence.json."),
};

const ParamsSchema = z.object(paramsShape);
type Params = z.infer<typeof ParamsSchema>;

async function handler(input: Params) {
  if (!isVisualExtractionAvailable()) {
    return buildResponse({
      what_happened: "Site extraction unavailable — no Chrome/Chromium found on this system",
      next_steps: [
        "Install Google Chrome or Chromium",
        "Use brand_extract_web for CSS-only extraction",
      ],
      data: {
        available: false,
        reason: "No Chromium-based browser detected. Site extraction requires Chrome, Chromium, Brave, or Edge.",
      },
    });
  }

  const brandDir = new BrandDir(process.cwd());
  if (input.merge && !(await brandDir.exists())) {
    return buildResponse({
      what_happened: "No .brand/ directory found",
      next_steps: ["Run brand_start or brand_init first to create the brand system"],
      data: { error: ERROR_CODES.NOT_INITIALIZED },
    });
  }

  const extraction = await extractSite(input.url, {
    pageLimit: input.page_limit,
    viewports: ["desktop", "mobile"],
  });

  if (!extraction.success) {
    return buildResponse({
      what_happened: `Site extraction failed: ${extraction.reason}`,
      next_steps: [
        "Check the URL is publicly accessible",
        "Try brand_extract_visual for a single-page fallback",
        "Try brand_extract_web for CSS-only extraction",
      ],
      data: { success: false, reason: extraction.reason },
    });
  }

  let merged = null;
  let evidenceFile = null;
  if (input.merge) {
    const persisted = await persistSiteExtraction(brandDir, extraction, { merge: true });
    merged = {
      colors_added: persisted.colors_added,
      fonts_added: persisted.fonts_added,
      screenshots_saved: persisted.screenshots_saved,
    };
    evidenceFile = ".brand/extraction-evidence.json";
  }

  const summaryImages = extraction.selectedPages
    .flatMap((page) => page.viewports.filter((viewport) => viewport.viewport === "desktop").slice(0, 1))
    .slice(0, 2)
    .map((viewport) => ({
      type: "image",
      data: viewport.screenshot.toString("base64"),
      mimeType: "image/png",
    } as unknown as { type: "text"; text: string }));

  const textResponse = buildResponse({
    what_happened: `Deep site extraction complete for ${input.url} — ${extraction.selectedPages.length} representative pages sampled across desktop and mobile viewports`,
    next_steps: [
      "Review the representative screenshots and confirm the extracted brand direction",
      ...(input.merge ? ["Run brand_generate_designmd to synthesize DESIGN.md and design-synthesis.json from the saved evidence bundle"] : []),
      ...(input.merge ? ["Run brand_compile to regenerate tokens after the deeper merge"] : []),
    ],
    data: {
      success: true,
      url: input.url,
      discovered_pages: extraction.discoveredPages,
      selected_pages: extraction.selectedPages.map((page) => ({
        url: page.url,
        page_type: page.pageType,
        selection_reason: page.selectionReason,
        title: page.title,
        viewport_count: page.viewports.length,
        unique_colors: [...new Set(page.viewports.flatMap((viewport) => viewport.uniqueColors))].length,
        unique_fonts: [...new Set(page.viewports.flatMap((viewport) => viewport.uniqueFonts))],
      })),
      summary: {
        page_count: extraction.selectedPages.length,
        screenshot_count: extraction.selectedPages.reduce((sum, page) => sum + page.viewports.length, 0),
        aggregated_colors: [...new Set(extraction.selectedPages.flatMap((page) => page.viewports.flatMap((viewport) => viewport.uniqueColors)))].length,
        aggregated_fonts: [...new Set(extraction.selectedPages.flatMap((page) => page.viewports.flatMap((viewport) => viewport.uniqueFonts)))],
      },
      merged,
      evidence_file: evidenceFile,
      conversation_guide: {
        instruction: [
          "This was a deep URL extraction, not a homepage-only scan.",
          "Describe what stays consistent across the sampled pages: CTA color, typography character, density, and shape language.",
          "If the screenshots and extracted colors disagree, trust the screenshots and ask for confirmation before finalizing primary roles.",
          ...(input.merge ? ["Mention that extraction-evidence.json was saved and core-identity.yaml was updated with merged colors and fonts."] : []),
        ].join("\n"),
      },
    },
  });

  return {
    content: [...summaryImages, textResponse.content[0]],
  };
}

export function register(server: McpServer) {
  server.tool(
    "brand_extract_site",
    "Deeply extract brand evidence from a website by discovering representative pages, rendering them in headless Chrome across desktop and mobile, capturing screenshots, and sampling computed styles from multiple components. Use when a homepage scan is not enough or when you want richer evidence before compiling tokens.",
    paramsShape,
    async (args) => {
      const parsed = ParamsSchema.safeParse(args);
      if (!parsed.success) {
        return buildResponse({
          what_happened: `Invalid parameters: ${parsed.error.message}`,
          next_steps: ["Check the url and page_limit parameters"],
          data: { error: parsed.error.format() },
        });
      }
      return handler(parsed.data);
    },
  );
}
