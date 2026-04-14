export type Confidence = "confirmed" | "high" | "medium" | "low";
export type Source = "web" | "visual" | "figma" | "guidelines" | "manual";

export interface ColorEntry {
  name: string;
  value: string; // hex
  role: "primary" | "secondary" | "accent" | "neutral" | "surface" | "text" | "action" | "tint" | "overlay" | "border" | "gradient" | "highlight" | "unknown";
  source: Source;
  confidence: Confidence;
  figma_variable_id?: string;
  css_property?: string;
}

export interface TypographyEntry {
  name: string;
  family: string;
  size?: string;
  weight?: number;
  line_height?: string;
  source: Source;
  confidence: Confidence;
  figma_style_id?: string;
}

export interface LogoVariant {
  name: string; // e.g. "dark", "light"
  file?: string; // relative path in .brand/assets/logo/
  inline_svg?: string;
  data_uri?: string;
}

export interface LogoSpec {
  type: "wordmark" | "logomark";
  source: Source;
  confidence: Confidence;
  variants: LogoVariant[];
}

export interface SpacingSpec {
  base_unit?: string;
  scale?: number[];
  source: Source;
  confidence: Confidence;
}

export interface CoreIdentity {
  schema_version: string;
  colors: ColorEntry[];
  typography: TypographyEntry[];
  logo: LogoSpec[];
  spacing: SpacingSpec | null;
}

export interface BrandConfig {
  schema_version: string;
  session: number;
  client_name: string;
  industry?: string;
  website_url?: string;
  figma_file_key?: string;
  created_at: string;
  source_priority?: Source[];
}

export interface ClarificationItem {
  id: string;
  field: string;
  question: string;
  source: string;
  priority: "high" | "medium" | "low";
}

export interface NeedsClarification {
  schema_version: string;
  items: ClarificationItem[];
}

// --- Session 2: Visual Identity ---

export interface CompositionSpec {
  energy: string; // e.g. "high-tension, asymmetric"
  negative_space: string; // e.g. "minimum 35%"
  grid: string; // e.g. "8px base, flexible columns"
  layout_preference: string; // e.g. "asymmetric tension"
}

export interface PatternSpec {
  type: "geometric" | "organic" | "photographic" | "none" | string;
  usage: "structural" | "decorative" | "both" | string;
  assets: string[]; // references to .brand/assets/patterns/
}

export interface IllustrationSpec {
  style: string; // e.g. "flat", "dimensional", "hand-drawn", "collage"
  function: string; // e.g. "explanatory", "atmospheric", "both"
  assets: string[];
}

export interface PhotographySpec {
  style: string; // e.g. "studio", "lifestyle", "documentary", "abstract", "none"
  anti_patterns: string[];
}

export interface SignatureSpec {
  description: string; // what makes the brand recognizable beyond tokens
  elements: string[]; // specific signature moves
}

export interface AntiPatternRule {
  rule: string; // e.g. "no drop shadows"
  severity: "hard" | "soft"; // hard = auto-enforced, soft = flagged
  preflight_id?: string; // ID for automated checking
}

export interface AssetManifestEntry {
  file: string;
  description: string;
  usage: string; // e.g. "hero sections", "blog headers", "general purpose"
  theme: "dark" | "light" | "both";
  dimensions?: string;
  type?: string; // e.g. "illustration", "sticker", "pattern", "icon"
}

export interface VisualIdentity {
  schema_version: string;
  session: number;
  composition: CompositionSpec | null;
  patterns: PatternSpec | null;
  illustration: IllustrationSpec | null;
  photography: PhotographySpec | null;
  signature: SignatureSpec | null;
  anti_patterns: AntiPatternRule[];
  positioning_context: string; // from Session 1 interview Q3
}

// --- Session 3: Core Messaging ---

export interface Perspective {
  worldview: string;
  tension: string;
  resolution: string;
  audience: string;
  positioning: string;
  one_liner: string;
}

export interface ToneSpec {
  descriptors: string[]; // exactly 3 words
  register: string; // how the brand speaks to its audience
  never_sounds_like: string; // negative tone constraint
  sentence_patterns: {
    prefer: string[];
    avoid: string[];
  };
  conventions: {
    person: string; // "we" | "I" | "they"
    founder_voice?: string; // "I" for founder channels
    reader_address: string; // "you"
    oxford_comma: boolean;
    sentence_length: number; // target average words
    paragraph_length: number; // target sentences
  };
}

export interface AnchorTerm {
  use: string; // the preferred word
  not: string; // words it replaces
  reason: string; // why this word matters
}

export interface NeverSayTerm {
  word: string;
  reason: string;
}

export interface VoiceCodex {
  tone: ToneSpec;
  vocabulary: {
    anchor: AnchorTerm[];
    never_say: NeverSayTerm[];
    jargon_policy: string; // e.g. "define on first use"
    placeholder_defaults: {
      headline: string;
      subhead: string;
      cta: string;
      body_paragraph: string;
    };
  };
  ai_ism_detection: {
    patterns: string[];
    instruction: string;
  };
}

export interface BrandStory {
  origin: string;
  tension: string;
  resolution: string;
  vision: string;
  tagline: string;
}

