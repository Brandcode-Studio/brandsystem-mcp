/**
 * Color metrics for rendered compliance checks: CSS color parsing, alpha
 * compositing, CIEDE2000 perceptual distance, and WCAG 2.x contrast.
 *
 * Pure functions only — no I/O — so the comparison logic is unit-testable
 * without a browser.
 */

export interface Rgba {
  r: number; // 0-255
  g: number; // 0-255
  b: number; // 0-255
  a: number; // 0-1
}

export interface Lab {
  L: number;
  a: number;
  b: number;
}

const clamp255 = (n: number) => Math.min(255, Math.max(0, n));
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Parse "#rgb", "#rgba", "#rrggbb", "#rrggbbaa". */
export function parseHex(hex: string): Rgba | null {
  const h = hex.trim().toLowerCase().replace(/^#/, "");
  if (!/^[0-9a-f]+$/.test(h)) return null;
  let full: string;
  if (h.length === 3 || h.length === 4) {
    full = [...h].map((c) => c + c).join("");
  } else if (h.length === 6 || h.length === 8) {
    full = h;
  } else {
    return null;
  }
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
    a: full.length === 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1,
  };
}

/**
 * Parse a computed CSS color. Handles hex, rgb()/rgba() in comma or space
 * syntax (with optional "/ alpha", percentages allowed), `color(srgb ...)`,
 * and the keyword `transparent`. Returns null for anything else (the
 * in-page measurement normalizes exotic color spaces to rgba first).
 */
