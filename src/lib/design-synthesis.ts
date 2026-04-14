import { BrandDir } from "./brand-dir.js";
import { isTokenWorthy } from "./confidence.js";
import type { BrandConfigData, CoreIdentityData, TokensFileData } from "../schemas/index.js";
import type { Confidence } from "../types/index.js";
import type { ExtractionEvidenceFile } from "./site-evidence.js";
import type { ComputedElement } from "./visual-extractor.js";
import { summarizeVisualTokens, type VisualComponentVariant } from "./visual-tokens.js";

export type DesignSignalConfidence = "high" | "medium" | "low";
export type DesignSynthesisSource = "evidence" | "current-brand";

export interface DesignSignal {
  token: string;
  value: string;
  confidence: DesignSignalConfidence;
  provenance: string[];
}

export interface TypographyFamilySynthesis {
  family: string;
  role: "display" | "body" | "ui" | "mono";
  character: string;
  confidence: DesignSignalConfidence;
  evidence_count: number;
}

export interface TypographyScaleSynthesis {
  token: string;
  selector: string;
  size: string;
  weight: string;
  line_height?: string | null;
  letter_spacing?: string | null;
  confidence: DesignSignalConfidence;
}

export interface ComponentSynthesis {
  count: number;
  dominant_fill: string | null;
  dominant_text: string | null;
  dominant_radius: string | null;
  dominant_shadow: string | null;
  notes: string[];
}

export interface DesignSynthesisFile {
  schema_version: string;
  generated_at: string;
  source: DesignSynthesisSource;
  brand: {
    client_name: string;
    website_url: string | null;
  };
  evidence: {
    pages_sampled: number;
    screenshots_analyzed: number;
    page_types: string[];
    viewports: Array<"desktop" | "mobile">;
    computed_elements: number;
    css_custom_properties: number;
  };
  colors: {
    brand: Array<{
      role: string;
      name: string;
      value: string;
      confidence: DesignSignalConfidence;
      provenance: string[];
    }>;
    semantic: Array<{
      role: string;
      name: string;
      value: string;
      confidence: DesignSignalConfidence;
      provenance: string[];
    }>;
    additional: Array<{
      role: string;
      name: string;
      value: string;
      confidence: DesignSignalConfidence;
      provenance: string[];
    }>;
    mood: {
      temperature: "warm" | "cool" | "balanced";
      contrast: "high" | "medium" | "low";
      brightness: "light" | "dark" | "mixed";
    };
  };
  typography: {
    families: TypographyFamilySynthesis[];
    scale: TypographyScaleSynthesis[];
    character: string[];
  };
  shape: {
    radius_scale: DesignSignal[];
    corner_style: "sharp" | "balanced" | "rounded";
    values: Array<{ value: string; count: number }>;
    dominant_style: "sharp" | "rounded" | "pill";
  };
  depth: {
    shadow_scale: DesignSignal[];
    elevation_style: "flat" | "subtle" | "layered";
    shadows: Array<{ value: string; count: number; context: string }>;
  };
  spacing: {
    base_unit: string | null;
    scale: number[];
    common_values: Array<{ px: number; count: number }>;
    component_spacing: string[];
    section_spacing: string[];
    confidence: DesignSignalConfidence;
  };
  layout: {
    content_width: string | null;
    density: "compact" | "balanced" | "spacious";
    grid_feel: string;
  };
  components: {
    button: ComponentSynthesis;
    card: ComponentSynthesis;
    input: ComponentSynthesis;
    navigation: ComponentSynthesis;
    badge: ComponentSynthesis;
    variants: {
      buttons: VisualComponentVariant[];
      inputs: VisualComponentVariant[];
      badges: VisualComponentVariant[];
    };
  };
  motion: {
    tone: string;
    duration_tokens: DesignSignal[];
    easing_tokens: DesignSignal[];
  };
  personality: {
    adjectives: string[];
    tone: string;
    warmth: string;
    precision: string;
    positioning: string;
    rationale: string[];
  };
  ambiguities: string[];
}

export interface PersistedDesignArtifacts {
  source_used: DesignSynthesisSource;
  synthesis: DesignSynthesisFile;
  markdown: string;
  files_written: string[];
}

interface EvidenceSnapshot {
  elements: ComputedElement[];
  cssVars: Record<string, string>;
  pageTypes: string[];
  viewports: Array<"desktop" | "mobile">;
  pagesSampled: number;
  screenshotsAnalyzed: number;
}

const BRAND_COLOR_ROLES = new Set(["primary", "secondary", "accent", "action", "highlight", "gradient", "tint"]);
const SEMANTIC_COLOR_ROLES = new Set(["surface", "text", "neutral", "border", "overlay"]);
const ROLE_PRIORITY = ["primary", "secondary", "accent", "action", "highlight", "surface", "text", "border", "neutral", "unknown"];
const SELECTOR_ROLE_PRIORITY: Record<string, number> = {
  hero_heading: 5,
  hero_subheading: 4,
  paragraph: 3,
  body: 3,
  primary_button: 2,
  input: 2,
  link: 2,
  header: 1,
  badge: 1,
};

