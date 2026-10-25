import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  extractSlug,
  handleHostedRequest,
} from "../../src/hosted/router.js";
import { createMemoryRateLimitStore } from "../../src/hosted/rate-limit.js";
import type { HostedRateLimitStore } from "../../src/hosted/types.js";

const TEST_SERVICE_TOKEN = "service-token-abc";

const validator = async (token: string) => {
  if (token === "bck_test_acme_read") {
    return {
      token,
      keyId: token.slice(0, 16),
      scopes: ["read"] as const,
      allowedSlugs: ["acme"],
      environment: "staging" as const,
    };
  }
  if (token === "bck_test_pendium_full") {
    return {
      token,
      keyId: token.slice(0, 16),
      scopes: ["read", "check", "feedback"] as const,
      allowedSlugs: ["pendium"],
      environment: "staging" as const,
    };
  }
  return null;
};

const fetchBrandPackage = async (slug: string) => {
  if (slug === "acme" || slug === "pendium") {
    return {
      runtime: {
        version: "1.0.0",
        client_name: slug === "acme" ? "Acme" : "Pendium",
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
    };
  }
  return null;
};

function buildRequest(url: string, init: RequestInit = {}): Request {
  return new Request(url, init);
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

const baseOptions = {
  environment: "staging" as const,
  ucsBaseUrl: "https://www.brandcode.studio",
  ucsServiceToken: TEST_SERVICE_TOKEN,
  validateToken: validator,
  fetchBrandPackage,
  allowedHosts: ["mcp.example"],
};

describe("extractSlug", () => {
  it("extracts the first path segment", () => {
    expect(extractSlug("/acme")).toBe("acme");
    expect(extractSlug("/pendium/")).toBe("pendium");
    expect(extractSlug("/acme/resource")).toBe("acme");
  });
  it("rejects empty and root paths", () => {
    expect(extractSlug("/")).toBeNull();
    expect(extractSlug("")).toBeNull();
  });
  it("normalizes case to lowercase", () => {
    expect(extractSlug("/ACME")).toBe("acme");
  });
  it("rejects invalid slug characters", () => {
    expect(extractSlug("/acme_corp")).toBeNull();
    expect(extractSlug("/acme.corp")).toBeNull();
  });
});

describe("handleHostedRequest — routing + auth", () => {
  it("returns a 200 health payload at /", async () => {
    const res = await handleHostedRequest(
      buildRequest("https://mcp.example/"),
      baseOptions,
    );
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.service).toBe("brandcode-mcp");
  });

  it("returns 404 brand_not_found on malformed slug", async () => {
    const res = await handleHostedRequest(
      buildRequest("https://mcp.example/nope.path"),
      baseOptions,
    );
    expect(res.status).toBe(404);
    const body = await readJson(res);
    expect(body.error).toBe("brand_not_found");
  });

  it("returns 401 missing_bearer when no Authorization header", async () => {
    const res = await handleHostedRequest(
      buildRequest("https://mcp.example/acme", { method: "POST" }),
      baseOptions,
    );
    expect(res.status).toBe(401);
    const body = await readJson(res);
    expect(body.error).toBe("missing_bearer");
    expect(body.slug).toBe("acme");
  });

  it("returns 401 missing_bearer for malformed Authorization headers", async () => {
    const res = await handleHostedRequest(
      buildRequest("https://mcp.example/acme", {
        method: "POST",
        headers: { authorization: "Bearer bck_test_acme_read extra" },
      }),
      baseOptions,
    );
    expect(res.status).toBe(401);
    const body = await readJson(res);
    expect(body.error).toBe("missing_bearer");
    expect(body.slug).toBe("acme");
  });

  it("returns 401 invalid_token on unknown bearer", async () => {
    const res = await handleHostedRequest(
      buildRequest("https://mcp.example/acme", {
        method: "POST",
        headers: { authorization: "Bearer bck_test_unknown" },
      }),
      baseOptions,
    );
    expect(res.status).toBe(401);
    const body = await readJson(res);
    expect(body.error).toBe("invalid_token");
  });

  it("returns 403 slug_forbidden when key is valid but not authorized for slug", async () => {
    const res = await handleHostedRequest(
      buildRequest("https://mcp.example/pendium", {
        method: "POST",
        headers: { authorization: "Bearer bck_test_acme_read" },
      }),
      baseOptions,
    );
    expect(res.status).toBe(403);
    const body = await readJson(res);
    expect(body.error).toBe("slug_forbidden");
  });
});

describe("handleHostedRequest — MCP protocol dispatch", () => {
  function initializeBody(id = 1) {
    return JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "router-test", version: "1.0.0" },
      },
    });
  }

  it("accepts an initialize call with valid bearer + slug", async () => {
    const res = await handleHostedRequest(
      buildRequest("https://mcp.example/acme", {
        method: "POST",
        headers: {
          authorization: "Bearer bck_test_acme_read",
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: initializeBody(),
      }),
      baseOptions,
    );
    // Stateless mode: expect 200 with JSON-RPC response (enableJsonResponse: true)
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body.jsonrpc).toBe("2.0");
    expect(body.result).toBeDefined();
    expect(res.headers.get("x-ratelimit-limit")).toBe("60");
    expect(res.headers.get("x-ratelimit-remaining")).toBe("59");
  });

  it("returns 429 when an authenticated key exceeds its per-brand window", async () => {
    const store = createMemoryRateLimitStore();
    const limitedOptions = {
      ...baseOptions,
      rateLimit: {
        maxRequests: 1,
        windowMs: 60_000,
        now: () => 1_800_000_000_000,
        store,
        source: "router test",
      },
    };

    const first = await handleHostedRequest(
      buildRequest("https://mcp.example/acme", {
        method: "POST",
        headers: {
          authorization: "Bearer bck_test_acme_read",
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: initializeBody(1),
      }),
      limitedOptions,
    );
    expect(first.status).toBe(200);
    expect(first.headers.get("x-ratelimit-limit")).toBe("1");
    expect(first.headers.get("x-ratelimit-remaining")).toBe("0");

    const second = await handleHostedRequest(
      buildRequest("https://mcp.example/acme", {
        method: "POST",
        headers: {
          authorization: "Bearer bck_test_acme_read",
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: initializeBody(2),
      }),
      limitedOptions,
    );
    expect(second.status).toBe(429);
    expect(second.headers.get("retry-after")).toBe("60");
    const body = await readJson(second);
    expect(body.error).toBe("rate_limited");
    expect(body.rate_limits).toMatchObject({
      status: "active_pre_release_in_process",
      enforced: true,
      limit: 1,
      remaining: 0,
      window_ms: 60_000,
      reset_at: "2027-01-15T08:01:00.000Z",
      retry_after_seconds: 60,
      release_gate: "blocked",
    });
  });

  it("reports durable shared enforcement when a shared store is active", async () => {
    const seenKeys: string[] = [];
    const sharedStore: HostedRateLimitStore = {
      mode: "durable_shared",
      enforcement: "durable_shared_redis_fixed_window",
      source: "durable shared test store",
      check: async (input) => {
        seenKeys.push(input.key);
        return {
          count: 1,
          resetAt: input.now + input.windowMs,
        };
      },
    };
    const durableOptions = {
      ...baseOptions,
      rateLimit: {
        maxRequests: 10,
        windowMs: 30_000,
        now: () => 1_800_000_000_000,
        store: sharedStore,
        source: "router durable test",
      },
    };

    const res = await handleHostedRequest(
      buildRequest("https://mcp.example/acme", {
        method: "POST",
        headers: {
          authorization: "Bearer bck_test_acme_read",
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: initializeBody(),
      }),
      durableOptions,
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("x-ratelimit-limit")).toBe("10");
    expect(res.headers.get("x-ratelimit-remaining")).toBe("9");
    expect(res.headers.get("x-ratelimit-reset")).toBe("1800000030");
    expect(seenKeys).toEqual([
      "brandcode:mcp:rate-limit-ip:staging:unknown",
      "brandcode:mcp:rate-limit:staging:acme:bck_test_acme_re",
      "brandcode:mcp:rate-limit-global:staging:bck_test_acme_re",
    ]);
  });

  it("fails closed when the durable shared rate-limit store is unavailable", async () => {
    const unavailableStore: HostedRateLimitStore = {
      mode: "durable_shared",
      enforcement: "durable_shared_redis_fixed_window",
      source: "durable shared test store",
      check: async () => {
        throw new Error("redis unavailable");
      },
    };
    const durableOptions = {
      ...baseOptions,
      rateLimit: {
        maxRequests: 10,
        windowMs: 30_000,
        now: () => 1_800_000_000_000,
        store: unavailableStore,
        source: "router durable test",
      },
    };

    const res = await handleHostedRequest(
      buildRequest("https://mcp.example/acme", {
        method: "POST",
        headers: {
          authorization: "Bearer bck_test_acme_read",
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: initializeBody(),
      }),
      durableOptions,
    );

    expect(res.status).toBe(503);
    const body = await readJson(res);
    expect(body).toMatchObject({
      error: "rate_limit_unavailable",
      slug: "acme",
    });
    expect(JSON.stringify(body)).not.toMatch(/@|redis unavailable|UPSTASH|BRANDCODE_MCP_/);
  });

  it("reports the unavailable snapshot when only the per-key store check fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const flakyStore: HostedRateLimitStore = {
      mode: "durable_shared",
      enforcement: "durable_shared_redis_fixed_window",
      source: "durable shared test store",
      check: async (input) => {
        if (input.key.includes("rate-limit-ip")) {
          return { count: 1, resetAt: input.now + input.windowMs };
        }
        throw new Error("redis unavailable");
      },
    };
    const res = await handleHostedRequest(
      buildRequest("https://mcp.example/acme", {
        method: "POST",
        headers: {
          authorization: "Bearer bck_test_acme_read",
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: initializeBody(),
      }),
      { ...baseOptions, rateLimit: { store: flakyStore } },
    );
    expect(res.status).toBe(503);
    const body = await readJson(res);
    expect(body).toMatchObject({
      error: "rate_limit_unavailable",
      slug: "acme",
      rate_limits: {
        status: "unavailable",
        enforced: false,
        enforcement: "durable_shared_unavailable",
        release_gate: "blocked",
      },
    });
    vi.restoreAllMocks();
  });
});

