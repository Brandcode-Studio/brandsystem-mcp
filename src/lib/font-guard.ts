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
import { isPlausibleFontName } from "./untrusted-text.js";

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
  if (rejected.length === 0) return identity;
  const cleaned: CoreIdentityData = { ...identity, typography: kept };
  await brandDir.writeCoreIdentity(cleaned);
  await recordRejectedFonts(brandDir, rejected);
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
