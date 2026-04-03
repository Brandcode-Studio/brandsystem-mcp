import { describe, it, expect } from 'vitest';
import { compileRuntime } from '../../src/lib/runtime-compiler.js';
import type {
  BrandConfigData,
  CoreIdentityData,
  VisualIdentityData,
  MessagingData,
  ContentStrategyData,
} from '../../src/schemas/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<BrandConfigData> = {}): BrandConfigData {
  return {
    schema_version: '0.1.0',
    session: 1,
    client_name: 'Acme Corp',
    created_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeIdentity(overrides: Partial<CoreIdentityData> = {}): CoreIdentityData {
  return {
    schema_version: '0.1.0',
    colors: [],
    typography: [],
    logo: [],
    spacing: null,
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
    positioning_context: 'Premium B2B SaaS',
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

describe('compileRuntime', () => {
  it('compiles minimal identity (empty colors, typography, no logo)', () => {
    const result = compileRuntime(makeConfig(), makeIdentity(), null, null, null);

    expect(result.version).toBe('0.1.0');
    expect(result.client_name).toBe('Acme Corp');
    expect(result.sessions_completed).toBe(1);
    expect(result.identity.colors).toEqual({});
    expect(result.identity.typography).toEqual({});
    expect(result.identity.logo).toBeNull();
    expect(result.visual).toBeNull();
    expect(result.voice).toBeNull();
    expect(result.strategy).toBeNull();
  });

  it('filters low-confidence colors (only medium+ appear in output)', () => {
    const result = compileRuntime(
      makeConfig(),
      makeIdentity({
        colors: [
          { name: 'Faded Blue', value: '#abc', role: 'primary', source: 'web', confidence: 'low' },
          { name: 'Solid Red', value: '#e63946', role: 'accent', source: 'web', confidence: 'medium' },
          { name: 'Confirmed Green', value: '#2d6a4f', role: 'secondary', source: 'figma', confidence: 'confirmed' },
          { name: 'High Teal', value: '#2dd4bf', role: 'action', source: 'manual', confidence: 'high' },
        ],
      }),
      null,
      null,
      null,
    );

    expect(result.identity.colors).not.toHaveProperty('primary');
    expect(result.identity.colors).toHaveProperty('accent', '#e63946');
    expect(result.identity.colors).toHaveProperty('secondary', '#2d6a4f');
    expect(result.identity.colors).toHaveProperty('action', '#2dd4bf');
  });

  it('maps color role to hex correctly', () => {
    const result = compileRuntime(
      makeConfig(),
      makeIdentity({
        colors: [
          { name: 'Brand Red', value: '#e63946', role: 'primary', source: 'web', confidence: 'high' },
          { name: 'Dark Gray', value: '#333333', role: 'text', source: 'web', confidence: 'medium' },
          { name: 'Misc Teal', value: '#008080', role: 'unknown', source: 'web', confidence: 'high' },
        ],
      }),
      null,
      null,
      null,
    );

    expect(result.identity.colors).toEqual({
      primary: '#e63946',
      text: '#333333',
      'Misc Teal': '#008080',
    });
  });

  it('maps typography name to family correctly', () => {
    const result = compileRuntime(
      makeConfig(),
      makeIdentity({
        typography: [
          { name: 'Heading', family: 'Inter', weight: 700, source: 'web', confidence: 'high' },
          { name: 'Body', family: 'Georgia', source: 'web', confidence: 'medium' },
          { name: 'Mono', family: 'JetBrains Mono', source: 'manual', confidence: 'low' },
        ],
      }),
      null,
      null,
      null,
    );

    expect(result.identity.typography).toEqual({
      Heading: 'Inter',
      Body: 'Georgia',
    });
    expect(result.identity.typography).not.toHaveProperty('Mono');
  });

  it('builds logo summary (type + has_svg) when logo exists', () => {
    const result = compileRuntime(
      makeConfig(),
      makeIdentity({
        logo: [
          {
            type: 'wordmark',
            source: 'web',
            confidence: 'high',
            variants: [
              { name: 'default', inline_svg: '<svg>...</svg>' },
              { name: 'dark', file: 'logo-dark.png' },
            ],
          },
        ],
      }),
      null,
      null,
      null,
    );

    expect(result.identity.logo).toEqual({ type: 'wordmark', has_svg: true });
  });

  it('sets has_svg to false when no variant has inline_svg', () => {
    const result = compileRuntime(
      makeConfig(),
      makeIdentity({
        logo: [
          {
            type: 'logomark',
            source: 'figma',
            confidence: 'confirmed',
            variants: [
              { name: 'default', file: 'logo.png' },
            ],
          },
        ],
      }),
      null,
      null,
      null,
    );

    expect(result.identity.logo).toEqual({ type: 'logomark', has_svg: false });
  });

  it('compiles visual composition and signature', () => {
    const result = compileRuntime(
      makeConfig({ session: 2 }),
      makeIdentity(),
      makeVisual({
        composition: {
          energy: 'high',
          negative_space: 'minimal',
          grid: '12-column',
          layout_preference: 'asymmetric',
        },
        signature: {
          description: 'Bold geometric shapes with brand teal accents',
          elements: ['geometric-overlay', 'teal-accent-bar', 'angular-crop'],
        },
      }),
      null,
      null,
    );

    expect(result.visual).not.toBeNull();
    expect(result.visual!.composition).toEqual({
      energy: 'high',
      grid: '12-column',
      layout: 'asymmetric',
    });
    expect(result.visual!.signature).toEqual({
      description: 'Bold geometric shapes with brand teal accents',
      elements: ['geometric-overlay', 'teal-accent-bar', 'angular-crop'],
    });
  });

  it('only includes hard severity anti-patterns', () => {
    const result = compileRuntime(
      makeConfig({ session: 2 }),
      makeIdentity(),
      makeVisual({
        anti_patterns: [
          { rule: 'Never use drop shadows on primary CTA', severity: 'hard' },
          { rule: 'Avoid rounded corners above 8px', severity: 'soft' },
          { rule: 'Never distort the logo', severity: 'hard', preflight_id: 'logo-distort' },
          { rule: 'Prefer left-aligned text', severity: 'soft' },
        ],
      }),
      null,
      null,
    );

    expect(result.visual!.anti_patterns).toEqual([
      'Never use drop shadows on primary CTA',
      'Never distort the logo',
    ]);
  });

  it('compiles voice section with tone, register, anchor terms, never_say, conventions', () => {
    const result = compileRuntime(
      makeConfig({ session: 3 }),
      makeIdentity(),
      null,
      makeMessaging({
        voice: {
          tone: {
            descriptors: ['confident', 'clear', 'warm'],
            register: 'professional-casual',
            never_sounds_like: 'corporate jargon or clickbait',
            sentence_patterns: {
              prefer: ['short declarative', 'active voice'],
              avoid: ['passive constructions', 'filler phrases'],
            },
            conventions: {
              person: 'first-person plural',
              founder_voice: 'third-person',
              reader_address: 'second-person',
              oxford_comma: true,
              sentence_length: 20,
              paragraph_length: 4,
            },
          },
          vocabulary: {
            anchor: [
              { use: 'platform', not: 'tool', reason: 'We are more than a point solution' },
              { use: 'partners', not: 'vendors', reason: 'Emphasizes collaboration' },
            ],
            never_say: [
              { word: 'synergy', reason: 'Overused corporate buzzword' },
              { word: 'disrupt', reason: 'Meaningless in our context' },
            ],
            jargon_policy: 'Define on first use; avoid when a simpler word works',
            placeholder_defaults: {
              headline: 'Your headline here',
              subhead: 'Supporting context',
              cta: 'Get started',
              body_paragraph: 'Describe the value...',
            },
          },
          ai_ism_detection: {
            patterns: ['in today\'s .* landscape', 'game-?changer', 'revolutionize'],
            instruction: 'Flag and rewrite any match',
          },
        },
      }),
      null,
    );

    expect(result.voice).not.toBeNull();
    expect(result.voice!.tone_descriptors).toEqual(['confident', 'clear', 'warm']);
    expect(result.voice!.register).toBe('professional-casual');
    expect(result.voice!.never_sounds_like).toBe('corporate jargon or clickbait');
    expect(result.voice!.anchor_terms).toEqual({
      platform: 'tool',
      partners: 'vendors',
    });
    expect(result.voice!.never_say).toEqual(['synergy', 'disrupt']);
    expect(result.voice!.jargon_policy).toBe('Define on first use; avoid when a simpler word works');
    expect(result.voice!.ai_ism_patterns).toEqual([
      'in today\'s .* landscape',
      'game-?changer',
      'revolutionize',
    ]);
    expect(result.voice!.conventions).toEqual({
      person: 'first-person plural',
      reader_address: 'second-person',
      oxford_comma: true,
      sentence_length: 20,
    });
  });

  it('compiles strategy section with persona counts, names, stages, matrix size', () => {
    const result = compileRuntime(
      makeConfig({ session: 4 }),
      makeIdentity(),
      null,
      null,
      makeStrategy({
        personas: [
          {
            id: 'p1',
            name: 'Marketing Maya',
            role_tag: 'marketing-lead',
            seniority: 'director',
            decision_authority: 'champion',
            status: 'Active',
            core_tension: 'Needs proof of ROI before committing budget',
            key_objections: ['Too expensive', 'Not enough integrations'],
            information_needs: {
              first_touch: 'High-level value prop',
              context_and_meaning: 'Industry benchmarks',
              validation_and_proof: 'Case studies',
              decision_support: 'ROI calculator',
            },
            narrative_emphasis: { primary: 'outcome-driven' },
            preferred_channels: ['blog', 'webinar'],
          },
          {
            id: 'p2',
            name: 'Developer Dan',
            role_tag: 'engineering-lead',
            seniority: 'senior',
            decision_authority: 'influencer',
            status: 'Hypothesis',
            core_tension: 'Wants technical depth',
            key_objections: ['SDK limitations'],
            information_needs: {
              first_touch: 'API docs',
              context_and_meaning: 'Architecture overview',
              validation_and_proof: 'Open source examples',
              decision_support: 'Migration guide',
            },
            narrative_emphasis: { primary: 'technical-credibility' },
            preferred_channels: ['docs', 'github'],
          },
          {
            id: 'p3',
            name: 'CFO Carl',
            role_tag: 'finance-lead',
            seniority: 'c-suite',
            decision_authority: 'decision-maker',
            status: 'Active',
            core_tension: 'Needs cost justification',
            key_objections: ['Budget constraints'],
            information_needs: {
              first_touch: 'Executive summary',
              context_and_meaning: 'Market positioning',
              validation_and_proof: 'Financial case studies',
              decision_support: 'TCO comparison',
            },
            narrative_emphasis: { primary: 'financial-impact' },
            preferred_channels: ['email', 'executive-brief'],
          },
          {
            id: 'p4',
            name: 'Retired Rita',
            role_tag: 'former-user',
            seniority: 'manager',
            decision_authority: 'none',
            status: 'Retired',
            core_tension: 'N/A',
            key_objections: [],
            information_needs: {
              first_touch: 'N/A',
              context_and_meaning: 'N/A',
              validation_and_proof: 'N/A',
              decision_support: 'N/A',
            },
            narrative_emphasis: { primary: 'N/A' },
            preferred_channels: [],
          },
        ],
        journey_stages: [
          {
            id: 'js1',
            name: 'Awareness',
            buyer_mindset: 'Exploring the problem space',
            content_goal: 'Build recognition',
            story_types: ['thought-leadership'],
            narrative_elements: ['tension'],
            claims_policy: { preferred_salience: 'low', max_per_piece: null },
            tone_shift: 'educational',
          },
          {
            id: 'js2',
            name: 'Consideration',
            buyer_mindset: 'Evaluating solutions',
            content_goal: 'Differentiate',
            story_types: ['comparison', 'case-study'],
            narrative_elements: ['proof', 'credibility'],
            claims_policy: { preferred_salience: 'medium', max_per_piece: 3 },
            tone_shift: 'authoritative',
          },
        ],
        messaging_matrix: [
          {
            id: 'mv1',
            persona: 'p1',
            journey_stage: 'js1',
            status: 'Active',
            core_message: 'Drive measurable marketing ROI',
            tone_shift: 'empathetic',
            proof_points: ['3x pipeline increase'],
          },
          {
            id: 'mv2',
            persona: 'p1',
            journey_stage: 'js2',
            status: 'Active',
            core_message: 'See how teams like yours succeed',
            tone_shift: 'confident',
            proof_points: ['Fortune 500 case study'],
          },
          {
            id: 'mv3',
            persona: 'p3',
            journey_stage: 'js1',
            status: 'Draft',
            core_message: 'Reduce content spend by 40%',
            tone_shift: 'data-driven',
            proof_points: ['Cost analysis'],
          },
          {
            id: 'mv4',
            persona: 'p4',
            journey_stage: 'js1',
            status: 'Retired',
            core_message: 'Legacy message',
            tone_shift: 'neutral',
            proof_points: [],
          },
        ],
        themes: [
          {
            id: 't1',
            name: 'AI-Powered Content',
            status: 'Active',
            content_intent: 'thought-leadership',
            strategic_priority: 'high',
            target_personas: ['p1', 'p2'],
          },
          {
            id: 't2',
            name: 'Enterprise Scale',
            status: 'Planned',
            content_intent: 'demand-gen',
            strategic_priority: 'medium',
            target_personas: ['p3'],
          },
          {
            id: 't3',
            name: 'Legacy Program',
            status: 'Retired',
            content_intent: 'brand',
            strategic_priority: 'low',
            target_personas: ['p4'],
          },
        ],
      }),
    );

    expect(result.strategy).not.toBeNull();
    expect(result.strategy!.persona_count).toBe(4);
    // Only Active personas appear in persona_names
    expect(result.strategy!.persona_names).toEqual(['Marketing Maya', 'CFO Carl']);
    expect(result.strategy!.journey_stages).toEqual(['Awareness', 'Consideration']);
    // Only Active themes count
    expect(result.strategy!.theme_count).toBe(1);
    // Only Active matrix entries count
    expect(result.strategy!.matrix_size).toBe(2);
  });

  it('compiles full runtime with all 4 sessions populated', () => {
    const result = compileRuntime(
      makeConfig({ session: 4, client_name: 'FullBrand Inc' }),
      makeIdentity({
        colors: [
          { name: 'Brand Blue', value: '#1a73e8', role: 'primary', source: 'figma', confidence: 'confirmed' },
          { name: 'Charcoal', value: '#2d2d2d', role: 'text', source: 'web', confidence: 'high' },
        ],
        typography: [
          { name: 'Display', family: 'Poppins', weight: 800, source: 'figma', confidence: 'confirmed' },
          { name: 'Body', family: 'Inter', source: 'web', confidence: 'medium' },
        ],
        logo: [
          {
            type: 'wordmark',
            source: 'figma',
            confidence: 'confirmed',
            variants: [
              { name: 'primary', inline_svg: '<svg>wordmark</svg>' },
            ],
          },
        ],
      }),
      makeVisual({
        composition: {
          energy: 'medium',
          negative_space: 'generous',
          grid: '8-column',
          layout_preference: 'centered',
        },
        signature: {
          description: 'Clean geometric forms',
          elements: ['grid-overlay'],
        },
        anti_patterns: [
          { rule: 'No gradients on type', severity: 'hard' },
          { rule: 'Avoid stock photos', severity: 'soft' },
        ],
      }),
      makeMessaging({
        voice: {
          tone: {
            descriptors: ['direct', 'approachable'],
            register: 'smart-casual',
            never_sounds_like: 'stuffy or robotic',
            sentence_patterns: { prefer: ['active voice'], avoid: ['passive'] },
            conventions: {
              person: 'we',
              reader_address: 'you',
              oxford_comma: true,
              sentence_length: 18,
              paragraph_length: 3,
            },
          },
          vocabulary: {
            anchor: [{ use: 'build', not: 'leverage', reason: 'Concrete action' }],
            never_say: [{ word: 'utilize', reason: 'Use "use" instead' }],
            jargon_policy: 'Plain language first',
            placeholder_defaults: {
              headline: 'Headline',
              subhead: 'Subhead',
              cta: 'Learn more',
              body_paragraph: 'Body text',
            },
          },
          ai_ism_detection: {
            patterns: ['game-?changer'],
            instruction: 'Rewrite',
          },
        },
      }),
      makeStrategy({
        personas: [
          {
            id: 'p1',
            name: 'Buyer Bob',
            role_tag: 'buyer',
            seniority: 'vp',
            decision_authority: 'decision-maker',
            status: 'Active',
            core_tension: 'Needs ROI proof',
            key_objections: ['price'],
            information_needs: {
              first_touch: 'Overview',
              context_and_meaning: 'Benchmarks',
              validation_and_proof: 'Cases',
              decision_support: 'ROI calc',
            },
            narrative_emphasis: { primary: 'outcomes' },
            preferred_channels: ['email'],
          },
        ],
        journey_stages: [
          {
            id: 'js1',
            name: 'Discover',
            buyer_mindset: 'Curious',
            content_goal: 'Attract',
            story_types: ['blog'],
            narrative_elements: ['hook'],
            claims_policy: { preferred_salience: 'low', max_per_piece: null },
            tone_shift: 'inviting',
          },
        ],
        messaging_matrix: [
          {
            id: 'mv1',
            persona: 'p1',
            journey_stage: 'js1',
            status: 'Active',
            core_message: 'Welcome to the future',
            tone_shift: 'warm',
            proof_points: ['100+ customers'],
          },
        ],
        themes: [
          {
            id: 't1',
            name: 'Innovation',
            status: 'Active',
            content_intent: 'thought-leadership',
            strategic_priority: 'high',
            target_personas: ['p1'],
          },
        ],
      }),
    );

    // Top-level fields
    expect(result.version).toBe('0.1.0');
    expect(result.client_name).toBe('FullBrand Inc');
    expect(result.sessions_completed).toBe(4);
    expect(result.compiled_at).toBeTruthy();

    // Identity
    expect(result.identity.colors).toEqual({ primary: '#1a73e8', text: '#2d2d2d' });
    expect(result.identity.typography).toEqual({ Display: 'Poppins', Body: 'Inter' });
    expect(result.identity.logo).toEqual({ type: 'wordmark', has_svg: true });

    // Visual
    expect(result.visual).not.toBeNull();
    expect(result.visual!.composition).toEqual({ energy: 'medium', grid: '8-column', layout: 'centered' });
    expect(result.visual!.signature!.elements).toContain('grid-overlay');
    expect(result.visual!.anti_patterns).toEqual(['No gradients on type']);

    // Voice
    expect(result.voice).not.toBeNull();
    expect(result.voice!.tone_descriptors).toEqual(['direct', 'approachable']);
    expect(result.voice!.register).toBe('smart-casual');
    expect(result.voice!.anchor_terms).toEqual({ build: 'leverage' });
    expect(result.voice!.never_say).toEqual(['utilize']);

    // Strategy
    expect(result.strategy).not.toBeNull();
    expect(result.strategy!.persona_count).toBe(1);
    expect(result.strategy!.persona_names).toEqual(['Buyer Bob']);
    expect(result.strategy!.journey_stages).toEqual(['Discover']);
    expect(result.strategy!.theme_count).toBe(1);
    expect(result.strategy!.matrix_size).toBe(1);
  });

  it('returns null sections when session data is not provided', () => {
    const result = compileRuntime(makeConfig(), makeIdentity(), null, null, null);

    expect(result.visual).toBeNull();
    expect(result.voice).toBeNull();
    expect(result.strategy).toBeNull();
  });

  it('returns null voice when messaging exists but voice is null', () => {
    const result = compileRuntime(
      makeConfig({ session: 3 }),
      makeIdentity(),
      null,
      makeMessaging({ voice: null }),
      null,
    );

    expect(result.voice).toBeNull();
  });

  it('returns null visual composition/signature when not set', () => {
    const result = compileRuntime(
      makeConfig({ session: 2 }),
      makeIdentity(),
      makeVisual({ composition: null, signature: null }),
      null,
      null,
    );

    expect(result.visual).not.toBeNull();
    expect(result.visual!.composition).toBeNull();
    expect(result.visual!.signature).toBeNull();
    expect(result.visual!.anti_patterns).toEqual([]);
  });

  it('uses color name as key when role is "unknown"', () => {
    const result = compileRuntime(
      makeConfig(),
      makeIdentity({
        colors: [
          { name: 'Warm Teal 400', value: '#2dd4bf', role: 'unknown', source: 'web', confidence: 'medium' },
        ],
      }),
      null,
      null,
      null,
    );

    expect(result.identity.colors).toHaveProperty('Warm Teal 400', '#2dd4bf');
  });

  it('sets compiled_at to a valid ISO timestamp', () => {
    const before = new Date().toISOString();
    const result = compileRuntime(makeConfig(), makeIdentity(), null, null, null);
    const after = new Date().toISOString();

    expect(result.compiled_at).toBeTruthy();
    expect(result.compiled_at >= before).toBe(true);
    expect(result.compiled_at <= after).toBe(true);
  });
});
