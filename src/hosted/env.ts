export const BRANDCODE_MCP_SERVICE_TOKEN_ENV = "BRANDCODE_MCP_SERVICE_TOKEN";
export const BRANDCODE_MCP_ENV_ENV = "BRANDCODE_MCP_ENV";
export const BRANDCODE_MCP_ALLOWED_HOSTS_ENV = "BRANDCODE_MCP_ALLOWED_HOSTS";

type Env = Record<string, string | undefined>;

export type HostedEnvironment = "staging" | "production";

export function readBrandcodeMcpServiceToken(
  env: Env = process.env,
): string | null {
  const token = env[BRANDCODE_MCP_SERVICE_TOKEN_ENV]?.trim();
  return token ? token : null;
}

export type HostedEnvironmentResolution =
  | { ok: true; environment: HostedEnvironment }
  | { ok: false; reason: string };

/**
 * Resolve the hosted environment, failing closed.
 *
 * BRANDCODE_MCP_ENV must be exactly "production" or "staging" — staging
 * accepts `bck_test_` keys and env-seeded test keys, so it is never inferred
 * from an unset or misspelled value. A Vercel production deployment
 * (VERCEL_ENV=production) must also declare BRANDCODE_MCP_ENV=production.
 *
 * `reason` names env vars and is for server-side logs only — never return it
 * in a client-facing body.
 */
export function resolveHostedEnvironment(
  env: Env = process.env,
): HostedEnvironmentResolution {
  const raw = env[BRANDCODE_MCP_ENV_ENV]?.trim();
  if (raw !== "production" && raw !== "staging") {
    return {
      ok: false,
      reason: `${BRANDCODE_MCP_ENV_ENV} must be explicitly "production" or "staging" (got ${raw ? JSON.stringify(raw.slice(0, 32)) : "unset"})`,
    };
  }
  if (env.VERCEL_ENV === "production" && raw !== "production") {
    return {
      ok: false,
      reason: `VERCEL_ENV=production requires ${BRANDCODE_MCP_ENV_ENV}=production (got "${raw}")`,
    };
  }
  return { ok: true, environment: raw };
}

/**
 * Optional Host allowlist override (comma-separated hostnames, e.g. for a
 * preview deployment). Returns null when unset so the router falls back to
 * its per-environment defaults.
 */
export function readAllowedHosts(env: Env = process.env): string[] | null {
  const raw = env[BRANDCODE_MCP_ALLOWED_HOSTS_ENV];
  if (!raw) return null;
  const hosts = raw
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
  return hosts.length > 0 ? hosts : null;
}
