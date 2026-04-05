import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  readConnectorConfig,
  writeConnectorConfig,
  readSyncHistory,
  appendSyncEvent,
  readPackagePayload,
  writePackagePayload,
} from "../../src/connectors/brandcode/persistence.js";
import type {
  ConnectorConfig,
  SyncHistoryEvent,
} from "../../src/connectors/brandcode/types.js";

describe("Brandcode connector persistence", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "brand-connector-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  // ── Connector config ────────────────

  it("readConnectorConfig returns null when no file exists", async () => {
    const config = await readConnectorConfig(tmpDir);
    expect(config).toBeNull();
  });

  it("writeConnectorConfig creates .brand/brandcode-connector.json", async () => {
    const config: ConnectorConfig = {
      provider: "brandcode",
      brandUrl: "https://brandcode.studio/start/brands/pendium",
      slug: "pendium",
      pullUrl: "https://brandcode.studio/api/brand/hosted/pendium/pull",
      connectUrl:
        "https://brandcode.studio/api/brand/hosted/pendium/connect",
      syncToken: "pendium:3:2026-04-05T22:00:00.000Z",
      lastSyncedAt: "2026-04-05T22:00:00.000Z",
      shareTokenRequired: false,
    };

    await writeConnectorConfig(tmpDir, config);

    const raw = await readFile(
      join(tmpDir, ".brand", "brandcode-connector.json"),
      "utf-8",
    );
    const parsed = JSON.parse(raw);
    expect(parsed.provider).toBe("brandcode");
    expect(parsed.slug).toBe("pendium");
    expect(parsed.syncToken).toBe("pendium:3:2026-04-05T22:00:00.000Z");
  });

  it("readConnectorConfig round-trips correctly", async () => {
    const config: ConnectorConfig = {
      provider: "brandcode",
      brandUrl: "https://brandcode.studio/start/brands/test",
      slug: "test",
      pullUrl: "https://brandcode.studio/api/brand/hosted/test/pull",
      connectUrl: "https://brandcode.studio/api/brand/hosted/test/connect",
      syncToken: "test:1:2026-04-05T00:00:00.000Z",
      lastSyncedAt: "2026-04-05T00:00:00.000Z",
      shareTokenRequired: true,
    };

    await writeConnectorConfig(tmpDir, config);
    const read = await readConnectorConfig(tmpDir);
    expect(read).toEqual(config);
  });

  // ── Sync history ────────────────────

  it("readSyncHistory returns empty events when no file exists", async () => {
    const history = await readSyncHistory(tmpDir);
    expect(history.events).toEqual([]);
  });

  it("appendSyncEvent creates history file and adds event", async () => {
    const event: SyncHistoryEvent = {
      timestamp: "2026-04-05T22:00:00.000Z",
      syncMode: "first_sync",
      changedAreas: ["tokens", "narratives"],
      advice: {
        headline: "Brand pulled successfully",
        detail: "Review the imported brand data.",
      },
    };

    await appendSyncEvent(tmpDir, event);

    const history = await readSyncHistory(tmpDir);
    expect(history.events).toHaveLength(1);
    expect(history.events[0].syncMode).toBe("first_sync");
    expect(history.events[0].changedAreas).toEqual([
      "tokens",
      "narratives",
    ]);
  });

  it("appendSyncEvent appends to existing history", async () => {
    await appendSyncEvent(tmpDir, {
      timestamp: "2026-04-05T22:00:00.000Z",
      syncMode: "first_sync",
      changedAreas: ["full package"],
      advice: { headline: "Connected", detail: "First pull." },
    });
    await appendSyncEvent(tmpDir, {
      timestamp: "2026-04-05T23:00:00.000Z",
      syncMode: "no_change",
      changedAreas: [],
      advice: { headline: "Up to date", detail: "No changes." },
    });

    const history = await readSyncHistory(tmpDir);
    expect(history.events).toHaveLength(2);
    expect(history.events[0].syncMode).toBe("first_sync");
    expect(history.events[1].syncMode).toBe("no_change");
  });

  it("appendSyncEvent enforces max history size", async () => {
    // Write 55 events (max is 50)
    for (let i = 0; i < 55; i++) {
      await appendSyncEvent(tmpDir, {
        timestamp: `2026-04-05T${String(i).padStart(2, "0")}:00:00.000Z`,
        syncMode: "no_change",
        changedAreas: [],
        advice: { headline: `Event ${i}`, detail: "" },
      });
    }

    const history = await readSyncHistory(tmpDir);
    expect(history.events).toHaveLength(50);
    // Should keep the most recent 50
    expect(history.events[0].advice.headline).toBe("Event 5");
    expect(history.events[49].advice.headline).toBe("Event 54");
  });

  // ── Package payload ─────────────────

  it("readPackagePayload returns null when no file exists", async () => {
    const pkg = await readPackagePayload(tmpDir);
    expect(pkg).toBeNull();
  });

  it("writePackagePayload creates .brand/brandcode-package.json", async () => {
    const payload = {
      slug: "pendium",
      brandData: { manifest: { name: "Pendium" } },
      brandInstance: { tokens: { colors: [] } },
    };

    await writePackagePayload(tmpDir, payload);

    const raw = await readFile(
      join(tmpDir, ".brand", "brandcode-package.json"),
      "utf-8",
    );
    const parsed = JSON.parse(raw);
    expect(parsed.slug).toBe("pendium");
    expect(parsed.brandData.manifest.name).toBe("Pendium");
  });

  it("readPackagePayload round-trips correctly", async () => {
    const payload = {
      slug: "test",
      brandData: { narratives: [{ id: "N-001" }] },
    };

    await writePackagePayload(tmpDir, payload);
    const read = await readPackagePayload(tmpDir);
    expect(read).toEqual(payload);
  });

  it("writePackagePayload overwrites existing package", async () => {
    await writePackagePayload(tmpDir, { slug: "v1", version: 1 });
    await writePackagePayload(tmpDir, { slug: "v2", version: 2 });

    const read = await readPackagePayload(tmpDir);
    expect(read).toEqual({ slug: "v2", version: 2 });
  });
});
