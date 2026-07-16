/**
 * Bearer-token auth for the hosted Brandcode MCP.
 *
 * Validator shape: a pluggable async function that accepts a raw token and
 * returns BrandcodeMcpAuthInfo or null. Resolution order (see authorizeRequest):
 *   1. options.validateToken — explicit injection (tests).
 *   2. buildDefaultValidator — local env-seeded keys, only when
 *      BRANDCODE_MCP_TEST_KEYS is set for staging smoke, or when production
 *      smoke opts in with allowEnvTestKeys.
 *   3. buildUcsValidator — the production path: POST the key to the UCS
 *      `/api/brandcode-mcp/keys/validate` endpoint with the hosted service
 *      token and map the response onto BrandcodeMcpAuthInfo.
 *
 * Not coupled to any HTTP framework. The router calls `parseBearer(headers)`
 * and `validateToken(token)` and dispatches 401/403 itself.
 */
import type {
  BrandcodeMcpAuthInfo,
  BrandcodeMcpScope,
  HostedRuntimeOptions,
} from "./types.js";

const STAGING_PREFIX = "bck_test_";
const PRODUCTION_PREFIX = "bck_live_";

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

/**
 * Default validator for local dev + staging: expects test keys seeded via env,
 * never hashed here (the seed is the source of truth for staging only).
 *
 * Env shape:
 *   BRANDCODE_MCP_TEST_KEYS=bck_test_acme:acme:read,check,feedback|bck_test_readonly:acme:read
 *
 * Each entry is `token:slug:scopes` where scopes is comma-separated. The same
 * token can grant access to multiple slugs by listing it multiple times with
 * different slug fields.
 */
export function buildDefaultValidator(environment: "staging" | "production") {
  return async (token: string): Promise<BrandcodeMcpAuthInfo | null> => {
    const env = tokenEnvironment(token);
    if (env !== environment) return null;

    const raw = process.env.BRANDCODE_MCP_TEST_KEYS;
    if (!raw) return null;

    const matches = raw
      .split("|")
      .map((entry) => entry.split(":"))
      .filter(([t]) => t === token);

    if (matches.length === 0) return null;

    const slugs = new Set<string>();
    const scopes = new Set<BrandcodeMcpScope>();
    for (const [, slug, scopeCsv] of matches) {
      if (slug) slugs.add(slug);
      for (const scope of (scopeCsv ?? "").split(",")) {
        const trimmed = scope.trim() as BrandcodeMcpScope;
        if (
          trimmed === "read" ||
          trimmed === "check" ||
          trimmed === "feedback" ||
          trimmed === "capture"
        ) {
          scopes.add(trimmed);
        }
      }
    }

    if (scopes.size === 0) return null;

    return {
      token,
      keyId: token.slice(0, STAGING_PREFIX.length + 8),
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
  options: HostedRuntimeOptions,
  environment: "staging" | "production",
): boolean {
  if (!process.env.BRANDCODE_MCP_TEST_KEYS) return false;
  if (environment !== "production") return true;
  return options.allowEnvTestKeys === true;
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
}) {
  const baseUrl = opts.ucsBaseUrl ?? DEFAULT_UCS_BASE_URL;
  const url = `${baseUrl}/api/brandcode-mcp/keys/validate`;

  return async (token: string): Promise<BrandcodeMcpAuthInfo | null> => {
    // Cheap prefix gate — skip the round trip for malformed / wrong-env tokens.
    if (tokenEnvironment(token) !== opts.environment) return null;

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
      return null;
    }

    if (response.status === 401) {
      // The hosted MCP's own service token was rejected — a config error, not
      // an end-user key problem. Surface it in logs without the bearer token.
      console.error(
        "[brandcode-mcp] key validation rejected the caller (check BRANDCODE_MCP_SERVICE_TOKEN)",
      );
      return null;
    }
    if (!response.ok) {
      console.error(`[brandcode-mcp] key validation returned ${response.status}`);
      return null;
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return null;
    }

    const ok = parseUcsValidationOk(body);
    if (!ok) return null; // { valid: false } or malformed
    if (ok.environment !== opts.environment) return null;

    return {
      token,
      keyId: ok.keyId,
      scopes: ok.scopes,
      allowedSlugs: ok.allowedSlugs,
      environment: ok.environment,
    };
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
    (shouldUseEnvSeededKeys(options, environment)
      ? buildDefaultValidator(environment)
      : buildUcsValidator({
          ucsBaseUrl: options.ucsBaseUrl,
          ucsServiceToken: options.ucsServiceToken,
          environment,
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
