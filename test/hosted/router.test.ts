import { describe, it, expect } from "vitest";
import {
  extractSlug,
  handleHostedRequest,
} from "../../src/hosted/router.js";

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
  });
});
