/**
 * Live Mode data source resolver.
 *
 * When a connector has `liveMode: true`, this helper transparently refreshes
 * the local brand package mirror on behalf of read-only tools. It honors the
 * per-brand cache TTL (default 60s) so high-frequency tools don't hammer the
 * Studio API, and falls back silently to the on-disk mirror on network error.
 *
 * Contract: tools call `ensureLiveFreshness(cwd)` at the start of their
 * handler. Result tells them which data source they're serving from so they
 * can surface a lightweight indicator in the response.
 */
import type { BrandPackagePayload, ConnectorConfig } from "./types.js";
import {
  getLiveCacheEntry,
  setLiveCacheEntry,
  clearLiveCache,
} from "./live-cache.js";
import {
  readConnectorConfig,
  readPackagePayload,
  writeConnectorConfig,
  writePackagePayload,
} from "./persistence.js";
import { resolveBrandcodeHostedUrl } from "./resolve.js";
import { pullHostedBrand } from "./client.js";

const DEFAULT_TTL_SECONDS = 60;

export type LiveFreshnessSource =
  | "inactive"
  | "cache"
  | "live"
  | "live-no-change"
  | "local-fallback";

export interface LiveFreshnessResult {
  /** True iff the connector has Live Mode enabled. */
  live: boolean;
  /** Which data source this read is being served from. */
  source: LiveFreshnessSource;
  /** ms-epoch timestamp of the freshest upstream fetch observed. */
  fetchedAt?: number;
  /** Effective cache TTL in seconds. */
  ttlSeconds?: number;
  /** Sync token in play (mirror's latest, or hosted's latest after refresh). */
  syncToken?: string;
  /** Hosted package payload (from cache, live, or on-disk fallback). */
  package?: BrandPackagePayload | null;
  /** Slug being served. */
  slug?: string;
  /** Present when we fell back due to an upstream error. */
  fallbackReason?: string;
}

function resolveTTL(config: ConnectorConfig): number {
  const ttl = config.liveCacheTTLSeconds;
  if (typeof ttl === "number" && ttl > 0) return ttl;
  return DEFAULT_TTL_SECONDS;
}

/**
 * Refresh the local package mirror when Live Mode is on and the cache is cold.
 * Returns a descriptor the calling tool can use to decorate its response.
 */
export async function ensureLiveFreshness(
  cwd: string,
): Promise<LiveFreshnessResult> {
  const config = await readConnectorConfig(cwd);
  if (!config || !config.liveMode) {
    return { live: false, source: "inactive" };
  }

  const ttlSeconds = resolveTTL(config);
  const cached = getLiveCacheEntry(config.slug);
  if (cached) {
    return {
      live: true,
      source: "cache",
      fetchedAt: cached.fetchedAt,
      ttlSeconds,
      syncToken: cached.syncToken,
      package: cached.package,
      slug: config.slug,
    };
  }

  let resolved;
  try {
    resolved = resolveBrandcodeHostedUrl(config.brandUrl);
  } catch (err) {
    return fallbackFromDisk(cwd, config, ttlSeconds, (err as Error).message);
  }

  try {
    const result = await pullHostedBrand(resolved, config.syncToken);
    const now = Date.now();

    if (result.upToDate) {
      const localPkg = await readPackagePayload(cwd);
      setLiveCacheEntry(config.slug, {
        package: localPkg,
        syncToken: config.syncToken,
        ttlSeconds,
        fetchedAt: now,
      });
      return {
        live: true,
        source: "live-no-change",
        fetchedAt: now,
        ttlSeconds,
        syncToken: config.syncToken,
        package: localPkg,
        slug: config.slug,
      };
    }

    if (!result.package) {
      return fallbackFromDisk(cwd, config, ttlSeconds, "empty-package");
    }

    await writePackagePayload(cwd, result.package, {
      origin: resolved.baseUrl,
      signature: result.signature,
    });
    const updatedConfig: ConnectorConfig = {
      ...config,
      syncToken: result.brand.syncToken,
      lastSyncedAt: new Date(now).toISOString(),
    };
    await writeConnectorConfig(cwd, updatedConfig);
    setLiveCacheEntry(config.slug, {
      package: result.package,
      syncToken: result.brand.syncToken,
      ttlSeconds,
      fetchedAt: now,
    });

    return {
      live: true,
      source: "live",
      fetchedAt: now,
      ttlSeconds,
      syncToken: result.brand.syncToken,
      package: result.package,
      slug: config.slug,
    };
  } catch (err) {
    return fallbackFromDisk(cwd, config, ttlSeconds, (err as Error).message);
  }
}

async function fallbackFromDisk(
  cwd: string,
  config: ConnectorConfig,
  ttlSeconds: number,
  reason: string,
): Promise<LiveFreshnessResult> {
  const localPkg = await readPackagePayload(cwd);
  return {
    live: true,
    source: "local-fallback",
    ttlSeconds,
    syncToken: config.syncToken,
    package: localPkg,
    slug: config.slug,
    fallbackReason: reason,
  };
}

/** Descriptor a tool can attach to its `data` field for client visibility. */
export interface LiveIndicator {
  live_mode: boolean;
  data_source: LiveFreshnessSource;
  cache_age_seconds?: number;
  cache_ttl_seconds?: number;
  slug?: string;
  fallback_reason?: string;
}

export function buildLiveIndicator(
  result: LiveFreshnessResult,
): LiveIndicator | null {
  if (!result.live) return null;
  const indicator: LiveIndicator = {
    live_mode: true,
    data_source: result.source,
    cache_ttl_seconds: result.ttlSeconds,
    slug: result.slug,
  };
  if (result.fetchedAt) {
    indicator.cache_age_seconds = Math.round(
      (Date.now() - result.fetchedAt) / 1000,
    );
  }
  if (result.fallbackReason) {
    indicator.fallback_reason = result.fallbackReason;
  }
  return indicator;
}

/** Re-export cache-bust so sync tools can wire it in without touching cache internals. */
export function invalidateLiveCache(slug?: string): void {
  clearLiveCache(slug);
}
