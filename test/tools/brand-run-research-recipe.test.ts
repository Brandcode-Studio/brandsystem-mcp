import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/server.js";
import { writeConnectorConfig } from "../../src/connectors/brandcode/persistence.js";
import { writeAuthCredentials } from "../../src/lib/auth-state.js";
import type { ConnectorConfig } from "../../src/connectors/brandcode/types.js";

const baseConfig: ConnectorConfig = {
  provider: "brandcode",
  brandUrl: "https://www.brandcode.studio/start/brands/acme",
  slug: "acme",
  pullUrl: "https://www.brandcode.studio/api/brand/hosted/acme/pull",
  connectUrl: "https://www.brandcode.studio/api/brand/hosted/acme/connect",
  syncToken: "acme:1",
  lastSyncedAt: "2026-04-18T00:00:00.000Z",
  shareTokenRequired: false,
};

async function writeAuth(tmpDir: string) {
  await mkdir(join(tmpDir, ".brand"), { recursive: true });
  await writeAuthCredentials(tmpDir, {
    email: "owner@acme.com",
    token: "test-jwt",
    expiresAt: "2099-01-01T00:00:00.000Z",
    studioUrl: "https://www.brandcode.studio",
  });
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function parseToolResult(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as Array<{ type: string; text: string }>;
  return JSON.parse(content[0].text) as Record<string, unknown>;
}

describe("run_research_recipe tool", () => {
  let tmpDir: string;
  let prevCwd: string;
  let client: Client;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "run-recipe-test-"));
    prevCwd = process.cwd();
    process.chdir(tmpDir);

    const server = createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "run-recipe-test", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    process.chdir(prevCwd);
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("ingests findings to the intelligence-capture route and summarizes outcomes", async () => {
    await writeConnectorConfig(tmpDir, baseConfig);
    await writeAuth(tmpDir);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        ok: true,
        mode: "findings",
        count: 2,
        outcomes: [
          { status: "queued", statement: "Sourced claim", ref: "ledger://acme", quarantined: false },
          { status: "refused", code: "evidence_bar_unmet", message: "needs a source" },
        ],
      }),
    );

    const json = await parseToolResult(client, "run_research_recipe", {
      recipe_id: "competitor-claims-weekly",
      question: "What proof claims are competitors making?",
      cadence: "weekly",
      default_target: "proof_point",
      findings: [
        { statement: "Sourced claim", citations: [{ url: "https://example.gov/report" }] },
        { statement: "Unsourced claim", citations: [] },
      ],
    });

    expect(json.ran).toBe(true);
    expect(json.brand).toBe("acme");
    expect(json.queued).toBe(1);
    expect(json.refused).toBe(1);
    expect(json.canonical_mutation).toBe(false);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://www.brandcode.studio/api/brand/acme/runtime/intelligence-capture");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["authorization"]).toBe("Bearer test-jwt");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.recipe.id).toBe("competitor-claims-weekly");
    expect(body.recipe.cadence).toBe("weekly");
    expect(body.findings).toHaveLength(2);
  });

  it("refuses without authentication and never calls the route", async () => {
    await writeConnectorConfig(tmpDir, baseConfig);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const json = await parseToolResult(client, "run_research_recipe", {
      recipe_id: "r1",
      question: "q",
      findings: [{ statement: "s", citations: [{ url: "https://example.gov/x" }] }],
    });

    expect(json.error).toBe("not_authenticated");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("requires at least one finding without reaching the route", async () => {
    await writeConnectorConfig(tmpDir, baseConfig);
    await writeAuth(tmpDir);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    // findings min(1) is enforced at the schema boundary; an empty run must
    // never reach the ingest route.
    const result = await client.callTool({
      name: "run_research_recipe",
      arguments: { recipe_id: "r1", question: "q", findings: [] },
    });
    const text = (result.content as Array<{ text: string }>)[0].text;

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(text).not.toMatch(/"ran":\s*true/);
  });
});
