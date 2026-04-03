import type { BrandConfigData, CoreIdentityData, VisualIdentityData, MessagingData, ContentStrategyData } from "../schemas/index.js";
import { isTokenWorthy } from "./confidence.js";

export interface BrandRuntime {
  version: string;
  client_name: string;
  compiled_at: string;
  sessions_completed: number;
  identity: RuntimeIdentity;
  visual: RuntimeVisual | null;
  voice: RuntimeVoice | null;
  strategy: RuntimeStrategy | null;
}

export interface RuntimeIdentity {
  colors: Record<string, string>;
  typography: Record<string, string>;
  logo: { type: string; has_svg: boolean } | null;
}

export interface RuntimeVisual {
  composition: { energy: string; grid: string; layout: string } | null;
  signature: { description: string; elements: string[] } | null;
  anti_patterns: string[];
}

export interface RuntimeVoice {
  tone_descriptors: string[];
  register: string;
  never_sounds_like: string;
  anchor_terms: Record<string, string>;
  never_say: string[];
  jargon_policy: string;
  ai_ism_patterns: string[];
  conventions: {
    person: string;
    reader_address: string;
    oxford_comma: boolean;
    sentence_length: number;
  };
}

export interface RuntimeStrategy {
  persona_count: number;
  persona_names: string[];
  journey_stages: string[];
  theme_count: number;
  matrix_size: number;
}

/**
 * Compile the 4 source YAMLs into a single brand-runtime.json.
 * This is the contract an AI agent reads to produce on-brand content.
 * Only includes token-worthy (medium+ confidence) values.
 */
export function compileRuntime(
  config: BrandConfigData,
  identity: CoreIdentityData,
  visual: VisualIdentityData | null,
  messaging: MessagingData | null,
  strategy: ContentStrategyData | null,
): BrandRuntime {
  return {
    version: config.schema_version,
    client_name: config.client_name,
    compiled_at: new Date().toISOString(),
    sessions_completed: config.session,
    identity: compileIdentity(identity),
    visual: visual ? compileVisual(visual) : null,
    voice: messaging?.voice ? compileVoice(messaging) : null,
    strategy: strategy ? compileStrategy(strategy) : null,
  };
}

function compileIdentity(identity: CoreIdentityData): RuntimeIdentity {
  const colors: Record<string, string> = {};
  for (const c of identity.colors) {
    if (!isTokenWorthy(c.confidence)) continue;
    const key = c.role === "unknown" ? c.name : c.role;
    colors[key] = c.value;
  }

  const typography: Record<string, string> = {};
  for (const t of identity.typography) {
    if (!isTokenWorthy(t.confidence)) continue;
    typography[t.name] = t.family;
  }

  const logo = identity.logo.length > 0
    ? {
        type: identity.logo[0].type,
        has_svg: identity.logo[0].variants.some(v => !!v.inline_svg),
      }
    : null;

  return { colors, typography, logo };
}

function compileVisual(visual: VisualIdentityData): RuntimeVisual {
  return {
    composition: visual.composition
      ? {
          energy: visual.composition.energy,
          grid: visual.composition.grid,
          layout: visual.composition.layout_preference,
        }
      : null,
    signature: visual.signature
      ? {
          description: visual.signature.description,
          elements: visual.signature.elements,
        }
      : null,
    anti_patterns: visual.anti_patterns
      .filter(ap => ap.severity === "hard")
      .map(ap => ap.rule),
  };
}

function compileVoice(messaging: MessagingData): RuntimeVoice | null {
  const voice = messaging.voice;
  if (!voice) return null;

  const anchorTerms: Record<string, string> = {};
  for (const a of voice.vocabulary.anchor) {
    anchorTerms[a.use] = a.not;
  }

  return {
    tone_descriptors: voice.tone.descriptors,
    register: voice.tone.register,
    never_sounds_like: voice.tone.never_sounds_like,
    anchor_terms: anchorTerms,
    never_say: voice.vocabulary.never_say.map(ns => ns.word),
    jargon_policy: voice.vocabulary.jargon_policy,
    ai_ism_patterns: voice.ai_ism_detection.patterns,
    conventions: {
      person: voice.tone.conventions.person,
      reader_address: voice.tone.conventions.reader_address,
      oxford_comma: voice.tone.conventions.oxford_comma,
      sentence_length: voice.tone.conventions.sentence_length,
    },
  };
}

function compileStrategy(strategy: ContentStrategyData): RuntimeStrategy {
  return {
    persona_count: strategy.personas.length,
    persona_names: strategy.personas
      .filter(p => p.status === "Active")
      .map(p => p.name),
    journey_stages: strategy.journey_stages.map(js => js.name),
    theme_count: strategy.themes.filter(t => t.status === "Active").length,
    matrix_size: strategy.messaging_matrix.filter(m => m.status === "Active").length,
  };
}
