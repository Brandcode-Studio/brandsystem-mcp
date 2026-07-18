/**
 * Lightweight inline brand checking engine.
 *
 * Reads the compiled brand-runtime.json and interaction-policy.json once,
 * caches in memory, and provides fast check functions for text, color,
 * font, and CSS inputs. Designed for <50ms per check.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { BrandRuntime } from "./runtime-compiler.js";
import type { InteractionPolicy } from "./interaction-policy-compiler.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CheckFlag {
  type: "never_say" | "anchor_term" | "ai_ism" | "off_palette" | "non_brand_font" | "anti_pattern";
  severity: "error" | "warning" | "info";
  message: string;
  fix?: string;
  /**
   * True when the flag was demoted to advisory because a high-priority color
   * clarification (clarify-primary) is open — the palette itself is
   * unconfirmed, so the flag must not fail the check (issue #41).
   */
  advisory?: boolean;
}

export interface CheckResult {
  pass: boolean;
  flags: CheckFlag[];
  checked: string[];
}

interface CachedBrand {
  runtime: BrandRuntime;
  policy: InteractionPolicy;
  loadedAt: number;
  /** Pre-computed lowercase brand color set for fast lookup */
  brandColorSet: Set<string>;
  /** Pre-computed color entries for nearest-match */
  brandColors: Array<{ name: string; hex: string; r: number; g: number; b: number; L: number; a: number; b_: number }>;
  /** Pre-computed lowercase font families */
  brandFonts: Set<string>;
  /** Original-case font names for display */
  brandFontOriginalCase: string[];
  /** Pre-computed lowercase never-say words */
  neverSay: string[];
  /** Pre-computed anchor terms: Map<wrong_word_lowercase, { use: string; not: string }> */
  anchorMap: Map<string, { use: string; not: string }>;
  /** Pre-computed AI-ism patterns (lowercase) */
  aiIsmPatterns: string[];
}

const CACHE_TTL_MS = 60_000; // 1 minute — brand data rarely changes mid-session
let _cache: CachedBrand | null = null;
let _cacheCwd: string | null = null;

// ---------------------------------------------------------------------------
// Color math (CIE76 delta E in Lab space)
// ---------------------------------------------------------------------------

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  };
}

function rgbToLab(r: number, g: number, b: number): { L: number; a: number; b_: number } {
  // sRGB → linear RGB → XYZ → Lab
  let rr = r / 255, gg = g / 255, bb = b / 255;
  rr = rr > 0.04045 ? Math.pow((rr + 0.055) / 1.055, 2.4) : rr / 12.92;
  gg = gg > 0.04045 ? Math.pow((gg + 0.055) / 1.055, 2.4) : gg / 12.92;
  bb = bb > 0.04045 ? Math.pow((bb + 0.055) / 1.055, 2.4) : bb / 12.92;

  // D65 illuminant
  let x = (rr * 0.4124564 + gg * 0.3575761 + bb * 0.1804375) / 0.95047;
  let y = rr * 0.2126729 + gg * 0.7151522 + bb * 0.0721750;
  let z = (rr * 0.0193339 + gg * 0.1191920 + bb * 0.9503041) / 1.08883;

  const f = (t: number) => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  x = f(x);
  y = f(y);
  z = f(z);

  return {
    L: 116 * y - 16,
    a: 500 * (x - y),
    b_: 200 * (y - z),
  };
}

function deltaE(lab1: { L: number; a: number; b_: number }, lab2: { L: number; a: number; b_: number }): number {
  return Math.sqrt(
    (lab1.L - lab2.L) ** 2 +
    (lab1.a - lab2.a) ** 2 +
    (lab1.b_ - lab2.b_) ** 2,
  );
}

// ---------------------------------------------------------------------------
// Normalize hex
// ---------------------------------------------------------------------------

