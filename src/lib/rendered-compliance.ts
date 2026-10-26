/**
 * Rendered compliance — compares what a page ACTUALLY renders (computed
 * styles measured in headless Chrome) against the brand: palette distance
 * (CIEDE2000), brand fonts (first available face, generic fallbacks
 * respected), WCAG AA text contrast on the real foreground/background, and
 * logo presence.
 *
 * Pure: takes a RenderMeasurement (see render-check.ts for how it is
 * produced) plus brand data, returns findings and a score. No I/O.
 */

import {
  compositeOver,
  contrastRatio,
  flattenBackground,
  labChroma,
  nearestPaletteColor,
  parseCssColor,
  requiredContrastAA,
  rgbToLab,
  toHex,
  type PaletteEntry,
  type Rgba,
} from "./color-metrics.js";
import { flattenUntrusted } from "./untrusted-text.js";

// ── Measurement input ──────────────────────────────────────────────────────

export interface RenderedElement {
  /** CSS-ish locator built in-page, e.g. "main > section.hero > h1" (untrusted). */
  locator: string;
  tag: string;
  /** Short sample of the element's own text (untrusted). */
  text?: string;
  /** Characters of the element's own (direct) text; 0 = not a text element. */
  textLength: number;
  /** Computed `color`. */
  color: string;
  /** Background colors from this element outward, stopping at the first opaque layer. */
  bgLayers: string[];
  /** True when a background-image/gradient sits in that stack (contrast indeterminate). */
  bgImage: boolean;
  /** Colors of visible border sides (deduplicated). */
  borderColors: string[];
  /** Computed `font-family` stack as declared. */
  fontFamily: string;
  /** First family in the stack that is actually available (or the generic used). */
  renderedFamily: string;
  fontSize: number;
  fontWeight: number;
}

export interface RenderMeasurement {
  viewport: { width: number; height: number };
  elements: RenderedElement[];
  /** True when the page had more visible elements than were measured. */
  truncated: boolean;
  logo: { detected: boolean; evidence?: string; failedToLoad: number };
  /** The brand's client_name appears in visible text. */
  brandNameVisible: boolean;
}

export interface BrandForRender {
  palette: PaletteEntry[];
  fonts: string[];
  clientName: string;
  /**
   * A high-priority color clarification is open (primary unconfirmed):
   * color errors demote to advisory warnings, as in brand_check (#41).
   */
  colorAdvisory?: boolean;
}

// ── Findings ───────────────────────────────────────────────────────────────

export type RenderSeverity = "error" | "warning" | "info";

export interface RenderFinding {
  rule: "R-COLOR" | "R-FONT" | "R-CONTRAST" | "R-LOGO";
  severity: RenderSeverity;
  /** Which property the measurement came from. */
  kind?: "text" | "background" | "border" | "font" | "logo";
  locator?: string;
  text?: string;
  measured: string;
  /** Nearest brand value (color/font) or the required threshold (contrast). */
  expected?: string;
  delta_e?: number;
  contrast?: number;
  occurrences: number;
  advisory?: boolean;
  message: string;
}

export interface RenderedComplianceResult {
  overall: "PASS" | "WARN" | "FAIL";
  /** 0-100 weighted score (color 40 / typography 30 / contrast 30); null if nothing was checkable. */
  score: number | null;
  subscores: { color: number | null; typography: number | null; contrast: number | null };
  counts: { error: number; warning: number; info: number };
  /** All findings, aggregated and sorted (severity, then occurrences). */
  findings: RenderFinding[];
  measured: {
    elements: number;
    text_elements: number;
    truncated: boolean;
    contrast_indeterminate: number;
    colors: Record<"text" | "background" | "border", Array<{ hex: string; count: number; status: ColorStatus }>>;
    fonts_rendered: Array<{ family: string; elements: number; brand: boolean }>;
    font_sizes: Array<{ px: number; elements: number }>;
    font_weights: Array<{ weight: number; elements: number }>;
    logo: { detected: boolean; evidence?: string };
  };
}

// ── Tolerances ─────────────────────────────────────────────────────────────

/** ΔE00 at or below this is the brand color (≈ just-noticeable difference). */
export const DELTA_E_MATCH = 2.3;
/** ΔE00 at or below this is "near" a brand color — reported as info, not a violation. */
export const DELTA_E_NEAR = 6;
/** ΔE00 above this is clearly a different color — error (warning when advisory). */
export const DELTA_E_FAR = 15;
/**
 * Lab chroma below this reads as a neutral gray/black/white — always allowed.
 * 10 admits the cool/warm-tinted UI grays common in design systems (e.g.
 * #9ca3af ≈ C* 7) while any recognizably colored value is still checked.
 */
export const NEUTRAL_CHROMA = 10;

