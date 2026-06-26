/**
 * Types matching the Brandcode Studio hosted brand API contract.
 * Contract version: 2026-04-05-connect
 *
 * The knowledge/retrieval contract carried inside the pull package lives in
 * ./knowledge-types and is re-exported here for a single connector entry point.
 */

import type {
  BrandInstancePayload,
  BrandKnowledgeCorpus,
  BrandRetrievalManifest,
} from "./knowledge-types.js";

export * from "./knowledge-types.js";

// ---------------------------------------------------------------------------
// URL Resolution
// ---------------------------------------------------------------------------

export interface ResolvedHostedBrand {
  slug: string;
  baseUrl: string;
  detailUrl: string;
  connectUrl: string;
  pullUrl: string;
}

// ---------------------------------------------------------------------------
// API Response: Brand Record (shared across all endpoints)
// ---------------------------------------------------------------------------

export interface HostedBrandAccess {
  mode: "listed" | "unlisted" | "protected";
  requiresToken: boolean;
  listedInFeed: boolean;
}

export interface HostedBrandLinks {
  self: string;
  connect: string;
  pull: string;
  package: string;
  assetManifest: string;
  studio: string;
  detail: string;
}

export interface HostedBrandRecord {
  slug: string;
  name: string;
  updatedAt: string;
  revisionCount: number;
  readinessStage: string;
  narrativeCount: number;
  assetCount: number;
  enabledCapabilityCount: number;
  primaryConcern: string | null;
  nextUnlock: string | null;
  syncToken: string;
  transport: string;
  lastAction: string;
  access: HostedBrandAccess;
  links: HostedBrandLinks;
}

// ---------------------------------------------------------------------------
// API Response: GET /api/brand/hosted
// ---------------------------------------------------------------------------

export interface HostedBrandFeedResponse {
  contractVersion: string;
  source: string;
  exportedAt: string;
  count: number;
  brands: HostedBrandRecord[];
}

// ---------------------------------------------------------------------------
// API Response: GET /api/brand/hosted/:slug
// ---------------------------------------------------------------------------

export interface HostedBrandDetailResponse {
  contractVersion: string;
  source: string;
  brand: HostedBrandRecord;
}

// ---------------------------------------------------------------------------
// API Response: GET /api/brand/hosted/:slug/connect
// ---------------------------------------------------------------------------

export interface ConnectArtifact {
  contractVersion: string;
  source: string;
  brand: HostedBrandRecord;
  connect: {
    strategy: string;
    files: {
      localSyncState: string;
      localConnectorConfig: string;
      localPackage: string;
    };
    remote: {
      slug: string;
      detailUrl: string;
      connectUrl: string;
      pullUrl: string;
      packageUrl: string;
      assetManifestUrl: string;
      studioUrl: string;
    };
    sync: {
      currentSyncToken: string;
      shareTokenRequired: boolean;
      shareTokenTransport: { header: string };
      syncTokenTransport: { queryParam: string };
    };
  };
}

// ---------------------------------------------------------------------------
// API Response: GET /api/brand/hosted/:slug/pull
// ---------------------------------------------------------------------------

export interface HostedBrandDelta {
  fromRevision: number | null;
  toRevision: number;
  changedAreas: string[];
  current: {
    assetCount: number;
    narrativeCount: number;
    proofPointCount: number;
    deployablePhraseCount: number;
    enabledCapabilityCount: number;
  };
  previous: {
    assetCount: number;
    narrativeCount: number;
    proofPointCount: number;
    deployablePhraseCount: number;
    enabledCapabilityCount: number;
  } | null;
}

/** The full brand package payload from a pull. Typed-but-open: the known
 *  fields the hosted tools consume are modeled (see knowledge-types.ts for the
 *  knowledge/retrieval contract), while the index signature keeps the MCP
 *  decoupled from the full UCS type graph and tolerant of new/unknown fields. */
