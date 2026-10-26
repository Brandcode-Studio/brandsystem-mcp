/**
 * Routing for font names rejected by the identity gate.
 *
 * mergeTypography / mergeTypographyWithPriority (confidence.ts) keep any
 * font family that is not shaped like a font name (isPlausibleFontName) out
 * of core identity — such values are typically injected instructions, not
 * fonts. Rather than dropping them silently, extraction tools record a single
 * needs-clarification item asking the user for the real brand font. The
 * rejected text itself is never echoed: the question names only the source
 * channels, so the clarification queue cannot become an injection channel.
 *
 * Compile (brand_compile, brand_start auto mode) regenerates
 * needs-clarification.yaml from scratch, so it carries this item forward and
 * also re-applies the gate to the stored identity (covering identities
 * written before the gate existed or edited by hand).
 */
import type { BrandDir } from "./brand-dir.js";
import type { ClarificationItem, TypographyEntry } from "../types/index.js";
import type { CoreIdentityData, NeedsClarificationData } from "../schemas/index.js";
import { createHash } from "node:crypto";
import { isPlausibleFontName, isPlausibleStyleName } from "./untrusted-text.js";

export const REJECTED_FONT_CLARIFICATION_ID = "clarify-font-rejected";
export const FONT_GUARD_SOURCE = "extraction-guard";

const KNOWN_SOURCES = new Set(["web", "visual", "figma", "guidelines", "manual"]);

function sourcesFromQuestion(question: string): string[] {
  const match = question.match(/\(from: ([a-z, ]+)\)/);
  if (!match) return [];
  return match[1].split(",").map((s) => s.trim()).filter((s) => KNOWN_SOURCES.has(s));
}

/** The single clarification item for rejected font names. */
export function rejectedFontClarification(sources: Iterable<string>): ClarificationItem {
  const from = [...new Set([...sources].filter((s) => KNOWN_SOURCES.has(s)))].sort().join(", ");
  return {
    id: REJECTED_FONT_CLARIFICATION_ID,
    field: "typography",
    question:
      `One or more extracted font-family values${from ? ` (from: ${from})` : ""} did not look like font names ` +
      "(they may contain injected text) and were kept out of the brand identity. What font family does your brand use?",
    source: FONT_GUARD_SOURCE,
    priority: "medium",
  };
}

async function readClarificationsOrEmpty(brandDir: BrandDir): Promise<NeedsClarificationData> {
  try {
    return await brandDir.readClarifications();
  } catch {
    return { schema_version: "0.1.0", items: [] };
  }
}

/**
 * Upsert the rejected-font clarification into needs-clarification.yaml.
 * No-op when nothing was rejected.
 */
export async function recordRejectedFonts(brandDir: BrandDir, rejected: TypographyEntry[]): Promise<void> {
  if (rejected.length === 0) return;
  const data = await readClarificationsOrEmpty(brandDir);
  const prior = data.items.find((i) => i.id === REJECTED_FONT_CLARIFICATION_ID);
  const sources = [...(prior ? sourcesFromQuestion(prior.question) : []), ...rejected.map((r) => r.source)];
  const item = rejectedFontClarification(sources);
  data.items = [...data.items.filter((i) => i.id !== REJECTED_FONT_CLARIFICATION_ID), item];
  await brandDir.writeClarifications(data);
}

/** Split typography into plausible entries and rejected ones. */
export function partitionTypography(entries: TypographyEntry[]): {
  kept: TypographyEntry[];
  rejected: TypographyEntry[];
} {
  const kept: TypographyEntry[] = [];
  const rejected: TypographyEntry[] = [];
  for (const entry of entries) (isPlausibleFontName(entry.family) ? kept : rejected).push(entry);
  return { kept, rejected };
}

/**
 * Compile-time gate: remove implausible font names from the stored identity
 * (rewriting core-identity.yaml when anything changes) and record the
 * clarification. Returns the cleaned identity.
 */
export async function enforceFontPlausibility(brandDir: BrandDir): Promise<CoreIdentityData> {
  const identity = await brandDir.readCoreIdentity();
  const { kept, rejected } = partitionTypography(identity.typography);
  // Style-name gate too (identities written before it existed, or hand-edited).
  const replacedStyleKeys: string[] = [];
  const guarded = kept.map((entry) => guardStyleName(entry, replacedStyleKeys));
  if (rejected.length === 0 && replacedStyleKeys.length === 0) return identity;
  const cleaned: CoreIdentityData = { ...identity, typography: guarded };
  await brandDir.writeCoreIdentity(cleaned);
  await recordRejectedFonts(brandDir, rejected);
  await recordReplacedStyleNames(brandDir, replacedStyleKeys);
  return cleaned;
}

/**
 * The pending rejected-font item from the current needs-clarification.yaml,
 * for compile steps that rebuild the file from scratch.
 */
export async function pendingRejectedFontItem(brandDir: BrandDir): Promise<ClarificationItem | null> {
  const data = await readClarificationsOrEmpty(brandDir);
  return data.items.find((i) => i.id === REJECTED_FONT_CLARIFICATION_ID) ?? null;
}

// ── Style-name guard ────────────────────────────────────────────
//
// Text-style names (Figma styles today) become typography entry NAMES, and
// entry names become keys in brand-runtime.json (`typography[name]`) and
// token names in tokens.json. Unlike a bad font family, a bad style name does
// not make the entry wrong — the family may be perfectly real — so the entry
// is kept under a generated safe key instead of being dropped. The original
// name is never echoed into the clarification question or any artifact.

