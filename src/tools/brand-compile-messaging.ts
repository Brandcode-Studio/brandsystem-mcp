import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BrandDir } from "../lib/brand-dir.js";
import { buildResponse } from "../lib/response.js";
import type { MessagingData } from "../schemas/messaging.js";
import type {
  Perspective,
  VoiceCodex,
  BrandStory,
  AnchorTerm,
  NeverSayTerm,
} from "../types/index.js";

const SECTIONS = ["perspective", "voice", "brand_story"] as const;
type Section = (typeof SECTIONS)[number];

const paramsShape = {
  mode: z
    .enum(["interview", "record"])
    .default("interview")
    .describe("'interview' returns questions for missing sections; 'record' writes answers to messaging.yaml"),
  section: z
    .enum(SECTIONS)
    .optional()
    .describe("Which section to record (required when mode='record')"),
  answers: z
    .string()
    .optional()
    .describe("JSON string with structured answers for the section (required when mode='record')"),
};

type Params = {
  mode: "interview" | "record";
  section?: Section;
  answers?: string;
};

// --- Default AI-ism patterns ---

const DEFAULT_AI_ISM_PATTERNS = [
  "In today's [landscape/world/era]",
  "It's worth noting that",
  "Let's dive in",
  "In conclusion",
  "Unlock [your/the] potential",
  "Navigate the [landscape/complexities]",
  "At the end of the day",
  "It goes without saying",
  "Revolutionize/Transform [your/the]",
  "Cutting-edge/Best-in-class",
  "Leverage [our/your/the]",
  "Seamless/Seamlessly",
  "Empower/Empowering",
  "Delve into",
  "Holistic approach",
  "Synergy/Synergize",
  "Game-changer/Game-changing",
  "Robust [solution/platform]",
  "Elevate [your/the]",
  "Furthermore/Moreover",
];

// --- Interview question bank ---

interface InterviewQuestion {
  key: string;
  question: string;
  follow_up?: string;
  guidance?: string;
}

interface VoiceInterviewPart {
  part: string;
  label: string;
  questions: InterviewQuestion[];
  note?: string;
}

const PERSPECTIVE_QUESTIONS: InterviewQuestion[] = [
  {
    key: "worldview",
    question: "What do you believe about your industry that most people get wrong?",
    follow_up: "This is your worldview — the lens through which everything you say is filtered.",
  },
  {
    key: "tension",
    question: "What's broken about how things work today? What's the status quo you reject?",
    follow_up: "Name the specific friction or dysfunction your brand exists to fix.",
  },
  {
    key: "resolution",
    question: "If everyone adopted your worldview, what would change?",
    follow_up: "Paint the picture — what does the world look like when this tension is resolved?",
  },
  {
    key: "audience",
    question: "Who's this message for? Whose problem are you solving?",
    follow_up: "Be specific — not 'everyone' but the person who feels that tension most acutely.",
  },
  {
    key: "positioning",
    question: "In one sentence: what do you do that nobody else does?",
    follow_up: "Not your tagline — your actual competitive differentiation.",
  },
  {
    key: "one_liner",
    question: "If you had to capture it in a tagline — 3 to 5 words?",
    follow_up: "Short, punchy, memorable. This becomes your one-liner.",
  },
];

const VOICE_INTERVIEW_PARTS: VoiceInterviewPart[] = [
  {
    part: "1",
    label: "Tone",
    questions: [
      {
        key: "descriptors",
        question: "Describe your brand's voice in exactly three words.",
        follow_up: "These three words define your tonal range. Everything you write should fit within them.",
      },
      {
        key: "register",
        question: "Your brand sounds like a _____ talking to a _____.",
        follow_up: "Example: 'a sharp colleague talking to a peer' or 'an expert talking to a curious beginner.'",
      },
      {
        key: "never_sounds_like",
        question: "What's the one thing your brand never sounds like?",
        follow_up: "This is your negative constraint — the voice you'd fire someone for using.",
      },
    ],
  },
  {
    part: "2",
    label: "Vocabulary",
    questions: [
      {
        key: "anchor_terms",
        question: "What words should your brand ALWAYS use instead of generic alternatives? Format: use X not Y because Z.",
        follow_up: "These are your anchor terms — words that signal your brand's specific worldview.",
      },
      {
        key: "never_say",
        question: "What words should your brand NEVER use?",
        follow_up: "Format: word — reason. Example: 'synergy — corporate cliche that signals hollow thinking.'",
      },
    ],
    note: "If messaging-audit.md exists, the audit's top vocabulary will be presented for keep/replace/ban triage before these questions.",
  },
  {
    part: "3",
    label: "Sentence Rules",
    questions: [
      {
        key: "exclamation_marks",
        question: "Exclamation marks: never, rarely, or freely?",
      },
      {
        key: "hedging",
        question: "Hedging language (can, may, might): ban, minimize, or allow?",
      },
      {
        key: "person",
        question: "Person: we, I, or you-focused?",
        follow_up: "Most brands use 'we' for company voice. Some founders use 'I'. Which is yours?",
      },
      {
        key: "oxford_comma",
        question: "Oxford comma: yes or no?",
      },
    ],
  },
];

