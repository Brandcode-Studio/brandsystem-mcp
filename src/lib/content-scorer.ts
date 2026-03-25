import * as cheerio from "cheerio";
import { BrandDir } from "./brand-dir.js";
import type {
  CoreIdentityData,
  VisualIdentityData,
  MessagingData,
} from "../schemas/index.js";
import type { AntiPatternRule } from "../types/index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DimensionScore {
  score: number;
  weight: number;
  details: Record<string, unknown>;
}

export interface ContentScore {
  overall: number;
  dimensions: {
    token_compliance?: DimensionScore;
    visual_compliance?: DimensionScore;
    voice_alignment?: DimensionScore;
    message_coverage?: DimensionScore;
  };
  dimensions_available: string[];
  dimensions_locked: string[];
  issues: ContentIssue[];
}

export interface ContentIssue {
  dimension: string;
  severity: "critical" | "warning" | "info";
  message: string;
  detail?: string;
}

export interface BrandContext {
  identity: CoreIdentityData;
  visual: VisualIdentityData | null;
  messaging: MessagingData | null;
  config: { client_name: string; session: number };
}

// ---------------------------------------------------------------------------
// Color utilities (from brand-preflight.ts)
// ---------------------------------------------------------------------------

function normalizeHex(hex: string): string {
  let h = hex.toLowerCase().trim();
  if (/^#[0-9a-f]{3}$/.test(h)) {
    h = `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`;
  }
  if (/^#[0-9a-f]{8}$/.test(h)) {
    h = h.slice(0, 7);
  }
  return h;
}

function rgbToHex(rgb: string): string | null {
  const match = rgb.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!match) return null;
  const [, r, g, b] = match;
  const toHex = (n: string) => parseInt(n, 10).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function extractCssColors(css: string): string[] {
  const colors: string[] = [];
  const hexRe = /#[0-9a-fA-F]{3,8}\b/g;
  let m: RegExpExecArray | null;
  while ((m = hexRe.exec(css)) !== null) {
    colors.push(normalizeHex(m[0]));
  }
  const rgbRe = /rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+(?:\s*,\s*[\d.]+)?\s*\)/g;
  while ((m = rgbRe.exec(css)) !== null) {
    const hex = rgbToHex(m[0]);
    if (hex) colors.push(normalizeHex(hex));
  }
  return [...new Set(colors)];
}

function extractFontFamilies(css: string): string[] {
  const families: string[] = [];
  const re = /font-family\s*:\s*([^;}"]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    for (const part of m[1].split(",")) {
      const clean = part.trim().replace(/^['"]|['"]$/g, "").trim();
      if (clean) families.push(clean);
    }
  }
  return [...new Set(families)];
}

const SYSTEM_FONT_FAMILIES = new Set([
  "serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui",
  "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded",
  "-apple-system", "blinkmacsystemfont", "segoe ui", "roboto",
  "helvetica neue", "arial", "noto sans", "liberation sans",
  "helvetica", "times new roman", "times", "georgia", "courier new",
  "courier", "verdana", "tahoma", "trebuchet ms", "lucida grande",
  "lucida sans unicode", "lucida console", "monaco", "menlo", "consolas",
]);

// Neutrals that can appear in any content without being "off-brand"
const NEUTRAL_COLORS = new Set([
  "#000000", "#ffffff", "#000", "#fff",
  "#111111", "#222222", "#333333", "#444444", "#555555",
  "#666666", "#777777", "#888888", "#999999",
  "#aaaaaa", "#bbbbbb", "#cccccc", "#dddddd", "#eeeeee",
  "#f5f5f5", "#f8f8f8", "#fafafa",
  "transparent", "inherit", "currentcolor",
]);

// ---------------------------------------------------------------------------
// CSS from HTML
// ---------------------------------------------------------------------------

function extractAllCss($: cheerio.CheerioAPI): string {
  const parts: string[] = [];
  $("style").each((_i, el) => {
    const text = $(el).text();
    if (text) parts.push(text);
  });
  $("[style]").each((_i, el) => {
    const style = $(el).attr("style");
    if (style) parts.push(style);
  });
  return parts.join("\n");
}

// ---------------------------------------------------------------------------
// Text extraction from HTML
// ---------------------------------------------------------------------------

function extractTextFromHtml(html: string): string {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg, iframe").remove();
  const contentSelectors = ["main", "article", "[role='main']"];
  let text = "";
  for (const sel of contentSelectors) {
    const el = $(sel);
    if (el.length) text += el.text() + "\n";
  }
  if (!text.trim()) text = $("body").text() || $.text();
  return text
    .replace(/[\t ]+/g, " ")
    .replace(/\n\s*\n/g, "\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitSentences(text: string): string[] {
  return text
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 5 && s.split(/\s+/).length >= 3);
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1);
}

