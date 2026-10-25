/**
 * Hosted Brandcode MCP rate limiting.
 *
 * Three fixed-window budgets share one store (Upstash Redis in deployed
 * environments, per-instance memory only in staging/dev without Redis):
 *
 *   1. Per client IP, checked BEFORE key validation so unauthenticated
 *      callers cannot turn the hosted MCP into a UCS validation amplifier.
 *   2. Per key per brand slug (the original budget).
 *   3. Per key across all brand slugs, so a key bound to N slugs does not get
 *      N times the budget.
 *
 * Production fails closed: missing Redis configuration yields a 503 and the
 * operator disable flag is ignored. Client-facing snapshots never name env
 * vars or people; configuration detail is logged server-side only.
 */
import { Redis } from "@upstash/redis";
import type {
  BrandcodeMcpAuthInfo,
  HostedRateLimitOptions,
  HostedRateLimitSnapshot,
  HostedRateLimitStore,
  HostedRateLimitStoreInput,
  HostedRateLimitStoreResult,
  HostedRateLimitWindowSnapshot,
} from "./types.js";

type HostedEnvironment = "staging" | "production";

const DEFAULT_MAX_REQUESTS = 60;
const DEFAULT_GLOBAL_MAX_REQUESTS = 120;
const DEFAULT_IP_MAX_REQUESTS = 300;
const DEFAULT_WINDOW_MS = 60_000;
const MAX_REQUESTS_ENV = "BRANDCODE_MCP_RATE_LIMIT_REQUESTS_PER_WINDOW";
const GLOBAL_MAX_REQUESTS_ENV =
  "BRANDCODE_MCP_RATE_LIMIT_GLOBAL_REQUESTS_PER_WINDOW";
const IP_MAX_REQUESTS_ENV = "BRANDCODE_MCP_RATE_LIMIT_IP_REQUESTS_PER_WINDOW";
const WINDOW_SECONDS_ENV = "BRANDCODE_MCP_RATE_LIMIT_WINDOW_SECONDS";
const DISABLED_ENV = "BRANDCODE_MCP_RATE_LIMIT_DISABLED";
const REDIS_URL_ENV = "BRANDCODE_MCP_RATE_LIMIT_REDIS_REST_URL";
const REDIS_TOKEN_ENV = "BRANDCODE_MCP_RATE_LIMIT_REDIS_REST_TOKEN";
const UPSTASH_URL_ENV = "UPSTASH_REDIS_REST_URL";
const UPSTASH_TOKEN_ENV = "UPSTASH_REDIS_REST_TOKEN";
const KV_URL_ENV = "KV_REST_API_URL";
const KV_TOKEN_ENV = "KV_REST_API_TOKEN";

/** Client-facing support pointer. Never a person's name or email. */
export const HOSTED_SUPPORT_POINTER = "Contact your Brandcode admin";
const OPS_OWNER = "Brandcode Studio Ops";

const REDIS_FIXED_WINDOW_SCRIPT = `
local current = redis.call("INCR", KEYS[1])
if current == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
local ttl = redis.call("PTTL", KEYS[1])
if ttl < 0 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return { current, ttl }
`;

export type HostedRateLimitError =
  | "rate_limit_store_unavailable"
  | "rate_limit_store_misconfigured";

export interface HostedRateLimitResult {
  allowed: boolean;
  snapshot: HostedRateLimitSnapshot;
  error?: HostedRateLimitError;
}

interface ResolvedRateLimitOptions {
  enabled: boolean;
  maxRequests: number;
  globalMaxRequests: number;
  ipMaxRequests: number;
  windowMs: number;
  now: () => number;
  /** null = production with no durable store configured (fail closed). */
  store: HostedRateLimitStore | null;
  source: string;
}

let defaultMemoryStore: HostedRateLimitStore | null = null;
let defaultRedisStore: HostedRateLimitStore | null = null;

function positiveInt(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.floor(parsed);
}

