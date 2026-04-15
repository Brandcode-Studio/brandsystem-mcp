import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BrandDir } from "../lib/brand-dir.js";
import { buildResponse, safeParseParams } from "../lib/response.js";
import { mergeColor, mergeTypography } from "../lib/confidence.js";
import { resolveSvg } from "../lib/svg-resolver.js";
import { ERROR_CODES } from "../types/index.js";
import type { ColorEntry, TypographyEntry } from "../types/index.js";
import { buildSourceCatalogRecords, upsertSourceCatalog } from "../lib/source-catalog.js";

const paramsShape = {
  mode: z.enum(["plan", "ingest"]).describe('"plan" to get extraction instructions, "ingest" to process collected Figma data'),
  figma_file_key: z.string().optional().describe("Figma file key from URL"),
  figma_url: z.string().optional().describe("Full Figma URL - file key and node ID extracted automatically"),
  variables: z.array(z.object({
    name: z.string(),
    resolvedType: z.string(),
    value: z.union([z.string(), z.number(), z.boolean()]).optional(),
    collection: z.string().optional(),
  })).optional().describe("Figma variables in structured format"),
  variable_map: z.record(z.string()).optional().describe("Simple { name: hex } map from get_variable_defs"),
  styles: z.array(z.object({
    name: z.string(),
    type: z.string(),
    fontFamily: z.string().optional(),
    fontSize: z.number().optional(),
    fontWeight: z.number().optional(),
    lineHeight: z.union([z.string(), z.number()]).optional(),
  })).optional().describe("Figma text styles"),
  design_context: z.string().optional().describe("Raw output from get_design_context - colors and fonts parsed from generated code"),
  logo_svg: z.string().optional().describe("Raw SVG of logo component"),
};

const ParamsSchema = z.object(paramsShape);
type Params = z.infer<typeof ParamsSchema>;

function extractFileKey(input: Params): string | null {
  if (input.figma_file_key) return input.figma_file_key;
  if (input.figma_url) {
    const match = input.figma_url.match(/figma\.com\/(?:file|design)\/([^/]+)/);
    return match?.[1] ?? null;
  }
  return null;
}

async function handlePlan(fileKey: string) {
  return buildResponse({
    what_happened: "Prepared Figma extraction plan",
    next_steps: [
      "Step 1: Call get_variable_defs with fileKey and a nodeId from the brand/color page. Returns a { name: hex } map.",
      "Step 2: Call get_design_context with the same fileKey and nodeId for the color palette frame. Returns code with embedded hex values and text labels.",
      "Step 3: (Optional) Search for a Logo component and export as SVG.",
      "Step 4: Call brand_extract_figma mode='ingest' with variable_map (step 1), design_context (step 2), and logo_svg (step 3).",
    ],
    data: {
      figma_file_key: fileKey,
      accepted_formats: {
        variable_map: '{ "C5 Orange": "#f44d37", "Dark Grey": "#1a171a" }',
        variables: '[{ name: "C5 Orange", resolvedType: "COLOR", value: "#f44d37" }]',
        design_context: "Raw string output from get_design_context (colors and fonts parsed automatically)",
        styles: '[{ name: "Heading", type: "TEXT", fontFamily: "Inter", fontSize: 24 }]',
      },
    },
  });
}