function mapConfidence(confidence: Confidence): DesignSignalConfidence {
  return confidence === "confirmed" ? "high" : confidence;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const normalized = hex.trim().toLowerCase();
  if (!/^#[0-9a-f]{6}$/i.test(normalized)) return null;
  return {
    r: parseInt(normalized.slice(1, 3), 16),
    g: parseInt(normalized.slice(3, 5), 16),
    b: parseInt(normalized.slice(5, 7), 16),
  };
}

function getLuminance(hex: string): number | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  return (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
}

function getHue(hex: string): number | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta < 0.05) return null;
  if (max === r) return ((g - b) / delta % 6) * 60;
  if (max === g) return ((b - r) / delta + 2) * 60;
  return ((r - g) / delta + 4) * 60;
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

function formatPx(px: number): string {
  const rounded = Math.round(px * 100) / 100;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded}px`;
}

function dedupeStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function flattenEvidence(evidence: ExtractionEvidenceFile | null): EvidenceSnapshot {
  if (!evidence) {
    return {
      elements: [],
      cssVars: {},
      pageTypes: [],
      viewports: [],
      pagesSampled: 0,
      screenshotsAnalyzed: 0,
    };
  }

  const elements: ComputedElement[] = [];
  const cssVars: Record<string, string> = {};
  const viewports = new Set<"desktop" | "mobile">();
  let screenshotsAnalyzed = 0;

  for (const page of evidence.selected_pages) {
    for (const viewport of page.viewports) {
      screenshotsAnalyzed++;
      viewports.add(viewport.viewport);
      elements.push(...viewport.computed_elements);
      Object.assign(cssVars, viewport.css_custom_properties);
    }
  }

  return {
    elements,
    cssVars,
    pageTypes: evidence.site_summary.page_types,
    viewports: [...viewports],
    pagesSampled: evidence.selected_pages.length,
    screenshotsAnalyzed,
  };
}

function inferColorMood(colors: string[], identity: CoreIdentityData): DesignSynthesisFile["colors"]["mood"] {
  const hues = colors.map(getHue).filter((value): value is number => value !== null);
  const warmCount = hues.filter((hue) => hue < 70 || hue >= 330).length;
  const coolCount = hues.filter((hue) => hue >= 70 && hue < 250).length;
  const temperature = warmCount === 0 && coolCount === 0
    ? "balanced"
    : warmCount > coolCount
      ? "warm"
      : coolCount > warmCount
        ? "cool"
        : "balanced";

  const textColor = identity.colors.find((color) => color.role === "text")?.value ?? null;
  const surfaceColor = identity.colors.find((color) => color.role === "surface")?.value ?? null;
  const primaryColor = identity.colors.find((color) => color.role === "primary")?.value ?? null;

  let contrast: "high" | "medium" | "low" = "medium";
  const textLum = textColor ? getLuminance(textColor) : null;
  const surfaceLum = surfaceColor ? getLuminance(surfaceColor) : null;
  const primaryLum = primaryColor ? getLuminance(primaryColor) : null;
  if (textLum !== null && surfaceLum !== null) {
    const delta = Math.abs(textLum - surfaceLum);
    contrast = delta >= 0.7 ? "high" : delta >= 0.45 ? "medium" : "low";
  } else if (primaryLum !== null && surfaceLum !== null) {
    const delta = Math.abs(primaryLum - surfaceLum);
    contrast = delta >= 0.6 ? "high" : delta >= 0.35 ? "medium" : "low";
  }

  const luminances = colors.map(getLuminance).filter((value): value is number => value !== null);
  const averageLuminance = luminances.length > 0
    ? luminances.reduce((sum, value) => sum + value, 0) / luminances.length
    : 0.5;
  const brightness = averageLuminance >= 0.72
    ? "light"
    : averageLuminance <= 0.28
      ? "dark"
      : "mixed";

  return { temperature, contrast, brightness };
}

function classifyFontCharacter(family: string): string {
  const lower = family.toLowerCase();
  if (/(mono|code|jetbrains|consolas|menlo|courier)/.test(lower)) return "monospaced";
  if (/(serif|garamond|georgia|merriweather|playfair|fraunces|times)/.test(lower)) return "serif";
  if (/(inter|graphik|soehne|geist|helvetica|arial|neue|grotesk|grotesque)/.test(lower)) return "neo-grotesk sans";
  if (/(avenir|frutiger|optima|source sans|humanist)/.test(lower)) return "humanist sans";
  if (/(circular|gilroy|futura|poppins|montserrat|geometric)/.test(lower)) return "geometric sans";
  return "sans";
}

function inferTypographyFamilies(identity: CoreIdentityData, elements: ComputedElement[]): TypographyFamilySynthesis[] {
  const counts = new Map<string, number>();
  const selectorCounts = new Map<string, Map<string, number>>();

  for (const element of elements) {
    if (!element.fontFamily) continue;
    counts.set(element.fontFamily, (counts.get(element.fontFamily) ?? 0) + 1);
    const bySelector = selectorCounts.get(element.fontFamily) ?? new Map<string, number>();
    bySelector.set(element.selector, (bySelector.get(element.selector) ?? 0) + 1);
    selectorCounts.set(element.fontFamily, bySelector);
  }

  const tokenWorthyIdentityFamilies = identity.typography
    .filter((entry) => isTokenWorthy(entry.confidence))
    .map((entry) => entry.family);

  const families = dedupeStrings([...tokenWorthyIdentityFamilies, ...counts.keys()]);

  return families
    .map((family) => {
      const selectorMap = selectorCounts.get(family) ?? new Map<string, number>();
      const topSelector = [...selectorMap.entries()]
        .sort((a, b) => (SELECTOR_ROLE_PRIORITY[b[0]] ?? 0) - (SELECTOR_ROLE_PRIORITY[a[0]] ?? 0) || b[1] - a[1])[0]?.[0];

      const role: TypographyFamilySynthesis["role"] = /mono/i.test(classifyFontCharacter(family))
        ? "mono"
        : topSelector === "hero_heading" || topSelector === "hero_subheading"
          ? "display"
          : topSelector === "paragraph" || topSelector === "body"
            ? "body"
            : "ui";

      const identityEntry = identity.typography.find((entry) => entry.family === family);
      const evidenceCount = counts.get(family) ?? 0;
      const confidence = identityEntry
        ? mapConfidence(identityEntry.confidence)
        : evidenceCount >= 6
          ? "high"
          : evidenceCount >= 2
            ? "medium"
            : "low";

      return {
        family,
        role,
        character: classifyFontCharacter(family),
        confidence,
        evidence_count: evidenceCount,
      };
    })
    .sort((a, b) => b.evidence_count - a.evidence_count || a.family.localeCompare(b.family));
}

function buildTypographyScale(identity: CoreIdentityData, elements: ComputedElement[]): TypographyScaleSynthesis[] {
  const grouped = new Map<string, TypographyScaleSynthesis & { sizePx: number }>();

  for (const element of elements) {
    const sizePx = parseDimensionToPx(element.fontSize);
    if (sizePx === null) continue;
    const token = `${element.selector}-${formatPx(sizePx)}-${element.fontWeight}`;
    if (!grouped.has(token)) {
      grouped.set(token, {
        token,
        selector: element.selector,
        size: element.fontSize,
        weight: element.fontWeight,
        line_height: element.lineHeight ?? null,
        letter_spacing: element.letterSpacing ?? null,
        confidence: sizePx >= 40 || element.selector === "paragraph" || element.selector === "primary_button" ? "high" : "medium",
        sizePx,
      });
    }
  }

  const scale = [...grouped.values()]
    .sort((a, b) => b.sizePx - a.sizePx)
    .slice(0, 6)
    .map(({ sizePx: _sizePx, ...step }) => step);

  if (scale.length > 0) return scale;

  return identity.typography
    .filter((entry) => isTokenWorthy(entry.confidence) && entry.size)
    .slice(0, 6)
    .map((entry) => ({
      token: entry.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      selector: entry.name,
      size: entry.size!,
      weight: entry.weight ? String(entry.weight) : "400",
      line_height: entry.line_height ?? null,
      letter_spacing: null,
      confidence: mapConfidence(entry.confidence),
    }));
}

function buildColorGroups(identity: CoreIdentityData) {
  const tokenWorthy = identity.colors
    .filter((color) => isTokenWorthy(color.confidence))
    .sort((a, b) => ROLE_PRIORITY.indexOf(a.role) - ROLE_PRIORITY.indexOf(b.role));

  const toSignal = (color: CoreIdentityData["colors"][number]) => ({
    role: color.role,
    name: color.name,
    value: color.value,
    confidence: mapConfidence(color.confidence),
    provenance: [`${color.source}${color.css_property ? `:${color.css_property}` : ""}`],
  });

  return {
    brand: tokenWorthy.filter((color) => BRAND_COLOR_ROLES.has(color.role)).map(toSignal),
    semantic: tokenWorthy.filter((color) => SEMANTIC_COLOR_ROLES.has(color.role)).map(toSignal),
    additional: tokenWorthy.filter((color) => !BRAND_COLOR_ROLES.has(color.role) && !SEMANTIC_COLOR_ROLES.has(color.role)).map(toSignal),
  };
}

function tokenizeScale(prefix: string, values: number[], provenance: string[]): DesignSignal[] {
  const labels = ["none", "sm", "md", "lg", "xl", "2xl"];
  return values.map((value, index) => ({
    token: `${prefix}-${labels[index] ?? `step-${index + 1}`}`,
    value: formatPx(value),
    confidence: values.length >= 4 ? "high" : values.length >= 2 ? "medium" : "low",
    provenance,
  }));
}

function extractRadiusScale(elements: ComputedElement[], cssVars: Record<string, string>) {
  const visualTokens = summarizeVisualTokens(elements);
  const radiusValues = new Set<number>();

  for (const element of elements) {
    const px = parseDimensionToPx(element.borderRadius);
    if (px !== null) radiusValues.add(px);
  }

  for (const [name, value] of Object.entries(cssVars)) {
    if (!/radius|round/i.test(name)) continue;
    const px = parseDimensionToPx(value);
    if (px !== null) radiusValues.add(px);
  }

  const sorted = [...radiusValues].sort((a, b) => a - b).slice(0, 6);
  const max = sorted[sorted.length - 1] ?? 0;
  const cornerStyle = max <= 4 ? "sharp" : max <= 12 ? "balanced" : "rounded";

  return {
    radius_scale: tokenizeScale("radius", sorted, ["computed:borderRadius", "css-vars:radius"]),
    corner_style: cornerStyle as DesignSynthesisFile["shape"]["corner_style"],
    values: visualTokens.borderRadius.values,
    dominant_style: visualTokens.borderRadius.dominantStyle,
  };
}

function extractShadowScale(elements: ComputedElement[], cssVars: Record<string, string>) {
  const visualTokens = summarizeVisualTokens(elements);
  const shadowValues = new Set<string>();

  for (const element of elements) {
    if (element.boxShadow && element.boxShadow !== "none") shadowValues.add(element.boxShadow);
  }

  for (const [name, value] of Object.entries(cssVars)) {
    if (!/shadow/i.test(name)) continue;
    if (!value || /^#[0-9a-f]{6}$/i.test(value)) continue;
    shadowValues.add(value);
  }

  const confidence: DesignSignalConfidence = shadowValues.size >= 3 ? "high" : shadowValues.size >= 1 ? "medium" : "low";
  const shadowScale: DesignSignal[] = [...shadowValues].slice(0, 4).map((value, index) => ({
    token: `shadow-${["sm", "md", "lg", "xl"][index] ?? `step-${index + 1}`}`,
    value,
    confidence,
    provenance: ["computed:boxShadow", "css-vars:shadow"],
  }));

  const elevationStyle = shadowScale.length === 0 ? "flat" : shadowScale.length === 1 ? "subtle" : "layered";
  return {
    shadow_scale: shadowScale,
    elevation_style: elevationStyle as DesignSynthesisFile["depth"]["elevation_style"],
    shadows: visualTokens.shadows,
  };
}

function inferBaseUnit(values: number[]): number | null {
  const filtered = values.filter((value) => value > 0 && value <= 16);
  if (filtered.length === 0) return null;
  const rounded = filtered.map((value) => Math.round(value));
  const divisibleBy8 = rounded.filter((value) => value % 8 === 0).length;
  const divisibleBy4 = rounded.filter((value) => value % 4 === 0).length;
  if (divisibleBy8 >= Math.max(2, Math.ceil(rounded.length / 2))) return 8;
  if (divisibleBy4 >= Math.max(2, Math.ceil(rounded.length / 2))) return 4;
  return Math.min(...rounded);
}

function extractSpacing(identity: CoreIdentityData, elements: ComputedElement[], cssVars: Record<string, string>) {
  const visualTokens = summarizeVisualTokens(elements);
  const spacingValues: number[] = [];

  if (identity.spacing?.scale) {
    spacingValues.push(...identity.spacing.scale);
  }

  for (const [name, value] of Object.entries(cssVars)) {
    if (!/space|spacing|gap|gutter|padding|margin/i.test(name)) continue;
    const px = parseDimensionToPx(value);
    if (px !== null) spacingValues.push(px);
  }

  for (const element of elements) {
    const block = parseDimensionToPx(element.paddingBlock);
    const inline = parseDimensionToPx(element.paddingInline);
    if (block !== null) spacingValues.push(block);
    if (inline !== null) spacingValues.push(inline);
  }

  const deduped = [...new Set(spacingValues.map((value) => Math.round(value * 100) / 100))].sort((a, b) => a - b);
  const baseUnit = identity.spacing?.base_unit ?? (inferBaseUnit(deduped) ? formatPx(inferBaseUnit(deduped)!) : null);

  const componentSpacing = deduped.filter((value) => value >= 4 && value <= 32).slice(0, 6).map(formatPx);
  const sectionSpacing = deduped.filter((value) => value > 32).slice(0, 4).map(formatPx);

  const confidence: DesignSignalConfidence = identity.spacing
    ? mapConfidence(identity.spacing.confidence)
    : deduped.length >= 6
      ? "medium"
      : deduped.length > 0
        ? "low"
        : "low";

  return {
    base_unit: baseUnit,
    scale: deduped,
    common_values: visualTokens.spacing.commonValues,
    component_spacing: componentSpacing,
    section_spacing: sectionSpacing,
    confidence,
  };
}

function extractLayout(
  pageTypes: string[],
  elements: ComputedElement[],
  cssVars: Record<string, string>,
  spacing: DesignSynthesisFile["spacing"],
  shape: DesignSynthesisFile["shape"],
) {
  const widthCandidates: number[] = [];

  for (const [name, value] of Object.entries(cssVars)) {
    if (!/container|max-width|content-width|measure/i.test(name)) continue;
    const px = parseDimensionToPx(value);
    if (px !== null && px >= 320) widthCandidates.push(px);
  }

  for (const element of elements) {
    const px = parseDimensionToPx(element.maxWidth);
    if (px !== null && px >= 320) widthCandidates.push(px);
  }

  const contentWidth = widthCandidates.length > 0
    ? formatPx([...widthCandidates].sort((a, b) => b - a)[0])
    : null;

  const basePx = parseDimensionToPx(spacing.base_unit);
  const density: DesignSynthesisFile["layout"]["density"] = basePx !== null && basePx <= 4 && pageTypes.includes("app")
    ? "compact"
    : basePx !== null && basePx >= 8 && shape.corner_style === "rounded"
      ? "spacious"
      : "balanced";

  let gridFeel = "modular responsive grid";
  if (pageTypes.includes("app") && pageTypes.includes("marketing")) {
    gridFeel = "structured product-marketing grid";
  } else if (pageTypes.includes("content") && !pageTypes.includes("app")) {
    gridFeel = "editorial content-led layout";
  } else if (pageTypes.includes("company")) {
    gridFeel = "modular marketing layout";
  }

  return {
    content_width: contentWidth,
    density,
    grid_feel: gridFeel,
  };
}

function mostCommon(values: string[]): string | null {
  if (values.length === 0) return null;
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

function summarizeComponent(elements: ComputedElement[], selectors: string[]): ComponentSynthesis {
  const matches = elements.filter((element) => selectors.includes(element.selector));
  const fills = matches
    .map((element) => element.backgroundColor)
    .filter((value): value is string => Boolean(value) && value !== "transparent");
  const text = matches
    .map((element) => element.color)
    .filter((value): value is string => Boolean(value));
  const radii = matches
    .map((element) => element.borderRadius)
    .filter((value): value is string => Boolean(value) && value !== "0px");
  const shadows = matches
    .map((element) => element.boxShadow)
    .filter((value): value is string => Boolean(value) && value !== "none");
  const textTransforms = dedupeStrings(matches.map((element) => element.textTransform));

  const notes: string[] = [];
  if (new Set(fills).size > 1) notes.push("Multiple visual treatments detected");
  if (new Set(radii).size > 1) notes.push("Corner radius varies across instances");
  if (textTransforms.includes("uppercase")) notes.push("Uses uppercase emphasis in some states");
  if (matches.length === 0) notes.push("No representative instances observed in the evidence bundle");

  return {
    count: matches.length,
    dominant_fill: mostCommon(fills),
    dominant_text: mostCommon(text),
    dominant_radius: mostCommon(radii),
    dominant_shadow: mostCommon(shadows),
    notes,
  };
}

function extractMotion(cssVars: Record<string, string>, personality: { precision: string; warmth: string }) {
  const durationTokens: DesignSignal[] = [];
  const easingTokens: DesignSignal[] = [];

  for (const [name, value] of Object.entries(cssVars)) {
    if (!/duration|timing|ease|transition/i.test(name)) continue;
    if (/(ms|s)\b/.test(value)) {
      durationTokens.push({
        token: name.replace(/^--/, ""),
        value,
        confidence: "medium",
        provenance: [`css-var:${name}`],
      });
    } else if (/cubic-bezier|ease|linear/.test(value)) {
      easingTokens.push({
        token: name.replace(/^--/, ""),
        value,
        confidence: "medium",
        provenance: [`css-var:${name}`],
      });
    }
  }

  const tone = personality.precision === "precise"
    ? "Keep motion quick, restrained, and product-like."
    : personality.warmth === "warm"
      ? "Use soft easing and friendly transitions rather than abrupt snaps."
      : "Favor subtle, low-drama transitions that support clarity.";

  return {
    tone,
    duration_tokens: durationTokens.slice(0, 4),
    easing_tokens: easingTokens.slice(0, 4),
  };
}

function buildPersonality(
  mood: DesignSynthesisFile["colors"]["mood"],
  shape: DesignSynthesisFile["shape"],
  depth: DesignSynthesisFile["depth"],
  layout: DesignSynthesisFile["layout"],
  typography: DesignSynthesisFile["typography"],
) {
  const warmth = mood.temperature === "warm"
    ? "warm"
    : mood.temperature === "cool"
      ? "cool"
      : "balanced";
  const precision = shape.corner_style === "sharp"
    ? "precise"
    : shape.corner_style === "rounded"
      ? "approachable"
      : "polished";

  let positioning = "balanced";
  if (depth.elevation_style === "flat" && layout.density === "compact") positioning = "product-led";
  else if (depth.elevation_style === "subtle" && typography.character.some((entry) => entry.includes("serif"))) positioning = "premium";
  else if (shape.corner_style === "rounded" && mood.temperature === "warm") positioning = "accessible";

  const adjectivePool = [
    precision === "precise" ? "confident" : precision === "approachable" ? "friendly" : "polished",
    warmth === "warm" ? "energetic" : warmth === "cool" ? "calm" : "balanced",
    positioning === "premium" ? "premium" : positioning === "accessible" ? "welcoming" : positioning === "product-led" ? "systematic" : "composed",
  ];

  const adjectives = dedupeStrings(adjectivePool).slice(0, 3);

  return {
    adjectives,
    tone: adjectives.join(", "),
    warmth,
    precision,
    positioning,
    rationale: [
      `Color temperature reads as ${mood.temperature} with ${mood.contrast} contrast.`,
      `Corners feel ${shape.corner_style} and elevation feels ${depth.elevation_style}.`,
      `Layout density trends ${layout.density}, which pushes the system toward a ${positioning} reading.`,
    ],
  };
}

function buildAmbiguities(identity: CoreIdentityData, evidence: EvidenceSnapshot, synthesis: Omit<DesignSynthesisFile, "ambiguities">): string[] {
  const ambiguities: string[] = [];
  if (synthesis.source === "current-brand" && evidence.pagesSampled === 0) {
    ambiguities.push("No extraction-evidence.json was available, so component and layout guidance was inferred from the current brand state only.");
  }
  if (!identity.colors.some((color) => color.role === "primary")) {
    ambiguities.push("Primary color is still ambiguous — confirm which extracted color should drive CTAs and dominant actions.");
  }
  if (identity.colors.some((color) => color.role === "unknown")) {
    ambiguities.push("Some colors still have unknown roles, so palette hierarchy may need manual cleanup.");
  }
  if (synthesis.shape.radius_scale.length === 0) {
    ambiguities.push("No reliable radius scale was detected from the rendered evidence.");
  }
  if (synthesis.depth.shadow_scale.length === 0) {
    ambiguities.push("No reusable shadow scale was detected; the brand may be intentionally flat or the crawl missed deeper component states.");
  }
  if (!synthesis.layout.content_width) {
    ambiguities.push("Content width could not be inferred from CSS variables or computed styles.");
  }
  if (synthesis.typography.families.length <= 1) {
    ambiguities.push("Typography hierarchy looks shallow — heading/body/UI roles may collapse to a single family.");
  }
  return ambiguities;
}

export function buildDesignSynthesis(
  config: BrandConfigData,
  identity: CoreIdentityData,
  options: {
    evidence?: ExtractionEvidenceFile | null;
    tokens?: TokensFileData | null;
    source?: DesignSynthesisSource;
  } = {},
): DesignSynthesisFile {
  const evidenceSnapshot = flattenEvidence(options.evidence ?? null);
  const source = options.source ?? (options.evidence ? "evidence" : "current-brand");
  const colorGroups = buildColorGroups(identity);
  const brandPalette = dedupeStrings([
    ...colorGroups.brand.map((color) => color.value),
    ...colorGroups.semantic.map((color) => color.value),
    ...colorGroups.additional.map((color) => color.value),
  ]);
  const mood = inferColorMood(brandPalette, identity);
  const typographyFamilies = inferTypographyFamilies(identity, evidenceSnapshot.elements);
  const typographyScale = buildTypographyScale(identity, evidenceSnapshot.elements);
  const typographyCharacter = dedupeStrings(typographyFamilies.map((entry) => entry.character));
  const visualTokens = summarizeVisualTokens(evidenceSnapshot.elements);
  const shape = extractRadiusScale(evidenceSnapshot.elements, evidenceSnapshot.cssVars);
  const depth = extractShadowScale(evidenceSnapshot.elements, evidenceSnapshot.cssVars);
  const spacing = extractSpacing(identity, evidenceSnapshot.elements, evidenceSnapshot.cssVars);
  const layout = extractLayout(evidenceSnapshot.pageTypes, evidenceSnapshot.elements, evidenceSnapshot.cssVars, spacing, shape);
  const provisionalPersonality = buildPersonality(
    mood,
    shape,
    depth,
    layout,
    { families: typographyFamilies, scale: typographyScale, character: typographyCharacter },
  );
  const motion = extractMotion(evidenceSnapshot.cssVars, provisionalPersonality);

  const partial: Omit<DesignSynthesisFile, "ambiguities"> = {
    schema_version: "0.4.0",
    generated_at: new Date().toISOString(),
    source,
    brand: {
      client_name: config.client_name,
      website_url: config.website_url ?? null,
    },
    evidence: {
      pages_sampled: evidenceSnapshot.pagesSampled,
      screenshots_analyzed: evidenceSnapshot.screenshotsAnalyzed,
      page_types: evidenceSnapshot.pageTypes,
      viewports: evidenceSnapshot.viewports,
      computed_elements: evidenceSnapshot.elements.length,
      css_custom_properties: Object.keys(evidenceSnapshot.cssVars).length,
    },
    colors: {
      ...colorGroups,
      mood,
    },
    typography: {
      families: typographyFamilies,
      scale: typographyScale,
      character: typographyCharacter,
    },
    shape,
    depth,
    spacing,
    layout,
    components: {
      button: summarizeComponent(evidenceSnapshot.elements, ["primary_button"]),
      card: summarizeComponent(evidenceSnapshot.elements, ["card"]),
      input: summarizeComponent(evidenceSnapshot.elements, ["input"]),
      navigation: summarizeComponent(evidenceSnapshot.elements, ["header"]),
      badge: summarizeComponent(evidenceSnapshot.elements, ["badge"]),
      variants: visualTokens.components,
    },
    motion,
    personality: provisionalPersonality,
  };

  return {
    ...partial,
    ambiguities: buildAmbiguities(identity, evidenceSnapshot, partial),
  };
}

function formatSignalList(signals: DesignSignal[]): string {
  if (signals.length === 0) return "none detected";
  return signals.map((signal) => `\`${signal.token}\` ${signal.value}`).join(", ");
}

