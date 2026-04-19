import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { connectWithCwd, callTool } from "../helpers.js";
import {
  writeConnectorConfig,
  appendSyncEvent,
  writePackagePayload,
} from "../../src/connectors/brandcode/persistence.js";
import { BrandDir } from "../../src/lib/brand-dir.js";
import type { ConnectorConfig } from "../../src/connectors/brandcode/types.js";

const makeConnectorConfig = (
  overrides?: Partial<ConnectorConfig>,
): ConnectorConfig => ({
  provider: "brandcode",
  brandUrl: "https://brandcode.studio/start/brands/pendium",
  slug: "pendium",
  pullUrl: "https://brandcode.studio/api/brand/hosted/pendium/pull",
  connectUrl: "https://brandcode.studio/api/brand/hosted/pendium/connect",
  syncToken: "pendium:3:2026-04-05T22:00:00.000Z",
  lastSyncedAt: "2026-04-05T22:00:00.000Z",
  shareTokenRequired: false,
  ...overrides,
});

describe("brand_brandcode_status tool", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "brand-status-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
    vi.restoreAllMocks();
  });

  it("returns NOT_FOUND when no connector exists", async () => {
    // Create a minimal .brand/ so server can initialize
    const brandDir = new BrandDir(tmpDir);
    await brandDir.initBrand({
      schema_version: "0.1.0",
      session: 1,
      client_name: "Test",
      created_at: new Date().toISOString(),
    });

    const { client, cleanup } = await connectWithCwd(tmpDir);
    const result = await callTool(client, "brand_brandcode_status");

    expect(result.error).toBe("not_found");
    expect(result._metadata).toBeDefined();
    await cleanup();
  });

  it("returns connector details when connected", async () => {
    // Set up .brand/ with connector
    const brandDir = new BrandDir(tmpDir);
    await brandDir.initBrand({
      schema_version: "0.1.0",
      session: 1,
      client_name: "Pendium",
      created_at: new Date().toISOString(),
    });
    await writeConnectorConfig(tmpDir, makeConnectorConfig());
    await appendSyncEvent(tmpDir, {
      timestamp: "2026-04-05T22:00:00.000Z",
      syncMode: "first_sync",
      changedAreas: ["full package"],
      advice: {
        headline: 'Connected to "Pendium"',
        detail: "Brand pulled successfully.",
      },
    });

    const { client, cleanup } = await connectWithCwd(tmpDir);
    const result = await callTool(client, "brand_brandcode_status");

    expect(result.error).toBeUndefined();
    expect(result.connector).toBeDefined();
    const connector = result.connector as ConnectorConfig;
    expect(connector.slug).toBe("pendium");
    expect(connector.syncToken).toBe("pendium:3:2026-04-05T22:00:00.000Z");
    expect(result.sync_count).toBe(1);
    expect(result.has_package).toBe(false);
    expect(result.brandcode_mcp_available).toBe(false);
    expect(result.brandcode_mcp_phase).toBe("phase_0_locked");
    expect(result.brandcode_mcp_url).toBe(
      "https://mcp.brandcode.studio/pendium",
    );
    expect(result.brandcode_mcp_tools).toEqual([
      "brand_runtime",
      "brand_search",
      "brand_check",
      "brand_status",
      "list_brand_assets",
      "get_brand_asset",
      "brand_feedback",
      "brand_history",
    ]);
    await cleanup();
  });

  it("includes package info when package exists", async () => {
    const brandDir = new BrandDir(tmpDir);
    await brandDir.initBrand({
      schema_version: "0.1.0",
      session: 1,
      client_name: "Pendium",
      created_at: new Date().toISOString(),
    });
    await writeConnectorConfig(tmpDir, makeConnectorConfig());
    await writePackagePayload(tmpDir, {
      slug: "pendium",
      brandData: {
        narratives: [{ id: "N-001" }, { id: "N-002" }],
        assets: [{ name: "logo.svg" }],
      },
      brandInstance: {
        readiness: { stage: "usable" },
        capabilities: { enabled: ["content", "preflight"] },
      },
    });

    const { client, cleanup } = await connectWithCwd(tmpDir);
    const result = await callTool(client, "brand_brandcode_status");

    expect(result.has_package).toBe(true);
    const status = result.status as string;
    expect(status).toContain("pendium");
    expect(status).toContain(".brand/brandcode-package.json");
    expect(status).toContain("Brandcode MCP");
    expect(status).toContain("https://mcp.brandcode.studio/pendium");
    await cleanup();
  });

  it("shows recent sync history events", async () => {
    const brandDir = new BrandDir(tmpDir);
    await brandDir.initBrand({
      schema_version: "0.1.0",
      session: 1,
      client_name: "Test",
      created_at: new Date().toISOString(),
    });
    await writeConnectorConfig(tmpDir, makeConnectorConfig());

    await appendSyncEvent(tmpDir, {
      timestamp: "2026-04-05T20:00:00.000Z",
      syncMode: "first_sync",
      changedAreas: ["full package"],
      advice: { headline: "Connected", detail: "" },
    });
    await appendSyncEvent(tmpDir, {
      timestamp: "2026-04-05T21:00:00.000Z",
      syncMode: "no_change",
      changedAreas: [],
      advice: { headline: "Up to date", detail: "" },
    });
    await appendSyncEvent(tmpDir, {
      timestamp: "2026-04-05T22:00:00.000Z",
      syncMode: "updated",
      changedAreas: ["Assets 10 -> 12"],
      advice: { headline: "Updated", detail: "" },
    });

    const { client, cleanup } = await connectWithCwd(tmpDir);
    const result = await callTool(client, "brand_brandcode_status");

    expect(result.sync_count).toBe(3);
    const lastSync = result.last_sync as { syncMode: string };
    expect(lastSync.syncMode).toBe("updated");
    await cleanup();
  });
});
