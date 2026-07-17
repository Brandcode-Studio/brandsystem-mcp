import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BrandDir } from "../lib/brand-dir.js";
import { buildResponse } from "../lib/response.js";
import { ERROR_CODES } from "../types/index.js";
import { generatePreviewHtml } from "../lib/preview-generator.js";
import type { BrandRuntime } from "../lib/runtime-compiler.js";
import {
  ensureLiveFreshness,
  buildLiveIndicator,
} from "../connectors/brandcode/live-source.js";

async function handler() {
  const cwd = process.cwd();
  const brandDir = new BrandDir(cwd);

  const live = await ensureLiveFreshness(cwd);
  const liveIndicator = buildLiveIndicator(live);

  if (!(await brandDir.exists())) {
    return buildResponse({
      what_happened: "No .brand/ directory found",
      next_steps: ["Run brand_start first to create a brand system"],
      data: { error: ERROR_CODES.NOT_INITIALIZED },
    });
  }

  // Read compiled runtime — the single source for preview
  let runtime: BrandRuntime;
  try {
    runtime = await brandDir.readRuntime();
  } catch {
    return buildResponse({
      what_happened: "No brand-runtime.json found — run brand_compile first",
      next_steps: [
        "Run brand_compile to generate the runtime from your extracted brand data",
        "Then run brand_preview to see the visual proof",
      ],
      data: { error: ERROR_CODES.NOT_COMPILED },
    });
  }

  const html = generatePreviewHtml(runtime);

  // Write to .brand/brand-preview.html
  await brandDir.writeMarkdown("brand-preview.html", html);

  const colorCount = Object.keys(runtime.identity?.colors ?? {}).length;
  const fontCount = Object.keys(runtime.identity?.typography ?? {}).length;
  const hasVoice = !!runtime.voice;
  const hasVisual = !!runtime.visual;

  const freshnessTag = liveIndicator
    ? live.source === "local-fallback"
      ? " (Live — local fallback)"
      : live.source === "live"
        ? " (Live)"
        : " (Live — cached)"
    : "";

  return buildResponse({
    what_happened: `Brand preview generated for "${runtime.client_name}"${freshnessTag}`,
    next_steps: [
      "Open .brand/brand-preview.html in a browser to see the visual proof",
      "Screenshot and share to validate the brand extraction",
      "If colors or fonts look wrong, run brand_clarify to correct them",
    ],
    data: {
      file: ".brand/brand-preview.html",
      client_name: runtime.client_name,
      sections: {
        color_palette: colorCount > 0,
        typography: fontCount > 0,
        ui_components: colorCount > 0,
        contrast_matrix: colorCount > 0,
        voice: hasVoice,
        visual_rules: hasVisual,
      },
      color_count: colorCount,
      font_count: fontCount,
      ...(liveIndicator ? { live: liveIndicator } : {}),
    },
  });
}

export function register(server: McpServer) {
  server.tool(
    "brand_preview",
    'Generate a visual proof page showing the brand applied to common UI patterns — color swatches, typography hierarchy, buttons, cards, and a WCAG contrast matrix. Writes .brand/brand-preview.html. Screenshot-ready, shareable, built from brand-runtime.json only. Use when the user says "show me my brand", "preview the brand", "does this look right?", or after extraction to validate results. Requires brand_compile to have run first. NOT the full report — use brand_report for comprehensive data.',
    { title: "Generate brand preview", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async () => handler(),
  );
}
