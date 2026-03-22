import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BrandDir } from "../lib/brand-dir.js";
import { buildResponse } from "../lib/response.js";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import * as cheerio from "cheerio";
import type { CoreIdentityData } from "../schemas/index.js";
import type { AntiPatternRule } from "../types/index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PreflightCheck {
  id: string;
  status: "pass" | "warn" | "fail";
  message: string;
  details?: string;
}

interface PreflightRule {
  id: string;
  description: string;
  severity: "hard" | "soft";
  source: string;
  checkable: boolean;
}

// ---------------------------------------------------------------------------
// Color utilities
// ---------------------------------------------------------------------------

/** Expand shorthand hex (#abc -> #aabbcc) and lowercase */
function normalizeHex(hex: string): string {
  let h = hex.toLowerCase().trim();
  if (/^#[0-9a-f]{3}$/.test(h)) {
    h = `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`;
  }
  // Strip alpha channel from 8-digit hex for comparison
  if (/^#[0-9a-f]{8}$/.test(h)) {
    h = h.slice(0, 7);
  }
  return h;
}

/** Convert rgb/rgba to hex. Returns null if not parseable. */
function rgbToHex(rgb: string): string | null {
  const match = rgb.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!match) return null;
  const [, r, g, b] = match;
  const toHex = (n: string) => parseInt(n, 10).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** Extract all color values from CSS text, normalized to hex */
function extractColors(css: string): string[] {
  const colors: string[] = [];

  // Hex colors
  const hexRe = /#[0-9a-fA-F]{3,8}\b/g;
  let m: RegExpExecArray | null;
  while ((m = hexRe.exec(css)) !== null) {
    colors.push(normalizeHex(m[0]));
  }

  // rgb/rgba
  const rgbRe = /rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+(?:\s*,\s*[\d.]+)?\s*\)/g;
  while ((m = rgbRe.exec(css)) !== null) {
    const hex = rgbToHex(m[0]);
    if (hex) colors.push(normalizeHex(hex));
  }

  return [...new Set(colors)];
}

