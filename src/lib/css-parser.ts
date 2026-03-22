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

  // Named colors (common subset)
  const NAMED: Record<string, string> = {
    white: "#ffffff",
    black: "#000000",
    red: "#ff0000",
    blue: "#0000ff",
    green: "#008000",
    transparent: "#00000000",
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
          .filter((f) => !isGenericFont(f));

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

function isGenericFont(name: string): boolean {
  return [
    "serif", "sans-serif", "monospace", "cursive", "fantasy",
    "system-ui", "ui-serif", "ui-sans-serif", "ui-monospace",
    "ui-rounded", "emoji", "math", "fangsong",
    "inherit", "initial", "unset", "revert",
  ].includes(name.toLowerCase());
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

/** Infer role from CSS property/variable name */
export function inferColorRole(
  color: ExtractedColor
): "primary" | "secondary" | "accent" | "neutral" | "surface" | "text" | "action" | "unknown" {
  const prop = color.property.toLowerCase();

  // CSS variable name heuristics
  if (prop.includes("primary") || prop.includes("brand")) return "primary";
  if (prop.includes("secondary")) return "secondary";
  if (prop.includes("accent")) return "accent";
  if (prop.includes("neutral") || prop.includes("gray") || prop.includes("grey")) return "neutral";
  if (prop.includes("surface") || prop.includes("bg") || prop.includes("background")) return "surface";
  if (prop.includes("text") || prop.includes("foreground")) return "text";
  if (prop.includes("action") || prop.includes("cta") || prop.includes("button")) return "action";

  // Computed property heuristics
  if (color.property === "background-color") return "surface";
  if (color.property === "color") return "text";

  return "unknown";
}
