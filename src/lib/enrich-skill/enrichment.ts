/**
 * SKILL.md Enricher core — ported from UCS brand-os/lib/skill-enrichment.mjs
 * with TypeScript types.
 *
 * Strategy:
 *   - ADDITIVE, never destructive — existing content preserved verbatim.
 *   - MATCH BEFORE INJECT — substring-check canonical text; matches increment
 *     alreadyPresent, misses become injection candidates.
 *   - CITE EVERY INJECTION — each injected bullet carries its governance ID.
 *   - ONE SECTION PER GOVERNANCE TYPE — tolerant section candidates absorb
 *     existing sections ("Hard rules", "Guardrails") instead of duplicating.
 *
 * Pure — no IO. Call sites load YAML and pass parsed objects.
 */

import { parseSkillMd, serializeSkillMd, slugifyHeading, type ParsedSkill } from "./parser.js";

// ── Governance shapes (permissive — governance YAML evolves) ──
export interface GovernanceClaim {
  id?: string;
  title?: string;
  status?: string;
  confidence?: number;
  salience?: string;
}

export interface GovernanceNarrativeEntry {
  id?: string;
  name?: string;
  type?: string;
  status?: string;
  canonical_text?: string;
  usage_notes?: string;
}

export interface GovernanceAntiPattern {
  id?: string;
  rule?: string;
  category?: string;
  status?: string;
}

export interface GovernanceApplicationRule {
  id?: string;
  name?: string;
  framework?: string;
  required_elements?: string[];
  status?: string;
}

export interface GovernanceTasteEntry {
  id?: string;
  rule?: string;
  title?: string;
}

export interface GovernanceBundle {
  narratives: { entries?: GovernanceNarrativeEntry[] } | null;
  proofPoints: { claims?: GovernanceClaim[] } | null;
  antiPatterns: { anti_patterns?: GovernanceAntiPattern[] } | null;
  applicationRules: { rules?: GovernanceApplicationRule[] } | null;
  tasteCodes:
    | { entries?: GovernanceTasteEntry[]; taste_codes?: GovernanceTasteEntry[] }
    | GovernanceTasteEntry[]
    | null;
  brandSlug: string;
  brandName: string;
}

export interface EnrichmentDiff {
  narrativesAdded: number;
  narrativesAlreadyPresent: number;
  proofsAdded: number;
  proofsAlreadyPresent: number;
  antiPatternsAdded: number;
  antiPatternsAlreadyPresent: number;
  applicationRulesAdded: number;
  tasteNotesAdded: number;
  conflicts: string[];
  warnings: string[];
}

export interface EnrichmentOptions {
  includeApplicationRules?: boolean;
  maxPerSection?: number;
}

export interface EnrichmentResult {
  enriched: string;
  diff: EnrichmentDiff;
}

const SECTION_CANDIDATES = {
  narratives: ["narratives", "narrative", "brand-phrases", "messaging", "messages"],
  proofPoints: ["proof-points", "proofs", "evidence", "claims", "stats", "statistics"],
  antiPatterns: [
    "anti-patterns",
    "antipatterns",
    "guardrails",
    "hard-rules",
    "hard-don-ts",
    "hard-don-t",
    "dont-s",
    "dos-and-don-ts",
    "do-not",
    "avoid",
  ],
  applicationRules: ["application-rules", "content-routing", "content-types"],
  tasteNotes: ["taste-notes", "taste-codes", "distinctiveness", "taste"],
} as const;

const SECTION_TITLES = {
  narratives: "Narratives",
  proofPoints: "Proof points",
  antiPatterns: "Anti-patterns",
  applicationRules: "Application rules",
  tasteNotes: "Taste notes",
} as const;

