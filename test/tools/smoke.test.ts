import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// brand_feedback writes to ~/.brandsystem/feedback (resolved at import time)
// and POSTs to brandcode.studio. Point HOME at a temp dir and answer the
// feedback endpoint locally so smoke runs never send real feedback.
const fakeHome = vi.hoisted(() => {
  const fs = process.getBuiltinModule("node:fs");
  const os = process.getBuiltinModule("node:os");
  const path = process.getBuiltinModule("node:path");
  return fs.mkdtempSync(path.join(os.tmpdir(), "smoke-home-"));
});
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: () => fakeHome };
});

const { createServer } = await import("../../src/server.js");

// ---------------------------------------------------------------------------
// Setup: create a real MCP client ↔ server pair over in-memory transport.
// The server runs against an empty temporary working directory (never the
// repository root), so tools that require .brand/ return a graceful error
// and tools that write .brand/ or .gitignore can't touch the checkout.
// ---------------------------------------------------------------------------

let client: Client;
let workDir: string;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "smoke-suite-"));
  vi.spyOn(process, "cwd").mockReturnValue(workDir);
  const realFetch = globalThis.fetch;
  vi.stubGlobal("fetch", (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.startsWith("https://www.brandcode.studio/api/feedback")) {
      return Promise.resolve(new Response(JSON.stringify({ ok: true, id: "smoke-test" }), { status: 200 }));
    }
    return realFetch(input, init);
  });
  const server = createServer({ profile: "full" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  client = new Client({ name: "smoke-test-client", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
});

afterAll(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await rm(workDir, { recursive: true, force: true });
  await rm(fakeHome, { recursive: true, force: true });
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
  it("registers all expected tools", async () => {
    const { tools } = await client.listTools();
    // 39 published + 2 repo tools (when committed). Use >= to handle both.
    expect(tools.length).toBeGreaterThanOrEqual(39);
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
    // Runs in the suite's temporary working directory, never the repo root.
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

  it("brand_extract_visual returns gracefully without .brand/", async () => {
    const result = await client.callTool({
      name: "brand_extract_visual",
      arguments: { url: "https://example.com", merge: false },
    });
    const content = result.content as McpContent;
    expect(content).toBeDefined();
    expect(content.length).toBeGreaterThanOrEqual(1);
    // Either returns image + text (if Chrome found) or just text (unavailable/error)
    const textItem = content.find((c) => c.type === "text");
    expect(textItem).toBeDefined();
  }, 45_000);

  it("brand_extract_site returns gracefully without .brand/ when merge is false", async () => {
    const result = await client.callTool({
      name: "brand_extract_site",
      arguments: { url: "https://example.com", merge: false, page_limit: 2 },
    });
    const content = result.content as McpContent;
    expect(content).toBeDefined();
    expect(content.length).toBeGreaterThanOrEqual(1);
    const textItem = content.find((c) => c.type === "text");
    expect(textItem).toBeDefined();
  }, 60_000);

  it("brand_extract_pdf handles missing .brand/", async () => {
    const json = await callAndParse("brand_extract_pdf", {
      file_path: "/tmp/brand-guidelines.pdf",
    });
    expectValidMetadata(json);
  });

  it("brand_resolve_conflicts handles missing .brand/", async () => {
    const json = await callAndParse("brand_resolve_conflicts", {
      mode: "show",
    });
    expectValidMetadata(json);
  });

  it("brand_generate_designmd handles missing .brand/", async () => {
    const json = await callAndParse("brand_generate_designmd", {});
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

  it("brand_preflight render=true returns a valid envelope", async () => {
    const json = await callAndParse("brand_preflight", {
      html: "<div>test</div>",
      render: true,
      viewport: "mobile",
    });
    expectValidMetadata(json);
    // Depending on suite order .brand/ may exist; either a rendered result,
    // a not-initialized error, or a no-browser error is a graceful outcome.
    if (json.error !== undefined) {
      expect(["not_initialized", "browser_unavailable"]).toContain(json.error);
    } else {
      expect(json.mode).toBe("render");
    }
  }, 60000);

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
// brand_preview
// ---------------------------------------------------------------------------

describe("brand_preview", () => {
  it("handles missing .brand/", async () => {
    const json = await callAndParse("brand_preview", {});
    expectValidMetadata(json);
  });
});

// ---------------------------------------------------------------------------
// brand_check inline gate
// ---------------------------------------------------------------------------

describe("brand_check inline gate", () => {
  it("requires at least one input", async () => {
    const json = await callAndParse("brand_check", {});
    expectValidMetadata(json);
    expect(json.error).toBe("no_input");
  });

  it("handles text check gracefully (pass or not_compiled)", async () => {
    const json = await callAndParse("brand_check", { text: "hello world" });
    expectValidMetadata(json);
    // Either passes (if brand data exists from earlier tests) or returns not_compiled
    expect(json.error === "not_compiled" || json.pass !== undefined).toBe(true);
  });

  it("handles color check gracefully", async () => {
    const json = await callAndParse("brand_check", { color: "#ff0000" });
    expectValidMetadata(json);
    expect(json.error === "not_compiled" || json.pass !== undefined).toBe(true);
  });

  it("handles font check gracefully", async () => {
    const json = await callAndParse("brand_check", { font: "Helvetica" });
    expectValidMetadata(json);
    expect(json.error === "not_compiled" || json.pass !== undefined).toBe(true);
  });

  it("handles css check gracefully", async () => {
    const json = await callAndParse("brand_check", { css: "box-shadow: 0 2px 4px black" });
    expectValidMetadata(json);
    expect(json.error === "not_compiled" || json.pass !== undefined).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Brandcode Studio connector tools (auth + save/push modes)
// ---------------------------------------------------------------------------

describe("brandcode auth and connector tools", () => {
  it("brand_brandcode_auth status returns not authenticated", async () => {
    const json = await callAndParse("brand_brandcode_auth", {
      mode: "status",
    });
    expectValidMetadata(json);
    expect(json.authenticated).toBe(false);
  });

  it("brand_brandcode_auth login requires email", async () => {
    const json = await callAndParse("brand_brandcode_auth", {
      mode: "login",
    });
    expectValidMetadata(json);
    expect(json.error).toBe("validation_failed");
  });

  it("brand_brandcode_auth set_key requires key", async () => {
    const json = await callAndParse("brand_brandcode_auth", {
      mode: "set_key",
    });
    expectValidMetadata(json);
    expect(json.error).toBe("validation_failed");
  });

  it("brand_brandcode_auth logout handles no credentials", async () => {
    const json = await callAndParse("brand_brandcode_auth", {
      mode: "logout",
    });
    expectValidMetadata(json);
    expect(json.was_authenticated).toBe(false);
  });

  it("brand_brandcode_connect save mode requires auth", async () => {
    const json = await callAndParse("brand_brandcode_connect", {
      mode: "save",
    });
    expectValidMetadata(json);
    // Should fail with not_initialized or not_authenticated
    expect(json.error).toBeDefined();
  });

  it("brand_brandcode_sync push requires connection", async () => {
    const json = await callAndParse("brand_brandcode_sync", {
      direction: "push",
    });
    expectValidMetadata(json);
    expect(json.error).toBe("not_found");
  });

  it("brand_brandcode_sync pull (default) requires connection", async () => {
    const json = await callAndParse("brand_brandcode_sync", {});
    expectValidMetadata(json);
    expect(json.error).toBe("not_found");
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
    const textItem = content.find((item) => item.type === "text");
    expect(textItem).toBeDefined();
    const json = JSON.parse(textItem!.text);
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
