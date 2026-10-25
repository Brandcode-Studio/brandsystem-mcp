import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkHostedIpRateLimit,
  checkHostedRateLimit,
  clientIpFromHeaders,
  createMemoryRateLimitStore,
} from "../../src/hosted/rate-limit.js";
import type { BrandcodeMcpAuthInfo } from "../../src/hosted/types.js";

const REDIS_ENV_VARS = [
  "BRANDCODE_MCP_RATE_LIMIT_REDIS_REST_URL",
  "BRANDCODE_MCP_RATE_LIMIT_REDIS_REST_TOKEN",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "KV_REST_API_URL",
  "KV_REST_API_TOKEN",
];

function auth(
  overrides: Partial<BrandcodeMcpAuthInfo> = {},
): BrandcodeMcpAuthInfo {
  return {
    token: "t",
    keyId: `key-${Math.random().toString(36).slice(2)}`,
    scopes: ["read"],
    allowedSlugs: ["acme", "pendium", "third"],
    environment: "staging",
    ...overrides,
  };
}

/** Client-facing payloads must never name env vars or people. */
function expectNoOpsLeak(value: unknown) {
  const text = JSON.stringify(value);
  expect(text).not.toMatch(/@/);
  expect(text).not.toMatch(/Jason|Lankow/i);
  expect(text).not.toMatch(/BRANDCODE_MCP_|UPSTASH_|KV_REST_/);
}

beforeEach(() => {
  for (const name of REDIS_ENV_VARS) vi.stubEnv(name, "");
  vi.stubEnv("BRANDCODE_MCP_RATE_LIMIT_DISABLED", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("per-key budget across slugs", () => {
  it("caps a key's total requests across every slug it can reach", async () => {
    const store = createMemoryRateLimitStore();
    const key = auth();
    const options = {
      maxRequests: 10,
      globalMaxRequests: 3,
      windowMs: 60_000,
      now: () => 1_800_000_000_000,
      store,
    };
    const results = [];
    for (const slug of ["acme", "pendium", "third", "acme"]) {
      results.push(await checkHostedRateLimit({ slug, auth: key, options }));
    }
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    const denied = results[3].snapshot;
    expect(denied.global).toMatchObject({
      scope: "per_key_all_brands",
      limit: 3,
      remaining: 0,
    });
    expect(denied.remaining).toBe(0);
    expect(denied.retry_after_seconds).toBe(60);
  });

  it("still enforces the per-slug budget independently", async () => {
    const store = createMemoryRateLimitStore();
    const key = auth();
    const options = {
      maxRequests: 1,
      globalMaxRequests: 100,
      windowMs: 60_000,
      now: () => 1_800_000_000_000,
      store,
    };
    expect((await checkHostedRateLimit({ slug: "acme", auth: key, options })).allowed).toBe(true);
    expect((await checkHostedRateLimit({ slug: "acme", auth: key, options })).allowed).toBe(false);
    expect((await checkHostedRateLimit({ slug: "pendium", auth: key, options })).allowed).toBe(true);
  });
});

describe("production strictness", () => {
  it("fails closed (misconfigured) when no durable Redis store is configured", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await checkHostedRateLimit({
      slug: "acme",
      auth: auth({ environment: "production" }),
    });
    expect(result.allowed).toBe(false);
    expect(result.error).toBe("rate_limit_store_misconfigured");
    expectNoOpsLeak(result.snapshot);
  });

  it("ignores the operator disable flag in production", async () => {
    vi.stubEnv("BRANDCODE_MCP_RATE_LIMIT_DISABLED", "1");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await checkHostedRateLimit({
      slug: "acme",
      auth: auth({ environment: "production" }),
    });
    expect(result.allowed).toBe(false);
    expect(result.error).toBe("rate_limit_store_misconfigured");

    const ip = await checkHostedIpRateLimit({
      ip: "203.0.113.9",
      environment: "production",
    });
    expect(ip.allowed).toBe(false);
    expect(ip.error).toBe("rate_limit_store_misconfigured");
  });

  it("enforces in production with an injected durable store", async () => {
    const result = await checkHostedRateLimit({
      slug: "acme",
      auth: auth({ environment: "production" }),
      options: {
        store: {
          mode: "durable_shared",
          enforcement: "durable_shared_redis_fixed_window",
          source: "test durable",
          check: async (input) => ({ count: 1, resetAt: input.now + input.windowMs }),
        },
      },
    });
    expect(result.allowed).toBe(true);
    expect(result.snapshot.status).toBe("active_durable_shared");
  });

  it("keeps staging workable: memory fallback without Redis, disable flag honored", async () => {
    const memory = await checkHostedRateLimit({ slug: "acme", auth: auth() });
    expect(memory.allowed).toBe(true);
    expect(memory.snapshot.status).toBe("active_pre_release_in_process");

    vi.stubEnv("BRANDCODE_MCP_RATE_LIMIT_DISABLED", "1");
    const disabled = await checkHostedRateLimit({ slug: "acme", auth: auth() });
    expect(disabled.allowed).toBe(true);
    expect(disabled.snapshot.status).toBe("disabled");
  });

  it("never exposes ops owner email or env var names in snapshots", async () => {
    const active = await checkHostedRateLimit({ slug: "acme", auth: auth() });
    expectNoOpsLeak(active.snapshot);
    vi.stubEnv("BRANDCODE_MCP_RATE_LIMIT_DISABLED", "1");
    const disabled = await checkHostedRateLimit({ slug: "acme", auth: auth() });
    expectNoOpsLeak(disabled.snapshot);
  });
});

describe("per-client-IP budget", () => {
  it("allows up to the IP budget, then denies with a retry hint", async () => {
    const store = createMemoryRateLimitStore();
    const options = {
      ipMaxRequests: 2,
      windowMs: 60_000,
      now: () => 1_800_000_000_000,
      store,
    };
    const check = (ip: string) =>
      checkHostedIpRateLimit({ ip, environment: "staging", options });
    expect((await check("198.51.100.1")).allowed).toBe(true);
    expect((await check("198.51.100.1")).allowed).toBe(true);
    const denied = await check("198.51.100.1");
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBe(60);
    expect((await check("198.51.100.2")).allowed).toBe(true);
    expect([...store.buckets!.keys()]).toContain(
      "brandcode:mcp:rate-limit-ip:staging:198.51.100.1",
    );
  });
});

describe("clientIpFromHeaders", () => {
  it("prefers the platform-set x-real-ip", () => {
    expect(
      clientIpFromHeaders(
        new Headers({ "x-real-ip": "203.0.113.5", "x-forwarded-for": "198.51.100.7" }),
      ),
    ).toBe("203.0.113.5");
  });

  it("falls back to the first x-forwarded-for hop", () => {
    expect(
      clientIpFromHeaders(new Headers({ "x-forwarded-for": "198.51.100.7, 10.0.0.1" })),
    ).toBe("198.51.100.7");
    expect(
      clientIpFromHeaders(new Headers({ "x-forwarded-for": "2001:db8::1" })),
    ).toBe("2001:db8::1");
  });

  it("collapses non-IP values into shared buckets", () => {
    expect(clientIpFromHeaders(new Headers({ "x-real-ip": "attacker-chosen-bucket" }))).toBe("invalid");
    expect(clientIpFromHeaders(new Headers())).toBe("unknown");
  });
});
