/**
 * Extraction quality corpus — deterministic, release-gating lane.
 *
 * Runs the real extraction pipeline (the same lib functions brand_extract_web
 * composes: css-parser → promote/role/confidence → color-namer → merge, plus
 * logo-extractor → svg-resolver) over frozen self-contained HTML fixtures in
 * test/fixtures/extraction-corpus/ and scores precision/recall against each
 * fixture's expected.json ground truth.
 *
 * This is the counterpart to scripts/extraction-canary.mjs (live-yield canary,
 * non-blocking). This lane is deterministic (no network) and runs in `npm test`,
 * so it gates releases.
 *
 * To dump measured actuals when updating fixtures or thresholds:
 *   EXTRACTION_MEASURE=1 npx vitest run test/extraction-quality.test.ts
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";
import {
  extractFromCSS,
  inferColorConfidence,
  inferColorRole,
  isChromatic,
  promotePrimaryColor,
  getTopChromaticCandidates,
} from "../src/lib/css-parser.js";
import { extractLogos, type ExtractedLogo } from "../src/lib/logo-extractor.js";
import { resolveSvg } from "../src/lib/svg-resolver.js";
import { mergeColor, mergeTypography, needsClarification, confidenceRank } from "../src/lib/confidence.js";
import { generateColorName, isCssArtifactName, cleanColorName } from "../src/lib/color-namer.js";
import { fenceUntrusted } from "../src/lib/untrusted-text.js";
import type { ColorEntry, TypographyEntry } from "../src/types/index.js";

const CORPUS_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "extraction-corpus");

// ── Expected.json shape ─────────────────────────────────────────

interface ExpectedColor {
  value: string;
  /** Acceptable role(s). Omit to skip role checking for this color. */
  role?: string | string[];
  /** Expected theme tag ("dark"). Omit for theme-agnostic/default entries,
   * which must NOT carry a theme tag. */
  theme?: string;
  /** Acceptable confidence tier(s). Omit to skip. */
  confidence?: string | string[];
  /** True = ground truth the extractor is KNOWN to miss. Excluded from the
   * recall denominator; documented rather than hidden. */
  known_gap?: boolean;
  note?: string;
}

interface ExpectedFixture {
  description: string;
  colors: ExpectedColor[];
  fonts: Array<{ family: string; confidence?: string | string[]; known_gap?: boolean; note?: string }>;
  suggested_primary: string | null;
  chromatic_candidates_include?: string[];
  logo: {
    inline_svg_found: boolean;
    chosen_type?: string;
    candidate_types_include?: string[];
    sanitized_must_contain?: string[];
    sanitized_must_not_contain?: string[];
  };
  clarifications: {
    count: number;
    question_substrings?: string[];
  };
  names_must_not_contain?: string[];
  thresholds: {
    color_precision: number;
    color_recall: number;
    role_accuracy: number;
    font_precision: number;
    font_recall: number;
  };
  known_gaps?: string[];
}

// ── Real extraction pipeline (mirrors brand-extract-web's offline path) ──

// Same selector list brand_extract_web uses for inline-style capture.
const INLINE_STYLE_SELECTORS = [
  "body", "header", "nav", "footer", "[class*=hero]", "[class*=banner]",
  "h1", "h2", "h3", "a", "button", "[class*=btn]", "[class*=cta]",
  "section", "[class*=elementor-section]", "[class*=sqs-block]",
];

interface ClarificationItem {
  field: string;
  question: string;
  priority: "high" | "medium";
}

interface ExtractionResult {
  colors: ColorEntry[];
  typography: TypographyEntry[];
  suggestedPrimary: string | null;
  chromaticCandidates: string[];
  logoCandidates: ExtractedLogo[];
  logoFound: boolean;
  chosenLogoType: string | null;
  sanitizedLogoSvg: string | null;
  clarifications: ClarificationItem[];
}

