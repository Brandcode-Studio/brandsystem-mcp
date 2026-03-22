import type { Confidence, Source, ColorEntry, TypographyEntry } from "../types/index.js";

/** Source precedence: figma > manual > web */
const SOURCE_RANK: Record<Source, number> = {
  figma: 3,
  manual: 2,
  web: 1,
};

const CONFIDENCE_RANK: Record<Confidence, number> = {
  confirmed: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export function sourceWins(a: Source, b: Source): Source {
  return SOURCE_RANK[a] >= SOURCE_RANK[b] ? a : b;
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
 * Merge a new color entry into an existing array.
 * If a color with the same role exists and the new source has higher precedence, replace it.
 * If same source, keep the one with higher confidence.
 */
export function mergeColor(existing: ColorEntry[], incoming: ColorEntry): ColorEntry[] {
  const idx = existing.findIndex(
    (e) => e.role === incoming.role && e.role !== "unknown"
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
