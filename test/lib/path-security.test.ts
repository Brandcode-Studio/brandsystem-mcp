import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertPathWithinBase,
  isPathWithinBase,
  isRealPathWithinBase,
  realResolve,
} from "../../src/lib/path-security.js";

describe("path-security", () => {
  it("allows paths within the base directory", () => {
    expect(isPathWithinBase("/workspace/project/file.html", "/workspace/project")).toBe(true);
    expect(isPathWithinBase("/workspace/project/nested/file.html", "/workspace/project")).toBe(true);
  });

  it("rejects sibling paths that only share a prefix", () => {
    expect(isPathWithinBase("/workspace/project-evil/file.html", "/workspace/project")).toBe(false);
  });

  it("rejects parent-directory traversal escapes", () => {
    expect(isPathWithinBase("/workspace/secret.txt", "/workspace/project")).toBe(false);
  });

  it("throws on paths outside the base directory", () => {
    expect(() =>
      assertPathWithinBase("/workspace/project-evil/file.html", "/workspace/project", "../project-evil/file.html")
    ).toThrow(/Path traversal blocked/);
  });
});

describe("path-security (symlink-aware)", () => {
  let root: string;
  let base: string;
  let outside: string;

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), "path-sec-"));
    base = join(root, "base");
    outside = join(root, "outside");
    mkdirSync(base, { recursive: true });
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, "secret.txt"), "secret");
    writeFileSync(join(base, "ok.txt"), "ok");
    // symlink inside base pointing outside it
    symlinkSync(join(outside, "secret.txt"), join(base, "sneaky.txt"));
    symlinkSync(outside, join(base, "sneaky-dir"));
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("accepts real files within the base", () => {
    expect(isRealPathWithinBase(join(base, "ok.txt"), base)).toBe(true);
  });

  it("lexical check alone is fooled by a symlink escape (documents the gap)", () => {
    expect(isPathWithinBase(join(base, "sneaky.txt"), base)).toBe(true);
  });

  it("rejects a file symlink inside base that points outside", () => {
    expect(isRealPathWithinBase(join(base, "sneaky.txt"), base)).toBe(false);
  });

  it("rejects paths routed through a directory symlink escape", () => {
    expect(isRealPathWithinBase(join(base, "sneaky-dir", "secret.txt"), base)).toBe(false);
  });

  it("assertPathWithinBase throws on symlink escapes", () => {
    expect(() => assertPathWithinBase(join(base, "sneaky.txt"), base, "sneaky.txt")).toThrow(
      /symlink escape/
    );
  });

  it("resolves not-yet-existing paths through their deepest existing ancestor", () => {
    const future = join(base, "new-dir", "new-file.txt");
    expect(isRealPathWithinBase(future, base)).toBe(true);
    const futureEscape = join(base, "sneaky-dir", "new-file.txt");
    expect(isRealPathWithinBase(futureEscape, base)).toBe(false);
  });

  it("realResolve returns a stable path for nonexistent targets", () => {
    expect(realResolve(join(base, "nope.txt"))).toContain("nope.txt");
  });
});
