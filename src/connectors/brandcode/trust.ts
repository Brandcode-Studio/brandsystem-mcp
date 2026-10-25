/**
 * Brandcode Studio origin trust.
 *
 * A single allowlist decides which hosts may (a) receive credentials
 * (session tokens, admin tokens, share tokens) and (b) confer approval
 * levels such as `production_approved`. Everything else is an untrusted
 * custom domain: it may still be READ for public packages (over the SSRF
 * guarded `safeFetch`, https only, no credentials), but anything it says
 * about approval is ignored.
 *
 * Defaults: https://www.brandcode.studio and https://brandcode.studio.
 *
 * Local development / staging override:
 *   BRANDCODE_STUDIO_TRUSTED_ORIGINS="https://staging.brandcode.studio,http://localhost:3000"
 * Comma-separated origins ADDED to the defaults. Each entry must be a bare
 * origin (no path, query, or credentials). https is required, except
 * http://localhost, http://127.0.0.1, and http://[::1] (any port), which
 * are accepted only when listed explicitly. Invalid entries are ignored.
 */

export const DEFAULT_TRUSTED_BRANDCODE_ORIGINS: readonly string[] = Object.freeze([
  "https://www.brandcode.studio",
  "https://brandcode.studio",
]);

export const TRUSTED_ORIGINS_ENV = "BRANDCODE_STUDIO_TRUSTED_ORIGINS";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Origin of a URL string, or null when it does not parse as http(s). */
export function originOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

/**
 * Validate one override entry. Returns the normalized origin or null.
 * Exported for tests and diagnostics.
 */
export function normalizeTrustedOriginEntry(entry: string): string | null {
  const trimmed = entry.trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.username || parsed.password) return null;
  if (parsed.search || parsed.hash) return null;
  if (parsed.pathname !== "/" && parsed.pathname !== "") return null;
  if (parsed.protocol === "https:") return parsed.origin;
  if (parsed.protocol === "http:" && LOOPBACK_HOSTS.has(parsed.hostname)) {
    return parsed.origin;
  }
  return null;
}

/** The effective trusted-origin list (defaults plus valid env additions). */
export function getTrustedBrandcodeOrigins(
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const origins = new Set<string>(DEFAULT_TRUSTED_BRANDCODE_ORIGINS);
  const raw = env[TRUSTED_ORIGINS_ENV];
  if (raw) {
    for (const entry of raw.split(",")) {
      const normalized = normalizeTrustedOriginEntry(entry);
      if (normalized) origins.add(normalized);
    }
  }
  return [...origins];
}

/** True when the URL (or bare origin) belongs to a trusted Brandcode origin. */
export function isTrustedBrandcodeOrigin(
  urlOrOrigin: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const origin = originOf(urlOrOrigin);
  if (!origin) return false;
  return getTrustedBrandcodeOrigins(env).includes(origin);
}

/** Human-readable hint for messages that refuse an untrusted origin. */
export function trustedOriginsHint(): string {
  return (
    `Trusted Brandcode Studio origins: ${getTrustedBrandcodeOrigins().join(", ")}. ` +
    `For local development or staging, add origins via the ${TRUSTED_ORIGINS_ENV} environment variable.`
  );
}

/** Raised when a request would send credentials or follow a hop it must not. */
export class BrandcodeTrustError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BrandcodeTrustError";
  }
}
