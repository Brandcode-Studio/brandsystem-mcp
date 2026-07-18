import type { Confidence, Source, ColorEntry, TypographyEntry } from "../types/index.js";

/** Legacy source precedence used by existing merge paths */
const SOURCE_RANK: Record<Source, number> = {
  guidelines: 4,
  figma: 3,
  manual: 2,
  web: 1,
  visual: 1,
};

export const DEFAULT_SOURCE_PRIORITY: Source[] = ["guidelines", "figma", "visual", "web", "manual"];

const CONFIDENCE_RANK: Record<Confidence, number> = {
  confirmed: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export function sourceWins(a: Source, b: Source): Source {
  return SOURCE_RANK[a] >= SOURCE_RANK[b] ? a : b;
}

export function sourcePriorityRank(source: Source, priority: Source[] = DEFAULT_SOURCE_PRIORITY): number {
  const index = priority.indexOf(source);
  return index === -1 ? -1 : priority.length - index;
}

export function sourceWinsWithPriority(a: Source, b: Source, priority: Source[] = DEFAULT_SOURCE_PRIORITY): Source {
  return sourcePriorityRank(a, priority) >= sourcePriorityRank(b, priority) ? a : b;
}

export function confidenceRank(c: Confidence): number {
  return CONFIDENCE_RANK[c];
}

/** Should this value go into tokens.json? (high or medium confidence) */
export function isTokenWorthy(confidence: Confidence): boolean {
  return CONFIDENCE_RANK[confidence] >= CONFIDENCE_RANK.medium;
}

/** Should this value go into needs-clarification? (low confidence) */
export function needsClarification(confidence: Confidence): boolean {
  return CONFIDENCE_RANK[confidence] <= CONFIDENCE_RANK.low;
}

/**
 * Merge-slot key for a color's theme dimension (issue #35 gap 1).
 * Absent theme and explicit "light" share the default slot — precedence and
 * confidence still resolve within it — while "dark" entries occupy their own
 * slot so a dark-theme surface never evicts the light-theme surface.
 */
function colorThemeKey(entry: ColorEntry): "default" | "dark" {
  return entry.theme === "dark" ? "dark" : "default";
}

/**
 * Merge a new color entry into an existing array.
 * Slots are keyed on (role, theme) — one color per role per theme.
 * If a color with the same (role, theme) exists and the new source has higher
 * precedence, replace it. If same source, keep the one with higher confidence.
 */
export function mergeColor(existing: ColorEntry[], incoming: ColorEntry): ColorEntry[] {
  const idx = existing.findIndex(
    (e) => e.role === incoming.role && e.role !== "unknown" && colorThemeKey(e) === colorThemeKey(incoming)
  );

  if (idx === -1) {
    return [...existing, incoming];
  }

  const current = existing[idx];
  if (
    SOURCE_RANK[incoming.source] > SOURCE_RANK[current.source] ||
    (incoming.source === current.source &&
      CONFIDENCE_RANK[incoming.confidence] > CONFIDENCE_RANK[current.confidence])
  ) {
    const result = [...existing];
    result[idx] = incoming;
    return result;
  }

  return existing;
}

/**
 * Merge a new typography entry into an existing array.
 * Match by family name (case-insensitive).
 */
export function mergeTypography(
  existing: TypographyEntry[],
  incoming: TypographyEntry
): TypographyEntry[] {
  const idx = existing.findIndex(
    (e) => e.family.toLowerCase() === incoming.family.toLowerCase() && e.name === incoming.name
  );

  if (idx === -1) {
    return [...existing, incoming];
  }

  const current = existing[idx];
  if (
    SOURCE_RANK[incoming.source] > SOURCE_RANK[current.source] ||
    (incoming.source === current.source &&
      CONFIDENCE_RANK[incoming.confidence] > CONFIDENCE_RANK[current.confidence])
  ) {
    const result = [...existing];
    result[idx] = incoming;
    return result;
  }

  return existing;
}

export function mergeColorWithPriority(
  existing: ColorEntry[],
  incoming: ColorEntry,
  priority: Source[] = DEFAULT_SOURCE_PRIORITY,
): ColorEntry[] {
  const idx = existing.findIndex(
    (e) => e.role === incoming.role && e.role !== "unknown" && colorThemeKey(e) === colorThemeKey(incoming)
  );

  if (idx === -1) {
    return [...existing, incoming];
  }

  const current = existing[idx];
  if (
    sourcePriorityRank(incoming.source, priority) > sourcePriorityRank(current.source, priority) ||
    (incoming.source === current.source &&
      CONFIDENCE_RANK[incoming.confidence] > CONFIDENCE_RANK[current.confidence])
  ) {
    const result = [...existing];
    result[idx] = incoming;
    return result;
  }

  return existing;
}

export function mergeTypographyWithPriority(
  existing: TypographyEntry[],
  incoming: TypographyEntry,
  priority: Source[] = DEFAULT_SOURCE_PRIORITY,
): TypographyEntry[] {
  const idx = existing.findIndex(
    (e) => e.family.toLowerCase() === incoming.family.toLowerCase() && e.name === incoming.name
  );

  if (idx === -1) {
    return [...existing, incoming];
  }

  const current = existing[idx];
  if (
    sourcePriorityRank(incoming.source, priority) > sourcePriorityRank(current.source, priority) ||
    (incoming.source === current.source &&
      CONFIDENCE_RANK[incoming.confidence] > CONFIDENCE_RANK[current.confidence])
  ) {
    const result = [...existing];
    result[idx] = incoming;
    return result;
  }

  return existing;
}
