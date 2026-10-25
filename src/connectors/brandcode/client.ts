/**
 * HTTP client for the Brandcode Studio hosted brand API.
 */

import type {
  ResolvedHostedBrand,
  ConnectArtifact,
  PullResult,
  HostedBrandDetailResponse,
  HostedBrandFeedResponse,
  MagicLinkResponse,
  VerifyResponse,
  SaveBrandResponse,
  DeviceCodeResponse,
  DeviceCodePollResponse,
} from "./types.js";
import { safeFetch, readResponseWithLimit } from "../../lib/url-validator.js";
import {
  BrandcodeTrustError,
  isTrustedBrandcodeOrigin,
  originOf,
  trustedOriginsHint,
} from "./trust.js";

const USER_AGENT = "brandsystem-mcp";
const TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 3;
/** Upper bound for any Brandcode API response body (packages included). */
export const MAX_BRANDCODE_RESPONSE_BYTES = 25 * 1024 * 1024;
/** Raw error bodies are kept (truncated) for debugging, never put in messages. */
const MAX_ERROR_BODY_CHARS = 2_000;

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

export interface FetchOptions {
  shareToken?: string;
  authToken?: string;
  /** Sent as x-brand-session-admin-token (repo connect). */
  adminToken?: string;
  /**
   * The Studio URL the credentials were issued for (auth.studioUrl). When
   * set, a request to any other origin is refused before touching the network.
   */
  credentialOrigin?: string;
}

interface RequestInit {
  method?: string;
  body?: string;
  contentType?: string;
}

type FetchLike = (url: string, init: globalThis.RequestInit) => Promise<Response>;

interface BrandcodeTransport {
  /** Used for trusted Studio origins. Called with redirect: "manual". */
  trustedFetch: FetchLike;
  /** Used for untrusted custom domains: SSRF-guarded and credential-free. */
  untrustedFetch: FetchLike;
}

const defaultTransport: BrandcodeTransport = {
  // Resolve globalThis.fetch per call so test spies and polyfills apply.
  trustedFetch: (url, init) => globalThis.fetch(url, init),
  untrustedFetch: (url, init) =>
    safeFetch(url, { ...init, maxResponseBytes: MAX_BRANDCODE_RESPONSE_BYTES }),
};

let transport: BrandcodeTransport = { ...defaultTransport };

/**
 * Test seam: swap the transports used for trusted and untrusted origins.
 * Call with no argument to restore the defaults.
 */
export function setBrandcodeTransportForTests(
  override?: Partial<BrandcodeTransport>,
): void {
  transport = { ...defaultTransport, ...(override ?? {}) };
}

export interface BrandcodeResponse<T> {
  status: number;
  ok: boolean;
  /** Parsed JSON body, or null when the body was empty. */
  data: T | null;
  /** Origin of the final response (after any permitted redirects). */
  origin: string;
  /** True only when every hop was a trusted Brandcode Studio origin. */
  trusted: boolean;
}

function isRedirect(status: number): boolean {
  return [301, 302, 303, 307, 308].includes(status);
}