export const REJECTED_STYLE_NAME_CLARIFICATION_ID = "clarify-style-name-rejected";
export const STYLE_NAME_CLARIFICATION_FIELD = "typography.style_names";

/**
 * Apply a user's answer to the style-name clarification: rename entries
 * stored under generated keys. Accepts "style-xxxxxxxx = Name" pairs
 * (comma/semicolon separated), a bare name when exactly one generated key
 * exists, or "keep". New names must themselves pass isPlausibleStyleName.
 * Returns human-readable change lines plus whether anything was unresolved.
 */
export function applyStyleNameAnswer(
  typography: TypographyEntry[],
  answer: string,
): { typography: TypographyEntry[]; changes: string[]; unresolved: string[] } {
  const generated = typography.filter((t) => /^style-[0-9a-f]{8}$/.test(t.name)).map((t) => t.name);
  const trimmed = answer.trim();
  if (/^(keep|ok|okay|fine|yes)$/i.test(trimmed)) {
    return { typography, changes: [`Kept generated style keys: ${generated.join(", ") || "(none)"}`], unresolved: [] };
  }

  const renames = new Map<string, string>();
  const pairs = [...trimmed.matchAll(/(style-[0-9a-f]{8})\s*(?:=|:|is|->|→)\s*([^,;]+)/gi)];
  if (pairs.length > 0) {
    for (const [, key, name] of pairs) renames.set(key.toLowerCase(), name.trim());
  } else if (generated.length === 1) {
    renames.set(generated[0], trimmed);
  }

  const changes: string[] = [];
  const unresolved: string[] = [];
  const next = typography.map((t) => {
    const name = renames.get(t.name);
    if (name === undefined) return t;
    if (!isPlausibleStyleName(name)) {
      unresolved.push(t.name);
      return t;
    }
    changes.push(`Renamed text style ${t.name} → ${name}`);
    return { ...t, name };
  });
  for (const key of generated) {
    if (!renames.has(key)) unresolved.push(key);
  }
  return { typography: next, changes, unresolved: [...new Set(unresolved)] };
}

/**
 * Deterministic safe key for an implausible style name. Stable across
 * re-ingests (same hostile name → same key) so the typography merge, which
 * matches on (family, name), does not accumulate duplicates.
 */
export function safeStyleKey(rawName: string): string {
  return `style-${createHash("sha256").update(rawName).digest("hex").slice(0, 8)}`;
}

/**
 * Return the entry unchanged when its name (and `figma_style_id`, which
 * carries the raw Figma style name) are plausible style names; otherwise
 * return a copy renamed to a safe generated key with `figma_style_id`
 * removed, and push the key to `replaced` so the caller can raise a
 * clarification.
 */
export function guardStyleName(entry: TypographyEntry, replaced?: string[]): TypographyEntry {
  const idOk = entry.figma_style_id === undefined || isPlausibleStyleName(entry.figma_style_id);
  if (idOk && isPlausibleStyleName(entry.name)) return entry;
  const key = safeStyleKey(entry.figma_style_id ?? entry.name);
  replaced?.push(key);
  const { figma_style_id: _dropped, ...rest } = entry;
  return { ...rest, name: key };
}

function styleKeysFromQuestion(question: string): string[] {
  return question.match(/style-[0-9a-f]{8}/g) ?? [];
}

/** The single clarification item for replaced style names. */
export function rejectedStyleNameClarification(keys: Iterable<string>): ClarificationItem {
  const list = [...new Set(keys)].filter((k) => /^style-[0-9a-f]{8}$/.test(k)).sort();
  return {
    id: REJECTED_STYLE_NAME_CLARIFICATION_ID,
    field: STYLE_NAME_CLARIFICATION_FIELD,
    question:
      `${list.length} text style name(s) did not look like style names (they may contain injected text) ` +
      `and were stored under generated keys${list.length ? ` (${list.join(", ")})` : ""}. ` +
      `The font families were kept. What should these text styles be called? ` +
      `Answer "style-xxxxxxxx = Heading 1" per key (comma-separated), a single name when there is one key, or "keep" to keep the generated keys.`,
    source: FONT_GUARD_SOURCE,
    priority: "medium",
  };
}

/**
 * Upsert the replaced-style-name clarification into needs-clarification.yaml.
 * No-op when nothing was replaced.
 */
export async function recordReplacedStyleNames(brandDir: BrandDir, replacedKeys: string[]): Promise<void> {
  if (replacedKeys.length === 0) return;
  const data = await readClarificationsOrEmpty(brandDir);
  const prior = data.items.find((i) => i.id === REJECTED_STYLE_NAME_CLARIFICATION_ID);
  const keys = [...(prior ? styleKeysFromQuestion(prior.question) : []), ...replacedKeys];
  const item = rejectedStyleNameClarification(keys);
  data.items = [...data.items.filter((i) => i.id !== REJECTED_STYLE_NAME_CLARIFICATION_ID), item];
  await brandDir.writeClarifications(data);
}

/**
 * Pending extraction-guard items (rejected fonts, replaced style names) from
 * the current needs-clarification.yaml, for compile steps that rebuild the
 * file from scratch.
 */
export async function pendingGuardItems(brandDir: BrandDir): Promise<ClarificationItem[]> {
  const data = await readClarificationsOrEmpty(brandDir);
  return data.items.filter(
    (i) => i.id === REJECTED_FONT_CLARIFICATION_ID || i.id === REJECTED_STYLE_NAME_CLARIFICATION_ID,
  );
}