const BRAND_STORY_QUESTIONS: InterviewQuestion[] = [
  {
    key: "origin",
    question: "How did this company start? What was the founding insight or frustration? If you don't know the full answer, that's OK — give me what you can. We can refine later.",
    follow_up: "Not the press release version — the real story.",
    guidance: "Check your About page, LinkedIn company page, or ask the founder. If you're a team member (not the founder), share what you know and mark it for founder review.",
  },
  {
    key: "tension",
    question: "What obstacle or broken system did you run into? If you don't know the full answer, that's OK — give me what you can. We can refine later.",
    follow_up: "Every good story has tension. What was the wall you hit?",
    guidance: "Check your About page, LinkedIn company page, or ask the founder. If you're a team member (not the founder), share what you know and mark it for founder review.",
  },
  {
    key: "resolution",
    question: "What did you build or discover that resolved it? If you don't know the full answer, that's OK — give me what you can. We can refine later.",
    follow_up: "This is the turning point — how did you overcome the obstacle?",
    guidance: "Check your About page, LinkedIn company page, or ask the founder. If you're a team member (not the founder), share what you know and mark it for founder review.",
  },
  {
    key: "vision",
    question: "Where are you going? What does the next chapter look like? If you don't know the full answer, that's OK — give me what you can. We can refine later.",
    follow_up: "Not a 5-year plan — the narrative arc. What are you building toward?",
    guidance: "Check your About page, LinkedIn company page, or ask the founder. If you're a team member (not the founder), share what you know and mark it for founder review.",
  },
  {
    key: "tagline",
    question: "If you could put the whole thing in one sentence? If you don't know the full answer, that's OK — give me what you can. We can refine later.",
    follow_up: "The origin, the tension, the resolution — compressed into a single line.",
    guidance: "Check your About page, LinkedIn company page, or ask the founder. If you're a team member (not the founder), share what you know and mark it for founder review.",
  },
];

// --- Helpers ---

function getEmptyMessaging(): MessagingData {
  return {
    schema_version: "0.1.0",
    session: 3,
    perspective: null,
    voice: null,
    brand_story: null,
  };
}

function getMissingSections(messaging: MessagingData | null): Section[] {
  if (!messaging) return [...SECTIONS];

  const missing: Section[] = [];
  if (!messaging.perspective) missing.push("perspective");
  if (!messaging.voice) missing.push("voice");
  if (!messaging.brand_story) missing.push("brand_story");
  return missing;
}