function parseJsonSafe(text: string): { ok: true; value: unknown } | { ok: false } {
  if (!text.trim()) return { ok: true, value: null };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

/**
 * Low-level Brandcode request with origin-trust enforcement.
 *
 * - Credentials (share / auth / admin tokens) are sent only to a trusted
 *   origin, and only to exactly `credentialOrigin` when that is given.
 * - Trusted origins: redirects are handled manually. A hop to an untrusted
 *   origin is refused; a cross-origin hop is refused when credentials are
 *   attached; non-GET requests are never redirected.
 * - Untrusted origins: https only, GET only, never credentials, fetched with
 *   the SSRF-guarded safeFetch (each redirect hop re-validated; private,
 *   loopback, and metadata addresses refused).
 * - Error messages never contain response bodies or server-provided text.
 *
 * With `allowErrorStatus`, non-2xx JSON responses are returned instead of
 * thrown so callers can read structured error fields.
 */
export async function brandcodeRequest<T>(
  url: string,
  opts?: FetchOptions,
  init?: RequestInit & { allowErrorStatus?: boolean },
): Promise<BrandcodeResponse<T>> {
  let current: URL;
  try {
    current = new URL(url);
  } catch {
    throw new BrandcodeTrustError("Invalid Brandcode URL");
  }
  if (current.protocol !== "https:" && current.protocol !== "http:") {
    throw new BrandcodeTrustError("Brandcode URLs must use https");
  }

  const method = init?.method ?? "GET";
  const trusted = isTrustedBrandcodeOrigin(current.origin);
  const hasCredentials = Boolean(opts?.shareToken || opts?.authToken || opts?.adminToken);

  const headers: Record<string, string> = {
    accept: "application/json",
    "user-agent": USER_AGENT,
  };
  if (init?.contentType) {
    headers["content-type"] = init.contentType;
  }

  if (hasCredentials) {
    if (!trusted) {
      throw new BrandcodeTrustError(
        `Refusing to send Brandcode credentials to untrusted origin ${current.origin}. ${trustedOriginsHint()}`,
      );
    }
    if (opts?.credentialOrigin !== undefined) {
      const credentialOrigin = originOf(opts.credentialOrigin);
      if (!credentialOrigin || !isTrustedBrandcodeOrigin(credentialOrigin)) {
        throw new BrandcodeTrustError(
          `Stored Brandcode credentials were issued for an untrusted origin (${credentialOrigin ?? "invalid"}). Run brand_brandcode_auth mode="logout", then re-authenticate against a trusted Studio. ${trustedOriginsHint()}`,
        );
      }
      if (credentialOrigin !== current.origin) {
        throw new BrandcodeTrustError(
          `Refusing to send Brandcode credentials to ${current.origin}: they were issued for ${credentialOrigin}.`,
        );
      }
    }
    if (opts?.shareToken) headers["x-brand-share-token"] = opts.shareToken;
    if (opts?.authToken) headers["authorization"] = `Bearer ${opts.authToken}`;
    if (opts?.adminToken) headers["x-brand-session-admin-token"] = opts.adminToken;
  }

  let res: Response;
  if (!trusted) {
    if (current.protocol !== "https:") {
      throw new BrandcodeTrustError(
        `Untrusted Brandcode origin ${current.origin} must use https. ${trustedOriginsHint()}`,
      );
    }
    if (method !== "GET") {
      throw new BrandcodeTrustError(
        `Refusing ${method} to untrusted Brandcode origin ${current.origin}. ${trustedOriginsHint()}`,
      );
    }
    try {
      res = await transport.untrustedFetch(current.href, {
        method,
        headers,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.startsWith("SSRF blocked")) {
        throw new BrandcodeTrustError(`Request to ${current.origin} refused: ${msg}`);
      }
      throw err;
    }
  } else {
    let hops = 0;
    for (;;) {
      res = await transport.trustedFetch(current.href, {
        method,
        headers,
        body: init?.body,
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!isRedirect(res.status)) break;

      const location = res.headers.get("location");
      await res.body?.cancel().catch(() => undefined);
      if (!location) {
        throw new BrandcodeClientError(
          `Brandcode API returned a redirect (HTTP ${res.status}) without a location`,
          res.status,
          "",
        );
      }
      let next: URL;
      try {
        next = new URL(location, current);
      } catch {
        throw new BrandcodeTrustError("Brandcode API redirected to an invalid URL; refused");
      }
      if (!isTrustedBrandcodeOrigin(next.origin)) {
        throw new BrandcodeTrustError(
          `Brandcode API at ${current.origin} redirected to an untrusted origin (${originOf(next.href) ?? next.protocol}); refused.`,
        );
      }
      if (hasCredentials && next.origin !== current.origin) {
        throw new BrandcodeTrustError(
          `Brandcode API at ${current.origin} redirected a credentialed request to ${next.origin}; refused so credentials stay with the origin they were issued for.`,
        );
      }
      if (method !== "GET") {
        throw new BrandcodeTrustError(`Brandcode API redirected a ${method} request; refused.`);
      }
      hops++;
      if (hops > MAX_REDIRECTS) {
        throw new BrandcodeTrustError(`Brandcode API redirected too many times (>${MAX_REDIRECTS})`);
      }
      current = next;
    }
  }

  let text: string;
  try {
    text = await readResponseWithLimit(res, MAX_BRANDCODE_RESPONSE_BYTES);
  } catch {
    throw new BrandcodeClientError(
      "Brandcode API response was too large or could not be read",
      res.status,
      "",
    );
  }

  if (!res.ok && !init?.allowErrorStatus) {
    throw new BrandcodeClientError(
      `Brandcode API returned HTTP ${res.status}`,
      res.status,
      text.slice(0, MAX_ERROR_BODY_CHARS),
    );
  }

  const parsed = parseJsonSafe(text);
  if (!parsed.ok) {
    throw new BrandcodeClientError(
      `Brandcode API returned a non-JSON response (HTTP ${res.status})`,
      res.status,
      "",
    );
  }

  return {
    status: res.status,
    ok: res.ok,
    data: parsed.value as T | null,
    origin: current.origin,
    trusted,
  };
}

async function request<T>(url: string, opts?: FetchOptions, init?: RequestInit): Promise<T> {
  const res = await brandcodeRequest<T>(url, opts, init);
  if (res.data === null) {
    throw new BrandcodeClientError(
      `Brandcode API returned an empty response (HTTP ${res.status})`,
      res.status,
      "",
    );
  }
  return res.data;
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

// ---------------------------------------------------------------------------
// Auth endpoints
// ---------------------------------------------------------------------------

/**
 * Request a magic link email for the given email address.
 */
export async function requestMagicLink(
  baseUrl: string,
  email: string,
): Promise<MagicLinkResponse> {
  return request<MagicLinkResponse>(
    `${baseUrl}/api/auth/magic-link`,
    undefined,
    {
      method: "POST",
      body: JSON.stringify({ email }),
      contentType: "application/json",
    },
  );
}

/**
 * Verify a magic link token and receive a session JWT.
 */
export async function verifyMagicLink(
  baseUrl: string,
  token: string,
): Promise<VerifyResponse> {
  return request<VerifyResponse>(
    `${baseUrl}/api/auth/verify?token=${encodeURIComponent(token)}`,
  );
}

// ---------------------------------------------------------------------------
// Brand save/push endpoints
// ---------------------------------------------------------------------------

/**
 * Save a brand package to Studio (create or update).
 * Requires auth token.
 */
export async function saveBrandToStudio(
  baseUrl: string,
  payload: Record<string, unknown>,
  authToken: string,
): Promise<SaveBrandResponse> {
  return request<SaveBrandResponse>(
    `${baseUrl}/api/brand/save`,
    { authToken, credentialOrigin: baseUrl },
    {
      method: "POST",
      body: JSON.stringify(payload),
      contentType: "application/json",
    },
  );
}

// ---------------------------------------------------------------------------
// Device code auth endpoints
// ---------------------------------------------------------------------------

/**
 * Request a device code for agent-first authentication.
 */
export async function requestDeviceCode(
  baseUrl: string,
  email: string,
): Promise<DeviceCodeResponse> {
  return request<DeviceCodeResponse>(
    `${baseUrl}/api/auth/device-code`,
    undefined,
    {
      method: "POST",
      body: JSON.stringify({ email }),
      contentType: "application/json",
    },
  );
}

/**
 * Poll for device code completion. Returns the session JWT when approved.
 */
export async function pollDeviceCode(
  baseUrl: string,
  code: string,
): Promise<DeviceCodePollResponse> {
  return request<DeviceCodePollResponse>(
    `${baseUrl}/api/auth/device-code/poll?code=${encodeURIComponent(code)}`,
  );
}
