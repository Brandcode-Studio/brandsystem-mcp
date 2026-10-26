import type { Confidence, Source, ColorEntry, TypographyEntry } from "../types/index.js";
import { isPlausibleFontName } from "./untrusted-text.js";
import { colorDeltaE, variantRoleFor } from "./color-roles.js";

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
 * Role-variant promotion (issue #93) — evidence threshold.
 *
 * A same-role, same-theme color that loses the base (role, theme) slot is
 * promoted to that role's variant slot (see lib/color-roles.ts) only when ALL
 * of these hold, so extraction noise cannot inflate the palette:
 *  - it carries at least `medium` confidence — the same bar as token-worthiness,
 *    i.e. independent evidence beyond a single computed/low-signal sighting;
 *  - it comes from the same source-precedence tier as the base slot holder
 *    (a lower-precedence source never adds variants to an authoritative
 *    palette — web sightings don't extend a Figma- or guidelines-defined one);
 *  - it is perceptually distinct from the base color (CIE76 ΔE >= 3, above the
 *    ~2.3 just-noticeable difference), so near-duplicates don't double up;
 *  - its value is not already in the palette for that theme.
 * Only ONE variant per (base role, theme): a contest for the variant slot is
 * resolved with the same precedence/confidence rules as the base slot.
 */
export const VARIANT_MIN_CONFIDENCE: Confidence = "medium";
export const VARIANT_MIN_DELTA_E = 3;

type RankFn = (source: Source) => number;

function sameSlot(e: ColorEntry, role: ColorEntry["role"], theme: "default" | "dark"): boolean {
  return e.role === role && e.role !== "unknown" && colorThemeKey(e) === theme;
}

/** Does `incoming` beat `current` for a slot? Source precedence, then confidence. */
function wins(incoming: ColorEntry, current: ColorEntry, rank: RankFn): boolean {
  return (
    rank(incoming.source) > rank(current.source) ||
    (incoming.source === current.source &&
      CONFIDENCE_RANK[incoming.confidence] > CONFIDENCE_RANK[current.confidence])
  );
}

function qualifiesAsVariant(
  candidate: ColorEntry,
  base: ColorEntry,
  palette: ColorEntry[],
  rank: RankFn,
): boolean {
  if (CONFIDENCE_RANK[candidate.confidence] < CONFIDENCE_RANK[VARIANT_MIN_CONFIDENCE]) return false;
  if (rank(candidate.source) !== rank(base.source)) return false;
  if (colorDeltaE(candidate.value, base.value) < VARIANT_MIN_DELTA_E) return false;
  const theme = colorThemeKey(candidate);
  const value = candidate.value.toLowerCase();
  return !palette.some((e) => colorThemeKey(e) === theme && e.value.toLowerCase() === value);
}

/**
 * Offer the loser of a base-slot contest to the variant slot. Returns the
 * palette unchanged when the candidate does not clear the evidence threshold
 * or loses the (single) variant slot to its current holder.
 */
function offerVariant(
  palette: ColorEntry[],
  candidate: ColorEntry,
  base: ColorEntry,
  rank: RankFn,
): ColorEntry[] {
  const variantRole = variantRoleFor(candidate.role);
  if (!variantRole) return palette;
  if (!qualifiesAsVariant(candidate, base, palette, rank)) return palette;

  const promoted: ColorEntry = { ...candidate, role: variantRole };
  const theme = colorThemeKey(candidate);
  const idx = palette.findIndex((e) => sameSlot(e, variantRole, theme));
  if (idx === -1) return [...palette, promoted];
  if (!wins(promoted, palette[idx], rank)) return palette;
  const result = [...palette];
  result[idx] = promoted;
  return result;
}

function mergeColorRanked(existing: ColorEntry[], incoming: ColorEntry, rank: RankFn): ColorEntry[] {
  const theme = colorThemeKey(incoming);
  const idx = existing.findIndex((e) => sameSlot(e, incoming.role, theme));

  if (idx === -1) {
    return [...existing, incoming];
  }

  const current = existing[idx];
  if (wins(incoming, current, rank)) {
    // Base-slot selection is unchanged from the pre-#93 behaviour; the
    // displaced incumbent may now survive as the variant instead of vanishing.
    const result = [...existing];
    result[idx] = incoming;
    return offerVariant(result, current, incoming, rank);
  }

  return offerVariant(existing, incoming, current, rank);
}

/**
 * Merge a new color entry into an existing array.
 * Slots are keyed on (role, theme) — one color per role per theme.
 * If a color with the same (role, theme) exists and the new source has higher
 * precedence, replace it. If same source, keep the one with higher confidence.
 * The losing color may be promoted to the role's variant slot (issue #93)
 * when it clears the evidence threshold above.
 */
export function mergeColor(existing: ColorEntry[], incoming: ColorEntry): ColorEntry[] {
  return mergeColorRanked(existing, incoming, (s) => SOURCE_RANK[s]);
}

/**
 * Font names are the one free-text identity field every extractor (web CSS,
 * computed/visual styles, Figma, PDF) feeds straight into core identity, and
 * from there into DESIGN.md, brand-runtime.json, and pasteable instruction
 * blocks. Both typography merges below are therefore the gate: an entry whose
 * family is not shaped like a font name (see isPlausibleFontName) is kept OUT
 * of the identity and reported to the optional `rejected` sink so the caller
 * can route it to needs-clarification instead of losing it silently.
 */
function rejectImplausibleFont(incoming: TypographyEntry, rejected?: TypographyEntry[]): boolean {
  if (isPlausibleFontName(incoming.family)) return false;
  rejected?.push(incoming);
  return true;
}

/**
 * Merge a new typography entry into an existing array.
 * Match by family name (case-insensitive).
 * Implausible family names are rejected (see rejectImplausibleFont).
 */
export function mergeTypography(
  existing: TypographyEntry[],
  incoming: TypographyEntry,
  rejected?: TypographyEntry[],
): TypographyEntry[] {
  if (rejectImplausibleFont(incoming, rejected)) return existing;
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
  return mergeColorRanked(existing, incoming, (s) => sourcePriorityRank(s, priority));
}

export function mergeTypographyWithPriority(
  existing: TypographyEntry[],
  incoming: TypographyEntry,
  priority: Source[] = DEFAULT_SOURCE_PRIORITY,
  rejected?: TypographyEntry[],
): TypographyEntry[] {
  if (rejectImplausibleFont(incoming, rejected)) return existing;
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
