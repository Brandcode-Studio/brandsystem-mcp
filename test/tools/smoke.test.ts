import { describe, it, expect, beforeAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/server.js";

// ---------------------------------------------------------------------------
// Setup: create a real MCP client ↔ server pair over in-memory transport.
// No .brand/ directory exists in the test working directory, so tools that
// require one will return a graceful error rather than throwing.
// ---------------------------------------------------------------------------

let client: Client;

beforeAll(async () => {
  const server = createServer();
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  client = new Client({ name: "smoke-test-client", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type McpContent = { type: string; text: string }[];

/** Call a tool and return the parsed JSON from its text response. */
async function callAndParse(
  name: string,
  args: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as McpContent;
  expect(content).toBeDefined();
  expect(content.length).toBeGreaterThanOrEqual(1);
  expect(content[0].type).toBe("text");
  const json = JSON.parse(content[0].text);
  return json;
}

/** Assert the response has a valid _metadata.what_happened field. */
function expectValidMetadata(json: Record<string, unknown>): void {
  const meta = json._metadata as Record<string, unknown>;
  expect(meta).toBeDefined();
  expect(typeof meta.what_happened).toBe("string");
  expect((meta.what_happened as string).length).toBeGreaterThan(0);
}

// ---------------------------------------------------------------------------
// Tool count
// ---------------------------------------------------------------------------

describe("tool registration", () => {
  it("registers all 31 tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.length).toBe(31);
  });

  it("every tool has a non-empty description", async () => {
    const { tools } = await client.listTools();
    for (const tool of tools) {
      expect(tool.description?.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Tools that do NOT require .brand/ directory
// ---------------------------------------------------------------------------

describe("tools that need no .brand/ dir", () => {
  it("brand_feedback returns success", async () => {
    const json = await callAndParse("brand_feedback", {
      category: "bug",
      summary: "smoke test feedback — please ignore",
    });
    expectValidMetadata(json);
  });

  it("brand_feedback accepts agent_signal category", async () => {
    const json = await callAndParse("brand_feedback", {
      category: "agent_signal",
      signal: "positive",
      tool_used: "brand_extract_web",
      signal_context: "Extracting brand from example.com",
      outcome: "Colors and fonts extracted successfully",
      summary: "Extraction worked well for simple static site",
    });
    expectValidMetadata(json);
    const meta = json._metadata as Record<string, unknown>;
    expect(meta.what_happened).toContain("Agent signal recorded");
    expect(meta.what_happened).toContain("positive");
    expect(meta.what_happened).toContain("brand_extract_web");
  });

  it("brand_feedback accepts agent_signal with negative signal", async () => {
    const json = await callAndParse("brand_feedback", {
      category: "agent_signal",
      signal: "negative",
      tool_used: "brand_compile",
      signal_context: "Compiling tokens after extraction",
      outcome: "Missing primary color despite extraction finding colors",
      summary: "Token compilation dropped extracted colors",
    });
    expectValidMetadata(json);
    expect(json.signal).toBe("negative");
    expect(json.tool_used).toBe("brand_compile");
  });

  it("brand_feedback_review returns success", async () => {
    const json = await callAndParse("brand_feedback_review", {});
    expectValidMetadata(json);
  });

  it("brand_feedback_triage handles missing ID gracefully", async () => {
    const json = await callAndParse("brand_feedback_triage", {
      feedback_id: "nonexistent-id",
      status: "acknowledged",
    });
    expectValidMetadata(json);
  });

  it("brand_init creates .brand/ (or reports it already exists)", async () => {
    // brand_init tries to create .brand/ in cwd — it will either succeed
    // or report "already exists". Either way, it should not throw.
    const json = await callAndParse("brand_init", {
      client_name: "Smoke Test Brand",
    });
    expectValidMetadata(json);
  });
});

// ---------------------------------------------------------------------------
// Tools that require .brand/ directory (should gracefully report missing)
// ---------------------------------------------------------------------------

describe("tools that require .brand/ dir", () => {
  it("brand_status handles missing .brand/", async () => {
    const json = await callAndParse("brand_status", {});
    expectValidMetadata(json);
  });

  it("brand_compile handles missing .brand/", async () => {
    const json = await callAndParse("brand_compile", {});
    expectValidMetadata(json);
  });

  it("brand_report handles missing .brand/", async () => {
    const json = await callAndParse("brand_report", {});
    expectValidMetadata(json);
  });

  it("brand_runtime handles missing .brand/", async () => {
    const json = await callAndParse("brand_runtime", {});
    expectValidMetadata(json);
  });

  it("brand_audit handles missing .brand/", async () => {
    const json = await callAndParse("brand_audit", {});
    expectValidMetadata(json);
  });

  it("brand_set_logo handles missing .brand/", async () => {
    const json = await callAndParse("brand_set_logo", {
      svg: "<svg><circle r='10'/></svg>",
    });
    expectValidMetadata(json);
  });

  it("brand_clarify handles missing .brand/", async () => {
    const json = await callAndParse("brand_clarify", {
      id: "clarify-1",
      answer: "skip",
    });
    expectValidMetadata(json);
  });

  it("brand_extract_figma handles missing .brand/", async () => {
    const json = await callAndParse("brand_extract_figma", {
      mode: "plan",
      figma_file_key: "test-key",
    });
    expectValidMetadata(json);
  });

  it("brand_deepen_identity handles missing .brand/", async () => {
    const json = await callAndParse("brand_deepen_identity", {
      mode: "interview",
    });
    expectValidMetadata(json);
  });

  it("brand_ingest_assets handles missing .brand/", async () => {
    const json = await callAndParse("brand_ingest_assets", {});
    expectValidMetadata(json);
  });

  it("brand_preflight handles missing .brand/", async () => {
    const json = await callAndParse("brand_preflight", {
      html: "<div>test</div>",
    });
    expectValidMetadata(json);
  });

  it("brand_compile_messaging handles missing .brand/", async () => {
    const json = await callAndParse("brand_compile_messaging", {
      mode: "interview",
    });
    expectValidMetadata(json);
  });

  it("brand_build_personas handles missing .brand/", async () => {
    const json = await callAndParse("brand_build_personas", {
      mode: "interview",
    });
    expectValidMetadata(json);
  });

  it("brand_build_journey handles missing .brand/", async () => {
    const json = await callAndParse("brand_build_journey", {
      mode: "interview",
    });
    expectValidMetadata(json);
  });

  it("brand_build_themes handles missing .brand/", async () => {
    const json = await callAndParse("brand_build_themes", {
      mode: "interview",
    });
    expectValidMetadata(json);
  });

  it("brand_build_matrix handles missing .brand/", async () => {
    const json = await callAndParse("brand_build_matrix", {
      mode: "generate",
    });
    expectValidMetadata(json);
  });

  it("brand_audit_content handles missing .brand/", async () => {
    const json = await callAndParse("brand_audit_content", {
      content: "Some test content to audit",
    });
    expectValidMetadata(json);
  });

  it("brand_check_compliance handles missing .brand/", async () => {
    const json = await callAndParse("brand_check_compliance", {
      content: "Some test content to check",
    });
    expectValidMetadata(json);
  });

  it("brand_audit_drift handles missing .brand/", async () => {
    const json = await callAndParse("brand_audit_drift", {
      items: JSON.stringify([
        { content: "Test page content", label: "Test Page" },
      ]),
    });
    expectValidMetadata(json);
  });

  it("brand_write handles missing .brand/", async () => {
    const json = await callAndParse("brand_write", {
      content_type: "general",
    });
    expectValidMetadata(json);
  });

  it("brand_export handles missing .brand/", async () => {
    const json = await callAndParse("brand_export", {
      target: "chat",
    });
    expectValidMetadata(json);
  });
});

// ---------------------------------------------------------------------------
// Tools that fetch URLs — may fail due to network, just verify no throw
// ---------------------------------------------------------------------------

describe("tools that fetch URLs (network-dependent)", () => {
  it("brand_start does not throw", async () => {
    const result = await client.callTool({
      name: "brand_start",
      arguments: {
        client_name: "Smoke Test",
        website_url: "https://example.com",
        mode: "auto",
      },
    });
    const content = result.content as McpContent;
    expect(content).toBeDefined();
    expect(content.length).toBeGreaterThanOrEqual(1);
    // Parse response — it should be valid JSON regardless of network outcome
    const json = JSON.parse(content[0].text);
    expect(json._metadata).toBeDefined();
  }, 30_000);

  it("brand_extract_web does not throw", async () => {
    const result = await client.callTool({
      name: "brand_extract_web",
      arguments: { url: "https://example.com" },
    });
    const content = result.content as McpContent;
    expect(content).toBeDefined();
    expect(content.length).toBeGreaterThanOrEqual(1);
    const json = JSON.parse(content[0].text);
    expect(json._metadata).toBeDefined();
  }, 30_000);

  it("brand_extract_messaging does not throw", async () => {
    const result = await client.callTool({
      name: "brand_extract_messaging",
      arguments: { url: "https://example.com" },
    });
    const content = result.content as McpContent;
    expect(content).toBeDefined();
    expect(content.length).toBeGreaterThanOrEqual(1);
    const json = JSON.parse(content[0].text);
    expect(json._metadata).toBeDefined();
  }, 30_000);
});
