import * as csstree from "css-tree";
import type { Confidence } from "../types/index.js";

export interface ExtractedColor {
  value: string; // hex
  property: string; // CSS property or custom property name
  frequency: number;
  source_type: "css-variable" | "structural" | "computed";
  /** CSS selector context — helps distinguish brand colors from content colors */
  selector_context?: string;
}

export interface ExtractedFont {
  family: string;
  frequency: number;
}

const COLOR_PROPERTIES = new Set([
  "color",
  "background-color",
  "border-color",
  "fill",
  "stroke",
  "outline-color",
  "text-decoration-color",
]);

/** Convert rgb/rgba/hsl/named colors to hex */
function normalizeToHex(value: string): string | null {
  const trimmed = value.trim().toLowerCase();

  // Already hex
  if (/^#[0-9a-f]{3,8}$/.test(trimmed)) {
    // Expand 3-char to 6-char
    if (trimmed.length === 4) {
      return `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`;
    }
    return trimmed;
  }

  // rgb(r, g, b) or rgba(r, g, b, a)
  const rgbMatch = trimmed.match(
    /rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/
  );
  if (rgbMatch) {
    const r = parseInt(rgbMatch[1], 10);
    const g = parseInt(rgbMatch[2], 10);
    const b = parseInt(rgbMatch[3], 10);
    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
  }

  // Named colors (commonly used CSS named colors)
  const NAMED: Record<string, string> = {
    white: "#ffffff",
    black: "#000000",
    red: "#ff0000",
    blue: "#0000ff",
    green: "#008000",
    transparent: "#00000000",
    navy: "#000080",
    teal: "#008080",
    orange: "#ffa500",
    purple: "#800080",
    gray: "#808080",
    grey: "#808080",
    silver: "#c0c0c0",
    maroon: "#800000",
    olive: "#808000",
    lime: "#00ff00",
    aqua: "#00ffff",
    fuchsia: "#ff00ff",
    yellow: "#ffff00",
    coral: "#ff7f50",
    tomato: "#ff6347",
    salmon: "#fa8072",
    gold: "#ffd700",
    indigo: "#4b0082",
    violet: "#ee82ee",
    pink: "#ffc0cb",
    cyan: "#00ffff",
    magenta: "#ff00ff",
    crimson: "#dc143c",
    turquoise: "#40e0d0",
    wheat: "#f5deb3",
    ivory: "#fffff0",
    linen: "#faf0e6",
    beige: "#f5f5dc",
    khaki: "#f0e68c",
    plum: "#dda0dd",
    orchid: "#da70d6",
    rebeccapurple: "#663399",
    darkblue: "#00008b",
    darkgreen: "#006400",
    darkred: "#8b0000",
    darkgray: "#a9a9a9",
    darkgrey: "#a9a9a9",
    lightblue: "#add8e6",
    lightgreen: "#90ee90",
    lightgray: "#d3d3d3",
    lightgrey: "#d3d3d3",
    midnightblue: "#191970",
    steelblue: "#4682b4",
    slategray: "#708090",
    slategrey: "#708090",
  };
  if (NAMED[trimmed]) return NAMED[trimmed];

  return null;
}

// ── Platform default blocklist ──────────────────────────────────
// CSS custom property patterns that are framework/CMS defaults, not brand colors.
// These get deprioritized (confidence: low) rather than filtered entirely,
// since occasionally a brand does use a platform default as their actual color.

const PLATFORM_DEFAULT_PATTERNS = [
  /^--wp--preset--color--/,         // WordPress default palette
  /^--wp-admin-theme-color/,        // WordPress admin
  /^--wp-block-synced-color/,       // WordPress block editor
  /^--swiper-theme-color/,          // Swiper.js
  /^--bs-/,                         // Bootstrap
  /^--chakra-/,                     // Chakra UI
  /^--mantine-/,                    // Mantine
  /^--tw-/,                         // Tailwind internal
  /^--fa-/,                         // Font Awesome
  /^--toastify-/,                   // React Toastify
  /^--diff-/,                       // Diff viewer libraries
  /^--rc-/,                         // Ant Design / rc-components
  /^--prism-/,                      // PrismJS syntax highlighting
  /^--hljs-/,                       // Highlight.js
  /^--cm-/,                         // CodeMirror
  /^--monaco-/,                     // Monaco editor
  /^--radix-/,                      // Radix UI primitives
  /^--shiki-/,                      // Shiki syntax highlighting
];

