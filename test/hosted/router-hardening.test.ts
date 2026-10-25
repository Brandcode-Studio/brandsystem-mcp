/**
 * Router-level hardening: JSON-RPC batch rejection (one HTTP request = one
 * rate-limit unit = at most one tool call), pre-auth per-IP limiting, the
 * cross-slug per-key budget, DNS-rebinding protection, no-store caching,
 * and generic client-facing error bodies.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_HOSTED_ALLOWED_HOSTS,
  handleHostedRequest,
  HOSTED_MAX_REQUEST_BODY_BYTES,
  type RouterOptions,
} from "../../src/hosted/router.js";
import { createMemoryRateLimitStore } from "../../src/hosted/rate-limit.js";
import {
  KeyValidationCache,
} from "../../src/hosted/auth.js";
import type { BrandcodeMcpAuthInfo } from "../../src/hosted/types.js";

const READ_KEY = "bck_test_acme_read";
const MULTI_KEY = "bck_test_multi_slug";

function makeValidator() {
  const calls: string[] = [];
  const validateToken = async (
    token: string,
  ): Promise<BrandcodeMcpAuthInfo | null> => {
    calls.push(token);
    if (token === READ_KEY) {
      return {
        token,
        keyId: "key-acme-read",
        scopes: ["read"],
        allowedSlugs: ["acme"],
        environment: "staging",
      };
    }
    if (token === MULTI_KEY) {
      return {
        token,
        keyId: "key-multi",
        scopes: ["read"],
        allowedSlugs: ["acme", "pendium"],
        environment: "staging",
      };
    }
    return null;
  };
  return { calls, validateToken };
}

const fetchBrandPackage = async (slug: string) => ({
  runtime: {
    version: "1.0.0",
    client_name: slug,
    compiled_at: "2026-04-19T00:00:00.000Z",
    sessions_completed: 1,
    identity: {
      colors: { primary: "#000000" },
      typography: { heading: "Inter" },
      logo: null,
    },
    visual: null,
    voice: null,
    strategy: null,
  },
});

function options(overrides: Partial<RouterOptions> = {}): RouterOptions {
  return {
    environment: "staging",
    ucsBaseUrl: "https://ucs.test",
    ucsServiceToken: "service-token-abc",
    validateToken: makeValidator().validateToken,
    fetchBrandPackage,
    fetchTasteGuidance: async () => null,
    allowedHosts: ["mcp.example"],
    rateLimit: {
      store: createMemoryRateLimitStore(),
      now: () => 1_800_000_000_000,
      source: "router hardening test",
    },
    ...overrides,
  };
}

function rpc(id: number, method: string, params: Record<string, unknown>) {
  return { jsonrpc: "2.0", id, method, params };
}

function toolCall(id: number) {
  return rpc(id, "tools/call", {
    name: "brand_search",
    arguments: { query: "logo" },
  });
}

function post(
  body: string,
  {
    url = "https://mcp.example/acme",
    token = READ_KEY,
    headers = {},
  }: { url?: string; token?: string; headers?: Record<string, string> } = {},
): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body,
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // Any real network call (telemetry POST, UCS) would land here.
  fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function flushTelemetry() {
  await new Promise((resolve) => setTimeout(resolve, 10));
}

describe("JSON-RPC batch rejection", () => {
  it("rejects an array body with -32600 before any rate-limit, tool, or telemetry work", async () => {
    const store = createMemoryRateLimitStore();
    const res = await handleHostedRequest(
      post(JSON.stringify(Array.from({ length: 50 }, (_, i) => toolCall(i + 1)))),
      options({ rateLimit: { store, now: () => 1_800_000_000_000 } }),
    );
    expect(res.status).toBe(400);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as Record<string, any>;
    expect(body).toMatchObject({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32600 },
    });
    expect(body.error.message).toMatch(/batching is not supported/);

    await flushTelemetry();
    // Per-key counters untouched (only the pre-auth IP bucket exists).
    const keys = [...store.buckets!.keys()];
    expect(keys.some((k) => k.includes(":rate-limit:"))).toBe(false);
    expect(keys.some((k) => k.includes("rate-limit-global"))).toBe(false);
    // No telemetry POST or any other upstream call.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects even a single-element batch", async () => {
    const res = await handleHostedRequest(
      post(JSON.stringify([toolCall(1)])),
      options(),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, any>;
    expect(body.error.code).toBe(-32600);
  });

  it("still serves a single tools/call and counts it exactly once", async () => {
    const store = createMemoryRateLimitStore();
    const res = await handleHostedRequest(
      post(JSON.stringify(toolCall(7))),
      options({ rateLimit: { store, now: () => 1_800_000_000_000 } }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, any>;
    expect(body.id).toBe(7);
    expect(body.result?.isError).not.toBe(true);
    expect(store.buckets!.get("brandcode:mcp:rate-limit:staging:acme:key-acme-read")?.count).toBe(1);
    expect(store.buckets!.get("brandcode:mcp:rate-limit-global:staging:key-acme-read")?.count).toBe(1);
    await flushTelemetry();
    // Exactly one telemetry POST for the one tool call.
    const telemetry = fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith("/api/brand/hosted/acme/agent/history"),
    );
    expect(telemetry).toHaveLength(1);
  });

  it("returns -32700 for invalid JSON", async () => {
    const res = await handleHostedRequest(post("{not json"), options());
    expect(res.status).toBe(400);
    const body = (await res.json()) as Record<string, any>;
    expect(body.error.code).toBe(-32700);
  });

  it("enforces the 1 MiB cap from the declared content-length", async () => {
    const res = await handleHostedRequest(
      post(JSON.stringify(toolCall(1)), {
        headers: { "content-length": String(HOSTED_MAX_REQUEST_BODY_BYTES + 1) },
      }),
      options(),
    );
    expect(res.status).toBe(413);
  });
});

describe("pre-auth per-IP rate limit", () => {
  it("refuses an over-budget IP before the key is validated", async () => {
    const { calls, validateToken } = makeValidator();
    const opts = options({
      validateToken,
      rateLimit: {
        store: createMemoryRateLimitStore(),
        ipMaxRequests: 2,
        now: () => 1_800_000_000_000,
      },
    });
    const from = (ip: string, token: string) =>
      post(JSON.stringify(toolCall(1)), { token, headers: { "x-real-ip": ip } });

    expect((await handleHostedRequest(from("203.0.113.1", "bck_test_guess1"), opts)).status).toBe(401);
    expect((await handleHostedRequest(from("203.0.113.1", "bck_test_guess2"), opts)).status).toBe(401);
    const limited = await handleHostedRequest(from("203.0.113.1", "bck_test_guess3"), opts);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("60");
    expect(calls).toEqual(["bck_test_guess1", "bck_test_guess2"]);

    // A different client is unaffected.
    expect((await handleHostedRequest(from("203.0.113.2", READ_KEY), opts)).status).toBe(200);
  });

  it("keeps malformed keys away from UCS and caches UCS verdicts for repeat tokens", async () => {
    const goodShape = `bck_test_${"Z".repeat(32)}`;
    fetchMock.mockImplementation(async (url: unknown) => {
      if (String(url).endsWith("/api/brandcode-mcp/keys/validate")) {
        return new Response(JSON.stringify({ valid: false }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("{}", { status: 200 });
    });
    const opts = options({
      validateToken: undefined,
      validationCache: new KeyValidationCache(),
    });
    for (const token of ["bck_test_malformed", "garbage", goodShape, goodShape, goodShape]) {
      const res = await handleHostedRequest(post(JSON.stringify(toolCall(1)), { token }), opts);
      expect(res.status).toBe(401);
    }
    const validateCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith("/api/brandcode-mcp/keys/validate"),
    );
    expect(validateCalls).toHaveLength(1);
  });
});

describe("per-key budget across slugs", () => {
  it("denies a key that spreads requests across slugs past its global budget", async () => {
    const opts = options({
      validateToken: makeValidator().validateToken,
      rateLimit: {
        store: createMemoryRateLimitStore(),
        maxRequests: 10,
        globalMaxRequests: 2,
        now: () => 1_800_000_000_000,
      },
    });
    const to = (slug: string) =>
      post(JSON.stringify(toolCall(1)), {
        url: `https://mcp.example/${slug}`,
        token: MULTI_KEY,
      });
    expect((await handleHostedRequest(to("acme"), opts)).status).toBe(200);
    expect((await handleHostedRequest(to("pendium"), opts)).status).toBe(200);
    const denied = await handleHostedRequest(to("acme"), opts);
    expect(denied.status).toBe(429);
    const body = (await denied.json()) as Record<string, any>;
    expect(body.rate_limits.global).toMatchObject({ limit: 2, remaining: 0 });
  });
});

describe("production rate-limit strictness via the router", () => {
  it("returns a generic 503 when production has no durable store configured", async () => {
    for (const name of [
      "BRANDCODE_MCP_RATE_LIMIT_REDIS_REST_URL",
      "BRANDCODE_MCP_RATE_LIMIT_REDIS_REST_TOKEN",
      "UPSTASH_REDIS_REST_URL",
      "UPSTASH_REDIS_REST_TOKEN",
      "KV_REST_API_URL",
      "KV_REST_API_TOKEN",
    ]) {
      vi.stubEnv(name, "");
    }
    vi.stubEnv("BRANDCODE_MCP_RATE_LIMIT_DISABLED", "1");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await handleHostedRequest(
      post(JSON.stringify(toolCall(1)), { url: "https://mcp.brandcode.studio/acme" }),
      options({
        environment: "production",
        allowedHosts: undefined,
        rateLimit: undefined,
      }),
    );
    expect(res.status).toBe(503);
    const text = await res.text();
    expect(text).toContain("rate_limit_unavailable");
    expect(text).not.toMatch(/@|UPSTASH|KV_REST|BRANDCODE_MCP_/);
  });
});

describe("DNS-rebinding protection", () => {
  it("refuses a Host header outside the allowlist", async () => {
    const res = await handleHostedRequest(
      post(JSON.stringify(toolCall(1)), { headers: { host: "evil.example" } }),
      options(),
    );
    expect(res.status).toBe(403);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("defaults the allowlist to the hosted hostname for the environment", async () => {
    expect(DEFAULT_HOSTED_ALLOWED_HOSTS.staging).toEqual([
      "mcp.staging.brandcode.studio",
    ]);
    expect(DEFAULT_HOSTED_ALLOWED_HOSTS.production).toEqual([
      "mcp.brandcode.studio",
    ]);
    const opts = options({ allowedHosts: undefined });
    const ok = await handleHostedRequest(
      post(JSON.stringify(toolCall(1)), {
        url: "https://mcp.staging.brandcode.studio/acme",
      }),
      opts,
    );
    expect(ok.status).toBe(200);
    const wrongEnvHost = await handleHostedRequest(
      post(JSON.stringify(toolCall(1)), { url: "https://mcp.brandcode.studio/acme" }),
      opts,
    );
    expect(wrongEnvHost.status).toBe(403);
  });
});

describe("response hygiene", () => {
  it("marks successful MCP responses no-store", async () => {
    const res = await handleHostedRequest(post(JSON.stringify(toolCall(1))), options());
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("does not leak raw exception text from an auth failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await handleHostedRequest(
      post(JSON.stringify(toolCall(1))),
      options({
        validateToken: async () => {
          throw new Error("db password=hunter2 at 10.0.0.5");
        },
      }),
    );
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).toContain("auth_internal_error");
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("10.0.0.5");
  });
});
