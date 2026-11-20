/**
 * Keep the Brandcode Studio credential file out of git.
 *
 * `.brand/` is designed to be committed, but `.brand/brandcode-auth.json`
 * holds a long-lived Studio session token. Every path that writes (or finds)
 * credentials calls ensureCredentialsGitignored() so protection does not
 * depend on which tool created `.brand/`:
 *
 *   - `.brand/.gitignore` gets `brandcode-auth.json` — local to `.brand/`, so
 *     it holds even when the project has no root `.gitignore`.
 *   - `<cwd>/.gitignore` gets `.brand/brandcode-auth.json` (the entry
 *     brand_init has always added).
 *
 * Both files are append-if-missing: existing user content is never rewritten.
 */

import { readFile, appendFile } from "node:fs/promises";
import { join } from "node:path";

export const AUTH_FILE_NAME = "brandcode-auth.json";
/** Entry written to `.brand/.gitignore` (relative to `.brand/`). */
export const BRAND_DIR_IGNORE_ENTRY = AUTH_FILE_NAME;
/** Entry written to the project-root `.gitignore`. */
export const ROOT_IGNORE_ENTRY = `.brand/${AUTH_FILE_NAME}`;

/**
 * Append `entry` to the gitignore at `path` unless an equivalent line is
 * already there. Creates the file when missing. Never rewrites existing
 * content — it only appends.
 */
export async function ensureGitignoreEntry(path: string, entry: string): Promise<void> {
  let content = "";
  try {
    content = await readFile(path, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  const equivalents = new Set([entry, `/${entry}`]);
  const present = content
    .split(/\r?\n/)
    .some((line) => equivalents.has(line.trim()));
  if (present) return;

  const prefix = content === "" || content.endsWith("\n") ? "" : "\n";
  await appendFile(path, `${prefix}${entry}\n`, "utf-8");
}

/**
 * Make sure the credential file is gitignored from inside `.brand/` and from
 * the project root. `.brand/` must already exist. The `.brand/.gitignore`
 * write is required (errors propagate); the root entry is best-effort.
 */
export async function ensureCredentialsGitignored(cwd: string): Promise<void> {
  await ensureGitignoreEntry(join(cwd, ".brand", ".gitignore"), BRAND_DIR_IGNORE_ENTRY);
  await ensureGitignoreEntry(join(cwd, ".gitignore"), ROOT_IGNORE_ENTRY).catch(() => {});
}
