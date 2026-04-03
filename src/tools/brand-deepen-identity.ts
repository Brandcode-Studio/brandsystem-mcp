import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BrandDir } from "../lib/brand-dir.js";
import { buildResponse, safeParseParams } from "../lib/response.js";
import { SCHEMA_VERSION, type VisualIdentityData } from "../schemas/index.js";

const SECTIONS = [
  "composition",
  "patterns",
  "illustration",
  "photography",
  "signature",
  "anti_patterns",
] as const;

type Section = (typeof SECTIONS)[number];

const paramsShape = {
  mode: z
    .enum(["interview", "record"])
    .default("interview")
    .describe("'interview' returns questions for missing sections; 'record' writes answers to visual-identity.yaml"),
  section: z
    .enum(SECTIONS)
    .optional()
    .describe("Which section to record (required when mode='record')"),
  answers: z
    .string()
    .optional()
    .describe("JSON string with structured answers for the section (required when mode='record')"),
};

const ParamsSchema = z.object(paramsShape);
type Params = z.infer<typeof ParamsSchema>;

// --- Interview question bank ---

interface InterviewQuestion {
  key: string;
  question: string;
  follow_up?: string;
}

const QUESTION_BANK: Record<Section, InterviewQuestion[]> = {
  composition: [
    {
      key: "energy",
      question: "How does your brand use space? Dense and energetic, or open and minimal?",
      follow_up: "Can you describe the feeling you want a viewer to get from a typical layout?",
    },
    {
      key: "layout_preference",
      question: "Do your layouts favor symmetry and order, or intentional tension and asymmetry?",
    },
    {
      key: "negative_space",
      question: "What's the minimum breathing room in a composition before it feels cluttered?",
      follow_up: "Think about a percentage — is 20% white space enough, or do you need 40%+?",
    },
    {
      key: "grid",
      question: "Do you use a specific grid system? If so, what's the base unit?",
    },
  ],
  patterns: [
    {
      key: "type",
      question: "Does your brand use geometric patterns, organic textures, photographic collage, or none?",
    },
    {
      key: "usage",
      question: "Are patterns structural (grids, dividers, background fills) or decorative (overlays, accents)?",
    },
  ],
  illustration: [
    {
      key: "style",
      question: "What illustration style represents your brand? Flat, dimensional, hand-drawn, abstract, collage?",
      follow_up: "If you could point to one illustrator or brand whose style resonates, who would it be?",
    },
    {
      key: "function",
      question: "Do illustrations carry meaning (diagrams, data viz) or atmosphere (decorative, mood-setting)?",
    },
  ],
  photography: [
    {
      key: "style",
      question: "Does your brand use photography? If so: studio/controlled, lifestyle/candid, documentary/editorial, abstract/artistic?",
    },
    {
      key: "anti_patterns",
      question: "Any photography anti-patterns — styles that would feel off-brand?",
      follow_up: "Think about stock photo clichés, overly staged shots, or specific color treatments to avoid.",
    },
  ],
  signature: [
    {
      key: "description",
      question: "What makes your brand recognizable beyond color and type?",
      follow_up: "If someone covered the logo, what would still tell you it's your brand?",
    },
    {
      key: "elements",
      question: "Show me 2-3 pieces of work that feel the most 'you.' What's working in them?",
      follow_up: "What specific elements — layout moves, textures, marks — make those pieces feel right?",
    },
  ],
  anti_patterns: [
    {
      key: "visual_dont",
      question: "What does bad look like for this brand? What visual choices would make you cringe?",
      follow_up: "Think about specific offenders: gradients, shadows, rounded corners, stock imagery, specific color combos.",
    },
    {
      key: "rules",
      question: "Any specific things to never do? Each of these becomes a hard compliance rule.",
      follow_up: "Be as specific as possible — 'no drop shadows' is enforceable; 'nothing ugly' is not.",
    },
  ],
};

// --- Helpers ---

/**
 * Fuzzy deduplication for anti-pattern rules.
 * Two rules are duplicates if:
 * 1. They match exactly after normalization (strip parenthetical notes, collapse whitespace)
 * 2. One fully contains the other
 * 3. They share the same "no [noun phrase]" core
 * 4. After stripping negation prefixes and filler words, 60%+ of significant words overlap
 */