function readRedisConfig(env: Record<string, string | undefined>) {
  const pairs: Array<[string, string]> = [
    [REDIS_URL_ENV, REDIS_TOKEN_ENV],
    [UPSTASH_URL_ENV, UPSTASH_TOKEN_ENV],
    [KV_URL_ENV, KV_TOKEN_ENV],
  ];
  for (const [urlEnv, tokenEnv] of pairs) {
    const url = env[urlEnv]?.trim();
    const token = env[tokenEnv]?.trim();
    if (url && token) return { url, token };
  }
  return null;
}

function encodeRateLimitKeyPart(value: string): string {
  return encodeURIComponent(value);
}

function rateLimitKey(input: {
  environment: string;
  slug: string;
  keyId: string;
}): string {
  return [
    "brandcode",
    "mcp",
    "rate-limit",
    encodeRateLimitKeyPart(input.environment),
    encodeRateLimitKeyPart(input.slug),
    encodeRateLimitKeyPart(input.keyId),
  ].join(":");
}

function globalRateLimitKey(input: {
  environment: string;
  keyId: string;
}): string {
  return [
    "brandcode",
    "mcp",
    "rate-limit-global",
    encodeRateLimitKeyPart(input.environment),
    encodeRateLimitKeyPart(input.keyId),
  ].join(":");
}

function ipRateLimitKey(input: { environment: string; ip: string }): string {
  return [
    "brandcode",
    "mcp",
    "rate-limit-ip",
    encodeRateLimitKeyPart(input.environment),
    encodeRateLimitKeyPart(input.ip),
  ].join(":");
}

function createRedisRateLimitStore(input: {
  redis: Pick<Redis, "eval">;
}): HostedRateLimitStore {
  return {
    mode: "durable_shared",
    enforcement: "durable_shared_redis_fixed_window",
    source: "durable shared Redis REST",
    async check(
      checkInput: HostedRateLimitStoreInput,
    ): Promise<HostedRateLimitStoreResult> {
      const result = await input.redis.eval<[string], [number, number]>(
        REDIS_FIXED_WINDOW_SCRIPT,
        [checkInput.key],
        [String(checkInput.windowMs)],
      );
      const [count, ttl] = Array.isArray(result) ? result : [0, 0];
      const ttlMs = Number.isFinite(Number(ttl))
        ? Math.max(0, Number(ttl))
        : checkInput.windowMs;
      return {
        count: Number(count),
        resetAt: checkInput.now + ttlMs,
      };
    },
  };
}

function defaultStore(
  environment: HostedEnvironment,
): HostedRateLimitStore | null {
  const redisConfig = readRedisConfig(process.env);
  if (redisConfig) {
    defaultRedisStore ??= createRedisRateLimitStore({
      redis: new Redis({
        url: redisConfig.url,
        token: redisConfig.token,
      }),
    });
    return defaultRedisStore;
  }

  if (environment === "production") {
    // Per-instance memory is not a real limit on a horizontally scaled
    // deployment — production refuses to run without the shared store.
    console.error(
      `[brandcode-mcp] production rate limiting requires a durable Redis store (${REDIS_URL_ENV}/${REDIS_TOKEN_ENV}, ${UPSTASH_URL_ENV}/${UPSTASH_TOKEN_ENV}, or ${KV_URL_ENV}/${KV_TOKEN_ENV}); refusing requests`,
    );
    return null;
  }

  defaultMemoryStore ??= createMemoryRateLimitStore();
  return defaultMemoryStore;
}