export interface MessagingAuditResult {
  voice_fingerprint: {
    formality: number; // 1-10
    jargon_density: string;
    avg_sentence_length: number;
    active_voice_pct: number;
    hedging_frequency: string;
    tone_by_channel: Record<string, string>;
  };
  vocabulary_frequency: Array<{ term: string; count: number; assessment: string }>;
  claims: {
    explicit: Array<{ claim: string; frequency: number; issues: string[] }>;
    implicit: Array<{ claim: string; evidence: string; status: string }>;
    contradictions: string[];
  };
  gaps: string[];
}

// --- Session 4: Content Strategy ---

export interface Persona {
  id: string; // e.g. PER-001
  name: string; // e.g. "The Overwhelmed VP"
  role_tag: string; // e.g. "VP Marketing"
  seniority: "C-Suite" | "VP" | "Director" | "Manager" | "IC" | string;
  company_stage?: string[]; // e.g. ["Series C+", "Public"]
  decision_authority: "Budget Holder" | "Influencer" | "Champion" | "Evaluator" | string;
  status: "Active" | "Hypothesis" | "Retired";
  source?: string;
  core_tension: string;
  key_objections: string[];
  information_needs: {
    first_touch: string;
    context_and_meaning: string;
    validation_and_proof: string;
    decision_support: string;
  };
  narrative_emphasis: {
    primary: string;
    secondary?: string;
    elements?: string[];
  };
  preferred_channels: string[];
}

export interface JourneyStage {
  id: string; // e.g. "first-touch"
  name: string;
  buyer_mindset: string;
  content_goal: string;
  story_types: string[];
  narrative_elements: string[];
  claims_policy: {
    preferred_salience: string | string[];
    max_per_piece: number | null;
    min_confidence?: number;
  };
  tone_shift: string;
}

export interface MessagingVariant {
  id: string; // e.g. MV-001
  persona: string; // persona id ref
  journey_stage: string; // stage id ref
  status: "Active" | "Draft" | "Retired";
  core_message: string;
  tone_shift: string;
  proof_points: string[];
  supporting_claims?: string[];
  source_element?: string;
}

export interface ContentTheme {
  id: string; // e.g. THM-001
  name: string;
  status: "Active" | "Planned" | "Retired";
  quarter?: string;
  content_intent: "Brand Heat" | "Momentum" | "Conversion" | string;
  strategic_priority: string;
  narrative_route?: string;
  target_personas: string[]; // persona id refs
  key_claims?: string[];
  success_criteria?: string;
}

export interface ContentStrategy {
  schema_version: string;
  session: number;
  personas: Persona[];
  journey_stages: JourneyStage[];
  messaging_matrix: MessagingVariant[];
  themes: ContentTheme[];
}

/** DTCG token value */
export interface DTCGToken {
  $value: string | number;
  $type: string;
  $description?: string;
  $extensions?: Record<string, unknown>;
}

export interface McpResponseData {
  what_happened: string;
  next_steps: string[];
  data?: Record<string, unknown>;
}

// --- Error Codes ---

export const ERROR_CODES = {
  // General
  VALIDATION_FAILED: "validation_failed",
  NOT_INITIALIZED: "not_initialized",
  NOT_FOUND: "not_found",

  // Input errors
  NO_INPUT: "no_input",
  INVALID_PROTOCOL: "invalid_protocol",
  INVALID_JSON: "invalid_json",
  INVALID_FORMAT: "invalid_format",
  INVALID_PATH: "invalid_path",
  INVALID_PAGES_PARAM: "invalid_pages_param",
  EMPTY_CONTENT: "empty_content",

  // Fetch errors
  FETCH_FAILED: "fetch_failed",
  AUTO_FETCH_FAILED: "auto_fetch_failed",

  // Brand state errors
  ALREADY_EXISTS: "already_exists",
  NO_CORE_IDENTITY: "no_core_identity",
  NO_BRAND_DIR: "no_brand_dir",
  NO_BRAND_DATA: "no_brand_data",
  NOT_COMPILED: "not_compiled",
  NO_CONTENT: "no_content",
  NO_STRATEGY: "no_strategy",
  NO_PERSONAS: "no_personas",
  NO_JOURNEY_STAGES: "no_journey_stages",
  NO_CLARIFICATIONS: "no_clarifications",
  EMPTY_MATRIX: "empty_matrix",

  // Missing data
  MISSING_SECTION: "missing_section",
  MISSING_ANSWERS: "missing_answers",
  MISSING_FILE: "missing_file",
  MISSING_FIGMA_FILE_KEY: "missing_figma_file_key",
  MISSING_VARIANT_ID: "missing_variant_id",
  MISSING_NAME: "missing_name",

  // Not found (specific entities)
  ITEM_NOT_FOUND: "item_not_found",
  PERSONA_NOT_FOUND: "persona_not_found",
  VARIANT_NOT_FOUND: "variant_not_found",
  THEME_NOT_FOUND: "theme_not_found",
  FILE_NOT_FOUND: "file_not_found",

  // Processing errors
  PARSE_FAILED: "parse_failed",
  PATH_OUTSIDE_CWD: "path_outside_cwd",
  NO_CHANGES: "no_changes",

  // Validation-specific
  INVALID_ITEMS: "invalid_items",
  EMPTY_ITEMS: "empty_items",
  ALL_EMPTY: "all_empty",

  // Rate limiting
  RATE_LIMITED: "rate_limited",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

// --- Conversation Guide ---

export interface ConversationGuide {
  instruction: string;
  conditionals?: Record<string, string>;
}