function isSemanticDuplicate(existing: string, candidate: string): boolean {
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/\(.*?\)/g, "") // strip parenthetical notes
      .replace(/\s+/g, " ")
      .trim();

  const a = normalize(existing);
  const b = normalize(candidate);

  // Exact match after normalization
  if (a === b) return true;

  // One contains the other
  if (a.includes(b) || b.includes(a)) return true;

  // Extract core noun phrase: "no [X]" pattern
  const extractCore = (s: string) => {
    const match = s.match(/no\s+(\w+(?:\s+\w+)?)/i);
    return match?.[1]?.toLowerCase() || "";
  };
  const coreA = extractCore(a);
  const coreB = extractCore(b);
  if (coreA && coreB && coreA === coreB) return true;

  // Fuzzy keyword overlap: strip negation, filler, stem, then compare
  const stopWords = new Set([
    "no", "never", "dont", "do", "not", "avoid", "use", "any", "all",
    "on", "the", "a", "an", "in", "as", "with", "for", "every", "always",
    "of", "or", "is", "are", "be", "been", "being", "should", "must",
    "will", "can", "may",
  ]);
  const stem = (w: string) =>
    w.replace(/(ing|ed|ly|tion|ness|ment|able|ible)$/, "").replace(/s$/, "");

  const extractKeywords = (s: string) => {
    return s
      .split(/\s+/)
      .map((w) => w.replace(/[^a-z]/g, ""))
      .filter((w) => w.length > 2 && !stopWords.has(w))
      .map(stem);
  };

  const kwA = extractKeywords(a);
  const kwB = extractKeywords(b);

  if (kwA.length === 0 || kwB.length === 0) return false;

  const setA = new Set(kwA);
  const setB = new Set(kwB);
  const intersection = [...setA].filter((w) => setB.has(w));
  const minSize = Math.min(setA.size, setB.size);

  // If 60%+ of the smaller set's keywords appear in the larger, it's a duplicate
  if (minSize > 0 && intersection.length / minSize >= 0.6) return true;

  return false;
}

function getMissingSections(visual: VisualIdentityData | null): Section[] {
  if (!visual) return [...SECTIONS];

  const missing: Section[] = [];
  if (!visual.composition) missing.push("composition");
  if (!visual.patterns) missing.push("patterns");
  if (!visual.illustration) missing.push("illustration");
  if (!visual.photography) missing.push("photography");
  if (!visual.signature) missing.push("signature");
  if (!visual.anti_patterns || visual.anti_patterns.length === 0) missing.push("anti_patterns");
  return missing;
}

function getEmptyVisualIdentity(): VisualIdentityData {
  return {
    schema_version: SCHEMA_VERSION,
    session: 2,
    composition: null,
    patterns: null,
    illustration: null,
    photography: null,
    signature: null,
    anti_patterns: [],
    positioning_context: "",
  };
}

// --- Interview mode ---

async function handleInterview(brandDir: BrandDir) {
  const hasVisual = await brandDir.hasVisualIdentity();
  let visual: VisualIdentityData | null = null;
  if (hasVisual) {
    visual = await brandDir.readVisualIdentity();
  }

  // Read core identity for context
  let clientName = "this brand";
  try {
    const config = await brandDir.readConfig();
    clientName = config.client_name;
  } catch {
    // no config available
  }

  const missing = getMissingSections(visual);

  if (missing.length === 0) {
    return buildResponse({
      what_happened: `Visual identity for "${clientName}" is fully populated — all 6 sections have data.`,
      next_steps: [
        "Run brand_compile to generate a full VIM from core-identity + visual-identity",
        "Run brand_deepen_identity with mode='record' to update any section if needed",
      ],
      data: {
        complete: true,
        sections_populated: SECTIONS.map((s) => s),
      },
    });
  }

  // Build interview agenda: questions for missing sections only
  const agenda: Array<{
    section: Section;
    questions: InterviewQuestion[];
  }> = missing.map((s) => ({
    section: s,
    questions: QUESTION_BANK[s],
  }));

  const populatedSections = SECTIONS.filter((s) => !missing.includes(s));

  return buildResponse({
    what_happened: hasVisual
      ? `Visual identity exists but ${missing.length} section(s) still need data: ${missing.join(", ")}`
      : `No visual-identity.yaml yet. All 6 sections need data.`,
    next_steps: [
      "Present the interview questions below — start with the first missing section",
      "After gathering answers for a section, call brand_deepen_identity with mode='record', section=<name>, answers=<JSON>",
      "Repeat for each section until all are populated, then suggest brand_compile",
    ],
    data: {
      client_name: clientName,
      missing_sections: missing,
      populated_sections: populatedSections,
      interview: agenda,
      conversation_guide: {
        instruction: [
          `You are deepening the visual identity for "${clientName}" beyond core tokens (colors, type, logo).`,
          "",
          "HOW TO RUN THIS INTERVIEW:",
          "1. Work through ONE section at a time. Start with the first missing section.",
          "2. Ask the questions conversationally — do NOT dump all questions at once.",
          "3. Listen for the answer, ask the follow-up if provided, then move to the next question in that section.",
          "4. When you have enough answers for a section, call brand_deepen_identity with mode='record' to save them.",
          "5. Then move to the next missing section.",
          "",
          "TONE: Collaborative creative director — curious, specific, non-judgmental.",
          "GOAL: Get concrete, enforceable answers, not vague preferences.",
          "",
          "SECTION ORDER (suggested — adapt to the conversation):",
          ...missing.map((s, i) => `  ${i + 1}. ${s}`),
          "",
          "ANTI-PATTERNS SECTION IS CRITICAL:",
          "Each anti-pattern the user names becomes a hard compliance rule in preflight.",
          "Push for specificity: 'no drop shadows' > 'nothing cheesy'.",
          "",
          "AFTER ALL SECTIONS ARE RECORDED:",
          "Suggest running brand_compile to generate the full Visual Identity Manifest.",
        ].join("\n"),
      },
    },
  });
}