function resolveOptions(
  options: HostedRateLimitOptions | false | undefined,
  environment: HostedEnvironment,
): ResolvedRateLimitOptions {
  const production = environment === "production";
  const maxRequests = positiveInt(
    process.env[MAX_REQUESTS_ENV],
    DEFAULT_MAX_REQUESTS,
  );
  const globalMaxRequests = positiveInt(
    process.env[GLOBAL_MAX_REQUESTS_ENV],
    DEFAULT_GLOBAL_MAX_REQUESTS,
  );
  const ipMaxRequests = positiveInt(
    process.env[IP_MAX_REQUESTS_ENV],
    DEFAULT_IP_MAX_REQUESTS,
  );
  const windowSeconds = positiveInt(
    process.env[WINDOW_SECONDS_ENV],
    DEFAULT_WINDOW_MS / 1000,
  );

  if (options === false) {
    // Code-level seam only (tests / embedded callers). No env var reaches it.
    return {
      enabled: false,
      maxRequests,
      globalMaxRequests,
      ipMaxRequests,
      windowMs: windowSeconds * 1000,
      now: Date.now,
      store: null,
      source: "rate limiting disabled by router option",
    };
  }

  // The operator kill switch is honored only outside production.
  const envDisabled = !production && process.env[DISABLED_ENV] === "1";
  if (production && process.env[DISABLED_ENV] === "1") {
    console.error(
      `[brandcode-mcp] ${DISABLED_ENV}=1 is ignored in production; rate limiting stays enforced`,
    );
  }
  const enabled = options?.enabled ?? !envDisabled;

  return {
    enabled,
    maxRequests: options?.maxRequests ?? maxRequests,
    globalMaxRequests: options?.globalMaxRequests ?? globalMaxRequests,
    ipMaxRequests: options?.ipMaxRequests ?? ipMaxRequests,
    windowMs: options?.windowMs ?? windowSeconds * 1000,
    now: options?.now ?? Date.now,
    store: options?.store ?? (enabled ? defaultStore(environment) : null),
    source:
      options?.source ??
      (envDisabled
        ? "hosted rate-limit config (disabled by operator flag)"
        : "hosted rate-limit config"),
  };
}

export function createMemoryRateLimitStore(): HostedRateLimitStore {
  const buckets = new Map<string, { windowStart: number; count: number }>();
  return {
    mode: "in_process",
    enforcement: "in_process_fixed_window",
    source: "in-process memory fallback",
    buckets,
    async check(
      input: HostedRateLimitStoreInput,
    ): Promise<HostedRateLimitStoreResult> {
      const existing = buckets.get(input.key);
      const windowExpired =
        !existing || input.now >= existing.windowStart + input.windowMs;
      const bucket = windowExpired
        ? { windowStart: input.now, count: 0 }
        : existing;

      bucket.count += 1;
      buckets.set(input.key, bucket);

      return {
        count: bucket.count,
        resetAt: bucket.windowStart + input.windowMs,
      };
    },
  };
}

function disabledSnapshot(source: string): HostedRateLimitSnapshot {
  return {
    status: "disabled",
    enforced: false,
    enforcement: "none",
    scope: "per_key_per_brand",
    limit: null,
    remaining: null,
    window_ms: null,
    reset_at: null,
    retry_after_seconds: null,
    release_gate: "blocked",
    blocker_owner: OPS_OWNER,
    required_before_public_release:
      "Implement durable shared hosted rate-limit enforcement before broad public release",
    source,
    global: null,
  };
}

function windowSnapshot(
  scope: HostedRateLimitWindowSnapshot["scope"],
  limit: number,
  result: HostedRateLimitStoreResult,
  windowMs: number,
): HostedRateLimitWindowSnapshot {
  return {
    scope,
    limit,
    remaining: Math.max(limit - result.count, 0),
    window_ms: windowMs,
    reset_at: new Date(result.resetAt).toISOString(),
  };
}

function activeSnapshot(input: {
  limit: number;
  remaining: number;
  windowMs: number;
  resetAt: number;
  retryAfterSeconds: number | null;
  source: string;
  store: HostedRateLimitStore;
  global: HostedRateLimitWindowSnapshot | null;
}): HostedRateLimitSnapshot {
  const durable = input.store.mode === "durable_shared";
  return {
    status: durable
      ? "active_durable_shared"
      : "active_pre_release_in_process",
    enforced: true,
    enforcement: input.store.enforcement,
    scope: "per_key_per_brand",
    limit: input.limit,
    remaining: input.remaining,
    window_ms: input.windowMs,
    reset_at: new Date(input.resetAt).toISOString(),
    retry_after_seconds: input.retryAfterSeconds,
    release_gate: "blocked",
    blocker_owner: OPS_OWNER,
    required_before_public_release:
      durable
        ? "Capture command-backed hosted durable/shared rate-limit proof and explicit release approval before broad public release"
        : "Replace in-process pre-release enforcement with durable shared hosted rate-limit enforcement before broad public release",
    source: `${input.source}; ${input.store.source}`,
    global: input.global,
  };
}