export type ColorStatus = "brand" | "near" | "neutral" | "off";

export interface ColorClassification {
  status: ColorStatus;
  hex: string;
  nearest?: PaletteEntry;
  deltaE?: number;
}

export function classifyColor(color: Rgba, palette: readonly PaletteEntry[]): ColorClassification {
  const hex = toHex(color);
  const match = nearestPaletteColor(color, palette);
  const deltaE = match ? Math.round(match.deltaE * 10) / 10 : undefined;
  if (match && match.deltaE <= DELTA_E_MATCH) {
    return { status: "brand", hex, nearest: match.entry, deltaE };
  }
  if (labChroma(rgbToLab(color)) < NEUTRAL_CHROMA) {
    return { status: "neutral", hex, nearest: match?.entry, deltaE };
  }
  if (match && match.deltaE <= DELTA_E_NEAR) {
    return { status: "near", hex, nearest: match.entry, deltaE };
  }
  return { status: "off", hex, nearest: match?.entry, deltaE };
}

// ── Fonts ──────────────────────────────────────────────────────────────────

const GENERIC_FAMILIES = new Set([
  "serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui",
  "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded", "math", "emoji",
  "fangsong", "-apple-system", "blinkmacsystemfont",
]);

/** Suffixes that denote packaging of the same typeface, not a different one. */
const SAME_FACE_SUFFIXES = new Set(["variable", "var", "vf", "web", "webfont", "regular", "pro", "std"]);

