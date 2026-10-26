import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { applyProjectDir } from "../../src/lib/project-dir.js";

describe("applyProjectDir (BRANDSYSTEM_PROJECT_DIR)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("is a no-op when unset or empty (MCPB passes '' for an unset option)", () => {
    const chdir = vi.fn();
    expect(applyProjectDir(undefined, chdir)).toBeNull();
    expect(applyProjectDir("   ", chdir)).toBeNull();
    expect(chdir).not.toHaveBeenCalled();
  });

  it("changes into an existing absolute directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "brand-project-"));
    try {
      const chdir = vi.fn();
      expect(applyProjectDir(dir, chdir)).toBe(dir);
      expect(chdir).toHaveBeenCalledWith(dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("expands ~ to the home directory", () => {
    const chdir = vi.fn();
    expect(applyProjectDir("~", chdir)).toBe(homedir());
  });

  it("ignores relative paths, missing paths, and files without throwing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const dir = await mkdtemp(join(tmpdir(), "brand-project-"));
    try {
      const file = join(dir, "not-a-dir.txt");
      await writeFile(file, "x");
      const chdir = vi.fn();
      expect(applyProjectDir("relative/path", chdir)).toBeNull();
      expect(applyProjectDir(join(dir, "missing"), chdir)).toBeNull();
      expect(applyProjectDir(file, chdir)).toBeNull();
      expect(chdir).not.toHaveBeenCalled();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