function unavailableSnapshot(input: {
  maxRequests: number;
  windowMs: number;
  source: string;
  store: HostedRateLimitStore | null;
}): HostedRateLimitSnapshot {
  return {
    status: "unavailable",
    enforced: false,
    enforcement: "durable_shared_unavailable",
    scope: "per_key_per_brand",
    limit: input.maxRequests,
    remaining: null,
    window_ms: input.windowMs,
    reset_at: null,
    retry_after_seconds: null,
    release_gate: "blocked",
    blocker_owner: OPS_OWNER,
    required_before_public_release:
      "Restore durable shared hosted rate-limit store availability before public release or broad hosted access",
    source: input.store
      ? `${input.source}; ${input.store.source}`
      : `${input.source}; durable shared store not configured`,
    global: null,
  };
}

function retryAfter(resetAt: number, now: number): number {
  return Math.max(1, Math.ceil((resetAt - now) / 1000));
}

/**
 * Per-key limits: one budget per (key, slug) and one per key across all
 * slugs. Both buckets are incremented on every authenticated request; the
 * request is allowed only if both are within budget.
 */
export async function checkHostedRateLimit(input: {
  slug: string;
  auth: BrandcodeMcpAuthInfo;
  options?: HostedRateLimitOptions | false;
}): Promise<HostedRateLimitResult> {
  const options = resolveOptions(input.options, input.auth.environment);
  if (!options.enabled) {
    return {
      allowed: true,
      snapshot: disabledSnapshot(options.source),
    };
  }
  const store = options.store;
  if (!store) {
    return {
      allowed: false,
      error: "rate_limit_store_misconfigured",
      snapshot: unavailableSnapshot({
        maxRequests: options.maxRequests,
        windowMs: options.windowMs,
        source: options.source,
        store: null,
      }),
    };
  }

  const now = options.now();
  const slugKey = rateLimitKey({
    environment: input.auth.environment,
    slug: input.slug,
    keyId: input.auth.keyId,
  });
  const globalKey = globalRateLimitKey({
    environment: input.auth.environment,
    keyId: input.auth.keyId,
  });

  let slugResult: HostedRateLimitStoreResult;
  let globalResult: HostedRateLimitStoreResult;
  try {
    [slugResult, globalResult] = await Promise.all([
      store.check({
        key: slugKey,
        maxRequests: options.maxRequests,
        windowMs: options.windowMs,
        now,
      }),
      store.check({
        key: globalKey,
        maxRequests: options.globalMaxRequests,
        windowMs: options.windowMs,
        now,
      }),
    ]);
  } catch (err) {
    if (store.mode === "durable_shared") {
      console.error(
        `[brandcode-mcp] durable rate-limit store failed: ${(err as Error)?.message ?? "unknown error"}`,
      );
      return {
        allowed: false,
        error: "rate_limit_store_unavailable",
        snapshot: unavailableSnapshot({
          maxRequests: options.maxRequests,
          windowMs: options.windowMs,
          source: options.source,
          store,
        }),
      };
    }
    throw new Error("Hosted rate-limit store failed");
  }

  const slugAllowed = slugResult.count <= options.maxRequests;
  const globalAllowed = globalResult.count <= options.globalMaxRequests;
  const allowed = slugAllowed && globalAllowed;
  const global = windowSnapshot(
    "per_key_all_brands",
    options.globalMaxRequests,
    globalResult,
    options.windowMs,
  );
  const slugRemaining = Math.max(options.maxRequests - slugResult.count, 0);

  let retryAfterSeconds: number | null = null;
  if (!slugAllowed) retryAfterSeconds = retryAfter(slugResult.resetAt, now);
  if (!globalAllowed) {
    retryAfterSeconds = Math.max(
      retryAfterSeconds ?? 0,
      retryAfter(globalResult.resetAt, now),
    );
  }

  return {
    allowed,
    snapshot: activeSnapshot({
      limit: options.maxRequests,
      // Headers advertise the tighter of the two budgets.
      remaining: Math.min(slugRemaining, global.remaining),
      windowMs: options.windowMs,
      resetAt:
        !globalAllowed && globalResult.resetAt > slugResult.resetAt
          ? globalResult.resetAt
          : slugResult.resetAt,
      retryAfterSeconds,
      source: options.source,
      store,
      global,
    }),
  };
}