export function enrichSkill(
  inputMd: string,
  bundle: GovernanceBundle,
  opts: EnrichmentOptions = {},
): EnrichmentResult {
  const { includeApplicationRules = true, maxPerSection = 12 } = opts;
  const parsed = parseSkillMd(inputMd);
  const haystack = inputMd.toLowerCase();

  const diff: EnrichmentDiff = {
    narrativesAdded: 0,
    narrativesAlreadyPresent: 0,
    proofsAdded: 0,
    proofsAlreadyPresent: 0,
    antiPatternsAdded: 0,
    antiPatternsAlreadyPresent: 0,
    applicationRulesAdded: 0,
    tasteNotesAdded: 0,
    conflicts: [],
    warnings: [],
  };

  // Narratives
  const narrativeEntries = bundle.narratives?.entries ?? [];
  const narrativeBullets: string[] = [];
  for (const entry of narrativeEntries) {
    if (entry.status && entry.status !== "Active") continue;
    const canonical = entry.canonical_text || entry.name || "";
    if (!canonical) continue;
    if (haystack.includes(canonical.toLowerCase())) {
      diff.narrativesAlreadyPresent++;
      continue;
    }
    if (narrativeBullets.length >= maxPerSection) {
      diff.warnings.push(
        `Narrative library has more than ${maxPerSection} Active entries; capped injection.`,
      );
      break;
    }
    const type = entry.type || "Narrative";
    const note = entry.usage_notes ? ` — ${entry.usage_notes}` : "";
    narrativeBullets.push(
      `- **${canonical}** _(${type}${entry.id ? `, ${entry.id}` : ""})_${note}`,
    );
    diff.narrativesAdded++;
  }

  // Proof points
  const claims = bundle.proofPoints?.claims ?? [];
  const proofBullets: string[] = [];
  for (const claim of claims) {
    if (claim.status !== "Active" && claim.status !== "Watch") continue;
    const title = claim.title || "";
    if (!title) continue;
    const probe = title.slice(0, Math.min(40, title.length)).toLowerCase();
    if (haystack.includes(probe)) {
      diff.proofsAlreadyPresent++;
      continue;
    }
    if (proofBullets.length >= maxPerSection) {
      diff.warnings.push(
        `Proof point library has more than ${maxPerSection} entries; capped injection.`,
      );
      break;
    }
    const meta = [
      claim.id,
      claim.status,
      claim.confidence != null ? `confidence ${claim.confidence}` : null,
      claim.salience,
    ]
      .filter(Boolean)
      .join(", ");
    const hedge = claim.status === "Watch" ? " **(hedge when citing)**" : "";
    proofBullets.push(`- ${title}${hedge} _(${meta})_`);
    diff.proofsAdded++;
  }

  // Anti-patterns
  const antiEntries = bundle.antiPatterns?.anti_patterns ?? [];
  const antiBullets: string[] = [];
  for (const ap of antiEntries) {
    if (ap.status && ap.status !== "Active") continue;
    const rule = ap.rule || "";
    if (!rule) continue;
    const probe = rule.slice(0, Math.min(40, rule.length)).toLowerCase();
    if (haystack.includes(probe)) {
      diff.antiPatternsAlreadyPresent++;
      continue;
    }
    if (antiBullets.length >= maxPerSection) {
      diff.warnings.push(
        `Anti-pattern library has more than ${maxPerSection} Active entries; capped injection.`,
      );
      break;
    }
    const category = ap.category ? ` \`${ap.category}\`` : "";
    antiBullets.push(`- ${rule}${category} _(${ap.id || "anti-pattern"})_`);
    diff.antiPatternsAdded++;
  }

  // Application rules (optional)
  const appBullets: string[] = [];
  if (includeApplicationRules) {
    const rules = bundle.applicationRules?.rules ?? [];
    for (const rule of rules) {
      if (rule.status && rule.status !== "Active") continue;
      const name = rule.name || rule.id;
      if (!name) continue;
      if (appBullets.length >= maxPerSection) break;
      const framework = rule.framework ? ` → ${rule.framework}` : "";
      const required = Array.isArray(rule.required_elements)
        ? ` (required: ${rule.required_elements.join(" + ")})`
        : "";
      appBullets.push(`- **${name}**${framework}${required} _(${rule.id || "rule"})_`);
      diff.applicationRulesAdded++;
    }
  }

  // Taste notes
  const tasteEntries = extractTasteEntries(bundle.tasteCodes);
  const tasteBullets: string[] = [];
  for (const t of tasteEntries) {
    if (tasteBullets.length >= maxPerSection) break;
    const rule = t.rule || t.title || "";
    if (!rule) continue;
    const probe = rule.slice(0, Math.min(40, rule.length)).toLowerCase();
    if (haystack.includes(probe)) continue;
    tasteBullets.push(`- ${rule}${t.id ? ` _(${t.id})_` : ""}`);
    diff.tasteNotesAdded++;
  }

  // Inject
  injectOrAppend(parsed, SECTION_TITLES.narratives, SECTION_CANDIDATES.narratives, narrativeBullets, {
    preamble: "Brand phrases are used verbatim. Never paraphrase.",
  });
  injectOrAppend(parsed, SECTION_TITLES.proofPoints, SECTION_CANDIDATES.proofPoints, proofBullets, {
    preamble:
      "**Active** claims deploy without qualification. **Watch** claims require hedge language.",
  });
  injectOrAppend(
    parsed,
    SECTION_TITLES.antiPatterns,
    SECTION_CANDIDATES.antiPatterns,
    antiBullets,
    {
      preamble: "Treat these as hard rules. Any violation is a compile-fail equivalent.",
    },
  );
  if (includeApplicationRules && appBullets.length > 0) {
    injectOrAppend(
      parsed,
      SECTION_TITLES.applicationRules,
      SECTION_CANDIDATES.applicationRules,
      appBullets,
      {
        preamble:
          "Content type → narrative framework + required elements. Route every piece of copy through these.",
      },
    );
  }
  if (tasteBullets.length > 0) {
    injectOrAppend(parsed, SECTION_TITLES.tasteNotes, SECTION_CANDIDATES.tasteNotes, tasteBullets, {
      preamble:
        "Distinctiveness signals — what makes this brand feel itself vs. correct-but-generic.",
    });
  }

  // Provenance footer
  const footer = buildProvenanceFooter(bundle, diff);
  parsed.trailing = (parsed.trailing ? `${parsed.trailing}\n\n` : "") + footer;

  return { enriched: serializeSkillMd(parsed), diff };
}