function extractIdentityFromHtml(html: string, baseUrl: string): ExtractionResult {
  const $ = cheerio.load(html);

  // CSS from <style> blocks (external stylesheets don't exist in fixtures — they
  // are self-contained by design).
  let allCSS = "";
  $("style").each((_, el) => {
    allCSS += $(el).text() + "\n";
  });

  // Inline styles from key semantic elements — same wrap the tool applies.
  const inlineCSS: string[] = [];
  for (const sel of INLINE_STYLE_SELECTORS) {
    $(sel).each((i, el) => {
      if (i >= 10) return false;
      const style = $(el).attr("style");
      if (style) inlineCSS.push(`${sel} { ${style} }`);
    });
  }
  if (inlineCSS.length > 0) {
    allCSS += "\n/* inline styles from HTML elements */\n" + inlineCSS.join("\n") + "\n";
  }

  const { colors: extractedColors, fonts: extractedFonts } = extractFromCSS(allCSS);

  const chromaticCandidates = getTopChromaticCandidates(extractedColors);
  const promotedColors = promotePrimaryColor(extractedColors);
  const autoPromoted = promotedColors.find(
    (c) => (c as unknown as { _promoted_role?: string })._promoted_role === "primary"
  );
  const suggestedPrimary = autoPromoted?.value ?? null;

  let colors: ColorEntry[] = [];
  for (const ec of promotedColors.slice(0, 20)) {
    const role = inferColorRole(ec as Parameters<typeof inferColorRole>[0]);
    const rawName = ec.property.startsWith("--")
      ? ec.property.replace(/^--/, "").replace(/[-_]/g, " ")
      : `${ec.property} ${ec.value}`;
    const name = isCssArtifactName(rawName, ec.value)
      ? generateColorName(ec.value, role)
      : rawName;
    const entry: ColorEntry = {
      name,
      value: ec.value,
      role,
      // Theme signal from css-parser dark-scope detection (issue #35 gap 1)
      ...(ec.theme ? { theme: ec.theme } : {}),
      source: "web",
      confidence: inferColorConfidence(ec),
      css_property: ec.property,
    };
    colors = mergeColor(colors, entry);
  }

  const cleanedFonts = extractedFonts.filter((f) => !f.family.startsWith("var("));
  let typography: TypographyEntry[] = [];
  for (const ef of cleanedFonts.slice(0, 8)) {
    const entry: TypographyEntry = {
      name: ef.family,
      family: ef.family,
      source: "web",
      confidence: ef.frequency >= 5 ? "high" : ef.frequency >= 2 ? "medium" : "low",
    };
    typography = mergeTypography(typography, entry);
  }

  // Logo: candidates from HTML. Offline lane resolves inline SVGs only —
  // remote candidates (img/favicon URLs) are recorded but never fetched,
  // exactly what the tool degrades to when fetches fail.
  const logoCandidates = extractLogos(html, baseUrl);
  let logoFound = false;
  let chosenLogoType: string | null = null;
  let sanitizedLogoSvg: string | null = null;
  for (const candidate of logoCandidates.slice(0, 5)) {
    if (candidate.inline_svg) {
      const { inline_svg } = resolveSvg(candidate.inline_svg);
      sanitizedLogoSvg = inline_svg;
      chosenLogoType = candidate.type;
      logoFound = true;
      break;
    }
  }

  // Clarification derivation — mirrors brand_compile (src/tools/brand-compile.ts).
  const clarifications: ClarificationItem[] = [];
  // Primary-color uncertainty (issue #41) — mirrors the clarify-primary item.
  const primaryColor = colors.find((c) => c.role === "primary");
  const primaryChromaticCandidates = colors.filter(
    (c) => c.role !== "primary" && isChromatic(c.value)
  );
  let primaryUncertain = false;
  if (!primaryColor) {
    primaryUncertain = true;
  } else if (primaryColor.confidence !== "confirmed" && primaryChromaticCandidates.length > 0) {
    primaryUncertain =
      !isChromatic(primaryColor.value) ||
      confidenceRank(primaryColor.confidence) < confidenceRank("high");
  }
  if (primaryUncertain) {
    const candidateList = primaryChromaticCandidates.map((c) => c.value).join(", ");
    let question: string;
    if (primaryColor) {
      question = `Primary color is uncertain: current primary is ${primaryColor.value} (name: ${fenceUntrusted(primaryColor.name, 60)}), but chromatic candidate(s) exist: ${candidateList}. Which is the true primary brand color?`;
    } else if (primaryChromaticCandidates.length > 0) {
      question = `No primary brand color identified. Chromatic candidate(s): ${candidateList}. Which color is your primary brand color?`;
    } else {
      question = "No primary brand color identified. Which color is your primary brand color?";
    }
    clarifications.push({
      field: "colors.primary",
      question,
      priority: "high",
    });
  }
  for (const color of colors) {
    if (needsClarification(color.confidence)) {
      if (color.role === "primary" && primaryUncertain) continue;
      clarifications.push({
        field: `colors.${color.role}`,
        question: `Color ${color.value} (name: ${fenceUntrusted(color.name, 60)}) has low confidence. Is this correct and what role does it play?`,
        priority: "medium",
      });
    }
  }
  if (typography.length === 0) {
    clarifications.push({
      field: "typography",
      question: "No fonts detected. What font family does your brand use?",
      priority: "high",
    });
  }
  for (const typo of typography) {
    if (needsClarification(typo.confidence)) {
      clarifications.push({
        field: `typography.${typo.family}`,
        question: `Font ${fenceUntrusted(typo.family, 60)} has low confidence. Is this your brand font?`,
        priority: "medium",
      });
    }
  }
  if (!logoFound) {
    clarifications.push({
      field: "logo",
      question: "No logo detected. Provide your logo as SVG for best results.",
      priority: "high",
    });
  }
  const unknownColors = colors.filter((c) => c.role === "unknown");
  if (unknownColors.length > 0) {
    clarifications.push({
      field: "colors.roles",
      question: `${unknownColors.length} color(s) have no assigned role: ${unknownColors.map((c) => c.value).join(", ")}. What role does each play?`,
      priority: "medium",
    });
  }

  return {
    colors,
    typography,
    suggestedPrimary,
    chromaticCandidates,
    logoCandidates,
    logoFound,
    chosenLogoType,
    sanitizedLogoSvg,
    clarifications,
  };
}

