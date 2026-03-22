import { z } from "zod";
import * as cheerio from "cheerio";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BrandDir } from "../lib/brand-dir.js";
import { buildResponse } from "../lib/response.js";
import type { MessagingAuditResult } from "../types/index.js";

// ─── Parameters ──────────────────────────────────────────────────────────────

const paramsShape = {
  url: z.string().describe("Website URL to audit messaging from (typically the homepage)"),
  pages: z
    .string()
    .optional()
    .describe("JSON array of additional page URLs to include in the analysis"),
};

// ─── Stop words (filtered from vocabulary frequency) ─────────────────────────

const STOP_WORDS = new Set([
  // ── English stop words ──────────────────────────────────────────────────────
  "a", "about", "above", "after", "again", "against", "all", "am", "an", "and",
  "any", "are", "aren't", "as", "at", "be", "because", "been", "before",
  "being", "below", "between", "both", "but", "by", "can", "can't", "cannot",
  "could", "couldn't", "did", "didn't", "do", "does", "doesn't", "doing",
  "don't", "down", "during", "each", "few", "for", "from", "further", "get",
  "got", "had", "hadn't", "has", "hasn't", "have", "haven't", "having", "he",
  "he'd", "he'll", "he's", "her", "here", "here's", "hers", "herself", "him",
  "himself", "his", "how", "how's", "i", "i'd", "i'll", "i'm", "i've", "if",
  "in", "into", "is", "isn't", "it", "it's", "its", "itself", "just", "let",
  "let's", "like", "ll", "me", "might", "more", "most", "mustn't", "my",
  "myself", "no", "nor", "not", "of", "off", "on", "once", "only", "or",
  "other", "ought", "our", "ours", "ourselves", "out", "over", "own", "re",
  "s", "same", "shan't", "she", "she'd", "she'll", "she's", "should",
  "shouldn't", "so", "some", "such", "t", "than", "that", "that's", "the",
  "their", "theirs", "them", "themselves", "then", "there", "there's", "these",
  "they", "they'd", "they'll", "they're", "they've", "this", "those",
  "through", "to", "too", "under", "until", "up", "us", "ve", "very", "was",
  "wasn't", "we", "we'd", "we'll", "we're", "we've", "were", "weren't",
  "what", "what's", "when", "when's", "where", "where's", "which", "while",
  "who", "who's", "whom", "why", "why's", "will", "with", "won't", "would",
  "wouldn't", "you", "you'd", "you'll", "you're", "you've", "your", "yours",
  "yourself", "yourselves", "also", "an", "another", "back", "even", "go",
  "going", "know", "make", "much", "new", "now", "one", "really", "right",
  "see", "still", "take", "thing", "think", "two", "use", "want", "way",
  "well", "work", "year", "d", "m", "re", "ve", "ll",

  // ── JavaScript keywords / patterns (web artifact noise) ─────────────────────
  "function", "const", "var", "let", "return", "class", "export", "import",
  "default", "async", "await", "typeof", "undefined", "null", "true", "false",
  "this", "new", "void", "delete", "throw", "catch", "finally", "switch",
  "case", "break", "continue", "else", "instanceof", "constructor", "prototype",
  "arguments", "module", "require", "window", "document", "console", "error",
  "object", "array", "string", "number", "boolean", "symbol",

  // ── CSS / HTML artifacts ────────────────────────────────────────────────────
  "width", "height", "display", "none", "block", "flex", "grid", "margin",
  "padding", "border", "color", "font", "size", "style", "background",
  "position", "absolute", "relative", "fixed", "overflow", "hidden", "visible",
  "auto", "inherit", "initial", "important", "hover", "active", "focus",
  "opacity", "transition", "transform", "animation", "index", "container",
  "wrapper", "section", "header", "footer", "main", "article", "button",
  "input", "image", "link", "content", "currentindex", "maxindex", "previndex",
  "nextindex", "slideto", "arialabel", "classname", "onclick", "onchange",
  "onload", "queryselector", "addeventlistener", "setinterval", "settimeout",
  "innerhtml", "textcontent", "appendchild", "createelement", "getelementbyid",
  "parentnode", "childnodes",

  // ── Common web framework terms ──────────────────────────────────────────────
  "component", "props", "state", "render", "mount", "unmount", "usestate",
  "useeffect", "useref", "memo", "callback", "dispatch", "reducer", "context",
  "provider", "consumer", "router", "route", "navigate", "params", "query",
  "middleware", "handler", "controller", "endpoint", "schema", "config",
  "utils", "helpers", "types", "interfaces",
]);