export interface HostedIpRateLimitResult {
  allowed: boolean;
  error?: HostedRateLimitError;
  window: HostedRateLimitWindowSnapshot | null;
  retryAfterSeconds: number | null;
}

/**
 * Pre-auth per-client-IP budget. Runs before any bearer validation so a
 * single source cannot drive unbounded UCS key-validation calls. The budget
 * is deliberately generous (default 300/min) so NAT'd teams are unaffected.
 */
export async function checkHostedIpRateLimit(input: {
  ip: string;
  environment: HostedEnvironment;
  options?: HostedRateLimitOptions | false;
}): Promise<HostedIpRateLimitResult> {
  const options = resolveOptions(input.options, input.environment);
  if (!options.enabled) {
    return { allowed: true, window: null, retryAfterSeconds: null };
  }
  const store = options.store;
  if (!store) {
    return {
      allowed: false,
      error: "rate_limit_store_misconfigured",
      window: null,
      retryAfterSeconds: null,
    };
  }
  const now = options.now();
  let result: HostedRateLimitStoreResult;
  try {
    result = await store.check({
      key: ipRateLimitKey({ environment: input.environment, ip: input.ip }),
      maxRequests: options.ipMaxRequests,
      windowMs: options.windowMs,
      now,
    });
  } catch (err) {
    if (store.mode === "durable_shared") {
      console.error(
        `[brandcode-mcp] durable rate-limit store failed (ip budget): ${(err as Error)?.message ?? "unknown error"}`,
      );
      return {
        allowed: false,
        error: "rate_limit_store_unavailable",
        window: null,
        retryAfterSeconds: null,
      };
    }
    throw new Error("Hosted rate-limit store failed");
  }
  const allowed = result.count <= options.ipMaxRequests;
  return {
    allowed,
    window: windowSnapshot(
      "per_client_ip",
      options.ipMaxRequests,
      result,
      options.windowMs,
    ),
    retryAfterSeconds: allowed ? null : retryAfter(result.resetAt, now),
  };
}

/**
 * Resolve the client IP from the platform-trusted header.
 *
 * On Vercel, `x-real-ip` and `x-forwarded-for` are set by the edge and any
 * client-supplied values are overwritten, so they are trustworthy there.
 * `x-real-ip` is preferred; the first hop of `x-forwarded-for` is the
 * fallback. The local Node entry (src/index-http.ts) overwrites `x-real-ip`
 * with the socket address for the same guarantee. Values that do not look
 * like an IP collapse to a shared "invalid" bucket so attacker-chosen
 * strings cannot mint unlimited buckets.
 */
export function clientIpFromHeaders(headers: Headers): string {
  const candidates = [
    headers.get("x-real-ip"),
    headers.get("x-forwarded-for")?.split(",")[0],
  ];
  for (const raw of candidates) {
    const value = raw?.trim();
    if (!value) continue;
    if (value.length <= 64 && /^[0-9A-Fa-f:.]+$/.test(value)) return value;
    return "invalid";
  }
  return "unknown";
}

export function hostedRateLimitHeaders(
  snapshot: HostedRateLimitSnapshot,
): HeadersInit {
  if (!snapshot.enforced) return {};
  const headers: Record<string, string> = {
    "x-ratelimit-limit": String(snapshot.limit),
    "x-ratelimit-remaining": String(snapshot.remaining),
  };
  if (snapshot.reset_at) {
    headers["x-ratelimit-reset"] = String(
      Math.ceil(new Date(snapshot.reset_at).getTime() / 1000),
    );
  }
  if (snapshot.retry_after_seconds) {
    headers["retry-after"] = String(snapshot.retry_after_seconds);
  }
  return headers;
}
