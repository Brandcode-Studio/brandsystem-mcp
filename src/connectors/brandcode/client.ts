/**
 * HTTP client for the Brandcode Studio hosted brand API.
 */

import type {
  ResolvedHostedBrand,
  ConnectArtifact,
  PullResult,
  HostedBrandDetailResponse,
  HostedBrandFeedResponse,
} from "./types.js";

const USER_AGENT = "brandsystem-mcp";
const TIMEOUT_MS = 30_000;

export class BrandcodeClientError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: string,
  ) {
    super(message);
    this.name = "BrandcodeClientError";
  }
}

interface FetchOptions {
  shareToken?: string;
}

async function request<T>(url: string, opts?: FetchOptions): Promise<T> {
  const headers: Record<string, string> = {
    accept: "application/json",
    "user-agent": USER_AGENT,
  };
  if (opts?.shareToken) {
    headers["x-brand-share-token"] = opts.shareToken;
  }

  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new BrandcodeClientError(
      `Brandcode API ${res.status}: ${res.statusText}`,
      res.status,
      body,
    );
  }

  return (await res.json()) as T;
}

/**
 * List all publicly listed hosted brands.
 */
export async function fetchHostedBrandList(
  baseUrl: string,
): Promise<HostedBrandFeedResponse> {
  return request<HostedBrandFeedResponse>(
    `${baseUrl}/api/brand/hosted`,
  );
}

/**
 * Fetch details for a single hosted brand.
 */
export async function fetchHostedBrandDetails(
  resolved: ResolvedHostedBrand,
  opts?: FetchOptions,
): Promise<HostedBrandDetailResponse> {
  return request<HostedBrandDetailResponse>(resolved.detailUrl, opts);
}

/**
 * Fetch the connect artifact (sync strategy, URLs, token transport).
 */
export async function fetchHostedBrandConnect(
  resolved: ResolvedHostedBrand,
  opts?: FetchOptions,
): Promise<ConnectArtifact> {
  return request<ConnectArtifact>(resolved.connectUrl, opts);
}

/**
 * Pull a hosted brand. Pass syncToken to enable delta-aware no-op.
 */
export async function pullHostedBrand(
  resolved: ResolvedHostedBrand,
  syncToken?: string,
  opts?: FetchOptions,
): Promise<PullResult> {
  let url = resolved.pullUrl;
  if (syncToken) {
    url += `?syncToken=${encodeURIComponent(syncToken)}`;
  }
  return request<PullResult>(url, opts);
}
