import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/server.js";
import {
  writeConnectorConfig,
  readConnectorConfig,
} from "../../src/connectors/brandcode/persistence.js";
import { writeAuthCredentials } from "../../src/lib/auth-state.js";
import {
  invalidateLiveCache,
} from "../../src/connectors/brandcode/live-source.js";
import type { ConnectorConfig } from "../../src/connectors/brandcode/types.js";

// The tool reads auth + connector from `process.cwd()`. Tests drive cwd to a
// temp dir so state is isolated and cleanup is safe.

vi.mock("../../src/connectors/brandcode/client.js", () => ({
  pullHostedBrand: vi.fn(),
  BrandcodeClientError: class extends Error {
    status: number;
    body: string;
    constructor(message: string, status: number, body: string) {
      super(message);
      this.status = status;
      this.body = body;
    }
  },
  fetchHostedBrandConnect: vi.fn(),
  saveBrandToStudio: vi.fn(),
}));

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
    email: "test@example.com",
    token: "test-jwt",
    expiresAt: "2099-01-01T00:00:00.000Z",
    studioUrl: "https://www.brandcode.studio",
  });
}

async function parseToolResult(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as Array<{ type: string; text: string }>;
  return JSON.parse(content[0].text) as Record<string, unknown>;
}

describe("brand_brandcode_live tool", () => {
  let tmpDir: string;
  let prevCwd: string;
  let client: Client;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "live-tool-test-"));
    prevCwd = process.cwd();
    process.chdir(tmpDir);
    invalidateLiveCache();

    const server = createServer({ profile: "full" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    client = new Client({ name: "live-tool-test", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    process.chdir(prevCwd);
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("status mode without connector reports NOT_FOUND", async () => {
    const json = await parseToolResult(client, "brand_brandcode_live", {
      mode: "status",
    });
    expect(json.error).toBe("not_found");
    expect(json.live_mode).toBe(false);
  });

  it("status mode with connector, live off, reports off", async () => {
    await writeConnectorConfig(tmpDir, baseConfig);
    const json = await parseToolResult(client, "brand_brandcode_live", {
      mode: "status",
    });
    expect(json.live_mode).toBe(false);
    expect(json.slug).toBe("acme");
  });

  it("on mode without auth fails with NOT_AUTHENTICATED", async () => {
    await writeConnectorConfig(tmpDir, baseConfig);
    const json = await parseToolResult(client, "brand_brandcode_live", {
      mode: "on",
    });
    expect(json.error).toBe("not_authenticated");
    expect(json.live_mode).toBe(false);
    const after = await readConnectorConfig(tmpDir);
    expect(after?.liveMode).toBeFalsy();
  });

  it("on mode without connector fails with NOT_FOUND", async () => {
    await writeAuth(tmpDir);
    const json = await parseToolResult(client, "brand_brandcode_live", {
      mode: "on",
    });
    expect(json.error).toBe("not_found");
  });

  it("on mode with connector + auth enables live mode with activatedAt", async () => {
    await writeConnectorConfig(tmpDir, baseConfig);
    await writeAuth(tmpDir);

    const json = await parseToolResult(client, "brand_brandcode_live", {
      mode: "on",
    });
    expect(json.live_mode).toBe(true);
    expect(json.slug).toBe("acme");
    expect(json.cache_ttl_seconds).toBe(60);

    const config = await readConnectorConfig(tmpDir);
    expect(config?.liveMode).toBe(true);
    expect(config?.liveModeActivatedAt).toBeTruthy();
    expect(config?.liveCacheTTLSeconds).toBe(60);
  });

  it("on mode respects cache_ttl_seconds override", async () => {
    await writeConnectorConfig(tmpDir, baseConfig);
    await writeAuth(tmpDir);

    const json = await parseToolResult(client, "brand_brandcode_live", {
      mode: "on",
      cache_ttl_seconds: 120,
    });
    expect(json.cache_ttl_seconds).toBe(120);

    const config = await readConnectorConfig(tmpDir);
    expect(config?.liveCacheTTLSeconds).toBe(120);
  });

  it("off mode clears liveMode but preserves other connector fields", async () => {
    await writeConnectorConfig(tmpDir, {
      ...baseConfig,
      liveMode: true,
      liveModeActivatedAt: "2026-04-18T00:00:00.000Z",
      liveCacheTTLSeconds: 60,
    });

    const json = await parseToolResult(client, "brand_brandcode_live", {
      mode: "off",
    });
    expect(json.live_mode).toBe(false);

    const config = await readConnectorConfig(tmpDir);
    expect(config?.liveMode).toBe(false);
    expect(config?.liveModeActivatedAt).toBeUndefined();
    expect(config?.slug).toBe("acme");
    expect(config?.syncToken).toBe("acme:1");
  });

  it("off mode is a no-op with clear messaging when already off", async () => {
    await writeConnectorConfig(tmpDir, baseConfig);
    const json = await parseToolResult(client, "brand_brandcode_live", {
      mode: "off",
    });
    expect(json.live_mode).toBe(false);
    const meta = json._metadata as Record<string, unknown>;
    expect(String(meta.what_happened)).toContain("already off");
  });
});
