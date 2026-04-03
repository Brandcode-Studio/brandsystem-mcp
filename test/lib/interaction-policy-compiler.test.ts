import { describe, it, expect } from 'vitest';
import { compileInteractionPolicy } from '../../src/lib/interaction-policy-compiler.js';
import type { VisualIdentityData } from '../../src/schemas/visual-identity.js';
import type { MessagingData } from '../../src/schemas/messaging.js';
import type { ContentStrategyData } from '../../src/schemas/strategy.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type AntiPatternRule = VisualIdentityData['anti_patterns'][number];
type VoiceCodex = NonNullable<MessagingData['voice']>;
type NeverSayTerm = VoiceCodex['vocabulary']['never_say'][number];
type Persona = ContentStrategyData['personas'][number];
type JourneyStage = ContentStrategyData['journey_stages'][number];
type ContentTheme = ContentStrategyData['themes'][number];

function makeAntiPattern(overrides: Partial<AntiPatternRule> = {}): AntiPatternRule {
  return {
    rule: 'Do not stretch the logo',
    severity: 'hard',
    ...overrides,
  };
}

function makeNeverSayTerm(overrides: Partial<NeverSayTerm> = {}): NeverSayTerm {
  return {
    word: 'synergy',
    reason: 'overused buzzword',
    ...overrides,
  };
}

function makeVoiceCodex(overrides: Partial<VoiceCodex> = {}): VoiceCodex {
  return {
    tone: {
      descriptors: ['confident', 'warm'],
      register: 'professional-casual',
      never_sounds_like: 'a corporate press release',
      sentence_patterns: {
        prefer: ['short declarative sentences'],
        avoid: ['passive voice'],
      },
      conventions: {
        person: 'first plural',
        reader_address: 'you',
        oxford_comma: true,
        sentence_length: 20,
        paragraph_length: 3,
      },
    },
    vocabulary: {
      anchor: [],
      never_say: [makeNeverSayTerm()],
      jargon_policy: 'define on first use',
      placeholder_defaults: {
        headline: 'Bold claim here',
        subhead: 'Supporting context',
        cta: 'Learn more',
        body_paragraph: 'Explain the value.',
      },
    },
    ai_ism_detection: {
      patterns: ['dive into', 'leverage'],
      instruction: 'Rewrite without these phrases',
    },
    ...overrides,
  };
}

function makeVisual(overrides: Partial<VisualIdentityData> = {}): VisualIdentityData {
  return {
    schema_version: '0.1.0',
    session: 2,
    composition: null,
    patterns: null,
    illustration: null,
    photography: null,
    signature: null,
    anti_patterns: [],
    positioning_context: 'Premium B2B SaaS brand',
    ...overrides,
  };
}

function makeMessaging(overrides: Partial<MessagingData> = {}): MessagingData {
  return {
    schema_version: '0.1.0',
    session: 3,
    perspective: null,
    voice: null,
    brand_story: null,
    ...overrides,
  };
}

function makePersona(overrides: Partial<Persona> = {}): Persona {
  return {
    id: 'persona-cmo',
    name: 'Marketing Mary',
    role_tag: 'CMO',
    seniority: 'C-suite',
    decision_authority: 'final',
    status: 'Active',
    core_tension: 'Needs ROI proof but values creativity',
    key_objections: ['Too expensive', 'Hard to measure'],
    information_needs: {
      first_touch: 'Industry context',
      context_and_meaning: 'How it fits their stack',
      validation_and_proof: 'Case studies and metrics',
      decision_support: 'ROI calculator',
    },
    narrative_emphasis: {
      primary: 'transformation',
    },
    preferred_channels: ['linkedin', 'email'],
    ...overrides,
  };
}

function makeJourneyStage(overrides: Partial<JourneyStage> = {}): JourneyStage {
  return {
    id: 'stage-awareness',
    name: 'Awareness',
    buyer_mindset: 'Curious but skeptical',
    content_goal: 'Earn attention',
    story_types: ['thought leadership', 'trend analysis'],
    narrative_elements: ['tension', 'worldview'],
    claims_policy: {
      preferred_salience: 'low',
      max_per_piece: 2,
    },
    tone_shift: 'lighter, more exploratory',
    ...overrides,
  };
}

function makeContentTheme(overrides: Partial<ContentTheme> = {}): ContentTheme {
  return {
    id: 'theme-ai-readiness',
    name: 'AI Readiness',
    status: 'Active',
    content_intent: 'Position brand as thought leader in AI adoption',
    strategic_priority: 'high',
    target_personas: ['persona-cmo'],
    ...overrides,
  };
}