// ── Scoring ─────────────────────────────────────────────────────

function asList(v: string | string[] | undefined): string[] | null {
  if (v === undefined) return null;
  return Array.isArray(v) ? v : [v];
}

interface FixtureScore {
  colorPrecision: number;
  colorRecall: number;
  roleAccuracy: number;
  fontPrecision: number;
  fontRecall: number;
  roleMismatches: string[];
  themeMismatches: string[];
  confidenceMismatches: string[];
  falsePositiveColors: string[];
  missedColors: string[];
  falsePositiveFonts: string[];
  missedFonts: string[];
}

function scoreFixture(result: ExtractionResult, expected: ExpectedFixture): FixtureScore {
  const expectedByValue = new Map(expected.colors.map((c) => [c.value.toLowerCase(), c]));
  const extractedValues = result.colors.map((c) => c.value.toLowerCase());

  const matchedExtracted = extractedValues.filter((v) => expectedByValue.has(v));
  const colorPrecision = extractedValues.length === 0 ? 1 : matchedExtracted.length / extractedValues.length;

  const recallTargets = expected.colors.filter((c) => !c.known_gap);
  const matchedTargets = recallTargets.filter((c) =>
    extractedValues.includes(c.value.toLowerCase())
  );
  const colorRecall = recallTargets.length === 0 ? 1 : matchedTargets.length / recallTargets.length;

  const roleMismatches: string[] = [];
  const themeMismatches: string[] = [];
  const confidenceMismatches: string[] = [];
  let roleChecked = 0;
  let roleCorrect = 0;
  for (const c of result.colors) {
    const exp = expectedByValue.get(c.value.toLowerCase());
    if (!exp) continue;
    const roles = asList(exp.role);
    if (roles) {
      roleChecked++;
      if (roles.includes(c.role)) roleCorrect++;
      else roleMismatches.push(`${c.value}: expected role ${roles.join("|")}, got ${c.role}`);
    }
    // Theme dimension: expected theme must match exactly; entries the fixture
    // marks theme-agnostic (no theme field) must not carry a tag.
    if ((exp.theme ?? undefined) !== (c.theme ?? undefined)) {
      themeMismatches.push(`${c.value}: expected theme ${exp.theme ?? "(none)"}, got ${c.theme ?? "(none)"}`);
    }
    const tiers = asList(exp.confidence);
    if (tiers && !tiers.includes(c.confidence)) {
      confidenceMismatches.push(`${c.value}: expected confidence ${tiers.join("|")}, got ${c.confidence}`);
    }
  }
  const roleAccuracy = roleChecked === 0 ? 1 : roleCorrect / roleChecked;

  const expectedFonts = new Map(expected.fonts.map((f) => [f.family.toLowerCase(), f]));
  const extractedFontNames = result.typography.map((t) => t.family.toLowerCase());
  const fontMatched = extractedFontNames.filter((f) => expectedFonts.has(f));
  const fontPrecision = extractedFontNames.length === 0 ? 1 : fontMatched.length / extractedFontNames.length;
  const fontRecallTargets = expected.fonts.filter((f) => !f.known_gap);
  const fontRecall = fontRecallTargets.length === 0
    ? 1
    : fontRecallTargets.filter((f) => extractedFontNames.includes(f.family.toLowerCase())).length / fontRecallTargets.length;

  for (const t of result.typography) {
    const exp = expectedFonts.get(t.family.toLowerCase());
    if (!exp) continue;
    const tiers = asList(exp.confidence);
    if (tiers && !tiers.includes(t.confidence)) {
      confidenceMismatches.push(`font ${t.family}: expected confidence ${tiers.join("|")}, got ${t.confidence}`);
    }
  }

  return {
    colorPrecision,
    colorRecall,
    roleAccuracy,
    fontPrecision,
    fontRecall,
    roleMismatches,
    themeMismatches,
    confidenceMismatches,
    falsePositiveColors: extractedValues.filter((v) => !expectedByValue.has(v)),
    missedColors: recallTargets
      .filter((c) => !extractedValues.includes(c.value.toLowerCase()))
      .map((c) => c.value),
    falsePositiveFonts: extractedFontNames.filter((f) => !expectedFonts.has(f)),
    missedFonts: fontRecallTargets
      .filter((f) => !extractedFontNames.includes(f.family.toLowerCase()))
      .map((f) => f.family),
  };
}