function parseColorsFromDesignContext(code: string): Array<{ name: string; hex: string }> {
  const colors: Array<{ name: string; hex: string }> = [];
  const seen = new Set<string>();
  let match;

  const varPattern = /var\(--([^,)]+),\s*#([0-9a-fA-F]{3,8})\)/g;
  while ((match = varPattern.exec(code)) !== null) {
    const hex = "#" + match[2].toLowerCase();
    if (!seen.has(hex)) { seen.add(hex); colors.push({ name: match[1].replace(/-/g, " ").trim(), hex }); }
  }

  const bgPattern = /bg-\[#([0-9a-fA-F]{3,8})\]/g;
  while ((match = bgPattern.exec(code)) !== null) {
    const hex = "#" + match[1].toLowerCase();
    if (!seen.has(hex)) { seen.add(hex); colors.push({ name: "extracted " + hex, hex }); }
  }

  const hexLabelPattern = /HEX:\s*([0-9a-fA-F]{6})/gi;
  while ((match = hexLabelPattern.exec(code)) !== null) {
    const hex = "#" + match[1].toLowerCase();
    if (!seen.has(hex)) { seen.add(hex); colors.push({ name: "labeled " + hex, hex }); }
  }

  return colors;
}

function parseFontsFromDesignContext(code: string): Array<{ family: string; size?: string; weight?: string }> {
  const fonts: Array<{ family: string; size?: string; weight?: string }> = [];
  const seen = new Set<string>();
  let match;

  const fontPattern = /font-\['([^':]+)(?::([^']+))?'/g;
  while ((match = fontPattern.exec(code)) !== null) {
    if (!seen.has(match[1])) { seen.add(match[1]); fonts.push({ family: match[1], weight: match[2] }); }
  }

  const sizePattern = /text-\[([0-9.]+)px\]/g;
  const sizes: string[] = [];
  while ((match = sizePattern.exec(code)) !== null) { sizes.push(match[1] + "px"); }
  if (fonts.length > 0 && sizes.length > 0) {
    fonts[0].size = [...new Set(sizes)].sort((a, b) => parseFloat(b) - parseFloat(a))[0];
  }

  return fonts;
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

  // Source 1: Structured variables
  if (input.variables) {
    for (const v of input.variables) {
      if (v.resolvedType === "COLOR" && typeof v.value === "string") {
        const hex = normalizeColor(v.value);
        if (!hex) continue;
        colors = mergeColor(colors, { name: v.name.replace(/\//g, " ").trim(), value: hex, role: inferRoleFromFigmaName(v.name), source: "figma", confidence: "high", figma_variable_id: v.name });
        colorCount++;
      }
    }
  }

  // Source 2: Simple variable map
  if (input.variable_map) {
    for (const [name, value] of Object.entries(input.variable_map)) {
      const hex = normalizeColor(value);
      if (!hex || colors.some(c => c.value === hex && c.source === "figma")) continue;
      colors = mergeColor(colors, { name, value: hex, role: inferRoleFromFigmaName(name), source: "figma", confidence: "high", figma_variable_id: name });
      colorCount++;
    }
  }

  // Source 3: Design context (parse from generated code)
  if (input.design_context) {
    for (const { name, hex } of parseColorsFromDesignContext(input.design_context)) {
      const normalized = normalizeColor(hex);
      if (!normalized || colors.some(c => c.value === normalized && c.source === "figma")) continue;
      colors = mergeColor(colors, { name, value: normalized, role: inferRoleFromFigmaName(name), source: "figma", confidence: "medium" });
      colorCount++;
    }
    for (const { family, size, weight } of parseFontsFromDesignContext(input.design_context)) {
      typography = mergeTypography(typography, { name: family, family, size, weight: weight === "Bold" ? 700 : weight === "Medium" ? 500 : undefined, source: "figma", confidence: "medium" });
      typeCount++;
    }
  }

  // Source 4: Text styles
  if (input.styles) {
    for (const s of input.styles) {
      if (s.type === "TEXT" && s.fontFamily) {
        typography = mergeTypography(typography, { name: s.name.replace(/\//g, " ").trim(), family: s.fontFamily, size: s.fontSize ? s.fontSize + "px" : undefined, weight: s.fontWeight, line_height: s.lineHeight ? String(s.lineHeight) : undefined, source: "figma", confidence: "high", figma_style_id: s.name });
        typeCount++;
      }
    }
  }

  // Source 5: Logo
  if (input.logo_svg) {
    const { inline_svg, data_uri } = resolveSvg(input.logo_svg);
    await brandDir.writeAsset("logo/logo-figma.svg", inline_svg);
    logos = logos.filter(l => l.source !== "web");
    logos.push({ type: "wordmark", source: "figma", confidence: "high", variants: [{ name: "default", file: "logo/logo-figma.svg", inline_svg, data_uri }] });
  }

  await brandDir.writeCoreIdentity({ ...identity, colors, typography, logo: logos });
  await upsertSourceCatalog(brandDir, buildSourceCatalogRecords({
    colors: colors.filter(c => c.source === "figma"),
    typography: typography.filter(t => t.source === "figma"),
  }));

  const config = await brandDir.readConfig();
  const figmaImportArtifact = {
    kind: "brandcode_figma_import_v1" as const,
    source: { tool: "brandsystem-mcp", mode: "extraction" as const },
    figma: { url: input.figma_url ?? null, fileKey: extractFileKey(input), nodeId: null, documentName: config.client_name ?? null, editorType: "unknown" as const },
    extraction: {
      colors: colors.map(c => ({ name: c.name, value: c.value, role: c.role, confidence: c.confidence })),
      typography: typography.map(t => ({ name: t.name, family: t.family, weight: t.weight, confidence: t.confidence })),
      logo: logos.length > 0 ? { type: logos[0].type, has_svg: !!logos[0].variants[0]?.inline_svg } : null,
      figma_file_key: extractFileKey(input),
      client_name: config.client_name ?? null,
    },
    _metadata: { what_happened: "Extracted from Figma: " + colorCount + " colors, " + typeCount + " typography" + (input.logo_svg ? ", 1 logo" : ""), next_steps: ["Run brand_compile", "Or paste artifact into Brand Loader"] },
  };

  const sources: string[] = [];
  if (input.variables?.length) sources.push("variables");
  if (input.variable_map && Object.keys(input.variable_map).length) sources.push("variable_map");
  if (input.design_context) sources.push("design_context");
  if (input.styles?.length) sources.push("styles");
  if (input.logo_svg) sources.push("logo");

  return buildResponse({
    what_happened: "Ingested Figma data from " + sources.join(" + ") + ": " + colorCount + " colors, " + typeCount + " typography" + (input.logo_svg ? ", 1 logo" : ""),
    next_steps: ["Run brand_compile to generate tokens, runtime, and interaction policy", "Run brand_status to see the full picture"],
    data: {
      ingested: { colors: colorCount, typography: typeCount, logo: input.logo_svg ? 1 : 0, sources },
      total: { colors: colors.length, typography: typography.length, logos: logos.length },
      brandcode_figma_import_artifact: figmaImportArtifact,
      agent_tip: "Figma extraction is the highest-accuracy source. Variables get 'high' confidence. Design context colors get 'medium'. Both outrank web extraction.",
    },
  });
}

function normalizeColor(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  if (/^#[0-9a-f]{3,8}$/.test(trimmed)) return trimmed;
  const rgbMatch = trimmed.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgbMatch) {
    const [, r, g, b] = rgbMatch;
    return "#" + parseInt(r).toString(16).padStart(2, "0") + parseInt(g).toString(16).padStart(2, "0") + parseInt(b).toString(16).padStart(2, "0");
  }
  return null;
}

function inferRoleFromFigmaName(name: string): ColorEntry["role"] {
  const lower = name.toLowerCase();
  if (lower.includes("primary") || lower.includes("brand") || lower.includes("orange") || lower.includes("main")) return "primary";
  if (lower.includes("secondary")) return "secondary";
  if (lower.includes("accent") || lower.includes("green") || lower.includes("acid") || lower.includes("pink") || lower.includes("light pink")) return "accent";
  if (lower.includes("neutral") || lower.includes("gray") || lower.includes("grey") || lower.includes("light grey")) return "neutral";
  if (lower.includes("surface") || lower.includes("bg") || lower.includes("background") || lower === "white") return "surface";
  if (lower.includes("text") || lower.includes("foreground") || lower.includes("dark grey") || lower.includes("dark")) return "text";
  if (lower.includes("action") || lower.includes("cta") || lower.includes("button")) return "action";
  if (lower.includes("tint") || lower.includes("alpha")) return "tint";
  if (lower.includes("border") || lower.includes("divider")) return "border";
  return "unknown";
}

export function register(server: McpServer) {
  server.tool(
    "brand_extract_figma",
    "Extract brand identity from a Figma design file. Accepts multiple input formats: variable_map (simple { name: hex } from get_variable_defs), design_context (raw get_design_context output with colors/fonts parsed from code), variables (structured array), styles (text styles), and logo_svg. Two phases: mode='plan' returns which Figma MCP tools to call. Mode='ingest' processes all collected data. Figma values override web extraction based on source_priority. Also accepts figma_url for automatic file key extraction. NOT for web extraction (use brand_extract_web).",
    paramsShape,
    async (args) => {
      const result = safeParseParams(ParamsSchema, args);
      if (!result.success) return result.response;
      const parsed = result.data;
      if (parsed.mode === "plan") {
        const fileKey = extractFileKey(parsed);
        if (!fileKey) {
          return buildResponse({ what_happened: "Figma file key is required", next_steps: ["Provide figma_file_key or figma_url"], data: { error: ERROR_CODES.MISSING_FIGMA_FILE_KEY } });
        }
        return handlePlan(fileKey);
      }
      return handleIngest(parsed);
    }
  );
}
