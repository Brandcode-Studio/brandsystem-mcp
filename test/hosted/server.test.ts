/**
 * Coverage for the AgentRun telemetry instrumentation wired into
 * createHostedServer() (src/hosted/server.ts) via wrapServerWithTelemetry()
 * (src/hosted/telemetry.ts). See test/hosted/telemetry.test.ts for
 * emitAgentRunRecord()'s own unit contract; this file proves the wrapper is
 * actually attached to every one of the 9 locked hosted tools and that it
 * never blocks or alters a tool's real MCP response.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { HOSTED_TOOL_ORDER } from "../../src/hosted/registrations.js";
import { wrapServerWithTelemetry } from "../../src/hosted/telemetry.js";
import {
  connectHostedClient as connectClient,
  callHostedTool as call,
  stubJsonFetch,
} from "./helpers.js";
import type {
  HostedBrandContext,
  BrandcodeMcpAuthInfo,
} from "../../src/hosted/types.js";
import type { BrandPackagePayload } from "../../src/connectors/brandcode/types.js";

function buildAuth(
  overrides: Partial<BrandcodeMcpAuthInfo> = {},
): BrandcodeMcpAuthInfo {
  return {
    token: "bck_test_acme",
    keyId: "bck_test_acme",
    scopes: ["read", "check", "feedback", "capture"],
    allowedSlugs: ["acme"],
    environment: "staging",
    ...overrides,
  };
}

function buildContext(
  overrides: Partial<HostedBrandContext> = {},
): HostedBrandContext {
  const auth = overrides.auth ?? buildAuth();
  const pkg: BrandPackagePayload = {
    slug: "acme",
    runtime: {
      version: "1.0.0",
      client_name: "Acme Hosted",
      identity: { colors: { primary: "#000000" } },
    },
    brandInstance: {
      assets: [
        {
          id: "logo-primary",
          title: "Primary logo",
          category: "logo",
          lifecycle: "official",
          format: "svg",
          packagePath: "acme/runtime/assets/logo-primary.svg",
        },
      ],
    },
  } as BrandPackagePayload;

  return {
    slug: "acme",
    auth,
    loadBrandPackage: async () => pkg,
    ucsBaseUrl: "https://www.brandcode.studio",
    ucsServiceToken: "test-service-token",
    ...overrides,
  };
}

/** Minimal per-tool arguments that let each of the 9 hosted tools dispatch
 *  successfully against the fixture context above. */
const TOOL_ARGS: Record<string, Record<string, unknown>> = {
  brand_runtime: {},
  brand_search: { query: "brand" },
  brand_check: { color: "#000000" },
  brand_status: {},
  list_brand_assets: {},
  get_brand_asset: { asset_id: "logo-primary" },
  brand_feedback: { summary: "telemetry coverage probe" },
  capture_taste: {
    candidate_ref: "variant-1",
    verdict: "distinctive",
    attribute_reason: "Coverage probe reason long enough to pass validation.",
  },
  brand_history: {},
};

/** Default OK body shared by this file's stubOkFetch() call sites (a generic
 *  UCS append/ledger response shape; the specific fields aren't asserted on
 *  by these tests, only that the call succeeded). */
const DEFAULT_OK_BODY = {
  ok: true,
  routed: "queued",
  ref: "taste-ledger:test",
  canonicalMutation: false,
  entry: {},
  history: [],
};

function stubOkFetch() {
  return stubJsonFetch(DEFAULT_OK_BODY);
}

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("wrapServerWithTelemetry coverage — all 9 locked hosted tools", () => {
  it("HOSTED_TOOL_ORDER has exactly the 9 tools this coverage test exercises", () => {
    expect(HOSTED_TOOL_ORDER).toHaveLength(9);
    for (const tool of HOSTED_TOOL_ORDER) {
      expect(TOOL_ARGS).toHaveProperty(tool);
    }
  });

  for (const tool of HOSTED_TOOL_ORDER) {
    it(`emits an AgentRun telemetry record when "${tool}" is called`, async () => {
      const fetchMock = stubOkFetch();
      const { client } = await connectClient(buildContext());

      await call(client, tool, TOOL_ARGS[tool]);
      // Let the fire-and-forget telemetry POST's microtask queue flush.
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Every tool must have triggered at least one fetch call whose body
      // contains the AgentRunHistoryEntry telemetry envelope tagged with
      // this exact tool name and the mcp-hosted surface.
      const telemetryCalls = fetchMock.mock.calls.filter(([url, init]) => {
        const target = String(url);
        if (!target.endsWith("/api/brand/hosted/acme/agent/history")) {
          return false;
        }
        const body = String((init as RequestInit | undefined)?.body ?? "");
        return body.includes("mcp-hosted") && body.includes(tool);
      });
      expect(telemetryCalls.length).toBeGreaterThanOrEqual(1);
    });
  }
});

