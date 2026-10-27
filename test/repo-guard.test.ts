import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diffSnapshots, snapshotRepo } from "./repo-guard.js";

describe("repo guard snapshot", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "repo-guard-"));
    writeFileSync(join(root, ".gitignore"), "node_modules/\n");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("reports nothing when the watched paths are untouched", () => {
    const before = snapshotRepo(root);
    expect(diffSnapshots(before, snapshotRepo(root))).toEqual([]);
  });

  it("catches a new .brand/ tree and an appended .gitignore", () => {
    const before = snapshotRepo(root);
    mkdirSync(join(root, ".brand", "exports"), { recursive: true });
    writeFileSync(join(root, ".brand", "tokens.json"), "{}");
    appendFileSync(join(root, ".gitignore"), ".brand/brandcode-auth.json\n");

    expect(diffSnapshots(before, snapshotRepo(root))).toEqual([
      "added    .brand",
      "added    .brand/exports",
      "added    .brand/tokens.json",
      "modified .gitignore",
    ]);
  });

  it("tolerates a pre-existing .brand/ as long as it is left alone", () => {
    mkdirSync(join(root, ".brand"));
    writeFileSync(join(root, ".brand", "brand.config.yaml"), "client_name: Local\n");
    const before = snapshotRepo(root);
    expect(diffSnapshots(before, snapshotRepo(root))).toEqual([]);

    rmSync(join(root, ".brand", "brand.config.yaml"));
    expect(diffSnapshots(before, snapshotRepo(root))).toEqual(["removed  .brand/brand.config.yaml"]);
  });

  it("ignores paths outside the watched set", () => {
    const before = snapshotRepo(root);
    writeFileSync(join(root, "unrelated.txt"), "x");
    expect(diffSnapshots(before, snapshotRepo(root))).toEqual([]);
  });
});
