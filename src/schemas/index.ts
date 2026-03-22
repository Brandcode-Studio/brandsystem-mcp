export const SCHEMA_VERSION = "0.1.0";

export { BrandConfigSchema, type BrandConfigData } from "./brand-config.js";
export {
  CoreIdentitySchema,
  ColorEntrySchema,
  TypographyEntrySchema,
  LogoSpecSchema,
  SpacingSpecSchema,
  type CoreIdentityData,
} from "./core-identity.js";
export {
  DTCGTokenSchema,
  TokensFileSchema,
  type DTCGTokenData,
  type TokensFileData,
} from "./tokens.js";
export {
  NeedsClarificationSchema,
  ClarificationItemSchema,
  type NeedsClarificationData,
} from "./needs-clarification.js";
export {
  VisualIdentitySchema,
  AntiPatternRuleSchema,
  type VisualIdentityData,
} from "./visual-identity.js";
export {
  MessagingSchema,
  PerspectiveSchema,
  VoiceCodexSchema,
  BrandStorySchema,
  type MessagingData,
  type PerspectiveData,
  type VoiceCodexData,
  type BrandStoryData,
} from "./messaging.js";
