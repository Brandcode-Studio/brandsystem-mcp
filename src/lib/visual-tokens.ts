import type { ComputedElement } from "./visual-extractor.js";

export interface VisualSpacingValue {
  px: number;
  count: number;
}

export interface VisualSpacingSummary {
  baseUnit: string | null;
  scale: number[];
  commonValues: VisualSpacingValue[];
  sampleCount: number;
}

export interface VisualBorderRadiusSummary {
  values: Array<{ value: string; count: number }>;
  dominantStyle: "sharp" | "rounded" | "pill";
}

export interface VisualShadowSummary {
  value: string;
  count: number;
  context: string;
}

export interface VisualComponentVariant {
  backgroundColor: string | null;
  color: string | null;
  borderRadius: string | null;
  padding: string | null;
  border: string | null;
  shadow: string | null;
  variant: string;
  count: number;
}

export interface VisualComponentSummary {
  buttons: VisualComponentVariant[];
  inputs: VisualComponentVariant[];
  badges: VisualComponentVariant[];
}

export interface VisualTokenSummary {
  spacing: VisualSpacingSummary;
  borderRadius: VisualBorderRadiusSummary;
  shadows: VisualShadowSummary[];
  components: VisualComponentSummary;
}

function parseDimensionToPx(value?: string | null): number | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  if (!trimmed || trimmed === "none" || trimmed === "normal" || trimmed === "auto") return null;
  if (trimmed === "0") return 0;

  const px = trimmed.match(/^(-?\d*\.?\d+)px$/);
  if (px) return Number.parseFloat(px[1]);

  const rem = trimmed.match(/^(-?\d*\.?\d+)rem$/);
  if (rem) return Number.parseFloat(rem[1]) * 16;

  const em = trimmed.match(/^(-?\d*\.?\d+)em$/);
  if (em) return Number.parseFloat(em[1]) * 16;

  return null;
}

