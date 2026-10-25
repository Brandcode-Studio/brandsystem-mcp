/**
 * Bearer-token auth for the hosted Brandcode MCP.
 *
 * Validator shape: a pluggable async function that accepts a raw token and
 * returns BrandcodeMcpAuthInfo or null. Resolution order (see authorizeRequest):
 *   1. options.validateToken — explicit injection (tests).
 *   2. buildDefaultValidator — local env-seeded keys, only in staging and
 *      only when BRANDCODE_MCP_TEST_KEYS is set. Never honored in production.
 *   3. buildUcsValidator — the production path: POST the key to the UCS
 *      `/api/brandcode-mcp/keys/validate` endpoint with the hosted service
 *      token and map the response onto BrandcodeMcpAuthInfo.
 *
 * The UCS path is guarded so unauthenticated traffic cannot amplify into UCS:
 *   - a strict local key-format check (`^bck_(live|test)_[0-9A-Za-z]{32}$`,
 *     the exact shape UCS mints) rejects malformed tokens with no round trip;
 *   - an in-process cache keyed by sha256(token) remembers definitive answers
 *     (valid: 30s, invalid: 60s, bounded LRU of 1,000 entries). Revocation in
 *     UCS therefore takes effect on a warm instance within 30 seconds.
 *     Upstream failures (network, non-2xx, service-token rejection, malformed
 *     payloads) are never cached.
 *
 * Not coupled to any HTTP framework. The router calls `parseBearer(headers)`
 * and `validateToken(token)` and dispatches 401/403 itself.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import type {
  BrandcodeMcpAuthInfo,
  BrandcodeMcpScope,
  HostedRuntimeOptions,
  KeyValidationCacheLike,
} from "./types.js";

const STAGING_PREFIX = "bck_test_";
const PRODUCTION_PREFIX = "bck_live_";

/** Exact shape UCS mints (UCS app/tools/lib/brandcode-mcp-key-registry.ts). */
const KEY_TOKEN_PATTERN = /^bck_(live|test)_[0-9A-Za-z]{32}$/;

export const KEY_VALIDATION_POSITIVE_TTL_MS = 30_000;
export const KEY_VALIDATION_NEGATIVE_TTL_MS = 60_000;
export const KEY_VALIDATION_CACHE_MAX_ENTRIES = 1_000;

const DEFAULT_UCS_BASE_URL = "https://www.brandcode.studio";
const VALIDATE_USER_AGENT = "brandcode-mcp";
const VALIDATE_TIMEOUT_MS = 10_000;

export class AuthError extends Error {
  constructor(
    public status: 401 | 403,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export function parseBearer(headers: Headers): string | null {
  const value = headers.get("authorization") ?? headers.get("Authorization");
  if (!value) return null;
  const match = value.match(/^Bearer\s+(\S+)$/i);
  if (!match) return null;
  return match[1];
}

/**
 * Permitted scopes per tool (matches the Phase 0 lock). Kept here rather than
 * on the tool definitions so the auth boundary stays single-sourced.
 */
export const TOOL_SCOPE_REQUIREMENTS: Record<string, BrandcodeMcpScope> = {
  brand_runtime: "read",
  brand_search: "read",
  brand_status: "read",
  list_brand_assets: "read",
  get_brand_asset: "read",
  brand_history: "read",
  brand_check: "check",
  brand_feedback: "feedback",
  capture_taste: "capture",
};

export function toolHasScope(
  tool: string,
  scopes: BrandcodeMcpScope[],
): boolean {
  const required = TOOL_SCOPE_REQUIREMENTS[tool];
  if (!required) return false;
  if (required === "read") return scopes.includes("read");
  if (required === "check") {
    return scopes.includes("check");
  }
  if (required === "feedback") {
    return scopes.includes("feedback");
  }
  // capture is the hosted contribute tier; read/check/feedback are insufficient.
  return scopes.includes("capture");
}

export function tokenEnvironment(
  token: string,
): "staging" | "production" | null {
  if (token.startsWith(STAGING_PREFIX)) return "staging";
  if (token.startsWith(PRODUCTION_PREFIX)) return "production";
  return null;
}

/** True when the token has the exact format UCS mints. */
export function isWellFormedKey(token: string): boolean {
  return KEY_TOKEN_PATTERN.test(token);
}

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

type CachedAuthInfo = Omit<BrandcodeMcpAuthInfo, "token">;

/**
 * Bounded LRU of key-validation outcomes keyed by sha256(token). The raw
 * token is never stored; auth info is stored without it and re-attached on
 * a hit.
 */
export class KeyValidationCache implements KeyValidationCacheLike {
  private readonly entries = new Map<
    string,
    { expiresAt: number; info: CachedAuthInfo | null }
  >();

  constructor(
    private readonly opts: {
      maxEntries?: number;
      positiveTtlMs?: number;
      negativeTtlMs?: number;
      now?: () => number;
    } = {},
  ) {}

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }

  get size(): number {
    return this.entries.size;
  }

  get(
    token: string,
  ): { hit: true; info: BrandcodeMcpAuthInfo | null } | { hit: false } {
    const key = sha256(token).toString("hex");
    const entry = this.entries.get(key);
    if (!entry) return { hit: false };
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return { hit: false };
    }
    // Refresh LRU position.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return {
      hit: true,
      info: entry.info
        ? {
            ...entry.info,
            scopes: [...entry.info.scopes],
            allowedSlugs: [...entry.info.allowedSlugs],
            token,
          }
        : null,
    };
  }

  set(token: string, info: BrandcodeMcpAuthInfo | null): void {
    const key = sha256(token).toString("hex");
    const ttl = info
      ? (this.opts.positiveTtlMs ?? KEY_VALIDATION_POSITIVE_TTL_MS)
      : (this.opts.negativeTtlMs ?? KEY_VALIDATION_NEGATIVE_TTL_MS);
    const stored: CachedAuthInfo | null = info
      ? {
          keyId: info.keyId,
          scopes: [...info.scopes],
          allowedSlugs: [...info.allowedSlugs],
          environment: info.environment,
        }
      : null;
    this.entries.delete(key);
    this.entries.set(key, { expiresAt: this.now() + ttl, info: stored });
    const max = this.opts.maxEntries ?? KEY_VALIDATION_CACHE_MAX_ENTRIES;
    while (this.entries.size > max) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  clear(): void {
    this.entries.clear();
  }
}

