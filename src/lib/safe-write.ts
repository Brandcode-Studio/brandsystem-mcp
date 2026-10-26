/**
 * Symlink-safe writes and reads for .brand/ sidecar files.
 *
 * A cloned repository can ship `.brand/<file>` as a symlink to anything the
 * user can write (`~/.zshrc`, `~/.ssh/config`, ...). A plain `writeFile`
 * follows that link and overwrites the target. These helpers:
 *
 *   1. resolve the destination through BrandDir's containment guard
 *      (`assertPathWithinBase`, realpath-aware) so neither `.brand/` nor any
 *      intermediate component can escape the brand directory;
 *   2. refuse when the destination itself is a symlink (or not a regular
 *      file);
 *   3. write to an exclusive temp file in the same directory and atomically
 *      rename it over the destination — `rename` replaces a directory entry
 *      and never writes through a link.
 */

import { lstat, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { assertPathWithinBase } from "./path-security.js";

function brandPath(cwd: string): string {
  return join(cwd, ".brand");
}

function guardedTarget(cwd: string, filename: string): string {
  const base = brandPath(cwd);
  return assertPathWithinBase(join(base, filename), base, filename);
}

/** Refuse a destination that exists as anything other than a regular file. */
async function assertNotLink(target: string, filename: string): Promise<void> {
  try {
    const st = await lstat(target);
    if (st.isSymbolicLink()) {
      throw new Error(`Refusing to write .brand/${filename}: it is a symbolic link`);
    }
    if (!st.isFile()) {
      throw new Error(`Refusing to write .brand/${filename}: it is not a regular file`);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
}

/**
 * Write `.brand/<filename>` atomically without following symlinks.
 * Throws if the path escapes `.brand/` or the destination is a symlink.
 */
export async function writeBrandFileSafe(
  cwd: string,
  filename: string,
  content: string | Uint8Array,
  options?: { mode?: number },
): Promise<void> {
  const dir = brandPath(cwd);
  await mkdir(dir, { recursive: true });
  const target = guardedTarget(cwd, filename);
  await assertNotLink(target, filename);

  const tmp = join(dir, `.${filename.replace(/[\\/]/g, "_")}.${randomBytes(6).toString("hex")}.tmp`);
  // "wx" = O_CREAT | O_EXCL: fails rather than following a pre-planted link.
  const handle = await open(tmp, "wx", options?.mode ?? 0o644);
  try {
    await handle.writeFile(content, typeof content === "string" ? "utf-8" : undefined);
    await handle.close();
    // Re-check immediately before the swap to narrow the race window; rename
    // itself never writes through a link even if one appears afterwards.
    await assertNotLink(target, filename);
    await rename(tmp, target);
  } catch (err) {
    await handle.close().catch(() => {});
    await unlink(tmp).catch(() => {});
    throw err;
  }
}

/**
 * Read `.brand/<filename>` as UTF-8, refusing symlinks and escapes.
 * Returns null when the file is absent, a symlink, or unreadable.
 */
export async function readBrandFileSafe(
  cwd: string,
  filename: string,
): Promise<string | null> {
  try {
    const target = guardedTarget(cwd, filename);
    const st = await lstat(target);
    if (!st.isFile()) return null;
    return await readFile(target, "utf-8");
  } catch {
    return null;
  }
}