function normalizeHex(hex: string): string {
  let h = hex.toLowerCase().trim();
  if (!h.startsWith("#")) h = "#" + h;
  if (/^#[0-9a-f]{3}$/.test(h)) {
    h = `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`;
  }
  if (/^#[0-9a-f]{8}$/.test(h)) {
    h = h.slice(0, 7); // strip alpha
  }
  return h;
}

// ---------------------------------------------------------------------------
// Cache management
// ---------------------------------------------------------------------------

async function loadCached(cwd: string): Promise<CachedBrand | null> {
  if (_cache && _cacheCwd === cwd && Date.now() - _cache.loadedAt < CACHE_TTL_MS) {
    return _cache;
  }

  const brandPath = join(cwd, ".brand");
  let runtime: BrandRuntime;
  let policy: InteractionPolicy;

  try {
    const [runtimeRaw, policyRaw] = await Promise.all([
      readFile(join(brandPath, "brand-runtime.json"), "utf-8"),
      readFile(join(brandPath, "interaction-policy.json"), "utf-8"),
    ]);
    runtime = JSON.parse(runtimeRaw);
    policy = JSON.parse(policyRaw);
  } catch {
    return null;
  }

  // Pre-compute lookup structures
  const brandColorSet = new Set<string>();
  const brandColors: CachedBrand["brandColors"] = [];
  if (runtime.identity?.colors) {
    for (const [name, hex] of Object.entries(runtime.identity.colors)) {
      const normalized = normalizeHex(hex);
      brandColorSet.add(normalized);
      const { r, g, b } = hexToRgb(normalized);
      const lab = rgbToLab(r, g, b);
      brandColors.push({ name, hex: normalized, r, g, b, ...lab });
    }
  }

  const brandFonts = new Set<string>();
  const brandFontOriginalCase: string[] = [];
  if (runtime.identity?.typography) {
    for (const family of Object.values(runtime.identity.typography)) {
      brandFonts.add(family.toLowerCase());
      if (!brandFontOriginalCase.includes(family)) {
        brandFontOriginalCase.push(family);
      }
    }
  }

  const neverSay = policy.voice_rules?.never_say ?? [];

  const anchorMap = new Map<string, { use: string; not: string }>();
  if (runtime.voice?.anchor_terms) {
    for (const [use, not] of Object.entries(runtime.voice.anchor_terms)) {
      // Map the wrong word → the correct replacement
      anchorMap.set((not as string).toLowerCase(), { use, not: not as string });
    }
  }

  const aiIsmPatterns = policy.voice_rules?.ai_ism_patterns ?? [];

  _cache = {
    runtime,
    policy,
    loadedAt: Date.now(),
    brandColorSet,
    brandColors,
    brandFonts,
    brandFontOriginalCase,
    neverSay,
    anchorMap,
    aiIsmPatterns,
  };
  _cacheCwd = cwd;
  return _cache;
}

/** Invalidate cached brand data (e.g. after a compile). */
export function invalidateCheckCache(): void {
  _cache = null;
  _cacheCwd = null;
}

// ---------------------------------------------------------------------------
// Color-uncertainty gate (issue #41)
// ---------------------------------------------------------------------------

/**
 * Advisory note appended to demoted color verdicts while the primary color
 * is unconfirmed. Shared by brand_check and brand_check_compliance.
 */
export const COLOR_ADVISORY_NOTE =
  "primary color unconfirmed — resolve clarify-primary; color verdicts are advisory until then";

/**
 * True while any high-priority clarification with a field starting "colors."
 * is open in needs-clarification.yaml (e.g. clarify-primary). While it holds,
 * color verdicts must soften from fail to warning: an unconfirmed guess must
 * not hard-fail the brand's own true colors. Text/font/css checks are
 * unaffected. Missing or unparseable file means no gate.
 */
