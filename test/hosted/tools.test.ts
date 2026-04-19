import { describe, it, expect, beforeEach } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createHostedServer } from "../../src/hosted/server.js";
import { HOSTED_TOOL_ORDER } from "../../src/hosted/registrations.js";
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
    scopes: ["read"],
    allowedSlugs: ["acme"],
    environment: "staging",
    ...overrides,
  };
}

function buildContext(
  pkg: BrandPackagePayload | null,
  overrides: Partial<HostedBrandContext> = {},
): HostedBrandContext {
  return {
    slug: "acme",
    auth: buildAuth(),
    loadBrandPackage: async () => pkg,
    ucsBaseUrl: "https://www.brandcode.studio",
    ucsServiceToken: "test-token",
    ...overrides,
  };
}

async function connectClient(context: HostedBrandContext) {
  const server = createHostedServer(context);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "hosted-tool-test", version: "1.0.0" });
  await server.connect(serverT);
  await client.connect(clientT);
  return { server, client };
}

async function call(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
) {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as Array<{ type: string; text: string }>;
  return JSON.parse(content[0].text) as Record<string, unknown>;
}

describe("hosted server registers all 8 tools in locked order", () => {
  it("listTools returns the Phase 0 locked surface", async () => {
    const { client } = await connectClient(buildContext(null));
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toEqual([...HOSTED_TOOL_ORDER]);
  });
});

describe("brand_runtime (hosted)", () => {
  const PACKAGE: BrandPackagePayload = {
    runtime: {
      version: "1.0.0",
      client_name: "Acme Hosted",
      compiled_at: "2026-04-19T00:00:00.000Z",
      sessions_completed: 1,
      identity: {
        colors: { primary: "#ff3b30" },
        typography: { heading: "Inter" },
        logo: null,
      },
      visual: null,
      voice: null,
      strategy: null,
    },
  };

  it("returns the hosted runtime tagged runtime_origin=hosted", async () => {
    const { client } = await connectClient(buildContext(PACKAGE));
    const json = await call(client, "brand_runtime", { slice: "full" });
    expect(json.runtime_origin).toBe("hosted");
    const runtime = json.runtime as Record<string, unknown>;
    expect(runtime.client_name).toBe("Acme Hosted");
  });

  it("supports minimal slice", async () => {
    const { client } = await connectClient(buildContext(PACKAGE));
    const json = await call(client, "brand_runtime", { slice: "minimal" });
    const runtime = json.runtime as Record<string, unknown>;
    expect((runtime.identity as Record<string, unknown>).colors).toEqual({
      primary: "#ff3b30",
    });
  });

  it("returns NOT_COMPILED when hosted package has no runtime shape", async () => {
    const { client } = await connectClient(buildContext({ unexpected: true }));
    const json = await call(client, "brand_runtime", { slice: "full" });
    expect(json.error).toBe("not_compiled");
  });

  it("returns FETCH_FAILED when upstream throws", async () => {
    const ctx = buildContext(null, {
      loadBrandPackage: async () => {
        throw new Error("upstream down");
      },
    });
    const { client } = await connectClient(ctx);
    const json = await call(client, "brand_runtime", { slice: "full" });
    expect(json.error).toBe("fetch_failed");
  });
});

describe("brand_status (hosted)", () => {
  it("reports slug, environment, scopes, and runtime availability", async () => {
    const pkg: BrandPackagePayload = {
      runtime: { version: "1.0.0", client_name: "Acme" },
      brandData: { narratives: [{}, {}], assets: [{}] },
    };
    const { client } = await connectClient(buildContext(pkg));
    const json = await call(client, "brand_status", {});
    expect(json.slug).toBe("acme");
    expect(json.environment).toBe("staging");
    expect(json.scopes).toEqual(["read"]);
    expect(json.runtime_available).toBe(true);
    const summary = json.brand_summary as Record<string, unknown>;
    expect(summary.narrative_count).toBe(2);
    expect(summary.asset_count).toBe(1);
  });
});

describe("stubs return structured not_implemented_in_staging errors", () => {
  const STUB_TOOLS = [
    ["brand_search", { query: "logo" }],
    ["brand_check", { text: "hi" }],
    ["list_brand_assets", {}],
    ["get_brand_asset", { asset_id: "x" }],
    ["brand_feedback", { summary: "test" }],
    ["brand_history", {}],
  ] as const;

  for (const [tool, args] of STUB_TOOLS) {
    it(`${tool} returns not_implemented_in_staging`, async () => {
      const { client } = await connectClient(buildContext(null));
      const json = await call(client, tool, args as Record<string, unknown>);
      expect(json.error).toBe("not_implemented_in_staging");
      expect(json.tool).toBe(tool);
      expect(json.phase).toBe("phase_1_staging_prototype");
    });
  }
});
