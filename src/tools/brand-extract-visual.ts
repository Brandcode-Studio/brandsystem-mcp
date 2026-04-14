/**
 * brand_extract_visual — Multimodal brand extraction via headless Chrome.
 *
 * Screenshots a URL and extracts computed styles from rendered elements.
 * Returns the screenshot as an MCP image content block so the calling agent
 * can use its own vision capabilities for analysis, PLUS structured computed
 * style data (colors with semantic roles, fonts, CSS custom properties).
 *
 * This is the I8 solution: sites that defeat static CSS parsing (Basecamp,
 * heavy JS-rendered apps, Elementor sites) render correctly in Chrome, so
 * computed styles always return values.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BrandDir } from "../lib/brand-dir.js";
import { buildResponse } from "../lib/response.js";
import {
  extractVisual,
  inferRolesFromVisual,
  isVisualExtractionAvailable,
  type VisualColorCandidate,
} from "../lib/visual-extractor.js";
import { mergeColorWithPriority, mergeTypographyWithPriority } from "../lib/confidence.js";
import { generateColorName } from "../lib/color-namer.js";
import type { ColorEntry, TypographyEntry } from "../types/index.js";
import { buildSourceCatalogRecords, getConfiguredSourcePriority, upsertSourceCatalog } from "../lib/source-catalog.js";

const paramsShape = {
  url: z.string().url().describe("Website URL to visually extract brand identity from (e.g. 'https://basecamp.com')"),
  merge: z.boolean().default(true)
    .describe("If true and .brand/ exists, merge visual results into existing core-identity.yaml. If false, return data only without writing."),
};

const ParamsSchema = z.object(paramsShape);
type Params = z.infer<typeof ParamsSchema>;

async function handler(input: Params) {
  // Check if Chrome is available
  if (!isVisualExtractionAvailable()) {
    return buildResponse({
      what_happened: "Visual extraction unavailable — no Chrome/Chromium found on this system",
      next_steps: [
        "Install Google Chrome or Chromium",
        "Use brand_extract_web for CSS-only extraction (no browser required)",
      ],
      data: {
        available: false,
        reason: "No Chromium-based browser detected. Visual extraction requires Chrome, Chromium, Brave, or Edge.",
      },
    });
  }

  const result = await extractVisual(input.url);

  if (!result.success) {
    return buildResponse({
      what_happened: `Visual extraction failed: ${result.reason}`,
      next_steps: [
        "Check the URL is accessible",
        "Try brand_extract_web for CSS-only extraction as fallback",
      ],
      data: { success: false, reason: result.reason },
    });
  }

  // Infer roles from visual context
  const roleCandidates = inferRolesFromVisual(result.computedElements, result.cssCustomProperties);
  const colorProperties = Object.fromEntries(
    Object.entries(result.cssCustomProperties)
      .filter(([, value]) => /^#[0-9a-f]{3,8}$/i.test(value) || /^rgba?\(/i.test(value))
      .slice(0, 30)
  );

  // Build structured color data
  const chromaticColors = roleCandidates.filter((c) => c.role !== "surface" && c.role !== "text");
  const surfaceColors = roleCandidates.filter((c) => c.role === "surface");
  const textColors = roleCandidates.filter((c) => c.role === "text");

  // Merge into existing brand if requested
  let mergedCount = 0;
  if (input.merge) {
    const brandDir = new BrandDir(process.cwd());
    if (await brandDir.exists()) {
      const config = await brandDir.readConfig();
      const sourcePriority = getConfiguredSourcePriority(config);
      const identity = await brandDir.readCoreIdentity();
      let colors = [...identity.colors];
      let typography = [...identity.typography];
      let spacing = identity.spacing;
      const visualColors: ColorEntry[] = [];
      const visualTypography: TypographyEntry[] = [];

      // Merge visual colors
      for (const vc of roleCandidates) {
        const entry: ColorEntry = {
          name: generateColorName(vc.hex, vc.role),
          value: vc.hex,
          role: vc.role as ColorEntry["role"],
          source: "visual",
          confidence: vc.confidence,
          css_property: `computed:${vc.source_context}`,
        };
        visualColors.push(entry);
        const before = colors.length;
        colors = mergeColorWithPriority(colors, entry, sourcePriority);
        if (colors.length > before) mergedCount++;
      }

      // Merge visual fonts
      for (const font of result.uniqueFonts) {
        const entry: TypographyEntry = {
          name: font,
          family: font,
          source: "visual",
          confidence: "medium",
        };
        visualTypography.push(entry);
        typography = mergeTypographyWithPriority(typography, entry, sourcePriority);
      }

      if (result.visualTokens.spacing.scale.length > 0 || result.visualTokens.spacing.baseUnit) {
        spacing = {
          base_unit: result.visualTokens.spacing.baseUnit ?? spacing?.base_unit,
          scale: result.visualTokens.spacing.scale.length > 0 ? result.visualTokens.spacing.scale : spacing?.scale,
          source: "visual",
          confidence: result.visualTokens.spacing.scale.length >= 5 ? "high" : "medium",
        };
      }

      await brandDir.writeCoreIdentity({
        ...identity,
        colors,
        typography,
        spacing,
      });

      await upsertSourceCatalog(
        brandDir,
        buildSourceCatalogRecords({
          colors: visualColors,
          typography: visualTypography,
          spacing: spacing?.source === "visual" ? spacing : null,
        }),
      );
    }
  }

  // Build the text response
  const textData = buildResponse({
    what_happened: `Visual extraction complete for ${input.url} — ${result.uniqueColors.length} colors, ${result.uniqueFonts.length} fonts from rendered page${mergedCount > 0 ? `, ${mergedCount} new colors merged into core-identity` : ""}`,
    next_steps: [
      "Analyze the screenshot to identify brand personality, layout patterns, and visual hierarchy",
      "Confirm the primary color and role assignments below",
      ...(mergedCount > 0 ? ["Run brand_compile to regenerate tokens with the new visual data"] : []),
    ],
    data: {
      success: true,
      url: input.url,
      page_title: result.pageTitle,

      computed_colors: {
        primary_candidates: chromaticColors.filter((c) => c.role === "primary"),
        accent_candidates: chromaticColors.filter((c) => c.role === "accent" || c.role === "secondary"),
        surface: surfaceColors,
        text: textColors,
        all_with_roles: roleCandidates,
      },

      computed_fonts: result.uniqueFonts,

      spacing: result.visualTokens.spacing,

      border_radius: result.visualTokens.borderRadius,

      shadows: result.visualTokens.shadows,

      components: result.visualTokens.components,

      computed_elements: result.computedElements,

      css_custom_properties: {
        total: Object.keys(result.cssCustomProperties).length,
        color_properties: colorProperties,
      },

      merged: input.merge ? { new_colors: mergedCount } : null,

      visual_analysis_prompt: [
        "You are looking at a screenshot of this brand's website. Analyze it for:",
        "1. **Primary brand color** — what color dominates CTAs, interactive elements, and the brand mark?",
        "2. **Color mood** — is the palette warm/cool, vibrant/muted, light/dark?",
        "3. **Typography character** — are the fonts geometric, humanist, serif, monospaced? What's the hierarchy?",
        "4. **Spatial personality** — dense/spacious, grid/organic, sharp/rounded corners?",
        "5. **Brand personality** — professional/playful, premium/accessible, minimal/rich?",
        "6. **Visual patterns** — gradients, illustrations, photography style, icon style?",
        "",
        "Compare your visual analysis with the computed_colors data. If they conflict, trust what you see.",
      ].join("\n"),
    },
  });

  // Return multi-content MCP response: image + text
  // Cast image content to satisfy buildResponse's text-only return type
  const textContent = textData.content[0];
  return {
    content: [
      {
        type: "image",
        data: result.screenshot.toString("base64"),
        mimeType: "image/png",
      } as unknown as { type: "text"; text: string },
      textContent,
    ],
  };
}

export function register(server: McpServer) {
  server.tool(
    "brand_extract_visual",
    "Screenshot a website and extract brand colors, fonts, and visual personality using headless Chrome. Returns the screenshot as an image for your visual analysis PLUS computed styles from rendered elements. Use when brand_extract_web yields LOW quality (e.g. JS-rendered sites like Basecamp), when you need visual context for brand personality, or when CSS parsing misses colors. Requires Chrome/Chromium installed. NOT for Figma extraction — use brand_extract_figma instead.",
    paramsShape,
    async (args) => {
      const parsed = ParamsSchema.safeParse(args);
      if (!parsed.success) {
        return buildResponse({
          what_happened: `Invalid parameters: ${parsed.error.message}`,
          next_steps: ["Check the url parameter is a valid URL"],
          data: { error: parsed.error.format() },
        });
      }
      return handler(parsed.data);
    }
  );
}
