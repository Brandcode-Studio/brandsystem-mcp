/**
 * The client's JSON-RPC id is client-controlled and unbounded, so telemetry
 * records always carry a server-generated requestId; the client id is kept
 * only when short.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  boundedClientRequestId,
  emitAgentRunRecord,
  MAX_CLIENT_REQUEST_ID_LENGTH,
} from "../../src/hosted/telemetry.js";
import { handleHostedRequest } from "../../src/hosted/router.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
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
});

function telemetryContexts(): Array<Record<string, unknown>> {
  return fetchMock.mock.calls
    .filter(([url]) => String(url).endsWith("/agent/history"))
    .map(([, init]) => {
      const body = JSON.parse(String((init as RequestInit).body));
      return body.entry.run.context as Record<string, unknown>;
    });
}

async function callWithId(id: string | number) {
  const res = await handleHostedRequest(
    new Request("https://mcp.example/acme", {
      method: "POST",
      headers: {
        authorization: "Bearer bck_test_acme_read",
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: { name: "brand_status", arguments: {} },
      }),
    }),
    {
      environment: "staging",
      ucsBaseUrl: "https://ucs.test",
      ucsServiceToken: "svc",
      allowedHosts: ["mcp.example"],
      rateLimit: false,
      validateToken: async (token) => ({
        token,
        keyId: "key-acme",
        scopes: ["read"],
        allowedSlugs: ["acme"],
        environment: "staging",
      }),
      fetchBrandPackage: async () => null,
      fetchTasteGuidance: async () => null,
    },
  );
  expect(res.status).toBe(200);
  await new Promise((resolve) => setTimeout(resolve, 10));
}

describe("boundedClientRequestId", () => {
  it("keeps short string and numeric ids", () => {
    expect(boundedClientRequestId(7)).toBe("7");
    expect(boundedClientRequestId("req-1")).toBe("req-1");
    expect(boundedClientRequestId("a".repeat(MAX_CLIENT_REQUEST_ID_LENGTH))).toHaveLength(64);
  });

  it("drops long, empty, non-scalar, or control-character ids", () => {
    expect(boundedClientRequestId("a".repeat(MAX_CLIENT_REQUEST_ID_LENGTH + 1))).toBeNull();
    expect(boundedClientRequestId("")).toBeNull();
    expect(boundedClientRequestId({ id: 1 })).toBeNull();
    expect(boundedClientRequestId(undefined)).toBeNull();
    expect(boundedClientRequestId("a\nb")).toBeNull();
  });
});

describe("hosted telemetry request ids", () => {
  it("records a server-generated requestId and keeps a short client id separately", async () => {
    await callWithId("client-req-42");
    const [context] = telemetryContexts();
    expect(context.requestId).toMatch(UUID);
    expect(context.clientRequestId).toBe("client-req-42");
  });

  it("drops an oversized client id instead of storing it", async () => {
    const huge = "x".repeat(100_000);
    await callWithId(huge);
    const [context] = telemetryContexts();
    expect(context.requestId).toMatch(UUID);
    expect(context).not.toHaveProperty("clientRequestId");
    const bodies = fetchMock.mock.calls.map(([, init]) => String((init as RequestInit).body));
    expect(bodies.some((b) => b.includes(huge))).toBe(false);
  });

  it("caps error messages written to telemetry", async () => {
    await emitAgentRunRecord({
      ucsBaseUrl: "https://ucs.test",
      ucsServiceToken: "svc",
      slug: "acme",
      tool: "brand_runtime",
      outcome: "tool_error",
      latencyMs: 1,
      auth: {
        token: "t",
        keyId: "k",
        scopes: ["read"],
        allowedSlugs: ["acme"],
        environment: "staging",
      },
      requestId: "r",
      errorMessage: "e".repeat(5_000),
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body.entry.run.telemetry.errorMessage).toHaveLength(500);
  });
});
