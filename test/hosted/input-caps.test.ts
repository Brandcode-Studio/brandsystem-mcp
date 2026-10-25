/**
 * GHSA-46jr-4wx8-v453: one HTTP request within the SDK's default 4 MiB body
 * limit could exhaust server memory during argument validation. SDK 1.32 adds
 * the caps but leaves them off by default — these tests prove ours are on.
 */
import { describe, it, expect } from "vitest";
import {
  handleHostedRequest,
  HOSTED_MAX_REQUEST_BODY_BYTES,
} from "../../src/hosted/router.js";
import { HOSTED_MAX_TOOL_INPUT_ELEMENTS } from "../../src/hosted/server.js";
import { createServer, LOCAL_MAX_TOOL_INPUT_ELEMENTS } from "../../src/server.js";

const options = {
  environment: "staging" as const,
  ucsBaseUrl: "https://www.brandcode.studio",
  ucsServiceToken: "service-token-abc",
  validateToken: async (token: string) =>
    token === "bck_test_acme_read"
      ? {
          token,
          keyId: token.slice(0, 16),
          scopes: ["read"] as const,
          allowedSlugs: ["acme"],
          environment: "staging" as const,
        }
      : null,
  fetchBrandPackage: async () => ({
    runtime: {
      version: "1.0.0",
      client_name: "Acme",
      compiled_at: "2026-04-19T00:00:00.000Z",
      sessions_completed: 1,
      identity: { colors: { primary: "#000000" }, typography: { heading: "Inter" }, logo: null },
      visual: null,
      voice: null,
      strategy: null,
    },
  }),
};

function post(body: string): Request {
  return new Request("https://mcp.example/acme", {
    method: "POST",
    headers: {
      authorization: "Bearer bck_test_acme_read",
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body,
  });
}

function toolCall(args: Record<string, unknown>): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "brand_search", arguments: args },
  });
}

describe("hosted input caps", () => {
  it("rejects a tools/call whose arguments exceed the element cap", async () => {
    const flood = Array.from({ length: HOSTED_MAX_TOOL_INPUT_ELEMENTS + 1 }, () => 0);
    const res = await handleHostedRequest(post(toolCall({ query: "logo", flood })), options);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result?: { isError?: boolean; content?: Array<{ text: string }> } };
    expect(body.result?.isError).toBe(true);
    expect(JSON.stringify(body.result?.content)).toMatch(new RegExp(`maximum of ${HOSTED_MAX_TOOL_INPUT_ELEMENTS} elements`));
  });

  it("accepts an ordinary tools/call under the cap", async () => {
    const res = await handleHostedRequest(post(toolCall({ query: "logo" })), options);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result?: { isError?: boolean } };
    expect(body.result?.isError).not.toBe(true);
  });

  it("rejects a request body over the hosted byte cap before parsing", async () => {
    const padding = "x".repeat(HOSTED_MAX_REQUEST_BODY_BYTES + 1);
    const res = await handleHostedRequest(post(toolCall({ query: padding })), options);
    expect(res.status).toBe(413);
  });

  it("caps sit below the SDK's 4 MiB default", () => {
    expect(HOSTED_MAX_REQUEST_BODY_BYTES).toBeLessThan(4 * 1024 * 1024);
    expect(Number.isFinite(HOSTED_MAX_TOOL_INPUT_ELEMENTS)).toBe(true);
  });
});

describe("local server input cap", () => {
  it("constructs the local server with a finite element cap", () => {
    const server = createServer() as unknown as { _maxToolInputElements?: number };
    expect(server._maxToolInputElements).toBe(LOCAL_MAX_TOOL_INPUT_ELEMENTS);
    expect(Number.isFinite(LOCAL_MAX_TOOL_INPUT_ELEMENTS)).toBe(true);
  });
});

describe("advertised input schemas stay closed under zod 4", () => {
  it("every parameterized local tool advertises additionalProperties: false", async () => {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
    const server = createServer({ profile: "full" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    const client = new Client({ name: "schema-test", version: "0" });
    await client.connect(b);
    const { tools } = await client.listTools();
    const open = tools
      .filter((t) => Object.keys(t.inputSchema.properties ?? {}).length > 0)
      .filter((t) => (t.inputSchema as { additionalProperties?: unknown }).additionalProperties !== false)
      .map((t) => t.name);
    expect(open).toEqual([]);
  });
});