export interface BrandPackagePayload {
  slug?: string;
  runtimeVersion?: string;
  runtime?: Record<string, unknown>;
  identity?: Record<string, unknown>;
  brandInstance?: BrandInstancePayload;
  /** Prebuilt retrieval corpus UCS ships in the compiled package. */
  brandKnowledgeCorpus?: BrandKnowledgeCorpus;
  /** Retrieval coverage/confidence/blind-spot manifest, paired with the corpus. */
  retrievalManifest?: BrandRetrievalManifest;
  brandGraph?: Record<string, unknown>;
  brandData?: Record<string, unknown>;
  interactionPolicy?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface PullResult {
  contractVersion: string;
  source: string;
  requestedSyncToken: string | null;
  upToDate: boolean;
  brand: HostedBrandRecord;
  delta: HostedBrandDelta | null;
  package: BrandPackagePayload | null;
}

// ---------------------------------------------------------------------------
// API Request/Response: POST /api/auth/magic-link
// ---------------------------------------------------------------------------

export interface MagicLinkRequest {
  email: string;
}

export interface MagicLinkResponse {
  ok: true;
  mode: "development" | "email";
  email: string;
  expiresAt: string;
  /** Only present in development mode */
  token?: string;
  /** Only present in development mode */
  verifyUrl?: string;
  /** Only present in email mode */
  deliveryId?: string | null;
}

// ---------------------------------------------------------------------------
// API Request/Response: GET /api/auth/verify
// ---------------------------------------------------------------------------

export interface VerifyResponse {
  ok: true;
  email: string;
  token: string;
  expiresAt: string;
}

// ---------------------------------------------------------------------------
// API Request/Response: POST /api/brand/save
// ---------------------------------------------------------------------------

export interface SaveBrandResponse {
  slug: string;
  ownerEmail: string;
  syncToken: string;
  session: {
    slug: string;
    url: string;
    savedAt: string;
  };
}

// ---------------------------------------------------------------------------
// API Request/Response: POST /api/auth/device-code
// ---------------------------------------------------------------------------

export interface DeviceCodeResponse {
  ok: true;
  code: string;
  activate_url: string;
  expires_at: string;
  poll_interval: number;
}

// ---------------------------------------------------------------------------
// API Response: GET /api/auth/device-code/poll
// ---------------------------------------------------------------------------

export type DeviceCodePollResponse =
  | { status: "pending" }
  | { status: "expired" }
  | { status: "not_found" }
  | { status: "complete"; token: string; email: string; expiresAt: string };

// ---------------------------------------------------------------------------
// Local Persistence: .brand/brandcode-auth.json (gitignored)
// ---------------------------------------------------------------------------

export interface AuthCredentials {
  email: string;
  token: string;
  expiresAt: string;
  studioUrl: string;
}

// ---------------------------------------------------------------------------
// Local Persistence: .brand/brandcode-connector.json
// ---------------------------------------------------------------------------

export interface ConnectorConfig {
  provider: "brandcode";
  brandUrl: string;
  slug: string;
  pullUrl: string;
  connectUrl: string;
  syncToken: string;
  lastSyncedAt: string;
  shareTokenRequired: boolean;
  /** When true, read-only tools refresh from hosted runtime on call (subject to TTL). */
  liveMode?: boolean;
  /** ISO timestamp of when Live Mode was turned on. */
  liveModeActivatedAt?: string;
  /** Cache TTL for live reads. Defaults to 60s when absent. */
  liveCacheTTLSeconds?: number;
}

// ---------------------------------------------------------------------------
// Local Persistence: .brand/brandcode-sync-history.json
// ---------------------------------------------------------------------------

export interface SyncHistoryEvent {
  timestamp: string;
  syncMode: "first_sync" | "updated" | "no_change";
  changedAreas: string[];
  advice: {
    headline: string;
    detail: string;
  };
}

export interface SyncHistory {
  events: SyncHistoryEvent[];
}
