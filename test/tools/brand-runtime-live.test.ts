import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/server.js";
import { writeConnectorConfig } from "../../src/connectors/brandcode/persistence.js";
import { invalidateLiveCache } from "../../src/connectors/brandcode/live-source.js";
import type { ConnectorConfig } from "../../src/connectors/brandcode/types.js";

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
import { pullHostedBrand } from "../../src/connectors/brandcode/client.js";
const mockedPull = pullHostedBrand as unknown as ReturnType<typeof vi.fn>;

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

const LOCAL_RUNTIME = {
  version: "1.0.0",
  client_name: "Acme Local",
  compiled_at: "2026-04-18T00:00:00.000Z",
  sessions_completed: 1,
  identity: {
    colors: { primary: "#000000" },
    typography: { heading: "Inter" },
    logo: null,
  },
  visual: null,
  voice: null,
  strategy: null,
};

const HOSTED_RUNTIME = {
  version: "1.0.0",
  client_name: "Acme Live",
  compiled_at: "2026-04-18T00:05:00.000Z",
  sessions_completed: 1,
  identity: {
    colors: { primary: "#ff0000" },
    typography: { heading: "Inter" },
    logo: null,
  },
  visual: null,
  voice: null,
  strategy: null,
};

async function setupBrandDir(tmpDir: string) {
  const brandDir = join(tmpDir, ".brand");
  await mkdir(brandDir, { recursive: true });
  await writeFile(
    join(brandDir, "brand.config.yaml"),
    `schema_version: 1\nsession: 1\nclient_name: Acme Local\ncreated_at: 2026-04-18T00:00:00.000Z\n`,
    "utf-8",
  );
  await writeFile(
    join(brandDir, "brand-runtime.json"),
    JSON.stringify(LOCAL_RUNTIME),
    "utf-8",
  );
}

async function parseToolResult(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as Array<{ type: string; text: string }>;
  return JSON.parse(content[0].text) as Record<string, unknown>;
}

describe("brand_runtime live routing", () => {
  let tmpDir: string;
  let prevCwd: string;
  let client: Client;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "runtime-live-test-"));
    prevCwd = process.cwd();
    process.chdir(tmpDir);
    invalidateLiveCache();
    mockedPull.mockReset();

    await setupBrandDir(tmpDir);

    const server = createServer({ profile: "full" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    client = new Client({ name: "runtime-live-test", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    process.chdir(prevCwd);
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns local runtime when live mode is off", async () => {
    const json = await parseToolResult(client, "brand_runtime", { slice: "full" });
    const runtime = json.runtime as Record<string, unknown>;
    expect(runtime.client_name).toBe("Acme Local");
    expect(json.runtime_origin).toBe("local");
    expect(json.live).toBeUndefined();
    expect(mockedPull).not.toHaveBeenCalled();
  });

  it("returns hosted runtime when live mode is on and fetch succeeds", async () => {
    await writeConnectorConfig(tmpDir, {
      ...baseConfig,
      liveMode: true,
      liveCacheTTLSeconds: 60,
    });

    mockedPull.mockResolvedValueOnce({
      contractVersion: "v1",
      source: "hosted",
      requestedSyncToken: baseConfig.syncToken,
      upToDate: false,
      brand: { slug: "acme", syncToken: "acme:2" } as never,
      delta: null,
      package: { runtime: HOSTED_RUNTIME },
    });

    const json = await parseToolResult(client, "brand_runtime", { slice: "full" });
    const runtime = json.runtime as Record<string, unknown>;
    expect(runtime.client_name).toBe("Acme Live");
    expect(json.runtime_origin).toBe("live");
    const live = json.live as Record<string, unknown>;
    expect(live.live_mode).toBe(true);
    expect(live.data_source).toBe("live");
  });

  it("falls back to local runtime on live fetch error", async () => {
    await writeConnectorConfig(tmpDir, {
      ...baseConfig,
      liveMode: true,
      liveCacheTTLSeconds: 60,
    });

    mockedPull.mockRejectedValueOnce(new Error("connection refused"));

    const json = await parseToolResult(client, "brand_runtime", { slice: "full" });
    const runtime = json.runtime as Record<string, unknown>;
    expect(runtime.client_name).toBe("Acme Local");
    expect(json.runtime_origin).toBe("local");
    const live = json.live as Record<string, unknown>;
    expect(live.data_source).toBe("local-fallback");
    expect(live.fallback_reason).toContain("connection refused");
  });

  it("surfaces live_mode indicator even when extraction falls back to local", async () => {
    await writeConnectorConfig(tmpDir, {
      ...baseConfig,
      liveMode: true,
      liveCacheTTLSeconds: 60,
    });

    mockedPull.mockResolvedValueOnce({
      contractVersion: "v1",
      source: "hosted",
      requestedSyncToken: baseConfig.syncToken,
      upToDate: false,
      brand: { slug: "acme", syncToken: "acme:2" } as never,
      delta: null,
      package: { unexpected: "shape-has-no-runtime" },
    });

    const json = await parseToolResult(client, "brand_runtime", { slice: "full" });
    expect(json.runtime_origin).toBe("local");
    const runtime = json.runtime as Record<string, unknown>;
    expect(runtime.client_name).toBe("Acme Local");
    expect(json.live).toBeDefined();
  });
});
