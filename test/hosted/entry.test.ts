import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createHostedFetchHandler,
  publicUrl,
} from "../../src/hosted/entry.js";

const BASE_ENV = {
  BRANDCODE_MCP_SERVICE_TOKEN: "svc-token",
  UCS_API_BASE_URL: "https://ucs.test",
};

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function expectGenericMisconfig(res: Response) {
  expect(res.status).toBe(503);
  expect(res.headers.get("cache-control")).toBe("no-store");
  const text = await res.text();
  expect(JSON.parse(text)).toMatchObject({ error: "service_misconfigured" });
  // No env var names (or values) in the client-facing body.
  expect(text).not.toMatch(/BRANDCODE_MCP|VERCEL_ENV|SERVICE_TOKEN|svc-token/);
  expect(text).toMatch(/Brandcode admin/);
}

describe("hosted entry environment gate (fail closed)", () => {
  const health = () => new Request("https://mcp.staging.brandcode.studio/api/");

  it("refuses requests when BRANDCODE_MCP_ENV is unset", async () => {
    const handler = createHostedFetchHandler({ ...BASE_ENV });
    await expectGenericMisconfig(await handler(health()));
    expect(String(errorSpy.mock.calls[0]?.[0])).toContain("BRANDCODE_MCP_ENV");
  });

  it("refuses requests when BRANDCODE_MCP_ENV is not exactly production or staging", async () => {
    for (const value of ["prod", "Production", "dev", ""]) {
      const handler = createHostedFetchHandler({
        ...BASE_ENV,
        BRANDCODE_MCP_ENV: value,
      });
      await expectGenericMisconfig(await handler(health()));
    }
  });

  it("refuses a Vercel production deployment that is not declared production", async () => {
    const handler = createHostedFetchHandler({
      ...BASE_ENV,
      BRANDCODE_MCP_ENV: "staging",
      VERCEL_ENV: "production",
    });
    await expectGenericMisconfig(await handler(health()));
    expect(String(errorSpy.mock.calls[0]?.[0])).toContain("VERCEL_ENV");
  });

  it("refuses requests when the service token is missing, without naming it", async () => {
    const handler = createHostedFetchHandler({ BRANDCODE_MCP_ENV: "staging" });
    await expectGenericMisconfig(await handler(health()));
  });

  it("serves staging when explicitly configured", async () => {
    const handler = createHostedFetchHandler({
      ...BASE_ENV,
      BRANDCODE_MCP_ENV: "staging",
      VERCEL_ENV: "preview",
    });
    const res = await handler(health());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, environment: "staging" });
  });

  it("serves production when production is declared on a production deployment", async () => {
    const handler = createHostedFetchHandler({
      ...BASE_ENV,
      BRANDCODE_MCP_ENV: "production",
      VERCEL_ENV: "production",
    });
    const res = await handler(new Request("https://mcp.brandcode.studio/api/"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ environment: "production" });
  });

  it("applies BRANDCODE_MCP_ALLOWED_HOSTS to the transport host allowlist", async () => {
    const handler = createHostedFetchHandler(
      {
        ...BASE_ENV,
        BRANDCODE_MCP_ENV: "staging",
        BRANDCODE_MCP_ALLOWED_HOSTS: "preview.example",
      },
      {
        validateToken: async (token) => ({
          token,
          keyId: "k",
          scopes: ["read"],
          allowedSlugs: ["acme"],
          environment: "staging",
        }),
        rateLimit: false,
      },
    );
    const init = (host: string) =>
      new Request(`https://${host}/api/acme`, {
        method: "POST",
        headers: {
          authorization: "Bearer bck_test_whatever",
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
      });
    expect((await handler(init("preview.example"))).status).toBe(200);
    expect((await handler(init("mcp.staging.brandcode.studio"))).status).toBe(403);
  });
});

describe("publicUrl", () => {
  it("strips the /api rewrite prefix", () => {
    expect(publicUrl("https://mcp.example/api/acme")).toBe("https://mcp.example/acme");
    expect(publicUrl("https://mcp.example/api/")).toBe("https://mcp.example/");
    expect(publicUrl("https://mcp.example/acme")).toBe("https://mcp.example/acme");
  });
});
