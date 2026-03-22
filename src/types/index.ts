export type Confidence = "confirmed" | "high" | "medium" | "low";
export type Source = "web" | "figma" | "manual";

export interface ColorEntry {
  name: string;
  value: string; // hex
  role: "primary" | "secondary" | "accent" | "neutral" | "surface" | "text" | "action" | "unknown";
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
