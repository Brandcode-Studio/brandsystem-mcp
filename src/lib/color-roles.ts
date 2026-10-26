/**
 * Canonical color-role vocabulary (issue #93).
 *
 * Base roles are what extractors infer. Variant roles hold a SECOND legitimate
 * color for the same base role within the same theme (e.g. a page surface and
 * a muted panel surface, or body text and a secondary text color). Without
 * variants the (role, theme) merge slot keeps only one color and silently
 * drops the other.
 *
 * Variant names are flat, hyphenated siblings of the base role so they compile
 * to DTCG/runtime keys next to the base token (`color.surface` and
 * `color.surface-alt`). A nested `color.surface.alt` is not possible: in DTCG a
 * node is either a token or a group, and `color.surface` is already a token.
 *
 * Only roles where design systems routinely carry a second value get a variant.
 * Excluded on purpose: primary (ambiguity there is routed to the primary
 * clarification flow, issue #41), secondary (already the "second brand color"),
 * tint (scale members are numerous by nature), overlay/gradient/highlight
 * (rarely more than one meaningful value), and unknown (always additive).
 */
import type { BaseColorRole, ColorRole, VariantColorRole } from "../types/index.js";

export const BASE_COLOR_ROLES = [
  "primary", "secondary", "accent", "neutral",
  "surface", "text", "action",
  "tint", "overlay", "border", "gradient", "highlight",
  "unknown",
] as const satisfies readonly BaseColorRole[];

/** Base role → its single variant role (one variant per base role). */
export const COLOR_ROLE_VARIANTS = {
  surface: "surface-alt",
  text: "text-secondary",
  neutral: "neutral-alt",
  border: "border-alt",
  accent: "accent-alt",
  action: "action-alt",
} as const satisfies Partial<Record<BaseColorRole, VariantColorRole>>;

export const VARIANT_COLOR_ROLES = Object.values(COLOR_ROLE_VARIANTS) as VariantColorRole[];

/** Every role a ColorEntry may carry (base roles, then variant roles). */
export const COLOR_ROLES = [
  ...BASE_COLOR_ROLES,
  "surface-alt", "text-secondary", "neutral-alt", "border-alt", "accent-alt", "action-alt",
] as const satisfies readonly ColorRole[];

const VARIANT_TO_BASE: Record<string, BaseColorRole> = Object.fromEntries(
  Object.entries(COLOR_ROLE_VARIANTS).map(([base, variant]) => [variant, base as BaseColorRole]),
);

/** The variant role for a base role, or null if that role has no variant. */
export function variantRoleFor(role: ColorRole): VariantColorRole | null {
  return (COLOR_ROLE_VARIANTS as Record<string, VariantColorRole>)[role] ?? null;
}

/** True when the role is a variant role (e.g. "surface-alt"). */
export function isVariantRole(role: string): role is VariantColorRole {
  return role in VARIANT_TO_BASE;
}

/** The base role of any role ("surface-alt" → "surface"; "surface" → "surface"). */
export function baseRoleOf(role: ColorRole): BaseColorRole {
  return VARIANT_TO_BASE[role] ?? (role as BaseColorRole);
}

// ── Perceptual distance (CIE76 ΔE) ───────────────────────────────

function hexToRgb(hex: string): [number, number, number] | null {
  let h = hex.trim().replace(/^#/, "").toLowerCase();
  if (!/^[0-9a-f]+$/.test(h)) return null;
  if (h.length === 3 || h.length === 4) h = h.slice(0, 3).split("").map((c) => c + c).join("");
  else if (h.length === 8) h = h.slice(0, 6);
  if (h.length !== 6) return null;
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function rgbToLab([r, g, b]: [number, number, number]): [number, number, number] {
  const lin = (c: number) => {
    const s = c / 255;
    return s > 0.04045 ? ((s + 0.055) / 1.055) ** 2.4 : s / 12.92;
  };
  const rr = lin(r), gg = lin(g), bb = lin(b);
  const x = (rr * 0.4124564 + gg * 0.3575761 + bb * 0.1804375) / 0.95047;
  const y = rr * 0.2126729 + gg * 0.7151522 + bb * 0.072175;
  const z = (rr * 0.0193339 + gg * 0.119192 + bb * 0.9503041) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIE76 ΔE between two hex colors; Infinity when either is unparseable. */
export function colorDeltaE(a: string, b: string): number {
  const ra = hexToRgb(a);
  const rb = hexToRgb(b);
  if (!ra || !rb) return Infinity;
  const la = rgbToLab(ra);
  const lb = rgbToLab(rb);
  return Math.sqrt((la[0] - lb[0]) ** 2 + (la[1] - lb[1]) ** 2 + (la[2] - lb[2]) ** 2);
}
