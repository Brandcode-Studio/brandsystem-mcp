/**
 * Shared types for the hosted Brandcode MCP surface (S009 G-5b Phase 1).
 */
import type { BrandPackagePayload } from "../connectors/brandcode/types.js";

export type BrandcodeMcpScope = "read" | "check" | "feedback";

export interface BrandcodeMcpAuthInfo {
  /** Full bearer token (redact in logs). */
  token: string;
  /** Per-brand API key id — stable prefix, no secret. */
  keyId: string;
  /** Scope bundles granted to this key. */
  scopes: BrandcodeMcpScope[];
  /** Brand slugs this key is authorized to access. */
  allowedSlugs: string[];
  /** Environment the key belongs to. Drives URL resolution + token prefix. */
  environment: "staging" | "production";
}

export interface HostedBrandContext {
  /** Brand slug resolved from the URL path. */
  slug: string;
  /** Validated auth info scoped to this request. */
  auth: BrandcodeMcpAuthInfo;
  /** Lazy getter for the hosted brand package. Cached per-request. */
  loadBrandPackage: () => Promise<BrandPackagePayload | null>;
  /** Origin UCS API base — typically https://www.brandcode.studio. */
  ucsBaseUrl: string;
  /** Service token the hosted MCP uses to authenticate with UCS. */
  ucsServiceToken: string;
}

export interface ToolDispatchMeta {
  /** Monotonic request identifier — passed through to AgentRunRecord. */
  requestId: string;
  /** ms-epoch of request start. */
  startedAt: number;
}

export interface HostedRuntimeOptions {
  /** UCS origin. Defaults to https://www.brandcode.studio. */
  ucsBaseUrl?: string;
  /** Service token for hosted→UCS calls. Must match UCS BRANDCODE_MCP_SERVICE_TOKEN. */
  ucsServiceToken: string;
  /** Environment. Controls which bearer prefix is accepted (bck_test_ vs bck_live_). */
  environment?: "staging" | "production";
  /** Optional token validator override (tests inject a stub). */
  validateToken?: (token: string) => Promise<BrandcodeMcpAuthInfo | null>;
}