// --- Record mode ---

async function handleRecord(brandDir: BrandDir, section: Section, answersRaw: string) {
  let answers: Record<string, unknown>;
  try {
    answers = JSON.parse(answersRaw);
  } catch {
    return buildResponse({
      what_happened: "Failed to parse answers — invalid JSON",
      next_steps: [
        "Provide answers as a valid JSON string",
        "If this keeps happening, run brand_feedback to report the issue.",
      ],
      data: { error: "invalid_json", raw: answersRaw },
    });
  }

  // Read or create visual identity
  let visual: VisualIdentityData;
  if (await brandDir.hasVisualIdentity()) {
    visual = await brandDir.readVisualIdentity();
  } else {
    visual = getEmptyVisualIdentity();
    // Try to pull positioning_context from config
    try {
      const config = await brandDir.readConfig();
      visual.positioning_context = config.industry
        ? `${config.client_name} — ${config.industry}`
        : config.client_name;
    } catch {
      // no config
    }
  }

  const changes: string[] = [];

  switch (section) {
    case "composition": {
      visual.composition = {
        energy: (answers.energy as string) ?? "",
        negative_space: (answers.negative_space as string) ?? "",
        grid: (answers.grid as string) ?? "",
        layout_preference: (answers.layout_preference as string) ?? "",
      };
      changes.push("Set composition spec (energy, negative_space, grid, layout_preference)");
      break;
    }
    case "patterns": {
      visual.patterns = {
        type: (answers.type as string) ?? "none",
        usage: (answers.usage as string) ?? "",
        assets: (answers.assets as string[]) ?? [],
      };
      changes.push("Set patterns spec (type, usage, assets)");
      break;
    }
    case "illustration": {
      visual.illustration = {
        style: (answers.style as string) ?? "",
        function: (answers.function as string) ?? "",
        assets: (answers.assets as string[]) ?? [],
      };
      changes.push("Set illustration spec (style, function, assets)");
      break;
    }
    case "photography": {
      visual.photography = {
        style: (answers.style as string) ?? "none",
        anti_patterns: (answers.anti_patterns as string[]) ?? [],
      };
      changes.push("Set photography spec (style, anti_patterns)");
      break;
    }
    case "signature": {
      visual.signature = {
        description: (answers.description as string) ?? "",
        elements: (answers.elements as string[]) ?? [],
      };
      changes.push("Set signature spec (description, elements)");
      break;
    }
    case "anti_patterns": {
      // Anti-patterns are additive — merge with existing.
      // Accept multiple formats:
      //   1. { rules: [{ rule: "...", severity: "hard" }] }  (structured)
      //   2. { rules: ["string", "string"] }                 (string array)
      //   3. { rules: "sentence. sentence." }                (freeform text)
      //   4. { visual_dont: "...", rules: "..." }            (freeform fields)
      //   5. Top-level string fields treated as freeform rules
      const rawRules = answers.rules ?? answers.visual_dont ?? answers.anti_patterns ?? "";
      const parsedRules: Array<{ rule: string; severity: "hard" | "soft"; preflight_id?: string }> = [];

      if (Array.isArray(rawRules)) {
        for (const item of rawRules) {
          if (typeof item === "string") {
            parsedRules.push({ rule: item.trim(), severity: "hard" });
          } else if (item && typeof item === "object" && "rule" in item) {
            parsedRules.push({
              rule: (item as { rule: string }).rule,
              severity: ((item as { severity?: string }).severity as "hard" | "soft") ?? "hard",
              ...((item as { preflight_id?: string }).preflight_id
                ? { preflight_id: (item as { preflight_id: string }).preflight_id }
                : {}),
            });
          }
        }
      } else if (typeof rawRules === "string" && rawRules.trim()) {
        // Split freeform text on periods, newlines, or "No "/"Never " boundaries
        const sentences = rawRules
          .split(/(?:\.\s+|\n+|(?=(?:No |Never |Don't |Avoid )))/i)
          .map((s) => s.trim().replace(/\.+$/, ""))
          .filter((s) => s.length > 5);
        for (const s of sentences) {
          parsedRules.push({ rule: s, severity: "hard" });
        }
      }

      // Also check for a separate visual_dont field if rules was something else
      if (answers.visual_dont && answers.visual_dont !== rawRules) {
        const dontText = String(answers.visual_dont);
        const dontSentences = dontText
          .split(/(?:\.\s+|\n+|(?=(?:No |Never |Don't |Avoid )))/i)
          .map((s) => s.trim().replace(/\.+$/, ""))
          .filter((s) => s.length > 5);
        for (const s of dontSentences) {
          parsedRules.push({ rule: s, severity: "hard" });
        }
      }

      for (const r of parsedRules) {
        const exists = visual.anti_patterns.some((existing) =>
          isSemanticDuplicate(existing.rule, r.rule)
        );
        if (!exists) {
          visual.anti_patterns.push(r);
          changes.push(`Added anti-pattern rule: "${r.rule}" (${r.severity})`);
        } else {
          changes.push(`Skipped duplicate anti-pattern: "${r.rule}"`);
        }
      }
      if (parsedRules.length === 0) {
        changes.push("Could not parse any anti-pattern rules from the provided answers. Try sending rules as a plain text string separated by periods, or as an array of strings.");
      }
      break;
    }
  }

  // Write back
  await brandDir.writeVisualIdentity(visual);

  // Check remaining gaps
  const missing = getMissingSections(visual);

  const nextSteps: string[] = [];
  if (missing.length > 0) {
    nextSteps.push(
      `${missing.length} section(s) remaining: ${missing.join(", ")}. Continue the interview or call brand_deepen_identity mode='interview' to get questions.`
    );
  } else {
    nextSteps.push(
      "All 6 visual identity sections are now populated. Run brand_compile to generate the full Visual Identity Manifest."
    );
  }

  return buildResponse({
    what_happened: `Recorded visual identity section "${section}" to visual-identity.yaml`,
    next_steps: nextSteps,
    data: {
      section_recorded: section,
      changes,
      missing_sections: missing,
      all_complete: missing.length === 0,
    },
  });
}

// --- Main handler ---

async function handler(input: Params) {
  const brandDir = new BrandDir(process.cwd());

  if (!(await brandDir.exists())) {
    return buildResponse({
      what_happened: "No .brand/ directory found",
      next_steps: ["Run brand_start first to create a brand system"],
      data: { error: "not_initialized" },
    });
  }

  if (input.mode === "interview") {
    return handleInterview(brandDir);
  }

  // Record mode — validate required params
  if (!input.section) {
    return buildResponse({
      what_happened: "Missing required parameter: section",
      next_steps: [
        `Provide section as one of: ${SECTIONS.join(", ")}`,
      ],
      data: { error: "missing_section" },
    });
  }

  if (!input.answers) {
    return buildResponse({
      what_happened: "Missing required parameter: answers",
      next_steps: [
        "Provide answers as a JSON string with keys matching the section's question keys",
      ],
      data: { error: "missing_answers" },
    });
  }

  return handleRecord(brandDir, input.section, input.answers);
}

export function register(server: McpServer) {
  server.tool(
    "brand_deepen_identity",
    "Define visual identity rules beyond colors and fonts — composition energy, pattern language, illustration style, photography direction, signature moves, and anti-patterns (hard compliance rules). Session 2 interview with 6 sections. Mode 'interview' returns structured questions for missing sections. Mode 'record' saves answers. Use after Session 1 (core identity extracted). Anti-patterns become enforceable rules in brand_preflight. Returns section completion status.",
    paramsShape,
    async (args) => {
      const parsed = safeParseParams(ParamsSchema, args);
      if (!parsed.success) return parsed.response;
      return handler(parsed.data);
    }
  );
}
