/**
 * Vitest globalSetup: fail the run if any test wrote into the repository root.
 *
 * Local tools resolve `.brand/` from process.cwd(), brand_init appends to
 * `.gitignore`, and the install CLI writes `.mcp.json`. A test that creates a
 * server or calls a tool without redirecting cwd to a temp dir (connectWithCwd,
 * vi.spyOn(process, "cwd"), or a `cwd` option on a spawned child) silently
 * dirties the checkout. This snapshots those paths before the run and compares
 * them after it, so the leak fails CI instead of landing in someone's diff.
 */
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, readlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const WATCHED = [".brand", ".gitignore", ".mcp.json"];

type Snapshot = Map<string, string>;

/** Map every file, dir, and symlink under the watched paths to a content fingerprint. */
export function snapshotRepo(root: string = REPO_ROOT, watched: string[] = WATCHED): Snapshot {
  const snapshot: Snapshot = new Map();
  const visit = (rel: string) => {
    const abs = join(root, rel);
    let stat;
    try {
      stat = lstatSync(abs);
    } catch {
      return;
    }
    if (stat.isSymbolicLink()) {
      snapshot.set(rel, `link:${readlinkSync(abs)}`);
    } else if (stat.isDirectory()) {
      snapshot.set(rel, "dir");
      for (const entry of readdirSync(abs).sort()) visit(join(rel, entry));
    } else {
      snapshot.set(rel, createHash("sha256").update(readFileSync(abs)).digest("hex"));
    }
  };
  for (const rel of watched) visit(rel);
  return snapshot;
}

/** Describe the paths that were added, removed, or modified between two snapshots. */
export function diffSnapshots(before: Snapshot, after: Snapshot): string[] {
  const changes: string[] = [];
  for (const [path, hash] of after) {
    if (!before.has(path)) changes.push(`added    ${path}`);
    else if (before.get(path) !== hash) changes.push(`modified ${path}`);
  }
  for (const path of before.keys()) {
    if (!after.has(path)) changes.push(`removed  ${path}`);
  }
  return changes.sort((a, b) => a.slice(9).localeCompare(b.slice(9)));
}

export default function setup() {
  const before = snapshotRepo();
  return () => {
    const changes = diffSnapshots(before, snapshotRepo());
    if (changes.length === 0) return;
    const shown = changes.slice(0, 20).map((c) => `  ${c}`);
    if (changes.length > shown.length) shown.push(`  ...and ${changes.length - shown.length} more`);
    console.error(
      [
        "",
        "Repo guard: tests wrote into the repository root. Redirect cwd to a temp dir",
        '(connectWithCwd in test/helpers.ts, vi.spyOn(process, "cwd"), or a spawn `cwd` option):',
        ...shown,
        "",
      ].join("\n"),
    );
    // Vitest only logs errors thrown from globalSetup teardown ("error during
    // close") and still exits 0, so fail the run through the exit code instead.
    process.exitCode = 1;
  };
}