/** Safely parse a value as a string array — handles string, string[], and comma-separated text */
function parseStringArray(val: unknown): string[] {
  if (Array.isArray(val)) {
    return val.map((v) => String(v).trim()).filter((v) => v.length > 0);
  }
  if (typeof val === "string" && val.trim()) {
    // Split on commas, newlines, or semicolons
    return val
      .split(/[,;\n]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  return [];
}

/** Parse anchor terms from various formats */
function parseAnchorTerms(val: unknown): AnchorTerm[] {
  if (Array.isArray(val)) {
    return val.map((item) => {
      if (typeof item === "object" && item !== null && "use" in item) {
        return {
          use: String((item as Record<string, unknown>).use ?? ""),
          not: String((item as Record<string, unknown>).not ?? ""),
          reason: String((item as Record<string, unknown>).reason ?? ""),
        };
      }
      // Freeform string: "use X not Y because Z" or "X instead of Y — Z"
      return parseAnchorTermFromString(String(item));
    });
  }
  if (typeof val === "string" && val.trim()) {
    // Split on newlines or semicolons to get individual terms
    const lines = val
      .split(/[;\n]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    return lines.map(parseAnchorTermFromString);
  }
  return [];
}

function parseAnchorTermFromString(raw: string): AnchorTerm {
  // Pattern: "use X not Y because Z"
  const useNotMatch = raw.match(/^(?:use\s+)?["']?(.+?)["']?\s+(?:not|instead of)\s+["']?(.+?)["']?\s*(?:because|—|--|:)\s*(.+)$/i);
  if (useNotMatch) {
    return { use: useNotMatch[1].trim(), not: useNotMatch[2].trim(), reason: useNotMatch[3].trim() };
  }
  // Pattern: "X → Y (reason)" or "X -> Y (reason)"
  const arrowMatch = raw.match(/^["']?(.+?)["']?\s*(?:→|->)\s*["']?(.+?)["']?\s*(?:\((.+?)\))?$/);
  if (arrowMatch) {
    return { use: arrowMatch[1].trim(), not: arrowMatch[2].trim(), reason: arrowMatch[3]?.trim() ?? "" };
  }
  // Fallback: treat the whole string as the "use" term
  return { use: raw.trim(), not: "", reason: "" };
}

/** Parse never-say terms from various formats */
function parseNeverSayTerms(val: unknown): NeverSayTerm[] {
  if (Array.isArray(val)) {
    return val.map((item) => {
      if (typeof item === "object" && item !== null && "word" in item) {
        return {
          word: String((item as Record<string, unknown>).word ?? ""),
          reason: String((item as Record<string, unknown>).reason ?? ""),
        };
      }
      return parseNeverSayFromString(String(item));
    });
  }
  if (typeof val === "string" && val.trim()) {
    const lines = val
      .split(/[;\n]+/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    return lines.map(parseNeverSayFromString);
  }
  return [];
}

function parseNeverSayFromString(raw: string): NeverSayTerm {
  // Pattern: "ban: word — reason" or "word — reason" or "word: reason"
  const banMatch = raw.match(/^(?:ban:\s*)?["']?(.+?)["']?\s*(?:—|--|:)\s*(.+)$/i);
  if (banMatch) {
    return { word: banMatch[1].trim(), reason: banMatch[2].trim() };
  }
  return { word: raw.trim(), reason: "" };
}

// --- Interview mode ---

async function handleInterview(brandDir: BrandDir) {
  const hasMessaging = await brandDir.hasMessaging();
  let messaging: MessagingData | null = null;
  if (hasMessaging) {
    messaging = await brandDir.readMessaging();
  }

  // Read client name for context
  let clientName = "this brand";
  try {
    const config = await brandDir.readConfig();
    clientName = config.client_name;
  } catch {
    // no config available
  }

  // Check for messaging-audit.md
  let auditVocabulary: string | null = null;
  try {
    const auditContent = await brandDir.readMarkdown("messaging-audit.md");
    // Extract vocabulary frequency section if it exists
    const vocabMatch = auditContent.match(/vocabulary.frequency[\s\S]*?(?=##|$)/i);
    if (vocabMatch) {
      auditVocabulary = vocabMatch[0].trim();
    }
  } catch {
    // no audit file
  }

  const missing = getMissingSections(messaging);

  if (missing.length === 0) {
    return buildResponse({
      what_happened: `Messaging architecture for "${clientName}" is fully populated — all 3 sections have data.`,
      next_steps: [
        "Run brand_compile to regenerate system-integration.md with voice rules included",
        "Run brand_compile_messaging with mode='record' to update any section if needed",
        "Try generating content with brand_write to test the full system",
      ],
      data: {
        complete: true,
        sections_populated: SECTIONS.map((s) => s),
      },
    });
  }

  // Build interview agenda for missing sections
  const agenda: Array<Record<string, unknown>> = [];

  if (missing.includes("perspective")) {
    agenda.push({
      section: "perspective",
      questions: PERSPECTIVE_QUESTIONS,
    });
  }

  if (missing.includes("voice")) {
    const voiceParts = VOICE_INTERVIEW_PARTS.map((part) => ({
      ...part,
      ...(part.part === "2" && auditVocabulary
        ? {
            audit_vocabulary: auditVocabulary,
            pre_question:
              "Before we create new vocabulary rules, here's what I found in your existing content. For each term, tell me: keep (distinctly yours), replace (generic), or ban (harmful).",
          }
        : {}),
    }));
    agenda.push({
      section: "voice",
      parts: voiceParts,
      ai_ism_defaults: DEFAULT_AI_ISM_PATTERNS,
      ai_ism_note:
        "These are the default AI-ism patterns that will be flagged in generated content. Ask if they want to add, remove, or adjust any.",
    });
  }

  if (missing.includes("brand_story")) {
    agenda.push({
      section: "brand_story",
      questions: BRAND_STORY_QUESTIONS,
    });
  }

  const populatedSections = SECTIONS.filter((s) => !missing.includes(s));

  return buildResponse({
    what_happened: hasMessaging
      ? `Messaging exists but ${missing.length} section(s) still need data: ${missing.join(", ")}`
      : `No messaging.yaml yet. All 3 sections need data.`,
    next_steps: [
      "Present the interview questions below — start with the first missing section",
      "After gathering answers for a section, call brand_compile_messaging with mode='record', section=<name>, answers=<JSON>",
      "Repeat for each section until all are populated",
    ],
    data: {
      client_name: clientName,
      missing_sections: missing,
      populated_sections: populatedSections,
      interview: agenda,
      conversation_guide: {
        instruction: [
          `You are building the messaging architecture for "${clientName}". This is Session 3 — perspective, voice, and brand story.`,
          "",
          "HOW TO RUN THIS INTERVIEW:",
          "1. Work through ONE section at a time in order: perspective → voice → brand story.",
          "2. Ask the questions conversationally — do NOT dump all questions at once.",
          "3. Listen for the answer, ask the follow-up if provided, then move to the next question.",
          "4. When you have enough answers for a section, call brand_compile_messaging with mode='record' to save.",
          "5. Then move to the next missing section.",
          "",
          "SECTION INTROS (use these to transition):",
          "",
          "PERSPECTIVE:",
          `"Let's define what your brand actually believes. Not your mission statement — your *worldview*."`,
          "",
          "VOICE:",
          `"Now that we know what you believe, let's define how it sounds."`,
          "Voice has 3 parts: Tone (3 descriptors + register), Vocabulary (anchor terms + never-say), and Sentence Rules.",
          "Work through each part sequentially.",
          ...(auditVocabulary
            ? [
                "",
                "VOCABULARY TRIAGE (voice part 2):",
                "A messaging audit exists. Before asking for new vocabulary, present the audit's top terms and ask: keep, replace, or ban.",
              ]
            : []),
          "",
          "BRAND STORY:",
          `"Last part — your origin story. Not a mission statement, but an actual story with tension and stakes. If you don't know all the details, that's completely fine — give me what you know and we'll flag the rest for the founder or leadership team to fill in."`,
          "",
          "AFTER ALL SECTIONS ARE RECORDED:",
          `"Your messaging architecture is set. Want to test it? Give me a content type and a topic and I'll generate something using your full brand system."`,
          "Suggest running brand_write to test the full system.",
          "",
          "TONE: Collaborative strategist — curious, direct, non-judgmental.",
          "GOAL: Get specific, deployable language — not corporate mush.",
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
      next_steps: ["Provide answers as a valid JSON string"],
      data: { error: "invalid_json", raw: answersRaw },
    });
  }

  // Read or create messaging
  let messaging: MessagingData;
  if (await brandDir.hasMessaging()) {
    messaging = await brandDir.readMessaging();
  } else {
    messaging = getEmptyMessaging();
  }

  const changes: string[] = [];

  switch (section) {
    case "perspective": {
      messaging.perspective = parsePerspective(answers);
      changes.push(
        "Set perspective (worldview, tension, resolution, audience, positioning, one_liner)"
      );
      break;
    }
    case "voice": {
      messaging.voice = parseVoice(answers);
      changes.push("Set voice codex (tone, vocabulary, ai-ism detection)");
      break;
    }
    case "brand_story": {
      messaging.brand_story = parseBrandStory(answers);
      changes.push("Set brand story (origin, tension, resolution, vision, tagline)");

      // Detect thin or empty fields and flag for refinement
      const storyFields: Array<{ key: string; label: string }> = [
        { key: "origin", label: "Origin" },
        { key: "tension", label: "Tension" },
        { key: "resolution", label: "Resolution" },
        { key: "vision", label: "Vision" },
        { key: "tagline", label: "Tagline" },
      ];
      const thinFields = storyFields.filter((f) => {
        const val = messaging.brand_story?.[f.key as keyof BrandStory] ?? "";
        return val.length < 20;
      });
      if (thinFields.length > 0) {
        const fieldNames = thinFields.map((f) => f.label).join(", ");
        changes.push(
          `Note: ${fieldNames} ${thinFields.length === 1 ? "is" : "are"} thin or empty — consider revisiting with the founder or leadership team to add more detail.`
        );
      }

      // Generate brand-story.md as human-readable markdown
      const storyMd = generateBrandStoryMarkdown(messaging.brand_story);
      await brandDir.writeMarkdown("brand-story.md", storyMd);
      changes.push("Generated brand-story.md (human-readable narrative)");
      break;
    }
  }

  // Write messaging.yaml
  await brandDir.writeMessaging(messaging);

  // Check remaining gaps
  const missing = getMissingSections(messaging);

  const nextSteps: string[] = [];

  if (missing.length > 0) {
    nextSteps.push(
      `${missing.length} section(s) remaining: ${missing.join(", ")}. Continue the interview or call brand_compile_messaging mode='interview' to get questions.`
    );
  } else {
    // All 3 sections complete — bump session and generate system integration
    try {
      const config = await brandDir.readConfig();
      if (config.session < 3) {
        config.session = 3;
        await brandDir.writeConfig(config);
        changes.push("Bumped config.session to 3");
      }

      // Regenerate system-integration.md with voice rules
      if (await brandDir.hasVisualIdentity()) {
        const identity = await brandDir.readCoreIdentity();
        const visual = await brandDir.readVisualIdentity();
        const { generateSystemIntegration } = await import("../lib/vim-generator.js");
        let integrationMd = generateSystemIntegration(config, identity, visual);
        integrationMd = appendVoiceRulesToIntegration(integrationMd, messaging);
        await brandDir.writeMarkdown("system-integration.md", integrationMd);
        changes.push("Updated system-integration.md with voice rules");
      }
    } catch {
      // Config or visual identity may not exist; non-fatal
    }

    nextSteps.push(
      "All 3 messaging sections are now populated. Your messaging architecture is complete.",
      "Run brand_compile to regenerate the full brand system output with messaging integrated.",
      "Try running brand_write to test content generation with your full brand system."
    );
  }

  return buildResponse({
    what_happened: `Recorded messaging section "${section}" to messaging.yaml`,
    next_steps: nextSteps,
    data: {
      section_recorded: section,
      changes,
      missing_sections: missing,
      all_complete: missing.length === 0,
    },
  });
}

// --- Parsers with freeform text fallbacks ---

function parsePerspective(answers: Record<string, unknown>): Perspective {
  return {
    worldview: String(answers.worldview ?? ""),
    tension: String(answers.tension ?? ""),
    resolution: String(answers.resolution ?? ""),
    audience: String(answers.audience ?? ""),
    positioning: String(answers.positioning ?? ""),
    one_liner: String(answers.one_liner ?? ""),
  };
}

function parseVoice(answers: Record<string, unknown>): VoiceCodex {
  // --- Tone ---
  const tone = (answers.tone as Record<string, unknown>) ?? answers;

  // Descriptors: accept array, string of 3 words, or comma-separated
  const rawDescriptors = tone.descriptors ?? answers.descriptors ?? "";
  const descriptors = parseStringArray(rawDescriptors);

  const register = String(tone.register ?? answers.register ?? "");
  const neverSoundsLike = String(
    tone.never_sounds_like ?? answers.never_sounds_like ?? ""
  );

  // --- Sentence rules ---
  const sentenceRules =
    (answers.sentence_rules as Record<string, unknown>) ??
    (answers.conventions as Record<string, unknown>) ??
    answers;

  const exclamation = String(
    sentenceRules.exclamation_marks ??
      answers.exclamation_marks ??
      "rarely"
  );
  const hedging = String(
    sentenceRules.hedging ?? answers.hedging ?? "minimize"
  );
  const person = String(
    sentenceRules.person ?? answers.person ?? "we"
  );
  const oxfordCommaRaw =
    sentenceRules.oxford_comma ?? answers.oxford_comma ?? true;
  const oxfordComma =
    typeof oxfordCommaRaw === "boolean"
      ? oxfordCommaRaw
      : String(oxfordCommaRaw).toLowerCase().startsWith("y") ||
        String(oxfordCommaRaw).toLowerCase() === "true";

  // Build sentence_patterns from exclamation/hedging preferences
  const preferPatterns: string[] = [];
  const avoidPatterns: string[] = [];

  if (exclamation === "never") {
    avoidPatterns.push("Exclamation marks in any context");
  } else if (exclamation === "rarely") {
    avoidPatterns.push("Exclamation marks except in genuinely exceptional moments");
  }

  if (hedging === "ban") {
    avoidPatterns.push("Hedging language: can, may, might, perhaps, possibly");
  } else if (hedging === "minimize") {
    avoidPatterns.push("Excessive hedging (can, may, might) — use direct statements");
  }

  preferPatterns.push(`${person}-focused voice`);

  // --- Vocabulary ---
  const vocab =
    (answers.vocabulary as Record<string, unknown>) ?? answers;

  const anchorTerms = parseAnchorTerms(
    vocab.anchor ?? vocab.anchor_terms ?? answers.anchor_terms ?? []
  );
  const neverSayTerms = parseNeverSayTerms(
    vocab.never_say ?? answers.never_say ?? []
  );
  const jargonPolicy = String(
    vocab.jargon_policy ?? answers.jargon_policy ?? "define on first use"
  );

  // Placeholder defaults
  const placeholderDefaults =
    (vocab.placeholder_defaults as Record<string, unknown>) ??
    (answers.placeholder_defaults as Record<string, unknown>) ??
    {};

  // --- AI-ism detection ---
  const aiIsm =
    (answers.ai_ism_detection as Record<string, unknown>) ?? answers;
  const rawPatterns =
    aiIsm.patterns ?? answers.ai_ism_patterns ?? DEFAULT_AI_ISM_PATTERNS;
  const aiPatterns = parseStringArray(rawPatterns);
  const aiInstruction = String(
    aiIsm.instruction ??
      answers.ai_ism_instruction ??
      "Flag and rewrite any sentence matching these patterns. Replace with specific, concrete language."
  );

  return {
    tone: {
      descriptors: descriptors.length > 0 ? descriptors : [],
      register,
      never_sounds_like: neverSoundsLike,
      sentence_patterns: {
        prefer: preferPatterns,
        avoid: avoidPatterns,
      },
      conventions: {
        person,
        reader_address: "you",
        oxford_comma: oxfordComma,
        sentence_length: 18,
        paragraph_length: 3,
      },
    },
    vocabulary: {
      anchor: anchorTerms,
      never_say: neverSayTerms,
      jargon_policy: jargonPolicy,
      placeholder_defaults: {
        headline: String(placeholderDefaults.headline ?? ""),
        subhead: String(placeholderDefaults.subhead ?? ""),
        cta: String(placeholderDefaults.cta ?? ""),
        body_paragraph: String(placeholderDefaults.body_paragraph ?? ""),
      },
    },
    ai_ism_detection: {
      patterns: aiPatterns.length > 0 ? aiPatterns : DEFAULT_AI_ISM_PATTERNS,
      instruction: aiInstruction,
    },
  };
}

function parseBrandStory(answers: Record<string, unknown>): BrandStory {
  return {
    origin: String(answers.origin ?? ""),
    tension: String(answers.tension ?? ""),
    resolution: String(answers.resolution ?? ""),
    vision: String(answers.vision ?? ""),
    tagline: String(answers.tagline ?? ""),
  };
}

// --- Markdown generators ---

function generateBrandStoryMarkdown(story: BrandStory): string {
  const lines: string[] = [];
  lines.push("# Brand Story");
  lines.push("");
  lines.push(`> ${story.tagline}`);
  lines.push("");
  lines.push("## Origin");
  lines.push("");
  lines.push(story.origin);
  lines.push("");
  lines.push("## Tension");
  lines.push("");
  lines.push(story.tension);
  lines.push("");
  lines.push("## Resolution");
  lines.push("");
  lines.push(story.resolution);
  lines.push("");
  lines.push("## Vision");
  lines.push("");
  lines.push(story.vision);
  lines.push("");
  return lines.join("\n");
}

function appendVoiceRulesToIntegration(
  existingMd: string,
  messaging: MessagingData
): string {
  const lines: string[] = [existingMd.trimEnd()];
  lines.push("");
  lines.push("");

  // --- Voice Rules Section ---
  lines.push("## Voice & Messaging");
  lines.push("");

  if (messaging.perspective) {
    lines.push("### Perspective");
    lines.push(`- **Worldview:** ${messaging.perspective.worldview}`);
    lines.push(`- **Tension:** ${messaging.perspective.tension}`);
    lines.push(`- **Positioning:** ${messaging.perspective.positioning}`);
    if (messaging.perspective.one_liner) {
      lines.push(`- **One-liner:** ${messaging.perspective.one_liner}`);
    }
    lines.push("");
  }

  if (messaging.voice) {
    const v = messaging.voice;
    lines.push("### Voice Rules");
    lines.push("");

    if (v.tone.descriptors.length > 0) {
      lines.push(`**Tone:** ${v.tone.descriptors.join(", ")}`);
    }
    if (v.tone.register) {
      lines.push(`**Register:** ${v.tone.register}`);
    }
    if (v.tone.never_sounds_like) {
      lines.push(`**Never sounds like:** ${v.tone.never_sounds_like}`);
    }
    lines.push("");

    if (v.vocabulary.anchor.length > 0) {
      lines.push("**Anchor Terms (ALWAYS use these):**");
      for (const t of v.vocabulary.anchor) {
        const reason = t.reason ? ` — ${t.reason}` : "";
        lines.push(`- Use "${t.use}" not "${t.not}"${reason}`);
      }
      lines.push("");
    }

    if (v.vocabulary.never_say.length > 0) {
      lines.push("**Never Say:**");
      for (const t of v.vocabulary.never_say) {
        const reason = t.reason ? ` — ${t.reason}` : "";
        lines.push(`- ${t.word}${reason}`);
      }
      lines.push("");
    }

    lines.push("**Conventions:**");
    lines.push(`- Person: ${v.tone.conventions.person}`);
    lines.push(`- Oxford comma: ${v.tone.conventions.oxford_comma ? "yes" : "no"}`);
    lines.push(`- Target sentence length: ${v.tone.conventions.sentence_length} words`);
    lines.push("");

    if (v.ai_ism_detection.patterns.length > 0) {
      lines.push("**AI-ism Detection (flag and rewrite):**");
      for (const p of v.ai_ism_detection.patterns.slice(0, 10)) {
        lines.push(`- "${p}"`);
      }
      if (v.ai_ism_detection.patterns.length > 10) {
        lines.push(`- ... and ${v.ai_ism_detection.patterns.length - 10} more patterns`);
      }
      lines.push("");
    }
  }

  if (messaging.brand_story) {
    lines.push("### Brand Story");
    lines.push(`> ${messaging.brand_story.tagline}`);
    lines.push("");
  }

  return lines.join("\n");
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
    "brand_compile_messaging",
    "Capture brand messaging — perspective, voice codex, and brand story. Two modes: 'interview' reads current state and returns structured questions for missing sections; 'record' writes answers to messaging.yaml for a specific section. Perspective defines worldview and positioning. Voice codex defines tone, vocabulary (anchor terms, never-say list), sentence conventions, and AI-ism detection patterns. Brand story captures the origin narrative. Use AFTER visual identity is populated (Session 2). All 3 sections complete triggers Session 3 — bumps config, regenerates system-integration.md with voice rules, and generates brand-story.md.",
    paramsShape,
    async (args) => handler(args as Params)
  );
}