const defaultValidationCache = new KeyValidationCache();

/** Test seam: drop every cached validation outcome in the default cache. */
export function resetDefaultKeyValidationCache(): void {
  defaultValidationCache.clear();
}

/**
 * Default validator for local dev + staging: expects test keys seeded via env.
 * Staging only — in production this validator never matches anything.
 *
 * Env shape:
 *   BRANDCODE_MCP_TEST_KEYS=bck_test_acme:acme:read,check,feedback|bck_test_readonly:acme:read
 *
 * Each entry is `token:slug:scopes` where scopes is comma-separated. The same
 * token can grant access to multiple slugs by listing it multiple times with
 * different slug fields. Tokens are compared as sha256 digests with
 * timingSafeEqual, and the key id is derived from a hash of the token (never
 * a slice of the secret). These keys are not revocable except by changing
 * the env var and redeploying — keep them out of anything long-lived.
 */
export function buildDefaultValidator(environment: "staging" | "production") {
  return async (token: string): Promise<BrandcodeMcpAuthInfo | null> => {
    if (environment !== "staging") return null;
    if (tokenEnvironment(token) !== "staging") return null;

    const raw = process.env.BRANDCODE_MCP_TEST_KEYS;
    if (!raw) return null;

    const tokenDigest = sha256(token);
    const matches = raw
      .split("|")
      .map((entry) => entry.split(":"))
      // Constant-time compare on fixed-length digests. Every entry is
      // compared (no early exit) so timing does not reveal which matched.
      .filter(([candidate]) =>
        candidate ? timingSafeEqual(sha256(candidate), tokenDigest) : false,
      );

    if (matches.length === 0) return null;

    const slugs = new Set<string>();
    const scopes = new Set<BrandcodeMcpScope>();
    for (const [, slug, scopeCsv] of matches) {
      if (slug) slugs.add(slug);
      for (const scope of (scopeCsv ?? "").split(",")) {
        const trimmed = scope.trim();
        if (isScope(trimmed)) scopes.add(trimmed);
      }
    }

    if (scopes.size === 0) return null;

    return {
      token,
      keyId: `${STAGING_PREFIX}env_${tokenDigest.toString("hex").slice(0, 12)}`,
      scopes: [...scopes],
      allowedSlugs: [...slugs],
      environment,
    };
  };
}

function isScope(value: unknown): value is BrandcodeMcpScope {
  return (
    value === "read" ||
    value === "check" ||
    value === "feedback" ||
    value === "capture"
  );
}

function shouldUseEnvSeededKeys(
  environment: "staging" | "production",
): boolean {
  if (!process.env.BRANDCODE_MCP_TEST_KEYS) return false;
  return environment === "staging";
}

interface UcsKeyValidationOk {
  valid: true;
  keyId: string;
  environment: "staging" | "production";
  scopes: BrandcodeMcpScope[];
  allowedSlugs: string[];
}

/** Defensive parse of the UCS validate response — never trust upstream blindly. */
function parseUcsValidationOk(body: unknown): UcsKeyValidationOk | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (b.valid !== true) return null;
  if (typeof b.keyId !== "string" || b.keyId.length === 0) return null;
  if (b.environment !== "staging" && b.environment !== "production") return null;
  if (!Array.isArray(b.scopes) || b.scopes.length === 0 || !b.scopes.every(isScope)) {
    return null;
  }
  if (
    !Array.isArray(b.allowedSlugs) ||
    b.allowedSlugs.length === 0 ||
    !b.allowedSlugs.every((s) => typeof s === "string" && s.length > 0)
  ) {
    return null;
  }
  return {
    valid: true,
    keyId: b.keyId,
    environment: b.environment,
    scopes: [...new Set(b.scopes as BrandcodeMcpScope[])],
    allowedSlugs: [...new Set(b.allowedSlugs as string[])],
  };
}