function formatPx(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded}px`;
}

function inferBaseUnit(values: number[]): number | null {
  const filtered = values.filter((value) => value > 0 && value <= 16).map((value) => Math.round(value));
  if (filtered.length === 0) return null;
  const byEight = filtered.filter((value) => value % 8 === 0).length;
  const byFour = filtered.filter((value) => value % 4 === 0).length;
  if (byEight >= Math.max(2, Math.ceil(filtered.length / 2))) return 8;
  if (byFour >= Math.max(2, Math.ceil(filtered.length / 2))) return 4;
  return Math.min(...filtered);
}

function pushCount(map: Map<string, number>, key: string | null | undefined) {
  if (!key) return;
  map.set(key, (map.get(key) ?? 0) + 1);
}

function spacingValuesFromElement(element: ComputedElement): number[] {
  const values: number[] = [];
  const candidates = [element.paddingBlock, element.paddingInline, element.marginBlock, element.marginInline];
  for (const candidate of candidates) {
    const px = parseDimensionToPx(candidate);
    if (px !== null && px >= 0) values.push(px);
  }
  return values;
}

function inferShadowContext(selector: string): string {
  if (selector === "card") return "cards";
  if (selector === "primary_button") return "buttons";
  if (selector === "badge") return "badges";
  if (selector === "input") return "inputs";
  return "elevated";
}

function normalizePadding(element: ComputedElement): string | null {
  const block = element.paddingBlock?.trim();
  const inline = element.paddingInline?.trim();
  if (!block && !inline) return null;
  if (block && inline) return `${block} ${inline}`;
  return block ?? inline ?? null;
}

function normalizeBorder(element: ComputedElement): string | null {
  const border = element.border?.trim();
  if (border && border !== "0px none rgba(0, 0, 0, 0)") return border;
  if (element.borderColor && element.borderColor !== "transparent") {
    return `1px solid ${element.borderColor}`;
  }
  return null;
}

function inferVariantKind(kind: "buttons" | "inputs" | "badges", element: ComputedElement): string {
  const hasFill = !!element.backgroundColor && element.backgroundColor !== "transparent";
  const hasBorder = !!normalizeBorder(element);
  if (kind === "buttons") {
    if (hasFill && hasBorder) return "primary";
    if (!hasFill && hasBorder) return "secondary";
    if (hasFill) return "primary";
    return "ghost";
  }
  if (kind === "inputs") {
    if (hasBorder) return "outline";
    if (hasFill) return "filled";
    return "minimal";
  }
  if (hasFill) return "solid";
  if (hasBorder) return "outlined";
  return "subtle";
}

function summarizeVariants(elements: ComputedElement[], kind: "buttons" | "inputs" | "badges"): VisualComponentVariant[] {
  const selector = kind === "buttons" ? "primary_button" : kind === "inputs" ? "input" : "badge";
  const matches = elements.filter((element) => element.selector === selector);
  const groups = new Map<string, VisualComponentVariant>();

  for (const element of matches) {
    const variant: VisualComponentVariant = {
      backgroundColor: element.backgroundColor === "transparent" ? "transparent" : (element.backgroundColor ?? null),
      color: element.color ?? null,
      borderRadius: element.borderRadius ?? null,
      padding: normalizePadding(element),
      border: normalizeBorder(element),
      shadow: element.boxShadow && element.boxShadow !== "none" ? element.boxShadow : null,
      variant: inferVariantKind(kind, element),
      count: 1,
    };
    const key = JSON.stringify(variant);
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      groups.set(key, variant);
    }
  }

  return [...groups.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 4);
}

export function summarizeVisualTokens(elements: ComputedElement[]): VisualTokenSummary {
  const spacingCounts = new Map<number, number>();
  let sampleCount = 0;
  for (const element of elements) {
    const values = spacingValuesFromElement(element);
    if (values.length > 0) sampleCount++;
    for (const value of values) {
      spacingCounts.set(value, (spacingCounts.get(value) ?? 0) + 1);
    }
  }

  const scale = [...spacingCounts.keys()].sort((a, b) => a - b);
  const commonValues = [...spacingCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, 6)
    .map(([px, count]) => ({ px, count }));

  const radiusCounts = new Map<string, number>();
  const radiusPxValues: number[] = [];
  for (const element of elements) {
    const radius = element.borderRadius?.trim();
    if (!radius || radius === "0px") continue;
    pushCount(radiusCounts, radius);
    const px = parseDimensionToPx(radius);
    if (px !== null) radiusPxValues.push(px);
  }
  const dominantStyle: VisualBorderRadiusSummary["dominantStyle"] = [...radiusCounts.keys()].some((value) => value.includes("%"))
    ? "pill"
    : (radiusPxValues.length === 0 || Math.max(...radiusPxValues) <= 4)
      ? "sharp"
      : Math.max(...radiusPxValues) >= 20
        ? "pill"
        : "rounded";

  const shadowCounts = new Map<string, { count: number; contexts: Map<string, number> }>();
  for (const element of elements) {
    const shadow = element.boxShadow?.trim();
    if (!shadow || shadow === "none") continue;
    const entry = shadowCounts.get(shadow) ?? { count: 0, contexts: new Map<string, number>() };
    entry.count += 1;
    const context = inferShadowContext(element.selector);
    entry.contexts.set(context, (entry.contexts.get(context) ?? 0) + 1);
    shadowCounts.set(shadow, entry);
  }

  return {
    spacing: {
      baseUnit: scale.length > 0 ? formatPx(inferBaseUnit(scale) ?? scale[0]) : null,
      scale,
      commonValues,
      sampleCount,
    },
    borderRadius: {
      values: [...radiusCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 6)
        .map(([value, count]) => ({ value, count })),
      dominantStyle,
    },
    shadows: [...shadowCounts.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 6)
      .map(([value, info]) => ({
        value,
        count: info.count,
        context: [...info.contexts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "elevated",
      })),
    components: {
      buttons: summarizeVariants(elements, "buttons"),
      inputs: summarizeVariants(elements, "inputs"),
      badges: summarizeVariants(elements, "badges"),
    },
  };
}