function buildDoRules(synthesis: DesignSynthesisFile): string[] {
  const rules = [
    synthesis.colors.brand[0]
      ? `Use ${synthesis.colors.brand[0].value} as the dominant action and brand anchor color.`
      : "Use the confirmed brand palette consistently before introducing new accents.",
    synthesis.typography.families[0]
      ? `Keep ${synthesis.typography.families[0].family} as the lead typography voice for prominent hierarchy.`
      : "Preserve the extracted typography hierarchy instead of defaulting to system fonts.",
    synthesis.shape.corner_style === "sharp"
      ? "Favor crisp, restrained corners and avoid overly pill-shaped UI."
      : synthesis.shape.corner_style === "rounded"
        ? "Lean into generous radii and soft containment instead of harsh rectangular edges."
        : "Keep corners balanced and consistent across controls and cards.",
  ];

  if (synthesis.depth.elevation_style === "flat") {
    rules.push("Keep surfaces relatively flat and let color/spacing do the separation work.");
  } else {
    rules.push("Use the extracted elevation language consistently rather than mixing flat and heavy-shadow components.");
  }

  return rules;
}

function buildDontRules(synthesis: DesignSynthesisFile): string[] {
  const rules = [
    "Do not introduce off-palette accent colors unless they are explicitly present in the extracted system.",
    "Do not mix unrelated type personalities; keep heading, body, and UI roles aligned with the extracted stack.",
  ];

  if (synthesis.shape.corner_style === "sharp") {
    rules.push("Do not round every container by default — it will dilute the brand's precise feel.");
  } else if (synthesis.shape.corner_style === "rounded") {
    rules.push("Do not collapse the interface into hard-edged boxes — it will feel colder than the observed brand.");
  } else {
    rules.push("Do not let corner radius drift wildly between components.");
  }

  if (synthesis.depth.elevation_style === "flat") {
    rules.push("Do not add ornamental shadows or glassy effects that were not observed in the evidence.");
  } else {
    rules.push("Do not over-stack shadows; keep elevation within the extracted scale.");
  }

  return rules;
}

