import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BrandDir } from "../lib/brand-dir.js";
import { buildResponse } from "../lib/response.js";
import { mergeColor, mergeTypography } from "../lib/confidence.js";
import { resolveSvg } from "../lib/svg-resolver.js";
import type { ColorEntry, TypographyEntry } from "../types/index.js";

const paramsShape = {
  mode: z.enum(["plan", "ingest"]).describe('"plan" to get instructions, "ingest" to process Figma data'),
  figma_file_key: z.string().optional().describe("Figma file key (required for plan mode)"),
  variables: z.array(z.object({
    name: z.string(),
    resolvedType: z.string(),
    value: z.union([z.string(), z.number(), z.boolean()]).optional(),
    collection: z.string().optional(),
  })).optional().describe("Figma variables (for ingest mode)"),
  styles: z.array(z.object({
    name: z.string(),
    type: z.string(),
    fontFamily: z.string().optional(),
    fontSize: z.number().optional(),
    fontWeight: z.number().optional(),
    lineHeight: z.union([z.string(), z.number()]).optional(),
  })).optional().describe("Figma text styles (for ingest mode)"),
  logo_svg: z.string().optional().describe("Raw SVG of logo component (for ingest mode)"),
};

type Params = {
  mode: "plan" | "ingest";
  figma_file_key?: string;
  variables?: Array<{ name: string; resolvedType: string; value?: string | number | boolean; collection?: string }>;
  styles?: Array<{ name: string; type: string; fontFamily?: string; fontSize?: number; fontWeight?: number; lineHeight?: string | number }>;
  logo_svg?: string;
};

async function handlePlan(figmaFileKey: string) {
  return buildResponse({
    what_happened: "Prepared Figma extraction plan",
    next_steps: [
      `Use the Figma MCP to call get_variables for file "${figmaFileKey}" — request all variable collections, resolve aliases, include color and number types`,
      `Use the Figma MCP to call get_styles — request text styles with font family, size, weight, and line height`,
      `Search for a component named "Logo" or "Wordmark" and export it as SVG`,
      `Call brand_extract_figma again with mode "ingest" and pass the collected variables, styles, and logo_svg`,
    ],
    data: {
      figma_file_key: figmaFileKey,
      required_data: [
        "variables: array of { name, resolvedType, value, collection }",
        "styles: array of { name, type, fontFamily, fontSize, fontWeight, lineHeight }",
        "logo_svg: raw SVG string of the logo component (optional)",
      ],
    },
  });
}

async function handleIngest(input: Params) {
  const brandDir = new BrandDir(process.cwd());

  if (!(await brandDir.exists())) {
    return buildResponse({
      what_happened: "No .brand/ directory found",
      next_steps: ["Run brand_init first"],
      data: { error: "not_initialized" },
    });
  }

  const identity = await brandDir.readCoreIdentity();
  let colors = [...identity.colors];
  let typography = [...identity.typography];
  let logos = [...identity.logo];
  let colorCount = 0;
  let typeCount = 0;

  if (input.variables) {
    for (const v of input.variables) {
      if (v.resolvedType === "COLOR" && typeof v.value === "string") {
        const hex = normalizeColor(v.value);
        if (!hex) continue;

        const entry: ColorEntry = {
          name: v.name.replace(/\//g, " ").trim(),
          value: hex,
          role: inferRoleFromFigmaName(v.name),
          source: "figma",
          confidence: "high",
          figma_variable_id: v.name,
        };
        colors = mergeColor(colors, entry);
        colorCount++;
      }
    }
  }

  if (input.styles) {
    for (const s of input.styles) {
      if (s.type === "TEXT" && s.fontFamily) {
        const entry: TypographyEntry = {
          name: s.name.replace(/\//g, " ").trim(),
          family: s.fontFamily,
          size: s.fontSize ? `${s.fontSize}px` : undefined,
          weight: s.fontWeight,
          line_height: s.lineHeight ? String(s.lineHeight) : undefined,
          source: "figma",
          confidence: "high",
          figma_style_id: s.name,
        };
        typography = mergeTypography(typography, entry);
        typeCount++;
      }
    }
  }

  if (input.logo_svg) {
    const { inline_svg, data_uri } = resolveSvg(input.logo_svg);
    await brandDir.writeAsset("logo/logo-figma.svg", input.logo_svg);
    logos = logos.filter((l) => l.source !== "web");
    logos.push({
      type: "wordmark",
      source: "figma",
      confidence: "high",
      variants: [{
        name: "default",
        file: "logo/logo-figma.svg",
        inline_svg,
        data_uri,
      }],
    });
  }

  await brandDir.writeCoreIdentity({ ...identity, colors, typography, logo: logos });

  return buildResponse({
    what_happened: `Ingested Figma data: ${colorCount} colors, ${typeCount} typography entries${input.logo_svg ? ", 1 logo" : ""}`,
    next_steps: [
      "Run brand_compile to generate tokens.json",
      "Run brand_status to see the full picture",
    ],
    data: {
      ingested: { colors: colorCount, typography: typeCount, logo: input.logo_svg ? 1 : 0 },
      total: { colors: colors.length, typography: typography.length, logos: logos.length },
    },
  });
}

function normalizeColor(value: string): string | null {
  if (/^#[0-9a-fA-F]{3,8}$/.test(value)) return value.toLowerCase();
  const rgbMatch = value.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgbMatch) {
    const [, r, g, b] = rgbMatch;
    return `#${parseInt(r).toString(16).padStart(2, "0")}${parseInt(g).toString(16).padStart(2, "0")}${parseInt(b).toString(16).padStart(2, "0")}`;
  }
  return null;
}

function inferRoleFromFigmaName(name: string): ColorEntry["role"] {
  const lower = name.toLowerCase();
  if (lower.includes("primary") || lower.includes("brand")) return "primary";
  if (lower.includes("secondary")) return "secondary";
  if (lower.includes("accent")) return "accent";
  if (lower.includes("neutral") || lower.includes("gray") || lower.includes("grey")) return "neutral";
  if (lower.includes("surface") || lower.includes("bg") || lower.includes("background")) return "surface";
  if (lower.includes("text") || lower.includes("foreground")) return "text";
  if (lower.includes("action") || lower.includes("cta")) return "action";
  return "unknown";
}

export function register(server: McpServer) {
  server.tool(
    "brand_extract_figma",
    `Extract brand identity from Figma. Two modes:
- mode "plan": Returns instructions for which Figma MCP tools to call. Use this first.
- mode "ingest": Processes Figma data you've collected. Pass variables, styles, and logo_svg.
Figma data is more authoritative than web extraction — it will override web-sourced values.`,
    paramsShape,
    async (args) => {
      const parsed = args as Params;
      if (parsed.mode === "plan") {
        if (!parsed.figma_file_key || parsed.figma_file_key.trim() === "") {
          return buildResponse({
            what_happened: "Figma file key is required for plan mode",
            next_steps: ["Provide a Figma file key (from the URL: figma.com/file/YOUR_KEY/...)"],
            data: { error: "missing_figma_file_key" },
          });
        }
        return handlePlan(parsed.figma_file_key);
      }
      return handleIngest(parsed);
    }
  );
}
