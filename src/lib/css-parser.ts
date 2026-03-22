import * as csstree from "css-tree";
import type { Confidence } from "../types/index.js";

export interface ExtractedColor {
  value: string; // hex
  property: string; // CSS property or custom property name
  frequency: number;
  source_type: "css-variable" | "computed";
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

  csstree.walk(ast, {
    visit: "Declaration",
    enter(node) {
      const property = node.property;

      // CSS custom properties that look like colors
      if (property.startsWith("--")) {
        const raw = csstree.generate(node.value);
        const hex = normalizeToHex(raw);
        if (hex && hex !== "#00000000") {
          const existing = colorMap.get(hex);
          if (existing) {
            existing.frequency++;
          } else {
            colorMap.set(hex, {
              value: hex,
              property,
              frequency: 1,
              source_type: "css-variable",
            });
          }
        }
      }

      // Color properties
      if (COLOR_PROPERTIES.has(property)) {
        const raw = csstree.generate(node.value);
        const hex = normalizeToHex(raw);
        if (hex && hex !== "#00000000") {
          const existing = colorMap.get(hex);
          if (existing) {
            existing.frequency++;
          } else {
            colorMap.set(hex, {
              value: hex,
              property,
              frequency: 1,
              source_type: "computed",
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

  const colors = Array.from(colorMap.values()).sort(
    (a, b) => b.frequency - a.frequency
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
  // Apple monospace fallbacks
  "sfmono-regular", "sf mono", "menlo", "monaco",
  // Windows system fonts
  "segoe ui", "segoe ui emoji", "segoe ui symbol",
  // Cross-platform monospace fallbacks
  "consolas", "liberation mono", "courier new", "courier",
  // Android
  "roboto mono", "droid sans mono",
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

  // Tag the winner so the caller can detect it
  const winner = chromatic[0];
  return colors.map((c) =>
    c === winner ? { ...c, _promoted_role: "primary" as const } : c
  );
}

/** Infer confidence from extraction quality */
export function inferColorConfidence(
  color: ExtractedColor
): Confidence {
  if (color.source_type === "css-variable" && color.frequency >= 3) return "high";
  if (color.source_type === "css-variable") return "medium";
  if (color.frequency >= 5) return "medium";
  return "low";
}

/** Infer role from CSS property/variable name, then fall back to value heuristics */
export function inferColorRole(
  color: ExtractedColor & { _promoted_role?: string }
): "primary" | "secondary" | "accent" | "neutral" | "surface" | "text" | "action" | "unknown" {
  // Promotion override from promotePrimaryColor()
  if (color._promoted_role === "primary") return "primary";

  const prop = color.property.toLowerCase();

  // CSS variable name heuristics
  if (prop.includes("primary") || prop.includes("brand")) return "primary";
  if (prop.includes("secondary")) return "secondary";
  if (prop.includes("accent")) return "accent";
  if (prop.includes("neutral") || prop.includes("gray") || prop.includes("grey")) return "neutral";
  if (prop.includes("surface") || prop.includes("bg") || prop.includes("background")) return "surface";
  if (prop.includes("text") || prop.includes("foreground")) return "text";
  if (prop.includes("action") || prop.includes("cta") || prop.includes("button")) return "action";

  // Value-based heuristics (when CSS names give no signal)
  if (isNearWhite(color.value)) return "surface";
  if (isNearBlack(color.value)) return "text";
  if (isNeutral(color.value)) return "neutral";

  return "unknown";
}