// ── Test run ────────────────────────────────────────────────────

const fixtures = readdirSync(CORPUS_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();

describe("extraction quality corpus (release-gating lane)", () => {
  it("has fixtures to run", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(4);
  });

  it("keeps total corpus size modest (< 200KB)", () => {
    let total = 0;
    for (const f of fixtures) {
      const dir = join(CORPUS_DIR, f);
      for (const file of readdirSync(dir)) {
        total += statSync(join(dir, file)).size;
      }
    }
    expect(total).toBeLessThan(200 * 1024);
  });

  for (const fixtureName of fixtures) {
    describe(fixtureName, () => {
      const html = readFileSync(join(CORPUS_DIR, fixtureName, "index.html"), "utf-8");
      const expected: ExpectedFixture = JSON.parse(
        readFileSync(join(CORPUS_DIR, fixtureName, "expected.json"), "utf-8")
      );
      const result = extractIdentityFromHtml(html, `https://${fixtureName}.example`);
      const score = scoreFixture(result, expected);

      if (process.env.EXTRACTION_MEASURE) {
        // eslint-disable-next-line no-console
        console.log(`\n===== MEASURE ${fixtureName} =====`);
        // eslint-disable-next-line no-console
        console.log(JSON.stringify({
          colors: result.colors.map((c) => ({ value: c.value, role: c.role, theme: c.theme, confidence: c.confidence, name: c.name })),
          fonts: result.typography.map((t) => ({ family: t.family, confidence: t.confidence })),
          suggested_primary: result.suggestedPrimary,
          chromatic_candidates: result.chromaticCandidates,
          logo: {
            found: result.logoFound,
            chosen_type: result.chosenLogoType,
            candidates: result.logoCandidates.map((l) => ({ type: l.type, url: l.url.slice(0, 80) })),
          },
          clarifications: result.clarifications,
          score,
        }, null, 2));
      }

      it(`color precision >= ${expected.thresholds.color_precision}`, () => {
        expect(score.colorPrecision, `false positives: ${score.falsePositiveColors.join(", ") || "none"}`)
          .toBeGreaterThanOrEqual(expected.thresholds.color_precision);
      });

      it(`color recall >= ${expected.thresholds.color_recall} (known_gaps excluded)`, () => {
        expect(score.colorRecall, `missed: ${score.missedColors.join(", ") || "none"}`)
          .toBeGreaterThanOrEqual(expected.thresholds.color_recall);
      });

      it(`role accuracy >= ${expected.thresholds.role_accuracy}`, () => {
        expect(score.roleAccuracy, score.roleMismatches.join("; ") || "no mismatches")
          .toBeGreaterThanOrEqual(expected.thresholds.role_accuracy);
      });

      it("confidence tiers match labels", () => {
        expect(score.confidenceMismatches).toEqual([]);
      });

      it("theme tags match labels", () => {
        expect(score.themeMismatches).toEqual([]);
      });

      it(`font precision >= ${expected.thresholds.font_precision}`, () => {
        expect(score.fontPrecision, `false positives: ${score.falsePositiveFonts.join(", ") || "none"}`)
          .toBeGreaterThanOrEqual(expected.thresholds.font_precision);
      });

      it(`font recall >= ${expected.thresholds.font_recall} (known_gaps excluded)`, () => {
        expect(score.fontRecall, `missed: ${score.missedFonts.join(", ") || "none"}`)
          .toBeGreaterThanOrEqual(expected.thresholds.font_recall);
      });

      it("suggested primary matches", () => {
        expect(result.suggestedPrimary).toBe(expected.suggested_primary);
      });

      if (expected.chromatic_candidates_include) {
        it("chromatic candidates include expected values", () => {
          for (const v of expected.chromatic_candidates_include) {
            expect(result.chromaticCandidates).toContain(v);
          }
        });
      }

      it("logo detection matches", () => {
        expect(result.logoFound).toBe(expected.logo.inline_svg_found);
        if (expected.logo.chosen_type) {
          expect(result.chosenLogoType).toBe(expected.logo.chosen_type);
        }
        for (const t of expected.logo.candidate_types_include ?? []) {
          expect(result.logoCandidates.map((l) => l.type)).toContain(t);
        }
      });

      if (expected.logo.sanitized_must_contain?.length || expected.logo.sanitized_must_not_contain?.length) {
        it("sanitized logo SVG is safe", () => {
          expect(result.sanitizedLogoSvg).toBeTruthy();
          const svg = result.sanitizedLogoSvg!;
          for (const s of expected.logo.sanitized_must_contain ?? []) {
            expect(svg).toContain(s);
          }
          for (const s of expected.logo.sanitized_must_not_contain ?? []) {
            expect(svg.toLowerCase()).not.toContain(s.toLowerCase());
          }
        });
      }

      it(`clarification count is ${expected.clarifications.count}`, () => {
        expect(
          result.clarifications.map((c) => `${c.field}: ${c.question}`).join("\n") || "(none)",
        ).toBeTruthy();
        expect(result.clarifications.length).toBe(expected.clarifications.count);
      });

      if (expected.clarifications.question_substrings?.length) {
        it("clarification questions include expected substrings", () => {
          const allQuestions = result.clarifications.map((c) => c.question).join("\n");
          for (const s of expected.clarifications.question_substrings!) {
            expect(allQuestions).toContain(s);
          }
        });
      }

      it("extracted names are flattened and bounded (no smuggled content)", () => {
        for (const c of result.colors) {
          const cleaned = cleanColorName(c);
          expect(cleaned).not.toMatch(/[\u0000-\u001F\u007F]/);
          expect(cleaned.length).toBeLessThanOrEqual(48);
        }
      });

      if (expected.names_must_not_contain?.length) {
        it("hostile text stays out of extracted names", () => {
          const surface = [
            ...result.colors.map((c) => cleanColorName(c)),
            ...result.typography.map((t) => t.family),
          ].join("\n").toLowerCase();
          for (const s of expected.names_must_not_contain!) {
            expect(surface).not.toContain(s.toLowerCase());
          }
        });
      }
    });
  }
});