export function renderDesignMarkdown(synthesis: DesignSynthesisFile): string {
  const visualIntro = synthesis.source === "evidence"
    ? `This document is grounded in rendered site evidence across ${synthesis.evidence.pages_sampled} representative page(s) and ${synthesis.evidence.screenshots_analyzed} screenshot(s).`
    : "This document was synthesized from the current brand state because no deeper rendered evidence bundle was available.";

  return [
    "# DESIGN.md",
    "",
    `Brand: ${synthesis.brand.client_name}`,
    visualIntro,
    "",
    "## 1. Visual Theme and Atmosphere",
    "",
    `${synthesis.brand.client_name} reads as ${synthesis.personality.tone}. The palette skews ${synthesis.colors.mood.temperature} with ${synthesis.colors.mood.contrast} contrast, the corners feel ${synthesis.shape.corner_style}, and the overall elevation language is ${synthesis.depth.elevation_style}. Layout density is ${synthesis.layout.density}, which makes the system feel ${synthesis.personality.positioning}.`,
    "",
    "## 2. Color Palette and Roles",
    "",
    `Primary brand colors: ${synthesis.colors.brand.length > 0 ? synthesis.colors.brand.map((color) => `\`${color.role}\` ${color.value}`).join(", ") : "none confirmed"}.`,
    `Semantic support colors: ${synthesis.colors.semantic.length > 0 ? synthesis.colors.semantic.map((color) => `\`${color.role}\` ${color.value}`).join(", ") : "none confirmed"}.`,
    `Additional palette notes: ${synthesis.colors.additional.length > 0 ? synthesis.colors.additional.map((color) => `\`${color.name}\` ${color.value}`).join(", ") : "no additional token-worthy colors"}.`,
    "",
    "## 3. Typography Rules",
    "",
    `Font families: ${synthesis.typography.families.length > 0 ? synthesis.typography.families.map((family) => `${family.family} (${family.role}, ${family.character})`).join(", ") : "no strong typography signal detected"}.`,
    `Representative scale: ${synthesis.typography.scale.length > 0 ? synthesis.typography.scale.map((step) => `\`${step.selector}\` ${step.size}/${step.line_height ?? "auto"} weight ${step.weight}`).join(", ") : "no reliable scale extracted"}.`,
    "",
    "## 4. Component Styling",
    "",
    `Buttons: ${synthesis.components.button.count > 0 ? `dominant fill ${synthesis.components.button.dominant_fill ?? "none"}, text ${synthesis.components.button.dominant_text ?? "inherit"}, radius ${synthesis.components.button.dominant_radius ?? "none"}, shadow ${synthesis.components.button.dominant_shadow ?? "none"}.` : "No button instances were observed."}`,
    `Cards: ${synthesis.components.card.count > 0 ? `dominant fill ${synthesis.components.card.dominant_fill ?? "none"}, radius ${synthesis.components.card.dominant_radius ?? "none"}, shadow ${synthesis.components.card.dominant_shadow ?? "none"}.` : "No card pattern was observed."}`,
    `Inputs and nav: inputs use ${synthesis.components.input.dominant_radius ?? "unspecified"} radius; navigation fill resolves to ${synthesis.components.navigation.dominant_fill ?? "unspecified"}.`,
    `Button variants: ${synthesis.components.variants.buttons.length > 0 ? synthesis.components.variants.buttons.map((variant) => `${variant.variant} (${variant.backgroundColor ?? "transparent"}, radius ${variant.borderRadius ?? "0px"}, padding ${variant.padding ?? "auto"})`).join(", ") : "none detected"}.`,
    `Input variants: ${synthesis.components.variants.inputs.length > 0 ? synthesis.components.variants.inputs.map((variant) => variant.variant).join(", ") : "none detected"}. Badge variants: ${synthesis.components.variants.badges.length > 0 ? synthesis.components.variants.badges.map((variant) => variant.variant).join(", ") : "none detected"}.`,
    "",
    "## 5. Layout Principles",
    "",
    `Grid feel: ${synthesis.layout.grid_feel}.`,
    `Content width: ${synthesis.layout.content_width ?? "not confidently detected"}.`,
    `Spacing model: base unit ${synthesis.spacing.base_unit ?? "not confidently detected"} with detected scale ${synthesis.spacing.scale.length > 0 ? synthesis.spacing.scale.map((value) => `${value}px`).join(", ") : "unknown"}, common values ${synthesis.spacing.common_values.length > 0 ? synthesis.spacing.common_values.map((item) => `${item.px}px x${item.count}`).join(", ") : "unknown"}, component spacing ${synthesis.spacing.component_spacing.join(", ") || "unknown"}, and larger section spacing ${synthesis.spacing.section_spacing.join(", ") || "unknown"}.`,
    "",
    "## 6. Depth and Elevation",
    "",
    `Elevation style: ${synthesis.depth.elevation_style}.`,
    `Shadow scale: ${formatSignalList(synthesis.depth.shadow_scale)}.`,
    `Observed shadows: ${synthesis.depth.shadows.length > 0 ? synthesis.depth.shadows.map((shadow) => `${shadow.value} (${shadow.context}, x${shadow.count})`).join(", ") : "none detected"}.`,
    `Radius scale: ${formatSignalList(synthesis.shape.radius_scale)}.`,
    `Observed radii: ${synthesis.shape.values.length > 0 ? synthesis.shape.values.map((radius) => `${radius.value} x${radius.count}`).join(", ") : "none detected"}; dominant shape language is ${synthesis.shape.dominant_style}.`,
    "",
    "## 7. Motion and Interaction Tone",
    "",
    synthesis.motion.tone,
    `Observed duration tokens: ${formatSignalList(synthesis.motion.duration_tokens)}.`,
    `Observed easing tokens: ${formatSignalList(synthesis.motion.easing_tokens)}.`,
    "",
    "## 8. Do and Do Not Rules",
    "",
    ...buildDoRules(synthesis).map((rule) => `- Do: ${rule}`),
    ...buildDontRules(synthesis).map((rule) => `- Do not: ${rule}`),
    "",
    "## 9. Agent Prompt Guide",
    "",
    `- Describe the brand as ${synthesis.personality.tone}.`,
    `- Use ${synthesis.layout.grid_feel} layouts with ${synthesis.layout.density} spacing.`,
    `- Keep color emphasis centered on ${synthesis.colors.brand[0]?.value ?? "the confirmed primary brand color"} for actions and branded highlights.`,
    `- Preserve the ${synthesis.shape.corner_style} corner language and ${synthesis.depth.elevation_style} depth treatment.`,
    synthesis.ambiguities.length > 0 ? `- Ask for confirmation on these unresolved areas before high-stakes output: ${synthesis.ambiguities.join(" ")}` : "- The current synthesis is internally consistent enough to use as an agent-facing design brief.",
    "",
  ].join("\n");
}

export async function generateAndPersistDesignArtifacts(
  brandDir: BrandDir,
  options: {
    source?: DesignSynthesisSource;
    overwrite?: boolean;
  } = {},
): Promise<PersistedDesignArtifacts> {
  const overwrite = options.overwrite ?? true;

  if (!overwrite && (await brandDir.hasDesignSynthesis()) && (await brandDir.hasDesignMarkdown())) {
    const synthesis = await brandDir.readDesignSynthesis<DesignSynthesisFile>();
    const markdown = await brandDir.readMarkdown("DESIGN.md");
    return {
      source_used: synthesis.source,
      synthesis,
      markdown,
      files_written: [],
    };
  }

  const config = await brandDir.readConfig();
  const identity = await brandDir.readCoreIdentity();
  const evidence = await brandDir.hasExtractionEvidence()
    ? await brandDir.readExtractionEvidence<ExtractionEvidenceFile>()
    : null;
  const tokens = await brandDir.hasTokens()
    ? await brandDir.readTokens()
    : null;

  const sourceUsed: DesignSynthesisSource = options.source ?? (evidence ? "evidence" : "current-brand");
  const synthesis = buildDesignSynthesis(config, identity, {
    evidence: sourceUsed === "evidence" ? evidence : null,
    tokens,
    source: sourceUsed,
  });
  const markdown = renderDesignMarkdown(synthesis);

  await brandDir.writeDesignSynthesis(synthesis);
  await brandDir.writeMarkdown("DESIGN.md", markdown);

  return {
    source_used: sourceUsed,
    synthesis,
    markdown,
    files_written: ["design-synthesis.json", "DESIGN.md"],
  };
}
