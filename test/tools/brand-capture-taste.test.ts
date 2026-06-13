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

describe("capture_taste tool", () => {
  let tmpDir: string;
  let prevCwd: string;
  let client: Client;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "capture-taste-test-"));
    prevCwd = process.cwd();
    process.chdir(tmpDir);

    const server = createServer();
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "capture-taste-test", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    process.chdir(prevCwd);
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("queues a capture to the taste-capture route with bearer auth", async () => {
    await writeConnectorConfig(tmpDir, baseConfig);
    await writeAuth(tmpDir);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        jsonResponse({ ok: true, routed: "queued", ref: "ledger://acme", quarantined: false, canonicalMutation: false }),
      );

    const json = await parseToolResult(client, "capture_taste", {
      candidate_ref: "variant-851",
      verdict: "distinctive",
      attribute_reason: "The asymmetric crop and editorial caption read as ours, not stock.",
    });

    expect(json.captured).toBe(true);
    expect(json.routed).toBe("queued");
    expect(json.canonical_mutation).toBe(false);
    expect(json.brand).toBe("acme");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://www.brandcode.studio/api/brand/acme/runtime/taste-capture");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["authorization"]).toBe("Bearer test-jwt");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.candidateRef).toBe("variant-851");
    expect(body.verdict).toBe("distinctive");
    expect(body.actor).toBe("owner@acme.com");
  });

  it("refuses without authentication and never calls the route", async () => {
    await writeConnectorConfig(tmpDir, baseConfig);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const json = await parseToolResult(client, "capture_taste", {
      candidate_ref: "variant-852",
      verdict: "generic",
      attribute_reason: "Reads like a template.",
    });

    expect(json.error).toBe("not_authenticated");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses without a connected brand and no explicit brand", async () => {
    await writeAuth(tmpDir);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const json = await parseToolResult(client, "capture_taste", {
      candidate_ref: "variant-853",
      verdict: "flag",
      attribute_reason: "Unsure if the tone fits.",
    });

    expect(json.error).toBe("not_found");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects a blank attribute_reason without reaching the route", async () => {
    await writeConnectorConfig(tmpDir, baseConfig);
    await writeAuth(tmpDir);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    // The required attribute_reason (min length) is enforced at the schema
    // boundary; an empty value must never produce a queued capture.
    const result = await client.callTool({
      name: "capture_taste",
      arguments: { candidate_ref: "variant-854", verdict: "distinctive", attribute_reason: "" },
    });
    const text = (result.content as Array<{ text: string }>)[0].text;

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(text).not.toMatch(/"captured":\s*true/);
  });

  it("targets an explicit brand over the connected one", async () => {
    await writeConnectorConfig(tmpDir, baseConfig);
    await writeAuth(tmpDir);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        jsonResponse({ ok: true, routed: "queued", ref: "ledger://other", quarantined: false, canonicalMutation: false }),
      );

    const json = await parseToolResult(client, "capture_taste", {
      candidate_ref: "x",
      verdict: "distinctive",
      attribute_reason: "Distinctly ours.",
      brand: "other-brand",
    });

    expect(json.brand).toBe("other-brand");
    expect(fetchSpy.mock.calls[0][0]).toBe(
      "https://www.brandcode.studio/api/brand/other-brand/runtime/taste-capture",
    );
  });
});