function makeStrategy(overrides: Partial<ContentStrategyData> = {}): ContentStrategyData {
  return {
    schema_version: '0.1.0',
    session: 4,
    personas: [],
    journey_stages: [],
    messaging_matrix: [],
    themes: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('compileInteractionPolicy', () => {
  it('returns empty rules when all inputs are null', () => {
    const result = compileInteractionPolicy('0.1.0', null, null, null);

    expect(result.version).toBe('0.1.0');
    expect(result.compiled_at).toBeTruthy();
    expect(result.visual_rules).toEqual([]);
    expect(result.voice_rules).toEqual({
      never_say: [],
      ai_ism_patterns: [],
      tone_constraints: null,
      sentence_patterns: null,
    });
    expect(result.content_rules).toEqual({
      claims_policies: [],
      persona_count: 0,
    });
  });

  describe('visual rules', () => {
    it('extracts rules from anti-patterns with correct severity', () => {
      const visual = makeVisual({
        anti_patterns: [
          makeAntiPattern({ rule: 'Never stretch the logo', severity: 'hard' }),
          makeAntiPattern({ rule: 'Avoid low-contrast backgrounds', severity: 'soft' }),
        ],
      });

      const result = compileInteractionPolicy('0.1.0', visual, null, null);

      expect(result.visual_rules).toHaveLength(2);
      expect(result.visual_rules[0]).toEqual({
        id: 'visual-1',
        rule: 'Never stretch the logo',
        severity: 'hard',
        category: 'visual',
      });
      expect(result.visual_rules[1]).toEqual({
        id: 'visual-2',
        rule: 'Avoid low-contrast backgrounds',
        severity: 'soft',
        category: 'visual',
      });
    });

    it('uses preflight_id when available, falls back to visual-N', () => {
      const visual = makeVisual({
        anti_patterns: [
          makeAntiPattern({ rule: 'No gradients on logo', severity: 'hard', preflight_id: 'PF-001' }),
          makeAntiPattern({ rule: 'Avoid neon colors', severity: 'soft' }),
          makeAntiPattern({ rule: 'No drop shadows', severity: 'hard', preflight_id: 'PF-003' }),
        ],
      });

      const result = compileInteractionPolicy('0.1.0', visual, null, null);

      expect(result.visual_rules[0].id).toBe('PF-001');
      expect(result.visual_rules[1].id).toBe('visual-2');
      expect(result.visual_rules[2].id).toBe('PF-003');
    });

    it('returns empty visual rules when visual data is null', () => {
      const result = compileInteractionPolicy('0.1.0', null, null, null);
      expect(result.visual_rules).toEqual([]);
    });

    it('returns empty visual rules when anti_patterns is empty', () => {
      const visual = makeVisual({ anti_patterns: [] });
      const result = compileInteractionPolicy('0.1.0', visual, null, null);
      expect(result.visual_rules).toEqual([]);
    });
  });

  describe('voice rules', () => {
    it('extracts never_say, ai_ism_patterns, and tone_constraints from messaging', () => {
      const messaging = makeMessaging({
        voice: makeVoiceCodex({
          vocabulary: {
            anchor: [],
            never_say: [
              makeNeverSayTerm({ word: 'synergy' }),
              makeNeverSayTerm({ word: 'disrupt' }),
            ],
            jargon_policy: 'define on first use',
            placeholder_defaults: {
              headline: 'Bold claim',
              subhead: 'Context',
              cta: 'Learn more',
              body_paragraph: 'Value prop.',
            },
          },
          ai_ism_detection: {
            patterns: ['dive into', 'leverage', 'at the end of the day'],
            instruction: 'Rewrite without these cliches',
          },
          tone: {
            descriptors: ['direct', 'human'],
            register: 'professional',
            never_sounds_like: 'a sales pitch',
            sentence_patterns: {
              prefer: ['active voice', 'concrete nouns'],
              avoid: ['passive voice', 'nominalizations'],
            },
            conventions: {
              person: 'first plural',
              reader_address: 'you',
              oxford_comma: true,
              sentence_length: 18,
              paragraph_length: 3,
            },
          },
        }),
      });

      const result = compileInteractionPolicy('0.1.0', null, messaging, null);

      expect(result.voice_rules.never_say).toEqual(['synergy', 'disrupt']);
      expect(result.voice_rules.ai_ism_patterns).toEqual([
        'dive into',
        'leverage',
        'at the end of the day',
      ]);
      expect(result.voice_rules.tone_constraints).toEqual({
        never_sounds_like: 'a sales pitch',
        avoid_patterns: ['passive voice', 'nominalizations'],
      });
      expect(result.voice_rules.sentence_patterns).toEqual({
        prefer: ['active voice', 'concrete nouns'],
        avoid: ['passive voice', 'nominalizations'],
      });
    });

    it('returns empty voice rules when messaging has no voice', () => {
      const messaging = makeMessaging({ voice: null });
      const result = compileInteractionPolicy('0.1.0', null, messaging, null);

      expect(result.voice_rules).toEqual({
        never_say: [],
        ai_ism_patterns: [],
        tone_constraints: null,
        sentence_patterns: null,
      });
    });

    it('returns empty voice rules when messaging is null', () => {
      const result = compileInteractionPolicy('0.1.0', null, null, null);

      expect(result.voice_rules).toEqual({
        never_say: [],
        ai_ism_patterns: [],
        tone_constraints: null,
        sentence_patterns: null,
      });
    });
  });

  describe('content rules', () => {
    it('extracts claims policies per stage and persona count', () => {
      const strategy = makeStrategy({
        personas: [
          makePersona({ id: 'p1', status: 'Active' }),
          makePersona({ id: 'p2', status: 'Active' }),
          makePersona({ id: 'p3', status: 'Retired' }),
          makePersona({ id: 'p4', status: 'Hypothesis' }),
        ],
        journey_stages: [
          makeJourneyStage({ name: 'Awareness', claims_policy: { preferred_salience: 'low', max_per_piece: 2 } }),
          makeJourneyStage({ name: 'Consideration', claims_policy: { preferred_salience: 'medium', max_per_piece: 4 } }),
          makeJourneyStage({ name: 'Decision', claims_policy: { preferred_salience: 'high', max_per_piece: null } }),
        ],
      });

      const result = compileInteractionPolicy('0.1.0', null, null, strategy);

      expect(result.content_rules.persona_count).toBe(2);
      expect(result.content_rules.claims_policies).toEqual([
        { stage: 'Awareness', max_per_piece: 2 },
        { stage: 'Consideration', max_per_piece: 4 },
        { stage: 'Decision', max_per_piece: null },
      ]);
    });

    it('returns empty content rules when strategy is null', () => {
      const result = compileInteractionPolicy('0.1.0', null, null, null);

      expect(result.content_rules).toEqual({
        claims_policies: [],
        persona_count: 0,
      });
    });

    it('counts only Active personas', () => {
      const strategy = makeStrategy({
        personas: [
          makePersona({ id: 'p1', status: 'Active' }),
          makePersona({ id: 'p2', status: 'Retired' }),
          makePersona({ id: 'p3', status: 'Hypothesis' }),
        ],
      });

      const result = compileInteractionPolicy('0.1.0', null, null, strategy);
      expect(result.content_rules.persona_count).toBe(1);
    });

    it('returns zero persona count when all personas are inactive', () => {
      const strategy = makeStrategy({
        personas: [
          makePersona({ id: 'p1', status: 'Retired' }),
          makePersona({ id: 'p2', status: 'Hypothesis' }),
        ],
      });

      const result = compileInteractionPolicy('0.1.0', null, null, strategy);
      expect(result.content_rules.persona_count).toBe(0);
    });
  });

  describe('full compilation', () => {
    it('compiles all sections together', () => {
      const visual = makeVisual({
        anti_patterns: [
          makeAntiPattern({ rule: 'No gradients on logo', severity: 'hard', preflight_id: 'PF-001' }),
          makeAntiPattern({ rule: 'Avoid neon', severity: 'soft' }),
        ],
      });

      const messaging = makeMessaging({
        voice: makeVoiceCodex(),
      });

      const strategy = makeStrategy({
        personas: [
          makePersona({ id: 'p1', status: 'Active' }),
          makePersona({ id: 'p2', status: 'Active' }),
        ],
        journey_stages: [
          makeJourneyStage({ name: 'Awareness', claims_policy: { preferred_salience: 'low', max_per_piece: 2 } }),
          makeJourneyStage({ name: 'Decision', claims_policy: { preferred_salience: 'high', max_per_piece: null } }),
        ],
        themes: [makeContentTheme()],
      });

      const result = compileInteractionPolicy('1.0.0', visual, messaging, strategy);

      // Metadata
      expect(result.version).toBe('1.0.0');
      expect(result.compiled_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

      // Visual rules
      expect(result.visual_rules).toHaveLength(2);
      expect(result.visual_rules[0].id).toBe('PF-001');
      expect(result.visual_rules[0].category).toBe('visual');
      expect(result.visual_rules[1].id).toBe('visual-2');

      // Voice rules
      expect(result.voice_rules.never_say).toEqual(['synergy']);
      expect(result.voice_rules.ai_ism_patterns).toEqual(['dive into', 'leverage']);
      expect(result.voice_rules.tone_constraints).not.toBeNull();
      expect(result.voice_rules.tone_constraints!.never_sounds_like).toBe(
        'a corporate press release',
      );
      expect(result.voice_rules.sentence_patterns).not.toBeNull();
      expect(result.voice_rules.sentence_patterns!.prefer).toEqual([
        'short declarative sentences',
      ]);

      // Content rules
      expect(result.content_rules.persona_count).toBe(2);
      expect(result.content_rules.claims_policies).toHaveLength(2);
      expect(result.content_rules.claims_policies[0]).toEqual({
        stage: 'Awareness',
        max_per_piece: 2,
      });
      expect(result.content_rules.claims_policies[1]).toEqual({
        stage: 'Decision',
        max_per_piece: null,
      });
    });

    it('sets compiled_at to a valid ISO timestamp', () => {
      const before = new Date().toISOString();
      const result = compileInteractionPolicy('0.1.0', null, null, null);
      const after = new Date().toISOString();

      expect(result.compiled_at >= before).toBe(true);
      expect(result.compiled_at <= after).toBe(true);
    });
  });
});