// ─── Overused / generic marketing words ──────────────────────────────────────

const OVERUSED_WORDS = new Set([
  "solution", "solutions", "leverage", "innovative", "innovation",
  "best-in-class", "cutting-edge", "world-class", "next-generation",
  "synergy", "synergies", "disruptive", "disrupt", "paradigm",
  "holistic", "seamless", "seamlessly", "robust", "scalable",
  "optimize", "optimization", "streamline", "streamlined",
  "revolutionary", "game-changing", "state-of-the-art", "turnkey",
  "bleeding-edge", "empower", "empowering", "enable", "enabling",
  "unlock", "unlocking", "transform", "transformative", "transformation",
  "elevate", "elevating",
]);

// ─── AI-ism patterns ─────────────────────────────────────────────────────────

const AI_ISM_PATTERNS = [
  "in today's",
  "it's worth noting",
  "at the end of the day",
  "this is a testament to",
  "let's dive in",
  "here's the thing",
  "the reality is",
  "is not just",
  "it's not just",
  "— it's",
  "whether you're",
  "in an era of",
  "in the world of",
  "at its core",
  "when it comes to",
  "it goes without saying",
  "needless to say",
  "look no further",
  "stands as a",
  "serves as a",
  "plays a crucial role",
  "navigating the",
  "landscape",
  "ever-evolving",
  "ever-changing",
  "game-changer",
  "take it to the next level",
  "deep dive",
  "delve",
  "moreover",
  "furthermore",
  "in conclusion",
  "comprehensive",
];

// ─── Hedging words ───────────────────────────────────────────────────────────

const HEDGING_WORDS = [
  "can", "may", "might", "could", "potentially", "help", "helps",
  "possible", "possibly", "perhaps", "likely", "tend", "tends",
  "generally", "typically", "often", "sometimes", "arguably",
];

// ─── Superlative / claim indicators ──────────────────────────────────────────

