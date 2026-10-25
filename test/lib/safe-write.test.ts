import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, lstat, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeBrandFileSafe, readBrandFileSafe } from "../../src/lib/safe-write.js";
import {
  writeConnectorConfig,
  appendSyncEvent,
  writePackagePayload,
  readSyncHistory,
} from "../../src/connectors/brandcode/persistence.js";
import { writeApprovalState } from "../../src/lib/approval-state.js";
import type { ConnectorConfig } from "../../src/connectors/brandcode/types.js";

const isWindows = process.platform === "win32";

let root: string;
let cwd: string;
let outside: string;
const ORIGINAL = "# victim file — must never be overwritten\n";

const config: ConnectorConfig = {
  provider: "brandcode",
  brandUrl: "https://www.brandcode.studio/start/brands/acme",
  slug: "acme",
  pullUrl: "https://www.brandcode.studio/api/brand/hosted/acme/pull",
  connectUrl: "https://www.brandcode.studio/api/brand/hosted/acme/connect",
  syncToken: "t1",
  lastSyncedAt: "2026-10-01T00:00:00Z",
  shareTokenRequired: false,
};

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "safe-write-"));
  cwd = join(root, "repo");
  outside = join(root, "home");
  await mkdir(join(cwd, ".brand"), { recursive: true });
  await mkdir(outside, { recursive: true });
  await writeFile(join(outside, "victim.rc"), ORIGINAL);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function plantLink(name: string): Promise<string> {
  const victim = join(outside, "victim.rc");
  await symlink(victim, join(cwd, ".brand", name));
  return victim;
}

describe.skipIf(isWindows)("symlink-safe .brand writes", () => {
  it("writes regular files atomically and leaves no temp files", async () => {
    await writeBrandFileSafe(cwd, "x.json", "{}\n");
    expect(await readFile(join(cwd, ".brand", "x.json"), "utf-8")).toBe("{}\n");
    await writeBrandFileSafe(cwd, "x.json", "{\"a\":1}\n");
    expect(await readBrandFileSafe(cwd, "x.json")).toBe("{\"a\":1}\n");
    const entries = await readdir(join(cwd, ".brand"));
    expect(entries.filter((e) => e.endsWith(".tmp"))).toEqual([]);
  });

  it("refuses to write through a symlinked destination", async () => {
    const victim = await plantLink("x.json");
    await expect(writeBrandFileSafe(cwd, "x.json", "pwned")).rejects.toThrow(/symbolic link|symlink escape/);
    expect(await readFile(victim, "utf-8")).toBe(ORIGINAL);
  });

  it("refuses path escapes", async () => {
    await expect(writeBrandFileSafe(cwd, "../escape.json", "x")).rejects.toThrow(/traversal/);
  });

  it("does not read through a symlink", async () => {
    await plantLink("x.json");
    expect(await readBrandFileSafe(cwd, "x.json")).toBeNull();
  });

  it("brandcode-sync-history.json symlink: appendSyncEvent refuses, target untouched", async () => {
    const victim = await plantLink("brandcode-sync-history.json");
    await expect(
      appendSyncEvent(cwd, {
        timestamp: "2026-10-01T00:00:00Z",
        syncMode: "first_sync",
        changedAreas: ["$(curl evil)"],
        advice: { headline: "h", detail: "d" },
      }),
    ).rejects.toThrow(/symbolic link|symlink escape/);
    expect(await readFile(victim, "utf-8")).toBe(ORIGINAL);
    // The link is not followed for reads either.
    expect(await readSyncHistory(cwd)).toEqual({ events: [] });
  });

  it("brandcode-connector.json symlink: writeConnectorConfig refuses, target untouched", async () => {
    const victim = await plantLink("brandcode-connector.json");
    await expect(writeConnectorConfig(cwd, config)).rejects.toThrow(/symbolic link|symlink escape/);
    expect(await readFile(victim, "utf-8")).toBe(ORIGINAL);
  });

  it("brandcode-package.json symlink: writePackagePayload refuses, target untouched", async () => {
    const victim = await plantLink("brandcode-package.json");
    await expect(
      writePackagePayload(cwd, { slug: "acme" }),
    ).rejects.toThrow(/symbolic link|symlink escape/);
    expect(await readFile(victim, "utf-8")).toBe(ORIGINAL);
  });

  it("approval.json symlink: writeApprovalState refuses, target untouched", async () => {
    const victim = await plantLink("approval.json");
    await expect(
      writeApprovalState(cwd, {
        level: "human_confirmed_local",
        confirmed_at: "2026-10-01T00:00:00Z",
        fingerprint: "abc",
        authority: "local_clarify",
      }),
    ).rejects.toThrow(/symbolic link|symlink escape/);
    expect(await readFile(victim, "utf-8")).toBe(ORIGINAL);
    expect((await lstat(join(cwd, ".brand", "approval.json"))).isSymbolicLink()).toBe(true);
  });

  it("a symlink pointing inside .brand is still never written through", async () => {
    const real = join(cwd, ".brand", "real.json");
    await writeFile(real, "keep\n");
    await symlink(real, join(cwd, ".brand", "link.json"));
    await expect(writeBrandFileSafe(cwd, "link.json", "x")).rejects.toThrow(/symbolic link/);
    expect(await readFile(real, "utf-8")).toBe("keep\n");
  });
});