export function parseCssColor(value: string): Rgba | null {
  const v = value.trim().toLowerCase();
  if (v === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  if (v.startsWith("#")) return parseHex(v);

  const fn = /^(rgba?|color)\((.*)\)$/.exec(v);
  if (!fn) return null;
  const [, name, body] = fn;
  let parts: string[];
  let alphaPart: string | undefined;
  if (body.includes("/")) {
    const [main, alpha] = body.split("/");
    parts = main.trim().split(/[\s,]+/).filter(Boolean);
    alphaPart = alpha.trim();
  } else {
    parts = body.split(/[\s,]+/).filter(Boolean);
  }

  const parseAlpha = (s: string | undefined): number => {
    if (s === undefined) return 1;
    if (s.endsWith("%")) return clamp01(parseFloat(s) / 100);
    const n = parseFloat(s);
    return Number.isFinite(n) ? clamp01(n) : 1;
  };

  if (name === "color") {
    // color(srgb r g b [/ a]) with 0-1 channels
    if (parts[0] !== "srgb" || parts.length < 4) return null;
    const ch = parts.slice(1, 4).map((p) => (p.endsWith("%") ? parseFloat(p) / 100 : parseFloat(p)));
    if (ch.some((n) => !Number.isFinite(n))) return null;
    return {
      r: Math.round(clamp255(ch[0] * 255)),
      g: Math.round(clamp255(ch[1] * 255)),
      b: Math.round(clamp255(ch[2] * 255)),
      a: parseAlpha(alphaPart ?? parts[4]),
    };
  }

  if (parts.length < 3) return null;
  const ch = parts.slice(0, 3).map((p) => (p.endsWith("%") ? (parseFloat(p) / 100) * 255 : parseFloat(p)));
  if (ch.some((n) => !Number.isFinite(n))) return null;
  return {
    r: Math.round(clamp255(ch[0])),
    g: Math.round(clamp255(ch[1])),
    b: Math.round(clamp255(ch[2])),
    a: parseAlpha(alphaPart ?? parts[3]),
  };
}

export function toHex(c: Pick<Rgba, "r" | "g" | "b">): string {
  const h = (n: number) => Math.round(clamp255(n)).toString(16).padStart(2, "0");
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`;
}

/** Source-over composite of `top` onto an opaque `bottom`. Result is opaque. */
export function compositeOver(top: Rgba, bottom: Rgba): Rgba {
  const a = clamp01(top.a);
  return {
    r: top.r * a + bottom.r * (1 - a),
    g: top.g * a + bottom.g * (1 - a),
    b: top.b * a + bottom.b * (1 - a),
    a: 1,
  };
}

const WHITE: Rgba = { r: 255, g: 255, b: 255, a: 1 };

/**
 * Flatten a background stack (element first, then ancestors outward) to one
 * opaque color. Layers below the first opaque layer are ignored; when no
 * layer is opaque the browser canvas default (white) is the base.
 */
export function flattenBackground(layers: readonly Rgba[], base: Rgba = WHITE): Rgba {
  let firstOpaque = layers.findIndex((l) => l.a >= 1);
  if (firstOpaque === -1) firstOpaque = layers.length;
  let result = firstOpaque < layers.length ? { ...layers[firstOpaque], a: 1 } : base;
  for (let i = Math.min(firstOpaque, layers.length) - 1; i >= 0; i--) {
    result = compositeOver(layers[i], result);
  }
  return result;
}

// ── CIE Lab + CIEDE2000 ────────────────────────────────────────────────────

function srgbToLinear(c: number): number {
  const v = c / 255;
  return v > 0.04045 ? Math.pow((v + 0.055) / 1.055, 2.4) : v / 12.92;
}

/** sRGB (D65) → CIE L*a*b*. */
export function rgbToLab(c: Pick<Rgba, "r" | "g" | "b">): Lab {
  const r = srgbToLinear(c.r);
  const g = srgbToLinear(c.g);
  const b = srgbToLinear(c.b);
  const x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047;
  const y = r * 0.2126729 + g * 0.7151522 + b * 0.072175;
  const z = (r * 0.0193339 + g * 0.119192 + b * 0.9503041) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

/** Lab chroma (C*). Values below ~6 read as neutral gray. */
export function labChroma(lab: Lab): number {
  return Math.hypot(lab.a, lab.b);
}

const deg = (rad: number) => (rad * 180) / Math.PI;
const rad = (d: number) => (d * Math.PI) / 180;

/**
 * CIEDE2000 color difference (Sharma, Wu & Dalal 2005), kL = kC = kH = 1.
 * ~1 is a just-noticeable difference; ~2.3 is a common JND threshold.
 */
export function ciede2000(lab1: Lab, lab2: Lab): number {
  const { L: L1, a: a1, b: b1 } = lab1;
  const { L: L2, a: a2, b: b2 } = lab2;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cbar = (C1 + C2) / 2;
  const Cbar7 = Math.pow(Cbar, 7);
  const G = 0.5 * (1 - Math.sqrt(Cbar7 / (Cbar7 + Math.pow(25, 7))));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const hue = (ap: number, bp: number) => {
    if (ap === 0 && bp === 0) return 0;
    const h = deg(Math.atan2(bp, ap));
    return h >= 0 ? h : h + 360;
  };
  const h1p = hue(a1p, b1);
  const h2p = hue(a2p, b2);

  const dLp = L2 - L1;
  const dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(rad(dhp / 2));

  const Lbarp = (L1 + L2) / 2;
  const Cbarp = (C1p + C2p) / 2;
  let hbarp: number;
  if (C1p * C2p === 0) hbarp = h1p + h2p;
  else if (Math.abs(h1p - h2p) <= 180) hbarp = (h1p + h2p) / 2;
  else if (h1p + h2p < 360) hbarp = (h1p + h2p + 360) / 2;
  else hbarp = (h1p + h2p - 360) / 2;

  const T =
    1 -
    0.17 * Math.cos(rad(hbarp - 30)) +
    0.24 * Math.cos(rad(2 * hbarp)) +
    0.32 * Math.cos(rad(3 * hbarp + 6)) -
    0.2 * Math.cos(rad(4 * hbarp - 63));
  const dTheta = 30 * Math.exp(-Math.pow((hbarp - 275) / 25, 2));
  const Cbarp7 = Math.pow(Cbarp, 7);
  const Rc = 2 * Math.sqrt(Cbarp7 / (Cbarp7 + Math.pow(25, 7)));
  const Sl = 1 + (0.015 * Math.pow(Lbarp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbarp - 50, 2));
  const Sc = 1 + 0.045 * Cbarp;
  const Sh = 1 + 0.015 * Cbarp * T;
  const Rt = -Math.sin(rad(2 * dTheta)) * Rc;

  return Math.sqrt(
    Math.pow(dLp / Sl, 2) +
      Math.pow(dCp / Sc, 2) +
      Math.pow(dHp / Sh, 2) +
      Rt * (dCp / Sc) * (dHp / Sh),
  );
}

/** CIEDE2000 between two sRGB colors. */
export function deltaE2000(c1: Pick<Rgba, "r" | "g" | "b">, c2: Pick<Rgba, "r" | "g" | "b">): number {
  return ciede2000(rgbToLab(c1), rgbToLab(c2));
}

// ── WCAG contrast ──────────────────────────────────────────────────────────

/** WCAG 2.x relative luminance of an opaque sRGB color. */
export function relativeLuminance(c: Pick<Rgba, "r" | "g" | "b">): number {
  return 0.2126 * srgbToLinear(c.r) + 0.7152 * srgbToLinear(c.g) + 0.0722 * srgbToLinear(c.b);
}

/** WCAG 2.x contrast ratio (1-21) between two opaque colors. */
export function contrastRatio(c1: Pick<Rgba, "r" | "g" | "b">, c2: Pick<Rgba, "r" | "g" | "b">): number {
  const l1 = relativeLuminance(c1);
  const l2 = relativeLuminance(c2);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * WCAG "large text": at least 18pt (24px), or at least 14pt (~18.66px) bold
 * (font-weight >= 700).
 */
export function isLargeText(fontSizePx: number, fontWeight: number): boolean {
  return fontSizePx >= 24 || (fontSizePx >= 18.66 && fontWeight >= 700);
}

/** Minimum WCAG AA contrast for text of this size/weight (4.5 or 3). */
export function requiredContrastAA(fontSizePx: number, fontWeight: number): number {
  return isLargeText(fontSizePx, fontWeight) ? 3 : 4.5;
}

// ── Palette matching ───────────────────────────────────────────────────────

export interface PaletteEntry {
  name: string;
  hex: string;
}

export interface NearestPaletteMatch {
  entry: PaletteEntry;
  deltaE: number;
}

/** Nearest palette entry by CIEDE2000, or null for an empty palette. */
export function nearestPaletteColor(
  color: Pick<Rgba, "r" | "g" | "b">,
  palette: readonly PaletteEntry[],
): NearestPaletteMatch | null {
  const lab = rgbToLab(color);
  let best: NearestPaletteMatch | null = null;
  for (const entry of palette) {
    const rgb = parseHex(entry.hex);
    if (!rgb) continue;
    const d = ciede2000(lab, rgbToLab(rgb));
    if (!best || d < best.deltaE) best = { entry, deltaE: d };
  }
  return best;
}