/** Extract all font-family values from CSS text */
function extractFontFamilies(css: string): string[] {
  const families: string[] = [];
  const re = /font-family\s*:\s*([^;}"]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    const raw = m[1].trim();
    // Split by comma and clean up
    for (const part of raw.split(",")) {
      const clean = part.trim().replace(/^['"]|['"]$/g, "").trim();
      if (clean) families.push(clean);
    }
  }
  return [...new Set(families)];
}

const SYSTEM_FONT_FAMILIES = new Set([
  "serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui",
  "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded",
  "-apple-system", "blinkmacsystemfont", "segoe ui", "roboto",
  "helvetica neue", "arial", "noto sans", "liberation sans",
  "helvetica", "times new roman", "times", "georgia", "courier new",
  "courier", "verdana", "tahoma", "trebuchet ms", "lucida grande",
  "lucida sans unicode", "lucida console", "monaco", "menlo", "consolas",
]);

// ---------------------------------------------------------------------------
// CSS extraction from HTML
// ---------------------------------------------------------------------------

function extractAllCss($: cheerio.CheerioAPI): string {
  const parts: string[] = [];

  // <style> blocks
  $("style").each((_i, el) => {
    const text = $(el).text();
    if (text) parts.push(text);
  });

  // style attributes
  $("[style]").each((_i, el) => {
    const style = $(el).attr("style");
    if (style) parts.push(style);
  });

  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Rules compilation
// ---------------------------------------------------------------------------

function compileRules(
  identity: CoreIdentityData,
  antiPatterns: AntiPatternRule[]
): PreflightRule[] {
  const rules: PreflightRule[] = [];

  // Color rules
  rules.push({
    id: "C-HEX",
    description: "All hex colors in CSS must be in the brand palette",
    severity: "soft",
    source: "core-identity.yaml colors",
    checkable: identity.colors.length > 0,
  });
  rules.push({
    id: "C-PRIMARY",
    description: "Primary brand color must appear somewhere in the content",
    severity: "soft",
    source: "core-identity.yaml colors[role=primary]",
    checkable: identity.colors.some((c) => c.role === "primary"),
  });
  rules.push({
    id: "C-PALETTE",
    description: "No off-palette colors (all used colors should match brand palette)",
    severity: "soft",
    source: "core-identity.yaml colors",
    checkable: identity.colors.length > 0,
  });

  // Typography rules
  rules.push({
    id: "T-FAMILY",
    description: "All font-family declarations must reference known brand fonts",
    severity: "soft",
    source: "core-identity.yaml typography",
    checkable: identity.typography.length > 0,
  });
  rules.push({
    id: "T-SYSTEM",
    description: "Brand fonts must be loaded (not only system fonts used as primary)",
    severity: "soft",
    source: "core-identity.yaml typography",
    checkable: identity.typography.length > 0,
  });

  // Logo rules
  rules.push({
    id: "L-PRESENT",
    description: "If brand name appears as text, logo SVG should also be present",
    severity: "soft",
    source: "core-identity.yaml logo + brand.config.yaml client_name",
    checkable: true,
  });
  rules.push({
    id: "L-APPROX",
    description: "No logo approximation (brand name in styled span/div without actual SVG)",
    severity: "soft",
    source: "core-identity.yaml logo",
    checkable: true,
  });

  // Anti-pattern rules from visual-identity.yaml
  let apIndex = 1;
  for (const ap of antiPatterns) {
    const id = ap.preflight_id || `A-${apIndex}`;
    apIndex++;
    rules.push({
      id,
      description: ap.rule,
      severity: ap.severity,
      source: "visual-identity.yaml anti_patterns",
      checkable: true,
    });
  }

  return rules;
}

// ---------------------------------------------------------------------------
// Anti-pattern matchers
// ---------------------------------------------------------------------------

interface AntiPatternMatcher {
  test: (css: string) => boolean;
  keywords: string[];
}

/** Map common anti-pattern phrases to CSS checks */
const ANTI_PATTERN_MATCHERS: AntiPatternMatcher[] = [
  {
    keywords: ["drop shadow", "drop-shadow", "box shadow", "box-shadow"],
    test: (css) =>
      /box-shadow\s*:/i.test(css) ||
      /text-shadow\s*:/i.test(css) ||
      /filter\s*:.*drop-shadow/i.test(css),
  },
  {
    keywords: ["gradient"],
    test: (css) => /(?:linear|radial|conic)-gradient/i.test(css),
  },
  {
    keywords: ["border radius", "border-radius", "rounded corner", "rounded corners", "pill shape"],
    test: (css) => /border-radius\s*:/i.test(css),
  },
  {
    keywords: ["opacity"],
    test: (css) => /\bopacity\s*:\s*(?!1\b|1\.0)/i.test(css),
  },
  {
    keywords: ["blur"],
    test: (css) => /filter\s*:.*blur/i.test(css) || /backdrop-filter\s*:.*blur/i.test(css),
  },
  {
    keywords: ["animation", "animate", "transition"],
    test: (css) => /animation\s*:/i.test(css) || /transition\s*:/i.test(css),
  },
  {
    keywords: ["outline"],
    test: (css) => /\boutline\s*:/i.test(css),
  },
  {
    keywords: ["underline", "text-decoration"],
    test: (css) => /text-decoration\s*:.*underline/i.test(css),
  },
  {
    keywords: ["italic"],
    test: (css) => /font-style\s*:\s*italic/i.test(css),
  },
  {
    keywords: ["uppercase", "text-transform"],
    test: (css) => /text-transform\s*:\s*uppercase/i.test(css),
  },
  {
    keywords: ["centered body", "center body", "text-align: center", "centered text"],
    test: (css) => /text-align\s*:\s*center/i.test(css),
  },
];

function matchAntiPattern(rule: string, css: string): boolean {
  const lower = rule.toLowerCase();
  for (const matcher of ANTI_PATTERN_MATCHERS) {
    if (matcher.keywords.some((kw) => lower.includes(kw))) {
      return matcher.test(css);
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Check runners
// ---------------------------------------------------------------------------

function checkColors(
  css: string,
  identity: CoreIdentityData
): PreflightCheck[] {
  const checks: PreflightCheck[] = [];
  const brandColors = identity.colors.map((c) => normalizeHex(c.value));
  const usedColors = extractColors(css);

  if (identity.colors.length === 0) {
    checks.push({
      id: "C-HEX",
      status: "warn",
      message: "No brand colors defined — cannot check hex compliance",
      details: "Add colors to core-identity.yaml first",
    });
    checks.push({
      id: "C-PRIMARY",
      status: "warn",
      message: "No brand colors defined",
    });
    checks.push({
      id: "C-PALETTE",
      status: "warn",
      message: "No brand palette to check against",
    });
    return checks;
  }

  // C-HEX: Check unknown colors
  const unknownColors = usedColors.filter((c) => !brandColors.includes(c));
  // Filter out common non-brand colors (pure black, white)
  const meaningfulUnknown = unknownColors.filter(
    (c) => !["#000000", "#ffffff"].includes(c)
  );
  if (meaningfulUnknown.length === 0) {
    checks.push({
      id: "C-HEX",
      status: "pass",
      message: `All ${usedColors.length} colors are on-palette`,
    });
  } else {
    checks.push({
      id: "C-HEX",
      status: "warn",
      message: `${meaningfulUnknown.length} color(s) not in brand palette`,
      details: meaningfulUnknown.slice(0, 10).join(", "),
    });
  }

  // C-PRIMARY: Primary color used
  const primaryColor = identity.colors.find((c) => c.role === "primary");
  if (!primaryColor) {
    checks.push({
      id: "C-PRIMARY",
      status: "warn",
      message: "No primary color role assigned in brand identity",
    });
  } else {
    const pHex = normalizeHex(primaryColor.value);
    if (usedColors.includes(pHex)) {
      checks.push({
        id: "C-PRIMARY",
        status: "pass",
        message: `Primary color ${pHex} is used`,
      });
    } else {
      checks.push({
        id: "C-PRIMARY",
        status: "warn",
        message: `Primary color ${pHex} not found in content`,
        details: `Brand primary is ${primaryColor.name} (${pHex})`,
      });
    }
  }

  // C-PALETTE: Off-palette summary
  if (meaningfulUnknown.length === 0) {
    checks.push({
      id: "C-PALETTE",
      status: "pass",
      message: "No off-palette colors detected",
    });
  } else {
    checks.push({
      id: "C-PALETTE",
      status: "warn",
      message: `${meaningfulUnknown.length} off-palette color(s) found`,
      details: `Brand palette: ${brandColors.join(", ")} | Off-palette: ${meaningfulUnknown.slice(0, 5).join(", ")}${meaningfulUnknown.length > 5 ? ` (+${meaningfulUnknown.length - 5} more)` : ""}`,
    });
  }

  return checks;
}

function checkTypography(
  css: string,
  identity: CoreIdentityData
): PreflightCheck[] {
  const checks: PreflightCheck[] = [];
  const brandFonts = identity.typography.map((t) => t.family.toLowerCase());
  const usedFamilies = extractFontFamilies(css).map((f) => f.toLowerCase());

  if (identity.typography.length === 0) {
    checks.push({
      id: "T-FAMILY",
      status: "warn",
      message: "No brand fonts defined — cannot check typography compliance",
    });
    checks.push({
      id: "T-SYSTEM",
      status: "warn",
      message: "No brand fonts defined",
    });
    return checks;
  }

  if (usedFamilies.length === 0) {
    checks.push({
      id: "T-FAMILY",
      status: "warn",
      message: "No font-family declarations found in content",
    });
    checks.push({
      id: "T-SYSTEM",
      status: "pass",
      message: "No font declarations to check",
    });
    return checks;
  }

  // T-FAMILY: Check that declared fonts are brand fonts
  const nonBrand = usedFamilies.filter(
    (f) => !brandFonts.includes(f) && !SYSTEM_FONT_FAMILIES.has(f)
  );
  if (nonBrand.length === 0) {
    checks.push({
      id: "T-FAMILY",
      status: "pass",
      message: "All font-family declarations use brand fonts or system fallbacks",
    });
  } else {
    checks.push({
      id: "T-FAMILY",
      status: "warn",
      message: `${nonBrand.length} non-brand font(s) detected`,
      details: nonBrand.join(", "),
    });
  }

  // T-SYSTEM: Check if ONLY system fonts are used (no brand fonts loaded)
  const hasBrandFont = usedFamilies.some((f) => brandFonts.includes(f));
  if (hasBrandFont) {
    checks.push({
      id: "T-SYSTEM",
      status: "pass",
      message: "Brand font(s) are loaded",
    });
  } else {
    checks.push({
      id: "T-SYSTEM",
      status: "warn",
      message: "Only system fonts detected — brand fonts may not be loaded",
      details: `Expected: ${identity.typography.map((t) => t.family).join(", ")} | Found: ${usedFamilies.join(", ")}`,
    });
  }

  return checks;
}

function checkLogo(
  $: cheerio.CheerioAPI,
  identity: CoreIdentityData,
  clientName: string
): PreflightCheck[] {
  const checks: PreflightCheck[] = [];

  const hasSvg = $("svg").length > 0;
  const hasImgLogo = $("img[src*='logo'], img[alt*='logo']").length > 0;
  const hasLogoElement = hasSvg || hasImgLogo;

  // Check if brand name appears as text
  const bodyText = $("body").text() || $.text();
  const nameInText = clientName
    ? bodyText.toLowerCase().includes(clientName.toLowerCase())
    : false;

  // L-PRESENT
  if (!nameInText) {
    checks.push({
      id: "L-PRESENT",
      status: "pass",
      message: "Brand name not found as text (no logo check needed)",
    });
  } else if (hasLogoElement) {
    checks.push({
      id: "L-PRESENT",
      status: "pass",
      message: "Brand name and logo element both present",
    });
  } else {
    checks.push({
      id: "L-PRESENT",
      status: "warn",
      message: "Brand name appears as text but no logo SVG/image found",
      details: `"${clientName}" found in text but no <svg> or logo <img> detected`,
    });
  }

  // L-APPROX: Check for logo approximation patterns
  let approxFound = false;
  if (clientName) {
    const nameLower = clientName.toLowerCase();
    $("span, div, a, h1, h2, h3").each((_i, el) => {
      const text = $(el).text().trim().toLowerCase();
      const style = $(el).attr("style") || "";
      // If element text IS the brand name (not just contains it in a paragraph)
      // and has heavy styling — likely a logo approximation
      if (
        text === nameLower &&
        (style.includes("font-weight") ||
          style.includes("font-size") ||
          style.includes("letter-spacing") ||
          style.includes("text-transform"))
      ) {
        // Only flag if there's no SVG sibling or child
        const parent = $(el).parent();
        if (parent.find("svg").length === 0 && !hasSvg) {
          approxFound = true;
        }
      }
    });
  }

  if (approxFound) {
    checks.push({
      id: "L-APPROX",
      status: "warn",
      message: "Possible logo approximation detected — brand name styled as text without SVG",
      details: "Use actual logo SVG instead of styling brand name with CSS",
    });
  } else {
    checks.push({
      id: "L-APPROX",
      status: "pass",
      message: "No logo approximation patterns detected",
    });
  }

  return checks;
}

function checkAntiPatterns(
  css: string,
  antiPatterns: AntiPatternRule[]
): PreflightCheck[] {
  const checks: PreflightCheck[] = [];
  let idx = 1;

  for (const ap of antiPatterns) {
    const id = ap.preflight_id || `A-${idx}`;
    idx++;
    const matched = matchAntiPattern(ap.rule, css);

    if (matched) {
      checks.push({
        id,
        status: ap.severity === "hard" ? "fail" : "warn",
        message: ap.rule,
        details: `Anti-pattern matched (severity: ${ap.severity})`,
      });
    } else {
      checks.push({
        id,
        status: "pass",
        message: ap.rule,
      });
    }
  }

  return checks;
}

// ---------------------------------------------------------------------------
// Main handlers
// ---------------------------------------------------------------------------

async function handleRules(brandDir: BrandDir) {
  const identity = await brandDir.readCoreIdentity();

  let antiPatterns: AntiPatternRule[] = [];
  if (await brandDir.hasVisualIdentity()) {
    const vi = await brandDir.readVisualIdentity();
    antiPatterns = vi.anti_patterns || [];
  }

  const rules = compileRules(identity, antiPatterns);

  return buildResponse({
    what_happened: `Compiled ${rules.length} preflight rules from brand system`,
    next_steps: [
      "Run brand_preflight with mode 'check' and HTML content to run compliance checks",
      rules.some((r) => !r.checkable)
        ? "Some rules are not checkable — add more data to core-identity.yaml"
        : "All rules are checkable",
    ],
    data: {
      rule_count: rules.length,
      rules: rules as unknown as Record<string, unknown>[],
    },
  });
}

async function handleCheck(brandDir: BrandDir, html: string) {
  const identity = await brandDir.readCoreIdentity();

  let antiPatterns: AntiPatternRule[] = [];
  if (await brandDir.hasVisualIdentity()) {
    const vi = await brandDir.readVisualIdentity();
    antiPatterns = vi.anti_patterns || [];
  }

  let clientName = "";
  try {
    const config = await brandDir.readConfig();
    clientName = config.client_name || "";
  } catch {
    // Non-critical — logo checks just won't match by name
  }

  // Parse HTML
  const $ = cheerio.load(html);
  const css = extractAllCss($);

  // Run all checks
  const checks: PreflightCheck[] = [
    ...checkColors(css, identity),
    ...checkTypography(css, identity),
    ...checkLogo($, identity, clientName),
    ...checkAntiPatterns(css, antiPatterns),
  ];

  // Compute summary
  const pass = checks.filter((c) => c.status === "pass").length;
  const warn = checks.filter((c) => c.status === "warn").length;
  const fail = checks.filter((c) => c.status === "fail").length;
  const overall = fail > 0 ? "FAIL" : warn > 0 ? "WARN" : "PASS";

  const nextSteps: string[] = [];
  if (fail > 0) nextSteps.push("Fix failing checks (hard anti-patterns) before shipping");
  if (warn > 0) nextSteps.push("Review warnings — some may be intentional deviations");
  if (fail === 0 && warn === 0) nextSteps.push("All checks pass — content is brand-compliant");

  return buildResponse({
    what_happened: `Preflight ${overall}: ${pass} pass, ${warn} warn, ${fail} fail`,
    next_steps: nextSteps,
    data: {
      overall,
      summary: { pass, warn, fail },
      checks: checks as unknown as Record<string, unknown>[],
    },
  });
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

const paramsShape = {
  html: z
    .string()
    .describe(
      "HTML content to check — either an inline HTML string or a file path to an HTML file"
    ),
  mode: z
    .enum(["check", "rules"])
    .default("check")
    .describe(
      '"check" runs compliance against HTML (default), "rules" lists all active preflight rules'
    ),
};

type Params = { html: string; mode?: "check" | "rules" };

async function handler(input: Params) {
  const brandDir = new BrandDir(process.cwd());

  if (!(await brandDir.exists())) {
    return buildResponse({
      what_happened: "No .brand/ directory found",
      next_steps: ["Run brand_start to create a brand system first"],
      data: { error: "not_initialized" },
    });
  }

  const mode = input.mode || "check";

  if (mode === "rules") {
    return handleRules(brandDir);
  }

  // Resolve HTML: if it looks like a file path, read it
  let html = input.html;
  if (
    !html.includes("<") &&
    (html.endsWith(".html") || html.endsWith(".htm") || html.startsWith("/"))
  ) {
    const resolvedPath = resolve(process.cwd(), html);
    if (!resolvedPath.startsWith(resolve(process.cwd()))) {
      return buildResponse({
        what_happened: "File path must be within the current working directory",
        next_steps: ["Provide an HTML string or a file path within your project"],
        data: { error: "path_outside_cwd" },
      });
    }
    try {
      html = await readFile(resolvedPath, "utf-8");
    } catch {
      return buildResponse({
        what_happened: `Could not read file: ${input.html}`,
        next_steps: ["Provide valid HTML content or a readable file path"],
        data: { error: "file_not_found", path: input.html },
      });
    }
  }

  return handleCheck(brandDir, html);
}

export function register(server: McpServer) {
  server.tool(
    "brand_preflight",
    "Check HTML content against brand compliance rules. Validates colors, typography, logo usage, and anti-patterns from the brand system. Use mode 'rules' to list all active rules, or mode 'check' (default) with HTML content to run compliance.",
    paramsShape,
    async (args) => handler(args as Params)
  );
}