// Page builder brand variable patterns (higher priority than platform defaults)
const PAGE_BUILDER_BRAND_PATTERNS = [
  /^--e-global-color-/,             // Elementor globals (actual brand)
  /^--sqs-/,                        // Squarespace brand variables
  /^--wf-/,                         // Webflow
  /^--color-brand/,                 // Common brand token pattern
  /^--brand-/,                      // Generic brand prefix
];

function isPlatformDefault(property: string): boolean {
  return PLATFORM_DEFAULT_PATTERNS.some(p => p.test(property));
}

function isPageBuilderBrand(property: string): boolean {
  return PAGE_BUILDER_BRAND_PATTERNS.some(p => p.test(property));
}

// ── Structural selector detection ────────────────────────────────
// Colors found in these selectors are the brand's structural colors (chrome).
// Colors only in content selectors are likely from showcased content.

const STRUCTURAL_SELECTORS = /^(html|body|:root|\*|header|nav|footer|\.header|\.nav|\.footer|\.navbar|\.site-header|\.site-footer|\.topbar|\.sidebar|\.menu|\.brand|a|a:hover|a:visited|button|\.btn|\.button|input|select|textarea|h[1-6]|p|\.text|\.heading|\.title)/i;

const CONTENT_SELECTORS = /\.(case-study|portfolio|project|article|post|blog|story|card|hero-image|featured|showcase|editorial|gallery|client|work-item|testimonial)/i;

function isStructuralSelector(selector: string): boolean {
  return STRUCTURAL_SELECTORS.test(selector.trim());
}

function isContentSelector(selector: string): boolean {
  return CONTENT_SELECTORS.test(selector.trim());
}

