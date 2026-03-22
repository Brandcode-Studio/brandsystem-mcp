/**
 * Generate clean, human-readable color names from hex values and roles.
 * Replaces raw CSS property names with meaningful labels.
 */

interface RGB {
  r: number;
  g: number;
  b: number;
}

interface HSL {
  h: number;
  s: number;
  l: number;
}

function hexToRGB(hex: string): RGB {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.substring(0, 2), 16),
    g: parseInt(h.substring(2, 4), 16),
    b: parseInt(h.substring(4, 6), 16),
  };
}

function rgbToHSL(rgb: RGB): HSL {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / d + 2) / 6;
        break;
      case b:
        h = ((r - g) / d + 4) / 6;
        break;
    }
  }

  return { h: h * 360, s: s * 100, l: l * 100 };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Determine the closest color family name from a hex value.
 * Returns a human-readable name like "Red", "Dark Blue", "Light Coral", etc.
 */
function colorFamilyFromHex(hex: string): string {
  const rgb = hexToRGB(hex);
  const hsl = rgbToHSL(rgb);

  // Near-black
  if (hsl.l < 8) return "Black";
  // Near-white
  if (hsl.l > 95) return "White";

  // Very low saturation = gray
  if (hsl.s < 10) {
    if (hsl.l < 30) return "Dark Gray";
    if (hsl.l < 60) return "Gray";
    return "Light Gray";
  }

  // Determine base hue name
  let baseName: string;
  const h = hsl.h;

  if (h < 10 || h >= 350) baseName = "Red";
  else if (h < 25) baseName = "Vermilion";
  else if (h < 40) baseName = "Orange";
  else if (h < 50) baseName = "Amber";
  else if (h < 65) baseName = "Yellow";
  else if (h < 80) baseName = "Lime";
  else if (h < 160) baseName = "Green";
  else if (h < 180) baseName = "Teal";
  else if (h < 200) baseName = "Cyan";
  else if (h < 240) baseName = "Blue";
  else if (h < 270) baseName = "Indigo";
  else if (h < 290) baseName = "Violet";
  else if (h < 320) baseName = "Purple";
  else if (h < 340) baseName = "Magenta";
  else baseName = "Pink";

  // Refine: coral range (h 0-20, s 60-100, l 50-70)
  if (h >= 0 && h < 20 && hsl.s > 60 && hsl.l > 45 && hsl.l < 75) {
    baseName = "Coral";
  }

  // Add lightness modifier
  if (hsl.l < 25) return `Dark ${baseName}`;
  if (hsl.l > 75) return `Light ${baseName}`;

  return baseName;
}

/**
 * Generate a clean, human-readable name for a color.
 *
 * Priority:
 * 1. If role is assigned (not "unknown"): capitalize the role
 * 2. If hex is recognizable: generate from color family
 * 3. Fall back to hex value
 */
export function generateColorName(hex: string, role: string): string {
  // If a meaningful role is assigned, use it
  if (role && role !== "unknown") {
    return capitalize(role);
  }

  // Generate a name from the hex color
  return colorFamilyFromHex(hex);
}

/**
 * Determine if a raw name is a CSS artifact that should be replaced
 * with a clean generated name.
 */
export function isCssArtifactName(name: string, hex: string): boolean {
  // CSS property patterns
  if (/^(color|background|border-color|fill|stroke|outline)/.test(name)) return true;
  // Tailwind-style patterns
  if (/^(--tw-|tw )/.test(name)) return true;
  // Raw CSS variable names that look like property refs
  if (/^(ring|shadow|divide|placeholder)/.test(name)) return true;
  // Name contains the hex value itself
  if (name.includes(hex)) return true;
  // Name is just a CSS property + some value
  if (/^[\w-]+\s+#[0-9a-f]{3,8}$/i.test(name)) return true;

  return false;
}

/**
 * Clean a color name: if it looks like a CSS artifact, replace with
 * a human-readable generated name. Otherwise keep the original.
 */
export function cleanColorName(color: { name: string; value: string; role: string }): string {
  if (isCssArtifactName(color.name, color.value)) {
    return generateColorName(color.value, color.role);
  }
  return color.name;
}