type UcsValidationOutcome =
  | { kind: "valid"; info: BrandcodeMcpAuthInfo }
  | { kind: "invalid" }
  | { kind: "error" };

/**
 * Production validator: resolves a per-brand key against UCS.
 *
 * POSTs `{ token }` to `${ucsBaseUrl}/api/brandcode-mcp/keys/validate` with the
 * hosted MCP's service token as the caller credential. UCS hashes the token,
 * looks up the (Blob-backed) key record, and returns its scopes + allowed
 * slugs. Slug binding is enforced afterward by authorizeRequest, which yields a
 * precise 403 slug_forbidden rather than a generic invalid_token — so we
 * deliberately do NOT pass slug here.
 *
 * Fails closed: any upstream/parse failure returns null (→ 401 invalid_token).
 * The raw token is never logged.
 */
export function buildUcsValidator(opts: {
  ucsBaseUrl?: string;
  ucsServiceToken: string;
  environment: "staging" | "production";
  /** Optional validation cache. Omitted = no caching. */
  cache?: KeyValidationCacheLike;
}) {
  const baseUrl = opts.ucsBaseUrl ?? DEFAULT_UCS_BASE_URL;
  const url = `${baseUrl}/api/brandcode-mcp/keys/validate`;

  const validateUpstream = async (
    token: string,
  ): Promise<UcsValidationOutcome> => {
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "user-agent": VALIDATE_USER_AGENT,
          authorization: `Bearer ${opts.ucsServiceToken}`,
        },
        body: JSON.stringify({ token }),
        signal: AbortSignal.timeout(VALIDATE_TIMEOUT_MS),
      });
    } catch (err) {
      // Upstream unreachable — fail closed, never leak the token.
      console.error(
        `[brandcode-mcp] key validation upstream error: ${(err as Error).message}`,
      );
      return { kind: "error" };
    }

    if (response.status === 401) {
      // The hosted MCP's own service token was rejected — a config error, not
      // an end-user key problem. Surface it in logs without the bearer token.
      console.error(
        "[brandcode-mcp] key validation rejected the caller (check BRANDCODE_MCP_SERVICE_TOKEN)",
      );
      return { kind: "error" };
    }
    if (!response.ok) {
      console.error(`[brandcode-mcp] key validation returned ${response.status}`);
      return { kind: "error" };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { kind: "error" };
    }

    if (
      body &&
      typeof body === "object" &&
      (body as Record<string, unknown>).valid === false
    ) {
      return { kind: "invalid" };
    }
    const ok = parseUcsValidationOk(body);
    // A malformed payload is a contract error, not a verdict on the key —
    // fail closed without caching.
    if (!ok) return { kind: "error" };
    // A real key from the other environment is definitively invalid here.
    if (ok.environment !== opts.environment) return { kind: "invalid" };

    return {
      kind: "valid",
      info: {
        token,
        keyId: ok.keyId,
        scopes: ok.scopes,
        allowedSlugs: ok.allowedSlugs,
        environment: ok.environment,
      },
    };
  };

  return async (token: string): Promise<BrandcodeMcpAuthInfo | null> => {
    // Strict local gate — malformed or wrong-environment tokens never reach
    // UCS and never occupy cache slots.
    if (!isWellFormedKey(token)) return null;
    if (tokenEnvironment(token) !== opts.environment) return null;

    const cached = opts.cache?.get(token);
    if (cached?.hit) return cached.info;

    const outcome = await validateUpstream(token);
    if (outcome.kind === "valid") {
      opts.cache?.set(token, outcome.info);
      return outcome.info;
    }
    if (outcome.kind === "invalid") {
      opts.cache?.set(token, null);
    }
    return null;
  };
}

export async function authorizeRequest(
  headers: Headers,
  slug: string,
  options: HostedRuntimeOptions,
): Promise<BrandcodeMcpAuthInfo> {
  const token = parseBearer(headers);
  if (!token) {
    throw new AuthError(401, "missing_bearer", "Authorization: Bearer required");
  }

  const environment = options.environment ?? "staging";
  const validator =
    options.validateToken ??
    (shouldUseEnvSeededKeys(environment)
      ? buildDefaultValidator(environment)
      : buildUcsValidator({
          ucsBaseUrl: options.ucsBaseUrl,
          ucsServiceToken: options.ucsServiceToken,
          environment,
          cache: options.validationCache ?? defaultValidationCache,
        }));
  const info = await validator(token);
  if (!info) {
    throw new AuthError(401, "invalid_token", "Token is not valid");
  }

  if (!info.allowedSlugs.includes(slug)) {
    throw new AuthError(
      403,
      "slug_forbidden",
      `Token is not authorized for slug "${slug}"`,
    );
  }

  return info;
}