function countOccurrences(text: string, pattern: string): number {
  const lower = text.toLowerCase();
  const target = pattern.toLowerCase();
  let count = 0;
  let idx = 0;
  while ((idx = lower.indexOf(target, idx)) !== -1) {
    count++;
    idx += target.length;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Anti-pattern matchers (from brand-preflight.ts)
// ---------------------------------------------------------------------------

interface AntiPatternMatcher {
  test: (css: string) => boolean;
  keywords: string[];
}

const ANTI_PATTERN_MATCHERS: AntiPatternMatcher[] = [
  {
    keywords: ["drop shadow", "drop-shadow", "box shadow", "box-shadow"],
    test: (css) =>
      /box-shadow\s*:/i.test(css) ||
      /text-shadow\s*:/i.test(css) ||
      /filter\s*:.*drop-shadow/i.test(css),
  },
  {
    keywords: ["gradient"],
    test: (css) => /(?:linear|radial|conic)-gradient/i.test(css),
  },
  {
    keywords: ["border radius", "border-radius", "rounded corner", "rounded corners", "pill shape"],
    test: (css) => /border-radius\s*:/i.test(css),
  },
  {
    keywords: ["opacity"],
    test: (css) => /\bopacity\s*:\s*(?!1\b|1\.0)/i.test(css),
  },
  {
    keywords: ["blur"],
    test: (css) => /filter\s*:.*blur/i.test(css) || /backdrop-filter\s*:.*blur/i.test(css),
  },
  {
    keywords: ["outline"],
    test: (css) => /\boutline\s*:/i.test(css),
  },
  {
    keywords: ["underline", "text-decoration"],
    test: (css) => /text-decoration\s*:.*underline/i.test(css),
  },
  {
    keywords: ["italic"],
    test: (css) => /font-style\s*:\s*italic/i.test(css),
  },
  {
    keywords: ["uppercase", "text-transform"],
    test: (css) => /text-transform\s*:\s*uppercase/i.test(css),
  },
];

function matchAntiPattern(rule: string, css: string): boolean {
  const lower = rule.toLowerCase();
  for (const matcher of ANTI_PATTERN_MATCHERS) {
    if (matcher.keywords.some((kw) => lower.includes(kw))) {
      return matcher.test(css);
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// AI-ism patterns (from brand-extract-messaging.ts)
// ---------------------------------------------------------------------------

const AI_ISM_PATTERNS = [
  "in today's", "it's worth noting", "at the end of the day",
  "this is a testament to", "let's dive in", "here's the thing",
  "the reality is", "is not just", "it's not just",
  "whether you're", "in an era of", "in the world of", "at its core",
  "when it comes to", "it goes without saying", "needless to say",
  "look no further", "stands as a", "serves as a",
  "plays a crucial role", "navigating the", "landscape",
  "ever-evolving", "ever-changing", "game-changer",
  "take it to the next level", "deep dive", "delve",
  "moreover", "furthermore", "in conclusion", "comprehensive",
];

// ---------------------------------------------------------------------------
// Load brand context
// ---------------------------------------------------------------------------

export async function loadBrandContext(brandDir: BrandDir): Promise<BrandContext> {
  const identity = await brandDir.readCoreIdentity();

  let config = { client_name: "", session: 1 };
  try {
    const raw = await brandDir.readConfig();
    config = { client_name: raw.client_name, session: raw.session };
  } catch {
    // Non-critical
  }

  let visual: VisualIdentityData | null = null;
  if (await brandDir.hasVisualIdentity()) {
    try {
      visual = await brandDir.readVisualIdentity();
    } catch { /* degrade */ }
  }

  let messaging: MessagingData | null = null;
  if (await brandDir.hasMessaging()) {
    try {
      messaging = await brandDir.readMessaging();
    } catch { /* degrade */ }
  }

  return { identity, visual, messaging, config };
}

// ---------------------------------------------------------------------------
// Detect if content is HTML
// ---------------------------------------------------------------------------

export function isHtmlContent(content: string): boolean {
  return /<[a-z][\s\S]*>/i.test(content.slice(0, 500));
}

// ---------------------------------------------------------------------------
// Score content
// ---------------------------------------------------------------------------

export function scoreContent(
  content: string,
  isHtml: boolean,
  ctx: BrandContext,
): ContentScore {
  const issues: ContentIssue[] = [];
  const dimensions: ContentScore["dimensions"] = {};
  const available: string[] = [];
  const locked: string[] = [];

  // Parse content
  let css = "";
  let text = content;
  let $: cheerio.CheerioAPI | null = null;

  if (isHtml) {
    $ = cheerio.load(content);
    css = extractAllCss($);
    text = extractTextFromHtml(content);
  }

  // --- Token compliance (always available if colors/fonts exist) ---
  if (ctx.identity.colors.length > 0 || ctx.identity.typography.length > 0) {
    available.push("token_compliance");
    dimensions.token_compliance = scoreTokenCompliance(css, text, ctx.identity, isHtml, $, issues);
  } else {
    locked.push("token_compliance");
  }

  // --- Visual compliance (Session 2+) ---
  if (ctx.visual && ctx.visual.anti_patterns.length > 0) {
    available.push("visual_compliance");
    dimensions.visual_compliance = scoreVisualCompliance(css, ctx.visual.anti_patterns, issues);
  } else {
    locked.push("visual_compliance");
  }

  // --- Voice alignment (Session 3+) ---
  if (ctx.messaging?.voice) {
    available.push("voice_alignment");
    dimensions.voice_alignment = scoreVoiceAlignment(text, ctx.messaging, issues);
  } else {
    locked.push("voice_alignment");
  }

  // --- Message coverage (Session 3+) ---
  if (ctx.messaging?.perspective || ctx.messaging?.brand_story) {
    available.push("message_coverage");
    dimensions.message_coverage = scoreMessageCoverage(text, ctx.messaging, issues);
  } else {
    locked.push("message_coverage");
  }

  // Compute overall score
  const scores = Object.values(dimensions).filter(Boolean) as DimensionScore[];
  const totalWeight = scores.reduce((sum, d) => sum + d.weight, 0);
  const overall = totalWeight > 0
    ? Math.round(scores.reduce((sum, d) => sum + d.score * d.weight, 0) / totalWeight)
    : 0;

  return { overall, dimensions, dimensions_available: available, dimensions_locked: locked, issues };
}

// ---------------------------------------------------------------------------
// Token compliance scoring
// ---------------------------------------------------------------------------

function scoreTokenCompliance(
  css: string,
  _text: string,
  identity: CoreIdentityData,
  isHtml: boolean,
  $: cheerio.CheerioAPI | null,
  issues: ContentIssue[],
): DimensionScore {
  const details: Record<string, unknown> = {};
  const subScores: number[] = [];

  // Color match
  if (identity.colors.length > 0 && isHtml && css) {
    const brandColors = new Set(identity.colors.map((c) => normalizeHex(c.value)));
    const usedColors = extractCssColors(css);
    const nonNeutralUsed = usedColors.filter(
      (c) => !NEUTRAL_COLORS.has(c) && !NEUTRAL_COLORS.has(c.replace("#", ""))
    );
    const offPalette = nonNeutralUsed.filter((c) => !brandColors.has(c));
    const onPalette = nonNeutralUsed.filter((c) => brandColors.has(c));
    const colorScore = nonNeutralUsed.length > 0
      ? Math.round((onPalette.length / nonNeutralUsed.length) * 100)
      : 100;
    details.color_match = {
      score: colorScore,
      on_palette: onPalette.length,
      off_palette: offPalette.length,
      off_palette_colors: offPalette.slice(0, 5),
    };
    subScores.push(colorScore);
    if (offPalette.length > 0) {
      issues.push({
        dimension: "token_compliance",
        severity: "warning",
        message: `${offPalette.length} off-palette color(s) found`,
        detail: offPalette.slice(0, 3).join(", "),
      });
    }
  }

  // Typography match
  if (identity.typography.length > 0 && isHtml && css) {
    const brandFonts = new Set(
      identity.typography.map((t) => t.family.toLowerCase())
    );
    const usedFamilies = extractFontFamilies(css);
    const customFonts = usedFamilies.filter(
      (f) => !SYSTEM_FONT_FAMILIES.has(f.toLowerCase())
    );
    const brandFontsUsed = customFonts.filter((f) => brandFonts.has(f.toLowerCase()));
    const nonBrandFonts = customFonts.filter((f) => !brandFonts.has(f.toLowerCase()));
    const typoScore = customFonts.length > 0
      ? Math.round((brandFontsUsed.length / customFonts.length) * 100)
      : 100;
    details.typography_match = {
      score: typoScore,
      brand_fonts_used: brandFontsUsed,
      non_brand_fonts: nonBrandFonts,
    };
    subScores.push(typoScore);
    if (nonBrandFonts.length > 0) {
      issues.push({
        dimension: "token_compliance",
        severity: "warning",
        message: `Non-brand font(s): ${nonBrandFonts.join(", ")}`,
      });
    }
  }

  // Logo presence (HTML only)
  if (isHtml && $) {
    const hasLogoSvg = $("svg").length > 0 || $("img[src*='logo']").length > 0 || $("img[alt*='logo' i]").length > 0;
    details.logo_present = { score: hasLogoSvg ? 100 : 0, found: hasLogoSvg };
    subScores.push(hasLogoSvg ? 100 : 0);
    if (!hasLogoSvg) {
      issues.push({
        dimension: "token_compliance",
        severity: "info",
        message: "No logo detected in content",
      });
    }
  }

  // Primary color usage
  if (isHtml && css) {
    const primary = identity.colors.find((c) => c.role === "primary");
    if (primary) {
      const primaryHex = normalizeHex(primary.value);
      const found = css.toLowerCase().includes(primaryHex);
      details.primary_color_used = { score: found ? 100 : 0, primary: primaryHex, found };
      subScores.push(found ? 100 : 0);
    }
  }

  // Aggregate
  const score = subScores.length > 0
    ? Math.round(subScores.reduce((a, b) => a + b, 0) / subScores.length)
    : 100;

  return { score, weight: 0.3, details };
}

// ---------------------------------------------------------------------------
// Visual compliance scoring
// ---------------------------------------------------------------------------

function scoreVisualCompliance(
  css: string,
  antiPatterns: AntiPatternRule[],
  issues: ContentIssue[],
): DimensionScore {
  if (!css) {
    return { score: 100, weight: 0.2, details: { note: "No CSS to check" } };
  }

  const violations: string[] = [];
  const checked: string[] = [];

  for (const ap of antiPatterns) {
    checked.push(ap.rule);
    if (matchAntiPattern(ap.rule, css)) {
      violations.push(ap.rule);
      issues.push({
        dimension: "visual_compliance",
        severity: ap.severity === "hard" ? "critical" : "warning",
        message: `Anti-pattern violated: ${ap.rule}`,
        detail: `Severity: ${ap.severity}`,
      });
    }
  }

  const score = checked.length > 0
    ? Math.round(((checked.length - violations.length) / checked.length) * 100)
    : 100;

  return {
    score,
    weight: 0.2,
    details: {
      violations,
      violations_count: violations.length,
      rules_checked: checked.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Voice alignment scoring
// ---------------------------------------------------------------------------

function scoreVoiceAlignment(
  text: string,
  messaging: MessagingData,
  issues: ContentIssue[],
): DimensionScore {
  const voice = messaging.voice;
  if (!voice) return { score: 100, weight: 0.3, details: {} };

  const details: Record<string, unknown> = {};
  const subScores: number[] = [];
  const sentences = splitSentences(text);

  // Sentence length match
  if (voice.tone.conventions?.sentence_length) {
    const targetLength = voice.tone.conventions.sentence_length;
    const avgLength = sentences.length > 0
      ? sentences.reduce((sum, s) => sum + s.split(/\s+/).length, 0) / sentences.length
      : targetLength;
    const diff = Math.abs(avgLength - targetLength);
    const formalityScore = Math.max(0, Math.round(100 - diff * 5));
    details.sentence_length = {
      score: formalityScore,
      avg: Math.round(avgLength),
      target: targetLength,
    };
    subScores.push(formalityScore);
  }

  // Anchor vocabulary usage
  if (voice.vocabulary.anchor.length > 0) {
    let used = 0;
    const wrongAlternatives: string[] = [];
    for (const term of voice.vocabulary.anchor) {
      const useCount = countOccurrences(text, term.use);
      const notCount = countOccurrences(text, term.not);
      if (useCount > 0) used++;
      if (notCount > 0) {
        wrongAlternatives.push(term.not);
        issues.push({
          dimension: "voice_alignment",
          severity: "warning",
          message: `Used "${term.not}" instead of anchor term "${term.use}"`,
          detail: term.reason,
        });
      }
    }
    const anchorViolations = wrongAlternatives.length;
    const anchorScore = Math.max(0, Math.round(100 - anchorViolations * 20));
    details.anchor_vocabulary = {
      score: anchorScore,
      anchor_terms_used: used,
      wrong_alternatives: wrongAlternatives.slice(0, 5),
      total_anchor_terms: voice.vocabulary.anchor.length,
    };
    subScores.push(anchorScore);
  }

  // Never-say violations
  if (voice.vocabulary.never_say.length > 0) {
    const violations: Array<{ word: string; count: number }> = [];
    for (const ns of voice.vocabulary.never_say) {
      const count = countOccurrences(text, ns.word);
      if (count > 0) {
        violations.push({ word: ns.word, count });
        issues.push({
          dimension: "voice_alignment",
          severity: "warning",
          message: `Never-say word "${ns.word}" found (${count}x)`,
          detail: ns.reason,
        });
      }
    }
    const nsScore = Math.max(0, Math.round(100 - violations.length * 15));
    details.never_say = {
      score: nsScore,
      violations: violations.slice(0, 5),
      total_rules: voice.vocabulary.never_say.length,
    };
    subScores.push(nsScore);
  }

  // AI-ism detection
  const aiPatterns = voice.ai_ism_detection?.patterns || AI_ISM_PATTERNS;
  const aiIsms: Array<{ pattern: string; count: number }> = [];
  for (const pattern of aiPatterns) {
    const count = countOccurrences(text, pattern);
    if (count > 0) aiIsms.push({ pattern, count });
  }
  const totalAiIsms = aiIsms.reduce((sum, a) => sum + a.count, 0);
  const aiScore = Math.max(0, Math.round(100 - totalAiIsms * 12));
  details.ai_isms = {
    score: aiScore,
    count: totalAiIsms,
    found: aiIsms.slice(0, 5),
  };
  subScores.push(aiScore);
  if (totalAiIsms > 0) {
    issues.push({
      dimension: "voice_alignment",
      severity: "warning",
      message: `${totalAiIsms} AI-ism(s) detected`,
      detail: aiIsms.slice(0, 3).map((a) => `"${a.pattern}"`).join(", "),
    });
  }

  const score = subScores.length > 0
    ? Math.round(subScores.reduce((a, b) => a + b, 0) / subScores.length)
    : 100;

  return { score, weight: 0.3, details };
}

// ---------------------------------------------------------------------------
// Message coverage scoring
// ---------------------------------------------------------------------------

function scoreMessageCoverage(
  text: string,
  messaging: MessagingData,
  issues: ContentIssue[],
): DimensionScore {
  const details: Record<string, unknown> = {};
  const subScores: number[] = [];
  const lowerText = text.toLowerCase();

  // Perspective echo
  if (messaging.perspective) {
    const p = messaging.perspective;
    const perspectiveTerms = [
      ...tokenize(p.worldview),
      ...tokenize(p.tension),
      ...tokenize(p.resolution),
    ].filter((w) => w.length > 4);

    const uniqueTerms = [...new Set(perspectiveTerms)];
    const found = uniqueTerms.filter((t) => lowerText.includes(t));
    const perspectiveScore = uniqueTerms.length > 0
      ? Math.min(100, Math.round((found.length / Math.min(uniqueTerms.length, 10)) * 100))
      : 100;
    details.perspective_echo = {
      score: perspectiveScore,
      terms_found: found.length,
      terms_checked: Math.min(uniqueTerms.length, 10),
    };
    subScores.push(perspectiveScore);
  }

  // Brand story alignment
  if (messaging.brand_story) {
    const story = messaging.brand_story;
    const storyTerms = [
      ...tokenize(story.tension),
      ...tokenize(story.resolution),
      ...tokenize(story.tagline),
    ].filter((w) => w.length > 4);

    const uniqueStory = [...new Set(storyTerms)];
    const found = uniqueStory.filter((t) => lowerText.includes(t));
    const storyScore = uniqueStory.length > 0
      ? Math.min(100, Math.round((found.length / Math.min(uniqueStory.length, 8)) * 100))
      : 100;
    details.brand_story_alignment = {
      score: storyScore,
      terms_found: found.length,
      terms_checked: Math.min(uniqueStory.length, 8),
    };
    subScores.push(storyScore);
  }

  const score = subScores.length > 0
    ? Math.round(subScores.reduce((a, b) => a + b, 0) / subScores.length)
    : 100;

  if (score < 50) {
    issues.push({
      dimension: "message_coverage",
      severity: "info",
      message: "Content shows low alignment with brand perspective and story",
    });
  }

  return { score, weight: 0.2, details };
}