/** Split a CSS font-family value into family names (quotes stripped). */
export function parseFontStack(value: string): string[] {
  const out: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (const ch of value) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ",") {
      if (current.trim()) out.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

export function normalizeFamily(family: string): string {
  return family.toLowerCase().replace(/^['"]|['"]$/g, "").replace(/[-_\s]+/g, " ").trim();
}

export function isGenericFamily(family: string): boolean {
  return GENERIC_FAMILIES.has(family.toLowerCase().replace(/^['"]|['"]$/g, "").trim());
}

/** Return the brand font a family resolves to, or null. */
export function matchBrandFont(family: string, brandFonts: readonly string[]): string | null {
  const f = normalizeFamily(family);
  if (!f) return null;
  const compact = f.replace(/ /g, "");
  for (const brand of brandFonts) {
    const b = normalizeFamily(brand);
    if (!b) continue;
    if (f === b || compact === b.replace(/ /g, "")) return brand;
    if (f.startsWith(`${b} `)) {
      const suffix = f.slice(b.length + 1).split(" ");
      if (suffix.every((w) => SAME_FACE_SUFFIXES.has(w))) return brand;
    }
  }
  return null;
}

export type FontVerdict =
  | { status: "brand"; brand: string }
  | { status: "unavailable"; brand: string } // brand font declared first, not available in render
  | { status: "shadowed"; brand: string } // a non-brand family ahead of the brand font rendered instead
  | { status: "off" };

/**
 * Classify one element's typography from its declared stack and the face
 * that actually rendered. Generic and system fallbacks declared AFTER a
 * brand font are fine — only the face that wins matters.
 */
export function classifyFont(stackValue: string, renderedFamily: string, brandFonts: readonly string[]): FontVerdict {
  const renderedBrand = matchBrandFont(renderedFamily, brandFonts);
  if (renderedBrand) return { status: "brand", brand: renderedBrand };
  const stack = parseFontStack(stackValue);
  const brandIndex = stack.findIndex((f) => matchBrandFont(f, brandFonts) !== null);
  if (brandIndex === -1) return { status: "off" };
  const brand = matchBrandFont(stack[brandIndex], brandFonts)!;
  const renderedIndex = stack.findIndex((f) => normalizeFamily(f) === normalizeFamily(renderedFamily));
  if (renderedIndex !== -1 && renderedIndex < brandIndex) return { status: "shadowed", brand };
  return { status: "unavailable", brand };
}

// ── Evaluation ─────────────────────────────────────────────────────────────

const TRANSPARENT: Rgba = { r: 0, g: 0, b: 0, a: 0 };

const SEVERITY_RANK: Record<RenderSeverity, number> = { error: 0, warning: 1, info: 2 };

function clean(value: string | undefined, max: number): string | undefined {
  if (!value) return undefined;
  const flat = flattenUntrusted(value, max);
  return flat || undefined;
}

function pct(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return Math.round((numerator / denominator) * 100);
}

function topCounts<K extends string | number>(map: Map<K, number>, limit: number): Array<[K, number]> {
  return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
}

export function evaluateRenderedCompliance(
  measurement: RenderMeasurement,
  brand: BrandForRender,
): RenderedComplianceResult {
  const findings = new Map<string, RenderFinding>();
  const add = (key: string, finding: Omit<RenderFinding, "occurrences">) => {
    const existing = findings.get(key);
    if (existing) {
      existing.occurrences++;
      return;
    }
    findings.set(key, { ...finding, occurrences: 1 });
  };

  const palette = brand.palette;
  const hasPalette = palette.length > 0;
  const hasFonts = brand.fonts.length > 0;

  let colorUsages = 0;
  let colorOk = 0;
  let textElements = 0;
  let fontOk = 0;
  let contrastMeasured = 0;
  let contrastPass = 0;
  let contrastIndeterminate = 0;

  const colorTally: Record<"text" | "background" | "border", Map<string, { count: number; status: ColorStatus }>> = {
    text: new Map(),
    background: new Map(),
    border: new Map(),
  };
  const fontTally = new Map<string, { elements: number; brand: boolean }>();
  const sizeTally = new Map<number, number>();
  const weightTally = new Map<number, number>();

  const checkColor = (
    kind: "text" | "background" | "border",
    color: Rgba,
    el: RenderedElement,
  ) => {
    const c = classifyColor(color, palette);
    const tally = colorTally[kind].get(c.hex) ?? { count: 0, status: c.status };
    tally.count++;
    colorTally[kind].set(c.hex, tally);
    if (!hasPalette) return;
    colorUsages++;
    if (c.status !== "off") colorOk++;
    if (c.status === "near") {
      add(`color|${kind}|${c.hex}`, {
        rule: "R-COLOR",
        severity: "info",
        kind,
        locator: clean(el.locator, 80),
        text: kind === "text" ? clean(el.text, 40) : undefined,
        measured: c.hex,
        expected: c.nearest ? `${c.nearest.name} ${c.nearest.hex}` : undefined,
        delta_e: c.deltaE,
        message: `${kind} color is close to a brand color — use the exact value`,
      });
    } else if (c.status === "off") {
      const far = (c.deltaE ?? Infinity) > DELTA_E_FAR;
      const advisory = far && brand.colorAdvisory === true;
      add(`color|${kind}|${c.hex}`, {
        rule: "R-COLOR",
        severity: far && !advisory ? "error" : "warning",
        kind,
        locator: clean(el.locator, 80),
        text: kind === "text" ? clean(el.text, 40) : undefined,
        measured: c.hex,
        expected: c.nearest ? `${c.nearest.name} ${c.nearest.hex}` : undefined,
        delta_e: c.deltaE,
        ...(advisory ? { advisory: true } : {}),
        message: `Off-palette ${kind} color${advisory ? " (advisory: primary color unconfirmed)" : ""}`,
      });
    }
  };

  for (const el of measurement.elements) {
    // bgLayers[0] is the element's own background; unparseable layers count as transparent.
    const layers = el.bgLayers.map((c) => parseCssColor(c) ?? TRANSPARENT);
    const background = flattenBackground(layers);

    // Background: only the element's own painted background counts as usage.
    const own = layers[0];
    if (own && own.a > 0) {
      const below = flattenBackground(layers.slice(1));
      checkColor("background", compositeOver(own, below), el);
    }

    for (const raw of el.borderColors) {
      const border = parseCssColor(raw);
      if (border && border.a > 0) checkColor("border", compositeOver(border, background), el);
    }

    if (el.textLength <= 0) continue;
    textElements++;
    const fg = parseCssColor(el.color);

    sizeTally.set(Math.round(el.fontSize), (sizeTally.get(Math.round(el.fontSize)) ?? 0) + 1);
    weightTally.set(el.fontWeight, (weightTally.get(el.fontWeight) ?? 0) + 1);

    // Text color
    if (fg && fg.a > 0) checkColor("text", compositeOver(fg, background), el);

    // Contrast on the real composited foreground/background
    if (!fg || fg.a === 0 || el.bgImage) {
      contrastIndeterminate++;
    } else {
      contrastMeasured++;
      const fgFlat = compositeOver(fg, background);
      const ratio = contrastRatio(fgFlat, background);
      const required = requiredContrastAA(el.fontSize, el.fontWeight);
      const rounded = Math.floor(ratio * 100) / 100;
      if (ratio + 1e-9 >= required) {
        contrastPass++;
      } else {
        const fgHex = toHex(fgFlat);
        const bgHex = toHex(background);
        add(`contrast|${fgHex}|${bgHex}|${required}`, {
          rule: "R-CONTRAST",
          severity: "error",
          kind: "text",
          locator: clean(el.locator, 80),
          text: clean(el.text, 40),
          measured: `${fgHex} on ${bgHex} = ${rounded}:1`,
          expected: `>= ${required}:1 (WCAG AA${required === 3 ? " large text" : ""})`,
          contrast: rounded,
          message: "Text contrast below WCAG AA",
        });
      }
    }

    // Typography
    const rendered = clean(el.renderedFamily, 64) ?? "unknown";
    const renderedLabel = isGenericFamily(rendered) ? `${rendered} (generic)` : rendered;
    if (hasFonts) {
      const verdict = classifyFont(el.fontFamily, el.renderedFamily, brand.fonts);
      const isBrand = verdict.status === "brand" || verdict.status === "unavailable";
      const tally = fontTally.get(rendered) ?? { elements: 0, brand: verdict.status === "brand" };
      tally.elements++;
      fontTally.set(rendered, tally);
      if (isBrand) fontOk++;
      if (verdict.status === "unavailable") {
        add(`font-unavailable|${verdict.brand}|${rendered}`, {
          rule: "R-FONT",
          severity: "info",
          kind: "font",
          locator: clean(el.locator, 80),
          measured: renderedLabel,
          expected: verdict.brand,
          message:
            "Brand font is declared first but did not render (not installed, or a remote font file — rendered checks block network). Inline it as a local file or data: URI to verify.",
        });
      } else if (verdict.status === "shadowed") {
        add(`font-shadowed|${rendered}`, {
          rule: "R-FONT",
          severity: "warning",
          kind: "font",
          locator: clean(el.locator, 80),
          text: clean(el.text, 40),
          measured: renderedLabel,
          expected: verdict.brand,
          message: "A non-brand font earlier in the stack renders instead of the brand font",
        });
      } else if (verdict.status === "off") {
        add(`font-off|${rendered}`, {
          rule: "R-FONT",
          severity: "warning",
          kind: "font",
          locator: clean(el.locator, 80),
          text: clean(el.text, 40),
          measured: renderedLabel,
          expected: brand.fonts.join(", "),
          message: "Text renders in a non-brand font (no brand font in its font-family stack)",
        });
      }
    } else {
      const tally = fontTally.get(rendered) ?? { elements: 0, brand: false };
      tally.elements++;
      fontTally.set(rendered, tally);
    }
  }

  // Logo
  if (!measurement.logo.detected) {
    const severity: RenderSeverity = measurement.brandNameVisible ? "warning" : "info";
    add("logo", {
      rule: "R-LOGO",
      severity,
      kind: "logo",
      measured: measurement.logo.failedToLoad > 0
        ? `no logo rendered (${measurement.logo.failedToLoad} logo image(s) failed to load)`
        : "no logo detected",
      message: measurement.brandNameVisible
        ? "Brand name appears as text but no logo (SVG/img) renders"
        : "No logo detected on the rendered page",
    });
  }

  const sorted = [...findings.values()].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.occurrences - a.occurrences,
  );
  const counts = {
    error: sorted.filter((f) => f.severity === "error").length,
    warning: sorted.filter((f) => f.severity === "warning").length,
    info: sorted.filter((f) => f.severity === "info").length,
  };

  const subscores = {
    color: hasPalette ? pct(colorOk, colorUsages) : null,
    typography: hasFonts ? pct(fontOk, textElements) : null,
    contrast: pct(contrastPass, contrastMeasured),
  };
  const weights: Array<[number | null, number]> = [
    [subscores.color, 0.4],
    [subscores.typography, 0.3],
    [subscores.contrast, 0.3],
  ];
  const present = weights.filter(([s]) => s !== null) as Array<[number, number]>;
  const weightSum = present.reduce((sum, [, w]) => sum + w, 0);
  const score = weightSum > 0
    ? Math.round(present.reduce((sum, [s, w]) => sum + s * w, 0) / weightSum)
    : null;

  const overall = counts.error > 0 ? "FAIL" : counts.warning > 0 ? "WARN" : "PASS";

  const colorSummary = (kind: "text" | "background" | "border") =>
    [...colorTally[kind].entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 6)
      .map(([hex, t]) => ({ hex, count: t.count, status: t.status }));

  return {
    overall,
    score,
    subscores,
    counts,
    findings: sorted,
    measured: {
      elements: measurement.elements.length,
      text_elements: textElements,
      truncated: measurement.truncated,
      contrast_indeterminate: contrastIndeterminate,
      colors: {
        text: colorSummary("text"),
        background: colorSummary("background"),
        border: colorSummary("border"),
      },
      fonts_rendered: [...fontTally.entries()]
        .sort((a, b) => b[1].elements - a[1].elements)
        .slice(0, 6)
        .map(([family, t]) => ({ family, elements: t.elements, brand: t.brand })),
      font_sizes: topCounts(sizeTally, 8).map(([px, elements]) => ({ px, elements })),
      font_weights: topCounts(weightTally, 6).map(([weight, elements]) => ({ weight, elements })),
      logo: {
        detected: measurement.logo.detected,
        ...(measurement.logo.evidence ? { evidence: clean(measurement.logo.evidence, 60) } : {}),
      },
    },
  };
}