export async function hasOpenColorClarification(cwd: string): Promise<boolean> {
  try {
    const raw = await readFile(join(cwd, ".brand", "needs-clarification.yaml"), "utf-8");
    const data = parseYaml(raw) as { items?: Array<{ field?: unknown; priority?: unknown }> } | null;
    const items = Array.isArray(data?.items) ? data!.items! : [];
    return items.some(
      (i) => i?.priority === "high" && typeof i?.field === "string" && i.field.startsWith("colors.")
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Check functions
// ---------------------------------------------------------------------------

function checkText(text: string, brand: CachedBrand): CheckFlag[] {
  const flags: CheckFlag[] = [];
  const lower = text.toLowerCase();

  // Never-say violations
  for (const word of brand.neverSay) {
    const wordLower = word.toLowerCase();
    if (lower.includes(wordLower)) {
      flags.push({
        type: "never_say",
        severity: "warning",
        message: `"${word}" is on the never-say list`,
        fix: `Remove or replace "${word}"`,
      });
    }
  }

  // Anchor term misuse (using the wrong alternative)
  for (const [wrongLower, { use, not }] of brand.anchorMap) {
    // Word boundary check to avoid false positives (e.g., "leverage" inside "leveraged")
    const regex = new RegExp(`\\b${escapeRegex(wrongLower)}\\b`, "i");
    if (regex.test(text)) {
      flags.push({
        type: "anchor_term",
        severity: "warning",
        message: `"${not}" should be "${use}"`,
        fix: `Replace "${not}" with "${use}"`,
      });
    }
  }

  // AI-ism patterns
  for (const pattern of brand.aiIsmPatterns) {
    if (lower.includes(pattern.toLowerCase())) {
      flags.push({
        type: "ai_ism",
        severity: "warning",
        message: `AI-ism detected: "${pattern}"`,
        fix: `Rephrase to avoid "${pattern}"`,
      });
    }
  }

  return flags;
}

const NEUTRAL_COLORS = new Set([
  "#000000", "#ffffff", "#111111", "#222222", "#333333", "#444444",
  "#555555", "#666666", "#777777", "#888888", "#999999", "#aaaaaa",
  "#bbbbbb", "#cccccc", "#dddddd", "#eeeeee", "#f5f5f5", "#f8f8f8", "#fafafa",
]);

function checkColor(hex: string, brand: CachedBrand): CheckFlag[] {
  const normalized = normalizeHex(hex);

  // Neutrals are always acceptable
  if (NEUTRAL_COLORS.has(normalized)) return [];

  // Exact match
  if (brand.brandColorSet.has(normalized)) return [];

  // Find nearest brand color
  if (brand.brandColors.length === 0) return [];

  const { r, g, b } = hexToRgb(normalized);
  const inputLab = rgbToLab(r, g, b);

  let nearest = brand.brandColors[0];
  let nearestDe = Infinity;

  for (const bc of brand.brandColors) {
    const de = deltaE(inputLab, { L: bc.L, a: bc.a, b_: bc.b_ });
    if (de < nearestDe) {
      nearestDe = de;
      nearest = bc;
    }
  }

  const de = Math.round(nearestDe * 10) / 10;

  // ΔE < 3 is barely perceptible — pass with info
  if (de < 3) {
    return [{
      type: "off_palette",
      severity: "info",
      message: `${normalized} is close to ${nearest.name} (${nearest.hex}) — ΔE ${de}`,
      fix: `Use ${nearest.hex} (${nearest.name}) for exact brand match`,
    }];
  }

  return [{
    type: "off_palette",
    severity: de < 10 ? "warning" : "error",
    message: `${normalized} is off-palette — nearest brand color is ${nearest.name} (${nearest.hex}), ΔE ${de}`,
    fix: `Use ${nearest.hex} (${nearest.name}) instead`,
  }];
}

const SYSTEM_FONTS = new Set([
  "serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui",
  "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded",
  "-apple-system", "blinkmacsystemfont", "segoe ui", "arial",
  "helvetica", "helvetica neue", "times new roman", "georgia",
  "verdana", "tahoma", "courier new", "consolas", "menlo", "monaco",
]);

function checkFont(family: string, brand: CachedBrand): CheckFlag[] {
  const lower = family.toLowerCase().replace(/^['"]|['"]$/g, "").trim();

  // System/generic fonts are always acceptable
  if (SYSTEM_FONTS.has(lower)) return [];

  if (brand.brandFonts.has(lower)) return [];

  if (brand.brandFonts.size === 0) return [];

  const brandFontList = brand.brandFontOriginalCase.join(", ");
  return [{
    type: "non_brand_font",
    severity: "warning",
    message: `"${family}" is not a brand font`,
    fix: `Use one of: ${brandFontList}`,
  }];
}

// Anti-pattern matchers (lightweight subset from content-scorer)
const CSS_ANTI_PATTERN_MATCHERS: Array<{ keywords: string[]; test: (css: string) => boolean }> = [
  {
    keywords: ["drop shadow", "drop-shadow", "box shadow", "box-shadow"],
    test: (css) => /box-shadow\s*:/i.test(css) || /text-shadow\s*:/i.test(css) || /filter\s*:.*drop-shadow/i.test(css),
  },
  {
    keywords: ["gradient"],
    test: (css) => /(?:linear|radial|conic)-gradient/i.test(css),
  },
  {
    keywords: ["border radius", "border-radius", "rounded corner", "pill shape"],
    test: (css) => /border-radius\s*:/i.test(css),
  },
  {
    keywords: ["blur"],
    test: (css) => /filter\s*:.*blur/i.test(css) || /backdrop-filter\s*:.*blur/i.test(css),
  },
  {
    keywords: ["opacity"],
    test: (css) => /\bopacity\s*:\s*(?!1\b|1\.0)/i.test(css),
  },
];

function checkCss(css: string, brand: CachedBrand): CheckFlag[] {
  const flags: CheckFlag[] = [];
  const rules = brand.policy.visual_rules ?? [];

  for (const rule of rules) {
    const lower = rule.rule.toLowerCase();
    for (const matcher of CSS_ANTI_PATTERN_MATCHERS) {
      if (matcher.keywords.some((kw) => lower.includes(kw)) && matcher.test(css)) {
        flags.push({
          type: "anti_pattern",
          severity: rule.severity === "hard" ? "error" : "warning",
          message: `Visual anti-pattern: ${rule.rule}`,
        });
        break;
      }
    }
  }

  return flags;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface CheckInput {
  text?: string;
  color?: string;
  font?: string;
  css?: string;
}

export async function runBrandCheck(cwd: string, input: CheckInput): Promise<CheckResult | null> {
  const brand = await loadCached(cwd);
  if (!brand) return null;

  const flags: CheckFlag[] = [];
  const checked: string[] = [];

  if (input.text) {
    checked.push("text");
    flags.push(...checkText(input.text, brand));
  }

  if (input.color) {
    checked.push("color");
    let colorFlags = checkColor(input.color, brand);
    if (
      colorFlags.some((f) => f.severity !== "info") &&
      (await hasOpenColorClarification(cwd))
    ) {
      // Primary unconfirmed (clarify-primary open): color verdicts demote from
      // fail to advisory warning — the palette itself is a guess (issue #41).
      colorFlags = colorFlags.map((f) =>
        f.severity === "info"
          ? f
          : {
              ...f,
              severity: "warning" as const,
              advisory: true,
              message: `${f.message} (${COLOR_ADVISORY_NOTE})`,
            }
      );
    }
    flags.push(...colorFlags);
  }

  if (input.font) {
    checked.push("font");
    flags.push(...checkFont(input.font, brand));
  }

  if (input.css) {
    checked.push("css");
    flags.push(...checkCss(input.css, brand));
  }

  return {
    pass: flags.every((f) => f.severity === "info" || f.advisory === true),
    flags,
    checked,
  };
}

/** Expose brand palette for color suggestions without running a full check. */
export async function getBrandPalette(cwd: string): Promise<Array<{ name: string; hex: string }> | null> {
  const brand = await loadCached(cwd);
  if (!brand) return null;
  return brand.brandColors.map((c) => ({ name: c.name, hex: c.hex }));
}
