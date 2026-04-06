import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BrandDir } from "../lib/brand-dir.js";
import { buildResponse, safeParseParams } from "../lib/response.js";
import { mergeColor, mergeTypography } from "../lib/confidence.js";
import { resolveSvg } from "../lib/svg-resolver.js";
import { ERROR_CODES } from "../types/index.js";
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

const ParamsSchema = z.object(paramsShape);
type Params = z.infer<typeof ParamsSchema>;

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
      brandcode_import_note: "After ingest, the response includes a brandcode_figma_import_v1 artifact that can be pasted directly into Brandcode Studio Brand Loader for hosted brand creation.",
    },
  });
}

async function handleIngest(input: Params) {
  const brandDir = new BrandDir(process.cwd());

  if (!(await brandDir.exists())) {
    return buildResponse({
      what_happened: "No .brand/ directory found",
      next_steps: ["Run brand_init first"],
      data: { error: ERROR_CODES.NOT_INITIALIZED },
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
    await brandDir.writeAsset("logo/logo-figma.svg", inline_svg);
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

  // Build the brandcode_figma_import_v1 artifact for Brand Loader interop
  const config = await brandDir.readConfig();
  const figmaImportArtifact = {
    kind: "brandcode_figma_import_v1" as const,
    source: {
      tool: "brandsystem-mcp",
      mode: "extraction" as const,
    },
    figma: {
      url: null,
      fileKey: input.figma_file_key ?? null,
      nodeId: null,
      documentName: config.client_name ?? null,
      editorType: "unknown" as const,
    },
    extraction: {
      colors: colors.map(c => ({ name: c.name, value: c.value, role: c.role, confidence: c.confidence })),
      typography: typography.map(t => ({ name: t.name, family: t.family, weight: t.weight, confidence: t.confidence })),
      logo: logos.length > 0 ? { type: logos[0].type, has_svg: !!logos[0].variants[0]?.inline_svg } : null,
      figma_file_key: input.figma_file_key ?? null,
      client_name: config.client_name ?? null,
    },
    _metadata: {
      what_happened: `Extracted from Figma: ${colorCount} colors, ${typeCount} typography${input.logo_svg ? ", 1 logo" : ""}`,
      next_steps: [
        "Run brand_compile to generate tokens + runtime + policy",
        "Or paste/upload this artifact into Brandcode Studio Brand Loader",
      ],
    },
  };

  return buildResponse({
    what_happened: `Ingested Figma data: ${colorCount} colors, ${typeCount} typography entries${input.logo_svg ? ", 1 logo" : ""}`,
    next_steps: [
      "Run brand_compile to generate tokens, runtime, and interaction policy",
      "Run brand_status to see the full picture",
      "To import into Brandcode Studio: paste or upload the brandcode_figma_import_v1 artifact into Brand Loader",
    ],
    data: {
      ingested: { colors: colorCount, typography: typeCount, logo: input.logo_svg ? 1 : 0 },
      total: { colors: colors.length, typography: typography.length, logos: logos.length },
      brandcode_figma_import_artifact: figmaImportArtifact,
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
    "Extract brand identity from a Figma design file — colors, typography, and logo at higher accuracy than web extraction. Two-phase workflow: first call with mode='plan' to get instructions for which Figma MCP tools to call, then call with mode='ingest' to process the collected data. Figma-sourced values override web-extracted values. Use when the user has a Figma file URL or key. Returns merged identity data with high-confidence scores.",
    paramsShape,
    async (args) => {
      const result = safeParseParams(ParamsSchema, args);
      if (!result.success) return result.response;
      const parsed = result.data;
      if (parsed.mode === "plan") {
        if (!parsed.figma_file_key || parsed.figma_file_key.trim() === "") {
          return buildResponse({
            what_happened: "Figma file key is required for plan mode",
            next_steps: ["Provide a Figma file key (from the URL: figma.com/file/YOUR_KEY/...)"],
            data: { error: ERROR_CODES.MISSING_FIGMA_FILE_KEY },
          });
        }
        return handlePlan(parsed.figma_file_key);
      }
      return handleIngest(parsed);
    }
  );
}
