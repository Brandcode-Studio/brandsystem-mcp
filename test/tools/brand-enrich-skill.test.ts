/**
 * Unit tests for the SKILL.md Enricher core (src/lib/enrich-skill/).
 *
 * The full tool handler is covered by integration tests against a real
 * `.brand/` fixture; the unit tests here focus on the parser + enrichment
 * logic since those carry the most nontrivial behavior.
 */
import { describe, it, expect } from "vitest";
import {
  parseSkillMd,
  serializeSkillMd,
  slugifyHeading,
} from "../../src/lib/enrich-skill/parser.js";
import {
  enrichSkill,
  formatDiffSummary,
  type GovernanceBundle,
} from "../../src/lib/enrich-skill/enrichment.js";

// ── Fixtures ────────────────────────────────────────────────────────

const MINIMAL_SKILL = `---
name: example-brand
description: An example brand
user-invocable: true
---

Some prose preamble.

## Hard rules

1. No drop shadows.
`;

function makeBundle(overrides: Partial<GovernanceBundle> = {}): GovernanceBundle {
  return {
    brandSlug: "test",
    brandName: "Test",
    narratives: {
      entries: [
        {
          id: "nl-001",
          name: "Tagline",
          type: "Brand Phrase",
          status: "Active",
          canonical_text: "Best Story Wins",
          usage_notes: "Flagship",
        },
        {
          id: "nl-002",
          name: "Message",
          type: "Key Message",
          status: "Active",
          canonical_text: "Content that compounds",
        },
        {
          id: "nl-retired",
          name: "Old one",
          type: "Brand Phrase",
          status: "Retired",
          canonical_text: "Old",
        },
      ],
    },
    proofPoints: {
      claims: [
        {
          id: "claim-001",
          title: "91% of enterprise teams have adopted AI tools",
          status: "Active",
          confidence: 0.95,
          salience: "Lead With",
        },
        {
          id: "claim-002",
          title: "Some hedged claim",
          status: "Watch",
          confidence: 0.7,
        },
        { id: "claim-retired", title: "Retired proof", status: "Retired" },
      ],
    },
    antiPatterns: {
      anti_patterns: [
        {
          id: "ap-001",
          rule: "Never use ghost or outline text as decoration",
          category: "visual",
          status: "Active",
        },
      ],
    },
    applicationRules: {
      rules: [
        {
          id: "ar-001",
          name: "Blog or Thought Leadership",
          framework: "Insight Narrative",
          required_elements: ["Problem", "Guide"],
          status: "Active",
        },
      ],
    },
    tasteCodes: null,
    ...overrides,
  };
}

// ── Parser ──────────────────────────────────────────────────────────