describe("wrapServerWithTelemetry — fail-open and non-blocking guarantees", () => {
  it("does not alter the tool's own response when the telemetry POST fails", async () => {
    // Every fetch (both the tool's own UCS call, when applicable, and the
    // telemetry POST) fails — the tool response must still be the normal
    // success/error shape the tool itself produces, unaffected by telemetry.
    const fetchMock = vi.fn(async () => {
      throw new TypeError("simulated network outage");
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { client } = await connectClient(buildContext());
    // brand_runtime does not call fetch itself (loadBrandPackage is a local
    // stub in this test), so its response is controlled purely by the tool
    // logic — proving telemetry's own fetch failure never leaks in.
    const json = await call(client, "brand_runtime", {});

    expect(json).toMatchObject({
      runtime_origin: "hosted",
      slug: "acme",
    });
    expect(json.error).toBeUndefined();
  });

  it("does not hang the tool's response when the telemetry POST never settles", async () => {
    const fetchMock = vi.fn(() => new Promise<Response>(() => {}));
    vi.stubGlobal("fetch", fetchMock);

    const { client } = await connectClient(buildContext());

    const start = Date.now();
    const json = await call(client, "brand_runtime", {});
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(1000);
    expect(json).toMatchObject({ runtime_origin: "hosted", slug: "acme" });
  });

  it("still returns the tool's real error response when telemetry POST fails for a tool that itself calls UCS", async () => {
    // brand_history's own UCS GET fails with 404; the telemetry POST fired
    // by the wrapper (a second, distinct fetch call) also resolves 404
    // against this uniform stub. The tool's structured error response must
    // reflect only its own UCS call outcome, not telemetry's.
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "not found" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { client } = await connectClient(buildContext());
    const json = await call(client, "brand_history", {});

    expect(json).toMatchObject({
      error: "hosted_brand_not_found",
      status: 404,
    });
  });
});

describe("wrapServerWithTelemetry — outcome classification at the server boundary", () => {
  it("classifies a successful call as outcome ok", async () => {
    const fetchMock = stubOkFetch();
    const { client } = await connectClient(buildContext());

    await call(client, "brand_runtime", {});
    await new Promise((resolve) => setTimeout(resolve, 10));

    const telemetryCall = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/api/brand/hosted/acme/agent/history"),
    );
    expect(telemetryCall).toBeDefined();
    const body = String((telemetryCall?.[1] as RequestInit | undefined)?.body ?? "");
    expect(body).toContain('"outcome":"ok"');
  });

  it("classifies a scope-denied call as outcome auth_error", async () => {
    const fetchMock = stubOkFetch();
    const readOnlyAuth = buildAuth({ scopes: ["read"] });
    const { client } = await connectClient(buildContext({ auth: readOnlyAuth }));

    await call(client, "brand_check", { color: "#000000" });
    await new Promise((resolve) => setTimeout(resolve, 10));

    const telemetryCall = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/api/brand/hosted/acme/agent/history"),
    );
    expect(telemetryCall).toBeDefined();
    const body = String((telemetryCall?.[1] as RequestInit | undefined)?.body ?? "");
    expect(body).toContain('"outcome":"auth_error"');
  });

  it("classifies a UCS upstream failure as outcome upstream_error", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "server exploded" }), {
          status: 500,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { client } = await connectClient(buildContext());
    await call(client, "brand_history", {});
    await new Promise((resolve) => setTimeout(resolve, 10));

    const telemetryCall = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/api/brand/hosted/acme/agent/history"),
    );
    expect(telemetryCall).toBeDefined();
    const body = String((telemetryCall?.[1] as RequestInit | undefined)?.body ?? "");
    expect(body).toContain('"outcome":"upstream_error"');
  });

  it("classifies a thrown tool exception as outcome tool_error and still rethrows to the MCP client", async () => {
    // None of the 9 real hosted tool handlers throw — they all funnel
    // failures through buildResponse(). Exercise the wrapper's catch{}
    // classification branch directly against a synthetic throwing tool
    // registered through the same wrapServerWithTelemetry() choke point, so
    // the tool_error path (a handler that fails outright, not just returns
    // a structured error) has direct coverage independent of the real tools.
    const fetchMock = stubOkFetch();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const context = buildContext();

    const server = new McpServer({ name: "telemetry-throw-test", version: "1.0.0" });
    wrapServerWithTelemetry(server, context);
    server.tool(
      "throwing_probe",
      "test-only tool that always throws",
      {},
      async () => {
        throw new Error("synthetic tool failure");
      },
    );

    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "throw-test-client", version: "1.0.0" });
    await server.connect(serverT);
    await client.connect(clientT);

    const result = await client.callTool({ name: "throwing_probe", arguments: {} });
    // The MCP SDK surfaces a thrown handler error as an isError tool result,
    // not a rejected callTool promise — confirm the failure still reaches
    // the client rather than being swallowed by the telemetry wrapper.
    expect(result.isError).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 10));
    const telemetryCall = fetchMock.mock.calls.find(([url]) =>
      String(url).endsWith("/api/brand/hosted/acme/agent/history"),
    );
    expect(telemetryCall).toBeDefined();
    const body = String((telemetryCall?.[1] as RequestInit | undefined)?.body ?? "");
    expect(body).toContain('"outcome":"tool_error"');
    expect(body).toContain("synthetic tool failure");
  });
});
