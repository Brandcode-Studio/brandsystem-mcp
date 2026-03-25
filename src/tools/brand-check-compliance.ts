import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readFile } from "node:fs/promises";
import { BrandDir } from "../lib/brand-dir.js";
import { buildResponse } from "../lib/response.js";
import { loadBrandContext, isHtmlContent } from "../lib/content-scorer.js";
import * as cheerio from "cheerio";

// ---------------------------------------------------------------------------
// Inline utilities (fast-path versions — no full scoring overhead)
// ---------------------------------------------------------------------------

function normalizeHex(hex: string): string {
  let h = hex.toLowerCase().trim();
  if (/^#[0-9a-f]{3}$/.test(h)) h = `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`;
  if (/^#[0-9a-f]{8}$/.test(h)) h = h.slice(0, 7);
  return h;
}

function rgbToHex(rgb: string): string | null {
  const match = rgb.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!match) return null;
  const [, r, g, b] = match;
  const toHex = (n: string) => parseInt(n, 10).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function extractCssColors(css: string): string[] {
  const colors: string[] = [];
  let m: RegExpExecArray | null;
  const hexRe = /#[0-9a-fA-F]{3,8}\b/g;
  while ((m = hexRe.exec(css)) !== null) colors.push(normalizeHex(m[0]));
  const rgbRe = /rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+(?:\s*,\s*[\d.]+)?\s*\)/g;
  while ((m = rgbRe.exec(css)) !== null) {
    const hex = rgbToHex(m[0]);
    if (hex) colors.push(normalizeHex(hex));
  }
  return [...new Set(colors)];
}

function extractFontFamilies(css: string): string[] {
  const families: string[] = [];
  const re = /font-family\s*:\s*([^;}"]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    for (const part of m[1].split(",")) {
      const clean = part.trim().replace(/^['"]|['"]$/g, "").trim();
      if (clean) families.push(clean);
    }
  }
  return [...new Set(families)];
}

const SYSTEM_FONTS = new Set([
  "serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui",
  "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded",
  "-apple-system", "blinkmacsystemfont", "segoe ui", "roboto",
  "helvetica neue", "arial", "noto sans", "liberation sans",
  "helvetica", "times new roman", "times", "georgia", "courier new",
  "courier", "verdana", "tahoma", "trebuchet ms", "lucida grande",
  "lucida sans unicode", "lucida console", "monaco", "menlo", "consolas",
]);

const NEUTRAL_COLORS = new Set([
  "#000000", "#ffffff", "#111111", "#222222", "#333333", "#444444",
  "#555555", "#666666", "#777777", "#888888", "#999999",
  "#aaaaaa", "#bbbbbb", "#cccccc", "#dddddd", "#eeeeee",
  "#f5f5f5", "#f8f8f8", "#fafafa",
]);

const ANTI_PATTERN_MATCHERS: Array<{ keywords: string[]; test: (css: string) => boolean }> = [
  { keywords: ["drop shadow", "drop-shadow", "box shadow", "box-shadow"], test: (css) => /box-shadow\s*:/i.test(css) || /text-shadow\s*:/i.test(css) || /filter\s*:.*drop-shadow/i.test(css) },
  { keywords: ["gradient"], test: (css) => /(?:linear|radial|conic)-gradient/i.test(css) },
  { keywords: ["border radius", "border-radius", "rounded corner", "pill shape"], test: (css) => /border-radius\s*:/i.test(css) },
  { keywords: ["blur"], test: (css) => /filter\s*:.*blur/i.test(css) || /backdrop-filter\s*:.*blur/i.test(css) },
];

function matchAntiPattern(rule: string, css: string): boolean {
  const lower = rule.toLowerCase();
  for (const m of ANTI_PATTERN_MATCHERS) {
    if (m.keywords.some((kw) => lower.includes(kw))) return m.test(css);
  }
  return false;
}

function countOccurrences(text: string, pattern: string): number {
  const lower = text.toLowerCase();
  const target = pattern.toLowerCase();
  let count = 0, idx = 0;
  while ((idx = lower.indexOf(target, idx)) !== -1) { count++; idx += target.length; }
  return count;
}

// ---------------------------------------------------------------------------
// Content resolution
// ---------------------------------------------------------------------------

async function resolveContent(input: string): Promise<{ content: string; isHtml: boolean }> {
  if (/\.(html?|md|txt)$/i.test(input.trim()) && !input.includes("\n") && input.length < 500) {
    try {
      const content = await readFile(input.trim(), "utf-8");
      return { content, isHtml: /\.html?$/i.test(input.trim()) || isHtmlContent(content) };
    } catch { /* not a file */ }
  }
  return { content: input, isHtml: isHtmlContent(input) };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

interface ComplianceCheck {
  id: string;
  status: "pass" | "fail" | "warn";
  message: string;
  detail?: string;
}

interface CheckComplianceParams {
  content: string;
  strict: boolean;
}

async function handler(input: CheckComplianceParams) {
  const brandDir = new BrandDir(process.cwd());

  if (!(await brandDir.exists())) {
    return buildResponse({
      what_happened: "No .brand/ directory found",
      next_steps: ["Run brand_start to create a brand system first"],
      data: { error: "not_initialized" },
    });
  }

  let ctx;
  try {
    ctx = await loadBrandContext(brandDir);
  } catch {
    return buildResponse({
      what_happened: "Could not read brand identity data",
      next_steps: ["Run brand_extract_web to populate core identity"],
      data: { error: "no_core_identity" },
    });
  }

  const { content, isHtml } = await resolveContent(input.content);
  const checks: ComplianceCheck[] = [];
  const layersChecked: string[] = ["core_identity"];

  // Parse HTML
  let css = "";
  let text = content;
  if (isHtml) {
    const $ = cheerio.load(content);
    const parts: string[] = [];
    $("style").each((_i, el) => { const t = $(el).text(); if (t) parts.push(t); });
    $("[style]").each((_i, el) => { const s = $(el).attr("style"); if (s) parts.push(s); });
    css = parts.join("\n");
    $("script, style, noscript, svg, iframe").remove();
    text = $("body").text() || $.text();
  }

  // --- Critical color check ---
  if (ctx.identity.colors.length > 0 && isHtml && css) {
    const brandColors = new Set(ctx.identity.colors.map((c) => normalizeHex(c.value)));
    const usedColors = extractCssColors(css);
    const offPalette = usedColors.filter((c) => !brandColors.has(c) && !NEUTRAL_COLORS.has(c));
    checks.push({
      id: "CRT-COLOR",
      status: offPalette.length > 0 ? "fail" : "pass",
      message: offPalette.length > 0
        ? `${offPalette.length} off-palette color(s): ${offPalette.slice(0, 3).join(", ")}`
        : "All colors on-palette",
    });
  }

  // --- Critical font check ---
  if (ctx.identity.typography.length > 0 && isHtml && css) {
    const brandFonts = new Set(ctx.identity.typography.map((t) => t.family.toLowerCase()));
    const customFonts = extractFontFamilies(css).filter((f) => !SYSTEM_FONTS.has(f.toLowerCase()));
    const nonBrand = customFonts.filter((f) => !brandFonts.has(f.toLowerCase()));
    checks.push({
      id: "CRT-FONT",
      status: nonBrand.length > 0 ? "fail" : "pass",
      message: nonBrand.length > 0
        ? `Non-brand font(s): ${nonBrand.join(", ")}`
        : "All fonts are brand fonts",
    });
  }

  // --- Hard anti-pattern checks (Session 2+) ---
  if (ctx.visual && ctx.visual.anti_patterns.length > 0 && isHtml && css) {
    layersChecked.push("visual_identity");
    for (const ap of ctx.visual.anti_patterns) {
      if (ap.severity === "hard" || input.strict) {
        const violated = matchAntiPattern(ap.rule, css);
        checks.push({
          id: ap.preflight_id || `AP-${ap.rule.slice(0, 15).replace(/\s+/g, "-")}`,
          status: violated ? "fail" : "pass",
          message: violated ? `Anti-pattern violated: ${ap.rule}` : `OK: ${ap.rule}`,
          detail: violated ? `Severity: ${ap.severity}` : undefined,
        });
      }
    }
  }

  // --- Never-say checks (Session 3+) ---
  if (ctx.messaging?.voice) {
    layersChecked.push("messaging");
    for (const ns of ctx.messaging.voice.vocabulary.never_say) {
      const count = countOccurrences(text, ns.word);
      checks.push({
        id: `NS-${ns.word.replace(/\s+/g, "-")}`,
        status: count > 0 ? "fail" : "pass",
        message: count > 0
          ? `Never-say word "${ns.word}" found (${count}x)`
          : `OK: "${ns.word}" not found`,
        detail: count > 0 ? ns.reason : undefined,
      });
    }
  }

  // --- Result ---
  const failures = checks.filter((c) => c.status === "fail");
  const pass = failures.length === 0;

  return buildResponse({
    what_happened: pass
      ? `Compliance check: PASS (${checks.length} rules checked, 0 failures)`
      : `Compliance check: FAIL (${checks.length} rules checked, ${failures.length} failure(s))`,
    next_steps: pass
      ? ["Content passes compliance — safe to publish"]
      : [
          `Fix ${failures.length} failing rule(s) before publishing`,
          "Run brand_audit_content for detailed scoring breakdown",
        ],
    data: {
      result: pass ? "pass" : "fail",
      rules_checked: checks.length,
      failures: failures.length,
      checks: checks.slice(0, 20),
      strict_mode: input.strict,
      layers_checked: layersChecked,
    } as unknown as Record<string, unknown>,
  });
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

const paramsShape = {
  content: z
    .string()
    .describe(
      "Content to check: raw text, HTML string, or a file path ending in .html/.htm/.md/.txt"
    ),
  strict: z
    .boolean()
    .default(false)
    .describe(
      "Strict mode: treat soft anti-patterns as failures too (default: only hard anti-patterns fail)"
    ),
};

export function register(server: McpServer) {
  server.tool(
    "brand_check_compliance",
    "Quick pass/fail compliance gate — checks critical brand rules before publishing. Verifies on-palette colors, brand fonts, hard anti-pattern rules, and never-say words. Fast and binary: returns PASS or FAIL with specific failures listed. Use in production workflows and CI/CD pipelines as a publish gate. Enable strict mode to also check soft anti-patterns. For detailed scoring, use brand_audit_content instead.",
    paramsShape,
    async (args) => handler(args as CheckComplianceParams),
  );
}