/** Parse CSS text and extract colors + fonts */
export function extractFromCSS(cssText: string): {
  colors: ExtractedColor[];
  fonts: ExtractedFont[];
} {
  const colorMap = new Map<string, ExtractedColor>();
  const fontMap = new Map<string, number>();

  let ast: csstree.CssNode;
  try {
    ast = csstree.parse(cssText, { parseCustomProperty: true });
  } catch {
    return { colors: [], fonts: [] };
  }

  // Track current rule's selector for context
  let currentSelector = "";

  csstree.walk(ast, {
    enter(node: csstree.CssNode) {
      // Track the selector of the current rule
      if (node.type === "Rule" && node.prelude) {
        currentSelector = csstree.generate(node.prelude);
      }

      if (node.type !== "Declaration") return;

      const property = node.property;

      // CSS custom properties that look like colors
      if (property.startsWith("--")) {
        const raw = csstree.generate(node.value);
        const hex = normalizeToHex(raw);
        if (hex && hex !== "#00000000") {
          // Determine source type based on platform detection
          const isPlatform = isPlatformDefault(property);
          const isBuilderBrand = isPageBuilderBrand(property);
          // Page builder brand vars get highest priority, platform defaults get deprioritized
          const sourceType = isBuilderBrand ? "css-variable" as const
            : isPlatform ? "computed" as const  // demote platform defaults to computed level
            : "css-variable" as const;

          const existing = colorMap.get(hex);
          if (existing) {
            existing.frequency += isPlatform ? 0 : 1; // don't boost frequency for platform defaults
            // Upgrade source type only if new source is higher priority
            if (existing.source_type !== "css-variable" && sourceType === "css-variable") {
              existing.source_type = "css-variable";
              existing.property = property;
            }
          } else {
            colorMap.set(hex, {
              value: hex,
              property,
              frequency: isPlatform ? 0 : 1,
              source_type: sourceType,
              selector_context: currentSelector,
            });
          }
        }
      }

      // Color properties
      if (COLOR_PROPERTIES.has(property)) {
        const raw = csstree.generate(node.value);
        const hex = normalizeToHex(raw);
        if (hex && hex !== "#00000000") {
          // Determine if this is a structural or content color
          const isStructural = isStructuralSelector(currentSelector);
          const isContent = isContentSelector(currentSelector);

          const existing = colorMap.get(hex);
          if (existing) {
            existing.frequency++;
            // Upgrade to structural if found in structural selector
            if (isStructural && existing.source_type === "computed") {
              existing.source_type = "structural";
              existing.property = property;
              existing.selector_context = currentSelector;
            }
          } else {
            colorMap.set(hex, {
              value: hex,
              property,
              frequency: isContent ? 0 : 1, // Content colors start at 0 frequency (deprioritized)
              source_type: isStructural ? "structural" : "computed",
              selector_context: currentSelector,
            });
          }
        }
      }

      // Font families
      if (property === "font-family") {
        const raw = csstree.generate(node.value);
        const families = raw
          .split(",")
          .map((f) => f.trim().replace(/^["']|["']$/g, ""))
          .filter((f) => !isSystemFont(f));

        for (const family of families) {
          fontMap.set(family, (fontMap.get(family) || 0) + 1);
        }
      }
    },
  });

  // Consolidate alpha variants: #rrggbbaa colors fold into their #rrggbb parent
  // e.g., #f48fb133, #f48fb11a, #f48fb166 all merge into #f48fb1's frequency
  for (const [hex, color] of colorMap) {
    if (hex.length === 9) { // 8-char hex = #rrggbbaa
      const baseHex = hex.slice(0, 7); // strip alpha
      const parent = colorMap.get(baseHex);
      if (parent) {
        parent.frequency += color.frequency;
        colorMap.delete(hex);
      } else {
        // No parent exists — promote the base color and drop the alpha variant
        colorMap.set(baseHex, { ...color, value: baseHex });
        colorMap.delete(hex);
      }
    }
  }

  // Detect design token scale patterns: "mulberry 30", "violet-50", "blue 700"
  // Group colors by hue name, keep the median-scale value as representative,
  // fold the rest as tints with boosted frequency on the representative.
  const scalePattern = /^--[\w-]*?(?:color[- ]?)?(\w+)[- ](\d+)$/i;
  const hueGroups = new Map<string, Array<{ hex: string; scale: number; color: ExtractedColor }>>();

  for (const [hex, color] of colorMap) {
    const match = color.property.match(scalePattern);
    if (match) {
      const hueName = match[1].toLowerCase();
      const scale = parseInt(match[2], 10);
      if (!hueGroups.has(hueName)) hueGroups.set(hueName, []);
      hueGroups.get(hueName)!.push({ hex, scale, color });
    }
  }

  for (const [hueName, group] of hueGroups) {
    if (group.length < 2) continue; // need 2+ to form a scale

    // Sort by scale number
    group.sort((a, b) => a.scale - b.scale);

    // Pick the median as the representative color
    const medianIdx = Math.floor(group.length / 2);
    const representative = group[medianIdx];

    // Boost representative frequency with all scale members' frequency
    for (let i = 0; i < group.length; i++) {
      if (i === medianIdx) continue;
      const member = group[i];
      representative.color.frequency += member.color.frequency;
      // Mark non-representative as tint and reduce to zero frequency
      // so they sort below the representative
      member.color.frequency = 0;
      member.color.source_type = "computed"; // demote from css-variable
      // Tag the property so inferColorRole can detect it as a tint
      member.color.property = `${member.color.property} (scale: ${hueName} ${member.scale}, tint of ${representative.hex})`;
    }

    // Tag the representative so it can be inferred as the hue's role
    representative.color.property = `${representative.color.property} (scale: ${hueName}, representative)`;
  }

  // Sort with priority: css-variable > structural > computed, then by frequency
  const sourceWeight = (t: string) => t === "css-variable" ? 100 : t === "structural" ? 50 : 0;
  const colors = Array.from(colorMap.values()).sort(
    (a, b) => (sourceWeight(b.source_type) + b.frequency) - (sourceWeight(a.source_type) + a.frequency)
  );

  const fonts = Array.from(fontMap.entries())
    .map(([family, frequency]) => ({ family, frequency }))
    .sort((a, b) => b.frequency - a.frequency);

  return { colors, fonts };
}

/** CSS generic families + platform system fonts that are never brand fonts */
const SYSTEM_FONTS = new Set([
  // CSS generic families
  "serif", "sans-serif", "monospace", "cursive", "fantasy",
  "system-ui", "ui-serif", "ui-sans-serif", "ui-monospace",
  "ui-rounded", "emoji", "math", "fangsong",
  // CSS keywords
  "inherit", "initial", "unset", "revert",
  // Apple system fonts
  "-apple-system", "blinkmacsystemfont",
  "sf pro", "sf pro display", "sf pro text", "sf pro rounded",
  // Apple emoji fonts (must never be "brand" fonts)
  "apple color emoji", "noto color emoji", "twemoji mozilla",
  // Apple monospace fallbacks
  "sfmono-regular", "sf mono", "menlo", "monaco",
  // Windows system fonts
  "segoe ui", "segoe ui emoji", "segoe ui symbol",
  // Cross-platform monospace fallbacks
  "consolas", "liberation mono", "courier new", "courier",
  // IDE / editor fonts (appear when extracting from dev tool sites)
  "cursor", "jetbrains mono", "fira code", "source code pro",
  "cascadia code", "cascadia mono", "hack", "iosevka",
  // Android
  "roboto mono", "droid sans mono",
  // Icon fonts (not typography)
  "material icons", "material symbols", "fontawesome",
  "font awesome", "icomoon", "eicons",
]);

function isSystemFont(name: string): boolean {
  return SYSTEM_FONTS.has(name.toLowerCase());
}

// --- Color analysis utilities ---

function hexToRGB(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  };
}

function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRGB(hex);
  const [rl, gl, bl] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

export function isNearWhite(hex: string): boolean {
  return relativeLuminance(hex) > 0.85;
}

export function isNearBlack(hex: string): boolean {
  return relativeLuminance(hex) < 0.05;
}

/** Low saturation = gray/neutral */
export function isNeutral(hex: string): boolean {
  const { r, g, b } = hexToRGB(hex);
  return (Math.max(r, g, b) - Math.min(r, g, b)) < 30;
}

/** Has noticeable hue — not white, black, or gray */
export function isChromatic(hex: string): boolean {
  return !isNeutral(hex) && !isNearWhite(hex) && !isNearBlack(hex);
}

/**
 * After extraction, if no primary color was identified, promote the
 * most frequent chromatic color. Returns a new array.
 *
 * The promoted color gets `_promoted_role: "primary"` and
 * `_promoted_confidence: "low"` so downstream can surface it
 * as a confirmation item rather than treating it as certain.
 */
export function promotePrimaryColor(colors: ExtractedColor[]): ExtractedColor[] {
  const hasExplicitPrimary = colors.some(
    (c) => inferColorRole(c) === "primary"
  );
  if (hasExplicitPrimary) return colors;

  // Find chromatic colors sorted by frequency
  const chromatic = colors
    .filter((c) => isChromatic(c.value))
    .sort((a, b) => b.frequency - a.frequency);

  if (chromatic.length === 0) return colors;

  // Tag the winner so the caller can detect it — low confidence since auto-promoted
  const winner = chromatic[0];
  return colors.map((c) =>
    c === winner
      ? { ...c, _promoted_role: "primary" as const, _promoted_confidence: "low" as const }
      : c
  );
}

/**
 * Get the top chromatic color candidates from extraction results.
 * Used by the confirmation flow to show the user color options.
 */
export function getTopChromaticCandidates(colors: ExtractedColor[], max = 4): string[] {
  return colors
    .filter((c) => isChromatic(c.value))
    .sort((a, b) => b.frequency - a.frequency)
    .slice(0, max)
    .map((c) => c.value);
}

/** Infer confidence from extraction quality.
 *
 * Confidence signals (weighted):
 * - Source type: css-variable > structural > computed
 * - Frequency: how many times the color appears
 * - Role assignability: does the property name contain a semantic keyword
 * - Platform default: known framework defaults get penalized
 * - Position: structural selectors (header, nav, h1-h6) signal brand
 */
export function inferColorConfidence(
  color: ExtractedColor
): Confidence {
  const prop = color.property.toLowerCase();

  // Platform defaults are always low confidence regardless of frequency
  if (isPlatformDefault(prop)) return "low";

  // Page builder brand variables are high confidence (explicitly marked as brand)
  if (isPageBuilderBrand(prop)) return "high";

  // Score-based approach: accumulate points
  let score = 0;

  // Source type
  if (color.source_type === "css-variable") score += 3;
  else if (color.source_type === "structural") score += 2;
  else score += 1; // computed

  // Frequency
  if (color.frequency >= 5) score += 2;
  else if (color.frequency >= 2) score += 1;

  // Semantic role keyword in property name (strong signal of intentional branding)
  const hasRoleKeyword = /primary|secondary|accent|brand|surface|text|action|bg|background|foreground|cta|button|heading|neutral/i.test(prop);
  if (hasRoleKeyword) score += 2;

  // Structural selector context (header, nav, h1-h6, body)
  if (color.selector_context) {
    const ctx = color.selector_context.toLowerCase();
    if (/^(body|html|:root|header|nav|h[1-6]|\.hero|\.banner)/.test(ctx)) score += 1;
  }

  // Scale representative gets a boost (it represents a whole hue scale)
  if (prop.includes("(scale:") && prop.includes("representative)")) score += 1;

  // Map score to confidence
  if (score >= 5) return "high";
  if (score >= 3) return "medium";
  return "low";
}

/** Infer role from CSS property/variable name, then fall back to value heuristics */
export function inferColorRole(
  color: ExtractedColor & { _promoted_role?: string }
): "primary" | "secondary" | "accent" | "neutral" | "surface" | "text" | "action" | "tint" | "overlay" | "border" | "gradient" | "highlight" | "unknown" {
  // Promotion override from promotePrimaryColor()
  if (color._promoted_role === "primary") return "primary";

  const prop = color.property.toLowerCase();

  // Scale grouping: non-representative scale members are tints
  if (prop.includes("(scale:") && prop.includes("tint of")) return "tint";
  // Scale representative: strip the tag and continue normal inference
  const cleanProp = prop.replace(/\s*\(scale:.*\)/, "");

  // CSS variable name heuristics (use cleanProp which strips scale tags)
  const p = cleanProp || prop;
  if (p.includes("primary") || p.includes("brand")) return "primary";
  if (p.includes("secondary")) return "secondary";
  if (p.includes("accent")) return "accent";
  if (p.includes("neutral") || p.includes("gray") || p.includes("grey")) return "neutral";
  if (p.includes("surface") || p.includes("bg") || p.includes("background")) return "surface";
  if (p.includes("text") || p.includes("foreground")) return "text";
  if (p.includes("action") || p.includes("cta") || p.includes("button")) return "action";
  if (p.includes("tint") || p.includes("alpha") || p.includes("opacity")) return "tint";
  if (p.includes("overlay")) return "overlay";
  if (p.includes("border") || p.includes("divider") || p.includes("separator")) return "border";
  if (p.includes("gradient")) return "gradient";
  if (p.includes("highlight") || p.includes("focus") || p.includes("selection")) return "highlight";

  // Value-based heuristics (when CSS names give no signal)
  if (isNearWhite(color.value)) return "surface";
  if (isNearBlack(color.value)) return "text";
  if (isNeutral(color.value)) return "neutral";

  return "unknown";
}
