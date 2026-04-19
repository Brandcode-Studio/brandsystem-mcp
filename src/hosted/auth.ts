/**
 * Bearer-token auth for the hosted Brandcode MCP.
 *
 * Phase 1 validator shape: a pluggable async function that accepts a raw token
 * and returns BrandcodeMcpAuthInfo or null. Phase 1 ships a deterministic
 * in-process validator for local dev + staging smoke against fixed test keys;
 * Phase 2 wires this to a UCS `/api/brandcode-mcp/keys/validate` lookup.
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
};

export function toolHasScope(
  tool: string,
  scopes: BrandcodeMcpScope[],
): boolean {
  const required = TOOL_SCOPE_REQUIREMENTS[tool];
  if (!required) return false;
  if (required === "read") return scopes.includes("read");
  if (required === "check") {
    return scopes.includes("check") || scopes.includes("read");
  }
  // feedback: must have feedback explicitly; read alone is insufficient
  return scopes.includes("feedback");
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
        if (trimmed === "read" || trimmed === "check" || trimmed === "feedback") {
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
  const validator = options.validateToken ?? buildDefaultValidator(environment);
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