const SUPERLATIVE_PATTERNS = [
  /\b(leading|best|top|first|only|largest|fastest|most|premier|number[- ]?one|#1|no\.?\s?1)\b/i,
];

// ─── Passive voice pattern ───────────────────────────────────────────────────

const PASSIVE_PATTERN = /\b(is|are|was|were|been|being|be)\s+\w+ed\b/i;

// ─── Industry jargon detection (common B2B / tech / marketing) ───────────────

const JARGON_TERMS = new Set([
  "roi", "kpi", "saas", "b2b", "b2c", "api", "crm", "erp", "mvp",
  "pipeline", "funnel", "touchpoint", "touchpoints", "omnichannel",
  "stakeholder", "stakeholders", "deliverable", "deliverables",
  "bandwidth", "cadence", "ecosystem", "integration", "integrations",
  "onboarding", "offboarding", "upskill", "upskilling", "whitepaper",
  "thought-leadership", "go-to-market", "end-to-end", "full-stack",
  "analytics", "metric", "metrics", "segmentation", "personalization",
  "attribution", "lifecycle", "retention", "churn", "arpu", "ltv",
  "cac", "conversion", "conversions", "engagement",
]);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractTextContent($: cheerio.CheerioAPI): string {
  // Remove script, style, nav, footer, header elements to focus on body copy
  $("script, style, noscript, svg, iframe").remove();

  // Get text from semantic content areas first, then body
  const contentSelectors = ["main", "article", "[role='main']"];
  let text = "";
  for (const sel of contentSelectors) {
    const el = $(sel);
    if (el.length) {
      text += el.text() + "\n";
    }
  }

  // If no semantic content areas found, use body
  if (!text.trim()) {
    text = $("body").text() || $.text();
  }

  // Clean up: collapse whitespace, preserve paragraph breaks
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

// ─── Analysis functions ──────────────────────────────────────────────────────

function analyzeVoiceFingerprint(
  text: string,
  sentences: string[],
  words: string[]
): MessagingAuditResult["voice_fingerprint"] {
  // Formality (1-10): based on contractions, avg word length, colloquialisms
  const contractionCount = (text.match(/\b\w+n't\b|\b\w+'re\b|\b\w+'ve\b|\b\w+'ll\b|\b\w+'s\b|\b\w+'d\b/gi) || []).length;
  const avgWordLength = words.reduce((sum, w) => sum + w.length, 0) / (words.length || 1);
  const contractionRatio = contractionCount / (sentences.length || 1);
  // High contractions + short words = informal; low contractions + long words = formal
  let formality = 5;
  if (avgWordLength > 6) formality += 2;
  else if (avgWordLength > 5) formality += 1;
  if (avgWordLength < 4.5) formality -= 1;
  if (contractionRatio < 0.1) formality += 1;
  if (contractionRatio > 0.4) formality -= 2;
  else if (contractionRatio > 0.2) formality -= 1;
  formality = Math.max(1, Math.min(10, formality));

  // Jargon density
  const jargonWords = words.filter((w) => JARGON_TERMS.has(w));
  const jargonDensity = words.length > 0 ? (jargonWords.length / words.length) : 0;
  const jargonStr = `${(jargonDensity * 100).toFixed(1)}% (${jargonWords.length} jargon terms / ${words.length} words)`;

  // Average sentence length
  const avgSentenceLength = sentences.length > 0
    ? Math.round(sentences.reduce((sum, s) => sum + s.split(/\s+/).length, 0) / sentences.length)
    : 0;

  // Active vs passive voice
  let passiveCount = 0;
  for (const sentence of sentences) {
    if (PASSIVE_PATTERN.test(sentence)) {
      passiveCount++;
    }
  }
  const activePct = sentences.length > 0
    ? Math.round(((sentences.length - passiveCount) / sentences.length) * 100)
    : 0;

  // Hedging frequency
  let hedgeCount = 0;
  for (const hw of HEDGING_WORDS) {
    hedgeCount += countOccurrences(text, ` ${hw} `);
  }
  const hedgeStr = `${hedgeCount} hedging instances across ${sentences.length} sentences (${sentences.length > 0 ? (hedgeCount / sentences.length * 100).toFixed(1) : 0}%)`;

  // Person detection
  const weCount = countOccurrences(text, " we ");
  const iCount = countOccurrences(text, " i ");
  const youCount = countOccurrences(text, " you ");
  const theyCount = countOccurrences(text, " they ");
  const personCounts: Record<string, number> = {
    "we (first-person plural)": weCount,
    "I (first-person singular)": iCount,
    "you (second-person)": youCount,
    "they (third-person)": theyCount,
  };
  const toneByChannel: Record<string, string> = {};
  const dominant = Object.entries(personCounts).sort((a, b) => b[1] - a[1]);
  toneByChannel["dominant_person"] = dominant[0]?.[1] > 0
    ? `${dominant[0][0]}: ${dominant[0][1]} occurrences`
    : "no clear dominant person";
  toneByChannel["person_breakdown"] = dominant.map(([k, v]) => `${k}: ${v}`).join(", ");

  return {
    formality,
    jargon_density: jargonStr,
    avg_sentence_length: avgSentenceLength,
    active_voice_pct: activePct,
    hedging_frequency: hedgeStr,
    tone_by_channel: toneByChannel,
  };
}

function analyzeVocabulary(
  words: string[]
): MessagingAuditResult["vocabulary_frequency"] {
  const freq = new Map<string, number>();
  for (const w of words) {
    if (STOP_WORDS.has(w) || w.length < 3) continue;
    freq.set(w, (freq.get(w) || 0) + 1);
  }

  const sorted = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);

  return sorted.map(([term, count]) => {
    let assessment: string;
    if (OVERUSED_WORDS.has(term)) {
      assessment = "overused-generic";
    } else if (JARGON_TERMS.has(term)) {
      assessment = "industry-jargon";
    } else if (count >= 5) {
      assessment = "potentially-distinctive";
    } else {
      assessment = "neutral";
    }
    return { term, count, assessment };
  });
}

function analyzeClaims(
  sentences: string[]
): MessagingAuditResult["claims"] {
  const explicit: MessagingAuditResult["claims"]["explicit"] = [];
  const implicit: MessagingAuditResult["claims"]["implicit"] = [];
  const contradictions: string[] = [];

  // Stat-based claims: sentences with numbers
  const statPattern = /\b\d[\d,]*\+?\b|\b\d+x\b|\b\d+%\b/i;
  const seenStatClaims = new Set<string>();

  for (const sentence of sentences) {
    // Explicit claims with numbers
    if (statPattern.test(sentence)) {
      const normalized = sentence.slice(0, 80);
      if (!seenStatClaims.has(normalized)) {
        seenStatClaims.add(normalized);
        const issues: string[] = [];
        // Check if there's a source/citation nearby
        if (!/source|according|study|report|survey|research|data/i.test(sentence)) {
          issues.push("no source cited");
        }
        explicit.push({
          claim: sentence.length > 120 ? sentence.slice(0, 120) + "..." : sentence,
          frequency: 1,
          issues,
        });
      }
    }

    // Superlative claims
    for (const pattern of SUPERLATIVE_PATTERNS) {
      if (pattern.test(sentence)) {
        const match = sentence.match(pattern);
        implicit.push({
          claim: sentence.length > 120 ? sentence.slice(0, 120) + "..." : sentence,
          evidence: `Uses superlative "${match?.[1] || "unknown"}"`,
          status: "unqualified",
        });
        break;
      }
    }
  }

  // Simple contradiction detection: look for opposing claims
  const hasLeading = sentences.some((s) => /\b(leading|leader|#1|number one)\b/i.test(s));
  const hasNew = sentences.some((s) => /\b(new|startup|emerging|young)\b/i.test(s));
  if (hasLeading && hasNew) {
    contradictions.push("Claims 'leading' position while also positioning as 'new/emerging' — clarify which framing is primary");
  }

  const hasSimple = sentences.some((s) => /\b(simple|easy|effortless)\b/i.test(s));
  const hasComprehensive = sentences.some((s) => /\b(comprehensive|full-suite|complete|everything)\b/i.test(s));
  if (hasSimple && hasComprehensive) {
    contradictions.push("Claims both 'simple/easy' and 'comprehensive/complete' — these can feel contradictory without careful framing");
  }

  return { explicit, implicit, contradictions };
}

function analyzeAiIsms(text: string): Array<{ pattern: string; count: number }> {
  const results: Array<{ pattern: string; count: number }> = [];
  for (const pattern of AI_ISM_PATTERNS) {
    const count = countOccurrences(text, pattern);
    if (count > 0) {
      results.push({ pattern, count });
    }
  }
  return results.sort((a, b) => b.count - a.count);
}

function analyzeGaps(
  text: string,
  sentences: string[],
  vocab: MessagingAuditResult["vocabulary_frequency"],
  pageTexts: string[]
): string[] {
  const gaps: string[] = [];

  // Check for stated brand perspective (mission/vision/why)
  const hasPerspective = /\b(mission|vision|purpose|believe|why we|what we stand for)\b/i.test(text);
  if (!hasPerspective) {
    gaps.push("No clear brand perspective found (mission, vision, or belief statement)");
  }

  // Check for enemy/tension
  const hasTension = /\b(problem|challenge|broken|wrong|unlike|instead of|tired of|frustrated)\b/i.test(text);
  if (!hasTension) {
    gaps.push("No clear 'enemy' or tension identified — brand lacks something to push against");
  }

  // Check for anchor vocabulary (distinctive repeated terms)
  const distinctiveTerms = vocab.filter((v) => v.assessment === "potentially-distinctive");
  if (distinctiveTerms.length < 3) {
    gaps.push("Weak anchor vocabulary — fewer than 3 distinctive, frequently-used terms found");
  }

  // Check for forbidden vocabulary awareness
  const overusedCount = vocab.filter((v) => v.assessment === "overused-generic").length;
  if (overusedCount >= 3) {
    gaps.push(`${overusedCount} overused generic marketing terms detected — needs a 'never say' list`);
  }

  // Check voice consistency across pages (if multiple pages analyzed)
  if (pageTexts.length > 1) {
    const pageSentenceLengths = pageTexts.map((pt) => {
      const ss = splitSentences(pt);
      return ss.length > 0
        ? ss.reduce((sum, s) => sum + s.split(/\s+/).length, 0) / ss.length
        : 0;
    });
    const maxLen = Math.max(...pageSentenceLengths);
    const minLen = Math.min(...pageSentenceLengths.filter((l) => l > 0));
    if (maxLen > 0 && minLen > 0 && maxLen / minLen > 1.8) {
      gaps.push("Voice inconsistency across pages — sentence length varies significantly (possible multiple writers without a style guide)");
    }
  }

  // Check for social proof
  const hasSocialProof = /\b(testimonial|review|client|customer|partner|trusted by|used by)\b/i.test(text);
  if (!hasSocialProof) {
    gaps.push("No social proof language detected (testimonials, client references, trust signals)");
  }

  return gaps;
}

// ─── Markdown report generator ───────────────────────────────────────────────

function generateAuditMarkdown(
  audit: MessagingAuditResult,
  aiIsms: Array<{ pattern: string; count: number }>,
  urls: string[]
): string {
  const lines: string[] = [];
  lines.push("# Messaging Audit Report");
  lines.push("");
  lines.push(`**Pages analyzed:** ${urls.join(", ")}`);
  lines.push(`**Generated:** ${new Date().toISOString().split("T")[0]}`);
  lines.push("");

  // Voice Fingerprint
  lines.push("## Voice Fingerprint");
  lines.push("");
  lines.push(`| Metric | Value |`);
  lines.push(`| ------ | ----- |`);
  lines.push(`| Formality | ${audit.voice_fingerprint.formality}/10 |`);
  lines.push(`| Jargon density | ${audit.voice_fingerprint.jargon_density} |`);
  lines.push(`| Avg sentence length | ${audit.voice_fingerprint.avg_sentence_length} words |`);
  lines.push(`| Active voice | ${audit.voice_fingerprint.active_voice_pct}% |`);
  lines.push(`| Hedging frequency | ${audit.voice_fingerprint.hedging_frequency} |`);
  lines.push(`| Dominant person | ${audit.voice_fingerprint.tone_by_channel["dominant_person"] || "n/a"} |`);
  lines.push(`| Person breakdown | ${audit.voice_fingerprint.tone_by_channel["person_breakdown"] || "n/a"} |`);
  lines.push("");

  // Vocabulary
  lines.push("## Top Vocabulary");
  lines.push("");
  lines.push(`| Term | Count | Assessment |`);
  lines.push(`| ---- | ----- | ---------- |`);
  for (const v of audit.vocabulary_frequency) {
    lines.push(`| ${v.term} | ${v.count} | ${v.assessment} |`);
  }
  lines.push("");

  // Overused callout
  const overused = audit.vocabulary_frequency.filter((v) => v.assessment === "overused-generic");
  if (overused.length > 0) {
    lines.push("### Overused Generic Terms");
    lines.push("");
    for (const o of overused) {
      lines.push(`- **${o.term}** (${o.count}x) — consider replacing with brand-specific language`);
    }
    lines.push("");
  }

  // Claims
  lines.push("## Claims Analysis");
  lines.push("");

  if (audit.claims.explicit.length > 0) {
    lines.push("### Explicit Claims (with data/numbers)");
    lines.push("");
    for (const c of audit.claims.explicit) {
      const issueStr = c.issues.length > 0 ? ` — **Issues:** ${c.issues.join(", ")}` : "";
      lines.push(`- "${c.claim}"${issueStr}`);
    }
    lines.push("");
  }

  if (audit.claims.implicit.length > 0) {
    lines.push("### Superlative / Implicit Claims");
    lines.push("");
    for (const c of audit.claims.implicit) {
      lines.push(`- "${c.claim}" — ${c.evidence} (${c.status})`);
    }
    lines.push("");
  }

  if (audit.claims.contradictions.length > 0) {
    lines.push("### Contradictions");
    lines.push("");
    for (const c of audit.claims.contradictions) {
      lines.push(`- ${c}`);
    }
    lines.push("");
  }

  // AI-isms
  if (aiIsms.length > 0) {
    lines.push("## AI-ism Detection");
    lines.push("");
    lines.push("Patterns commonly associated with AI-generated or template copy:");
    lines.push("");
    for (const a of aiIsms) {
      lines.push(`- "${a.pattern}" — ${a.count}x`);
    }
    lines.push("");
  }

  // Gaps
  if (audit.gaps.length > 0) {
    lines.push("## Gaps");
    lines.push("");
    for (const g of audit.gaps) {
      lines.push(`- ${g}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ─── Main handler ────────────────────────────────────────────────────────────

async function handler(input: { url: string; pages?: string }) {
  const brandDir = new BrandDir(process.cwd());

  if (!(await brandDir.exists())) {
    return buildResponse({
      what_happened: "No .brand/ directory found",
      next_steps: ["Run brand_init first to create the brand system"],
      data: { error: "not_initialized" },
    });
  }

  // Build URL list
  const urls: string[] = [input.url];
  if (input.pages) {
    try {
      const additionalPages = JSON.parse(input.pages) as string[];
      if (Array.isArray(additionalPages)) {
        urls.push(...additionalPages);
      }
    } catch {
      return buildResponse({
        what_happened: "Invalid pages parameter — must be a JSON array of URL strings",
        next_steps: ["Fix the pages parameter and try again"],
        data: { error: "invalid_pages_param" },
      });
    }
  }

  // Fetch all pages
  const pageTexts: string[] = [];
  const fetchedUrls: string[] = [];

  for (const pageUrl of urls.slice(0, 10)) {
    try {
      const response = await fetch(pageUrl, {
        signal: AbortSignal.timeout(15000),
        headers: { "User-Agent": "brandsystem-mcp/0.1.0" },
      });
      const html = await response.text();
      const $ = cheerio.load(html);
      const text = extractTextContent($);
      if (text.length > 50) {
        pageTexts.push(text);
        fetchedUrls.push(pageUrl);
      }
    } catch {
      // Skip failed pages, continue with what we have
    }
  }

  if (pageTexts.length === 0) {
    return buildResponse({
      what_happened: `Failed to extract text content from any of the ${urls.length} URLs`,
      next_steps: [
        "Check the URLs are correct and accessible",
        "Make sure the pages have text content (not just images/JS)",
      ],
      data: { error: "no_content", urls },
    });
  }

  // Combine all text for analysis
  const allText = pageTexts.join("\n\n");
  const sentences = splitSentences(allText);
  const words = tokenize(allText);

  // Run analyses
  const voiceFingerprint = analyzeVoiceFingerprint(allText, sentences, words);
  const vocabularyFrequency = analyzeVocabulary(words);
  const claims = analyzeClaims(sentences);
  const aiIsms = analyzeAiIsms(allText);
  const gaps = analyzeGaps(allText, sentences, vocabularyFrequency, pageTexts);

  const audit: MessagingAuditResult = {
    voice_fingerprint: voiceFingerprint,
    vocabulary_frequency: vocabularyFrequency,
    claims,
    gaps,
  };

  // Generate and write the markdown report
  const markdown = generateAuditMarkdown(audit, aiIsms, fetchedUrls);
  await brandDir.writeMarkdown("messaging-audit.md", markdown);

  // Build summary for response
  const topDistinctive = vocabularyFrequency
    .filter((v) => v.assessment === "potentially-distinctive")
    .slice(0, 5)
    .map((v) => v.term);
  const topOverused = vocabularyFrequency
    .filter((v) => v.assessment === "overused-generic")
    .slice(0, 5)
    .map((v) => v.term);

  return buildResponse({
    what_happened: `Analyzed messaging across ${fetchedUrls.length} page(s) from ${input.url}`,
    next_steps: [
      "Present the key findings to the user: voice fingerprint scores, top vocabulary patterns, any contradictions or claims issues, and gaps",
      "Then run brand_compile_messaging to define how the brand *should* sound",
    ],
    data: {
      pages_analyzed: fetchedUrls.length,
      total_sentences: sentences.length,
      total_words: words.length,
      voice_fingerprint: {
        formality: `${voiceFingerprint.formality}/10`,
        avg_sentence_length: `${voiceFingerprint.avg_sentence_length} words`,
        active_voice: `${voiceFingerprint.active_voice_pct}%`,
        dominant_person: voiceFingerprint.tone_by_channel["dominant_person"] || "n/a",
      },
      vocabulary: {
        distinctive_terms: topDistinctive,
        overused_terms: topOverused,
      },
      claims_summary: {
        explicit_count: claims.explicit.length,
        superlative_count: claims.implicit.length,
        contradictions: claims.contradictions,
      },
      ai_isms_found: aiIsms.length,
      gaps: gaps,
      report_file: ".brand/messaging-audit.md",
      conversation_guide: {
        present_findings: "Present the key findings to the user: voice fingerprint scores, top vocabulary patterns, any contradictions or claims issues, and gaps. Then say: 'This is how your brand sounds today. Now let's define how it *should* sound. I'll walk you through defining your perspective, voice, and brand story.' Then run brand_compile_messaging.",
      },
    },
  });
}

// ─── Registration ────────────────────────────────────────────────────────────

export function register(server: McpServer) {
  server.tool(
    "brand_extract_messaging",
    "Audit a brand's existing website messaging. Analyzes voice fingerprint, vocabulary patterns, claims, AI-isms, and gaps. Writes a detailed report to .brand/messaging-audit.md. Use AFTER brand_init. Produces findings that transition into brand_compile_messaging.",
    paramsShape,
    async (args) => handler(args as { url: string; pages?: string })
  );
}