describe("parseSkillMd", () => {
  it("parses frontmatter + sections", () => {
    const parsed = parseSkillMd(MINIMAL_SKILL);
    expect(parsed.frontmatter?.name).toBe("example-brand");
    expect(parsed.sections.length).toBe(1);
    expect(parsed.sections[0].heading).toBe("Hard rules");
    expect(parsed.sections[0].slug).toBe("hard-rules");
  });

  it("tolerates SKILL.md with no frontmatter", () => {
    const parsed = parseSkillMd("## Only section\n\nBody.");
    expect(parsed.frontmatter).toBeNull();
    expect(parsed.sections.length).toBe(1);
  });

  it("slugifyHeading handles punctuation", () => {
    expect(slugifyHeading("Proof Points")).toBe("proof-points");
    expect(slugifyHeading("Hard don'ts")).toBe("hard-don-ts");
  });

  it("serializes round-trip", () => {
    const parsed = parseSkillMd(MINIMAL_SKILL);
    const out = serializeSkillMd(parsed);
    expect(out).toMatch(/^---\nname: example-brand/);
    expect(out).toMatch(/## Hard rules\n\n1\. No drop shadows\./);
  });
});

// ── Enrichment ──────────────────────────────────────────────────────

describe("enrichSkill", () => {
  it("adds narratives, proofs, anti-patterns, and application rules", () => {
    const { enriched, diff } = enrichSkill(MINIMAL_SKILL, makeBundle());
    expect(enriched).toMatch(/Best Story Wins/);
    expect(enriched).toMatch(/91% of enterprise teams/);
    expect(enriched).toMatch(/ghost or outline text/);
    expect(enriched).toMatch(/Blog or Thought Leadership/);
    expect(diff.narrativesAdded).toBe(2);
    expect(diff.proofsAdded).toBe(2);
    expect(diff.antiPatternsAdded).toBe(1);
    expect(diff.applicationRulesAdded).toBe(1);
  });

  it("flags Watch claims with hedge language", () => {
    const { enriched } = enrichSkill(MINIMAL_SKILL, makeBundle());
    expect(enriched).toMatch(/hedge when citing/);
  });

  it("excludes Retired entries", () => {
    const { enriched } = enrichSkill(MINIMAL_SKILL, makeBundle());
    expect(enriched).not.toMatch(/Retired phrase|Retired proof|Old one/);
  });

  it("does not duplicate entries already present in the input", () => {
    const withNarr = `${MINIMAL_SKILL}\n## Narratives\n\n- Best Story Wins — our tagline\n`;
    const { enriched, diff } = enrichSkill(withNarr, makeBundle());
    expect(diff.narrativesAlreadyPresent).toBeGreaterThanOrEqual(1);
    expect((enriched.match(/Best Story Wins/g) || []).length).toBe(1);
  });

  it("appends to existing guardrail-like section instead of creating a duplicate", () => {
    const withGuards = `${MINIMAL_SKILL}\n## Guardrails\n\n- Existing rule\n`;
    const { enriched } = enrichSkill(withGuards, makeBundle());
    expect((enriched.match(/## Guardrails/g) || []).length).toBe(1);
    expect((enriched.match(/## Anti-patterns/g) || []).length).toBe(0);
    expect(enriched).toMatch(/ghost or outline text/);
    expect(enriched).toMatch(/injected by brandcode brand_enrich_skill/);
  });

  it("preserves original content verbatim", () => {
    const { enriched } = enrichSkill(MINIMAL_SKILL, makeBundle());
    expect(enriched).toMatch(/Some prose preamble\./);
    expect(enriched).toMatch(/## Hard rules/);
    expect(enriched).toMatch(/1\. No drop shadows\./);
  });

  it("emits a provenance footer with brand slug", () => {
    const { enriched } = enrichSkill(MINIMAL_SKILL, makeBundle());
    expect(enriched).toMatch(/Enriched by Brandcode MCP against brand `test`/);
  });

  it("honors maxPerSection cap with a warning", () => {
    const big = makeBundle({
      antiPatterns: {
        anti_patterns: Array.from({ length: 30 }, (_, i) => ({
          id: `ap-${i}`,
          rule: `Rule number ${i}`,
          status: "Active",
        })),
      },
    });
    const { diff } = enrichSkill(MINIMAL_SKILL, big, { maxPerSection: 5 });
    expect(diff.antiPatternsAdded).toBe(5);
    expect(diff.warnings.some((w) => w.includes("capped"))).toBe(true);
  });

  it("handles empty governance gracefully", () => {
    const empty: GovernanceBundle = {
      brandSlug: "x",
      brandName: "X",
      narratives: null,
      proofPoints: null,
      antiPatterns: null,
      applicationRules: null,
      tasteCodes: null,
    };
    const { enriched, diff } = enrichSkill(MINIMAL_SKILL, empty);
    expect(diff.narrativesAdded).toBe(0);
    expect(diff.proofsAdded).toBe(0);
    expect(diff.antiPatternsAdded).toBe(0);
    // Footer is always emitted even when nothing was added
    expect(enriched).toMatch(/Enriched by Brandcode MCP against brand `x`/);
  });

  it("formatDiffSummary renders the counts", () => {
    const { diff } = enrichSkill(MINIMAL_SKILL, makeBundle());
    const summary = formatDiffSummary(diff);
    expect(summary).toMatch(/Narratives/);
    expect(summary).toMatch(/Proof points/);
    expect(summary).toMatch(/Anti-patterns/);
  });
});
