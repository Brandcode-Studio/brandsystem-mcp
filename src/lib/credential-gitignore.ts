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
 * Both files are append-if-missing: existing user content is never rewritten,
 * and a symlinked ignore file is never written through.
 *
 * Line presence is not proof: a later negation (`!*.json`) re-includes the
 * file. Inside a git work tree, git itself decides — if it would not ignore
 * the file, the entry is appended as the last rule of `.brand/.gitignore`
 * (last match wins, and the nested file outranks the root one); if git still
 * would not ignore it, CredentialGitignoreError is thrown so the caller never
 * writes a token git would commit.
 */

import { appendFile, lstat, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { readBrandFileSafe, writeBrandFileSafe } from "./safe-write.js";

export const AUTH_FILE_NAME = "brandcode-auth.json";
/** Entry written to `.brand/.gitignore` (relative to `.brand/`). */
export const BRAND_DIR_IGNORE_ENTRY = AUTH_FILE_NAME;
/** Entry written to the project-root `.gitignore`; also the cwd-relative path git checks. */
export const ROOT_IGNORE_ENTRY = `.brand/${AUTH_FILE_NAME}`;

export class CredentialGitignoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CredentialGitignoreError";
  }
}

// ---------------------------------------------------------------------------
// git (argument vector, no shell)
// ---------------------------------------------------------------------------

export interface GitResult {
  /** Process exit code; null when git could not be run at all. */
  code: number | null;
  stdout: string;
}

/**
 * Run git with an argument vector (no shell). Never rejects. Repository
 * location overrides are dropped so git discovers the repo from `cwd`
 * (e.g. when running from inside a git hook that exports GIT_DIR).
 */
export function runGit(cwd: string, args: string[]): Promise<GitResult> {
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0" };
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR"]) {
    delete env[key];
  }
  return new Promise((resolve) => {
    execFile("git", args, { cwd, timeout: 10_000, windowsHide: true, env }, (err, stdout) => {
      if (!err) return resolve({ code: 0, stdout: String(stdout) });
      const code = (err as { code?: unknown }).code;
      resolve({ code: typeof code === "number" ? code : null, stdout: String(stdout ?? "") });
    });
  });
}

export type IgnoreVerdict = "ignored" | "not_ignored" | "unknown";

/**
 * Ask git whether it would ignore `.brand/brandcode-auth.json` under `cwd`.
 * `--no-index` evaluates the rules even if the file is already tracked.
 * "unknown" covers "not a git work tree" and "git unavailable".
 */
export async function credentialIgnoreVerdict(cwd: string): Promise<IgnoreVerdict> {
  const res = await runGit(cwd, ["check-ignore", "-q", "--no-index", "--", ROOT_IGNORE_ENTRY]);
  if (res.code === 0) return "ignored";
  if (res.code === 1) return "not_ignored";
  return "unknown";
}

/** The rule git says decides the credential path (`source:line:pattern`), if any. */
export async function decidingIgnoreRule(cwd: string): Promise<string | null> {
  const res = await runGit(cwd, ["check-ignore", "-v", "--no-index", "--", ROOT_IGNORE_ENTRY]);
  const line = res.stdout.split("\n")[0]?.split("\t")[0]?.trim();
  return line ? line.slice(0, 200) : null;
}

// ---------------------------------------------------------------------------
// Ignore-file writes
// ---------------------------------------------------------------------------

function hasEntry(content: string, entry: string): boolean {
  const equivalents = new Set([entry, `/${entry}`]);
  return content.split(/\r?\n/).some((line) => equivalents.has(line.trim()));
}

function lastRule(content: string): string | undefined {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .pop();
}

function appended(content: string, entry: string): string {
  const prefix = content === "" || content.endsWith("\n") ? "" : "\n";
  return `${content}${prefix}${entry}\n`;
}

/**
 * Append `entry` to the gitignore at `path` unless an equivalent line is
 * already there. Creates the file when missing; never rewrites existing
 * content and never writes through a symlink (a symlinked file is skipped).
 */
export async function ensureGitignoreEntry(path: string, entry: string): Promise<void> {
  let content = "";
  try {
    const st = await lstat(path);
    if (!st.isFile()) return;
    content = await readFile(path, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  if (hasEntry(content, entry)) return;
  const prefix = content === "" || content.endsWith("\n") ? "" : "\n";
  await appendFile(path, `${prefix}${entry}\n`, "utf-8");
}

/**
 * Add the credential entry to `.brand/.gitignore` (symlink-safe). With
 * `asLastRule`, append it even if present earlier so it outranks any later
 * negation in the same file.
 */
async function writeBrandIgnoreEntry(cwd: string, asLastRule: boolean): Promise<void> {
  const content = (await readBrandFileSafe(cwd, ".gitignore")) ?? "";
  const done = asLastRule
    ? lastRule(content) === BRAND_DIR_IGNORE_ENTRY
    : hasEntry(content, BRAND_DIR_IGNORE_ENTRY);
  if (done) return;
  await writeBrandFileSafe(cwd, ".gitignore", appended(content, BRAND_DIR_IGNORE_ENTRY));
}

/**
 * Make sure git will not pick up `.brand/brandcode-auth.json`. `.brand/`
 * must already exist. Throws CredentialGitignoreError when the directory is
 * in a git work tree and no entry we can write makes git ignore the file.
 */
export async function ensureCredentialsGitignored(cwd: string): Promise<void> {
  // A symlinked/unwritable .brand/.gitignore is left alone; git decides below.
  await writeBrandIgnoreEntry(cwd, false).catch(() => {});
  await ensureGitignoreEntry(join(cwd, ".gitignore"), ROOT_IGNORE_ENTRY).catch(() => {});

  // Outside a work tree (or without git) nothing can commit the file.
  if ((await credentialIgnoreVerdict(cwd)) !== "not_ignored") return;

  // A later rule re-includes it (e.g. "!*.json"): make ours the last word.
  await writeBrandIgnoreEntry(cwd, true).catch(() => {});
  if ((await credentialIgnoreVerdict(cwd)) !== "not_ignored") return;

  const rule = await decidingIgnoreRule(cwd);
  throw new CredentialGitignoreError(
    `Refusing to store Studio credentials: git would commit ${ROOT_IGNORE_ENTRY}` +
      (rule ? ` because the ignore rule ${rule} re-includes it` : " and no ignore entry could be added") +
      `. Remove or narrow that rule (a symlinked .brand/.gitignore is not read by git — replace it with a regular file containing "${BRAND_DIR_IGNORE_ENTRY}"), then sign in again.`,
  );
}
