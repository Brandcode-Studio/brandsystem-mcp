/**
 * Types matching the Brandcode Studio hosted brand API contract.
 * Contract version: 2026-04-05-connect
 */

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

/** The full brand package payload from a pull. Kept as a loose record
 *  so the MCP side stays decoupled from the full UCS type graph. */
export type BrandPackagePayload = Record<string, unknown>;

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
