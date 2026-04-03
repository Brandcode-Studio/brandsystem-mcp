import type { VisualIdentityData, MessagingData, ContentStrategyData } from "../schemas/index.js";

export interface InteractionPolicy {
  version: string;
  compiled_at: string;
  visual_rules: PolicyRule[];
  voice_rules: VoicePolicyRules;
  content_rules: ContentPolicyRules;
}

export interface PolicyRule {
  id: string;
  rule: string;
  severity: "hard" | "soft";
  category: "visual" | "voice" | "content";
}

export interface VoicePolicyRules {
  never_say: string[];
  ai_ism_patterns: string[];
  tone_constraints: {
    never_sounds_like: string;
    avoid_patterns: string[];
  } | null;
  sentence_patterns: {
    prefer: string[];
    avoid: string[];
  } | null;
}

export interface ContentPolicyRules {
  claims_policies: Array<{
    stage: string;
    max_per_piece: number | null;
  }>;
  persona_count: number;
}

/**
 * Compile interaction-policy.json from brand data.
 * This is the automated rules engine — the enforceable subset of the brand system.
 * Visual anti-patterns become hard/soft rules. Voice constraints become guardrails.
 */
export function compileInteractionPolicy(
  schemaVersion: string,
  visual: VisualIdentityData | null,
  messaging: MessagingData | null,
  strategy: ContentStrategyData | null,
): InteractionPolicy {
  return {
    version: schemaVersion,
    compiled_at: new Date().toISOString(),
    visual_rules: compileVisualRules(visual),
    voice_rules: compileVoiceRules(messaging),
    content_rules: compileContentRules(strategy),
  };
}

function compileVisualRules(visual: VisualIdentityData | null): PolicyRule[] {
  if (!visual) return [];

  return visual.anti_patterns.map((ap, i) => ({
    id: ap.preflight_id ?? `visual-${i + 1}`,
    rule: ap.rule,
    severity: ap.severity,
    category: "visual" as const,
  }));
}

function compileVoiceRules(messaging: MessagingData | null): VoicePolicyRules {
  if (!messaging?.voice) {
    return {
      never_say: [],
      ai_ism_patterns: [],
      tone_constraints: null,
      sentence_patterns: null,
    };
  }

  const voice = messaging.voice;
  return {
    never_say: voice.vocabulary.never_say.map(ns => ns.word),
    ai_ism_patterns: voice.ai_ism_detection.patterns,
    tone_constraints: {
      never_sounds_like: voice.tone.never_sounds_like,
      avoid_patterns: voice.tone.sentence_patterns.avoid,
    },
    sentence_patterns: {
      prefer: voice.tone.sentence_patterns.prefer,
      avoid: voice.tone.sentence_patterns.avoid,
    },
  };
}

function compileContentRules(strategy: ContentStrategyData | null): ContentPolicyRules {
  if (!strategy) {
    return { claims_policies: [], persona_count: 0 };
  }

  return {
    claims_policies: strategy.journey_stages.map(js => ({
      stage: js.name,
      max_per_piece: js.claims_policy.max_per_piece,
    })),
    persona_count: strategy.personas.filter(p => p.status === "Active").length,
  };
}