export function formatDiffSummary(diff: EnrichmentDiff): string {
  const lines = [
    `Narratives:        +${diff.narrativesAdded} added, ${diff.narrativesAlreadyPresent} already present`,
    `Proof points:      +${diff.proofsAdded} added, ${diff.proofsAlreadyPresent} already present`,
    `Anti-patterns:     +${diff.antiPatternsAdded} added, ${diff.antiPatternsAlreadyPresent} already present`,
    `Application rules: +${diff.applicationRulesAdded} added`,
    `Taste notes:       +${diff.tasteNotesAdded} added`,
  ];
  if (diff.warnings.length) {
    lines.push("", "Warnings:");
    for (const w of diff.warnings) lines.push(`  - ${w}`);
  }
  return lines.join("\n");
}

// ── Helpers ────────────────────────────────────────────────────────

function injectOrAppend(
  parsed: ParsedSkill,
  title: string,
  candidateSlugs: ReadonlyArray<string>,
  bullets: string[],
  opts: { preamble?: string } = {},
): void {
  if (!bullets || bullets.length === 0) return;
  const slug = slugifyHeading(title);
  const allSlugs = new Set<string>([slug, ...candidateSlugs]);
  const existing = parsed.sections.find((s) => allSlugs.has(s.slug));
  const block: string[] = [];
  if (opts.preamble) {
    block.push(opts.preamble);
    block.push("");
  }
  block.push(...bullets);
  if (existing) {
    existing.content = `${existing.content}\n\n<!-- injected by brandcode brand_enrich_skill -->\n${block.join("\n")}`.trim();
  } else {
    parsed.sections.push({
      heading: title,
      slug,
      level: 2,
      startLine: -1,
      endLine: -1,
      content: block.join("\n"),
      raw: "",
    });
  }
}

function extractTasteEntries(tasteCodes: GovernanceBundle["tasteCodes"]): GovernanceTasteEntry[] {
  if (!tasteCodes) return [];
  if (Array.isArray(tasteCodes)) return tasteCodes;
  if (Array.isArray(tasteCodes.entries)) return tasteCodes.entries;
  if (Array.isArray(tasteCodes.taste_codes)) return tasteCodes.taste_codes;
  return [];
}

function buildProvenanceFooter(bundle: GovernanceBundle, diff: EnrichmentDiff): string {
  const total =
    diff.narrativesAdded +
    diff.proofsAdded +
    diff.antiPatternsAdded +
    diff.applicationRulesAdded +
    diff.tasteNotesAdded;
  const timestamp = new Date().toISOString();
  return [
    "---",
    "",
    `_Enriched by Brandcode MCP against brand \`${bundle.brandSlug}\` — ${total} entries added, ${timestamp}._`,
    "_Source: governance files under `.brand/governance/`. Call `brand_enrich_skill` again after governance updates._",
    "",
  ].join("\n");
}
