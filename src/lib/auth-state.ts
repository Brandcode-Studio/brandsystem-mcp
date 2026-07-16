/**
 * Read/write local auth credentials inside .brand/.
 *
 * File managed:
 *   .brand/brandcode-auth.json — session token + email (gitignored)
 *
 * This file contains secrets and MUST be gitignored.
 * brand_init auto-adds it to .gitignore.
 */

import { readFile, writeFile, unlink, mkdir, rename, chmod } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { AuthCredentials } from "../connectors/brandcode/types.js";

const AUTH_FILE = "brandcode-auth.json";

function authPath(cwd: string): string {
  return join(cwd, ".brand", AUTH_FILE);
}

/**
 * Read stored auth credentials. Returns null if not authenticated.
 */
export async function readAuthCredentials(
  cwd: string,
): Promise<AuthCredentials | null> {
  try {
    const raw = await readFile(authPath(cwd), "utf-8");
    // Tighten files written by versions that predate owner-only mode.
    await chmod(authPath(cwd), 0o600).catch(() => {});
    const creds = JSON.parse(raw) as AuthCredentials;

    // Check expiry
    if (new Date(creds.expiresAt) < new Date()) {
      // Token expired — clean up silently
      await clearAuthCredentials(cwd);
      return null;
    }

    return creds;
  } catch {
    return null;
  }
}

/**
 * Store auth credentials after successful magic link verification.
 */
export async function writeAuthCredentials(
  cwd: string,
  creds: AuthCredentials,
): Promise<void> {
  const dir = join(cwd, ".brand");
  await mkdir(dir, { recursive: true });
  const target = authPath(cwd);
  // Owner-only from the first byte: create a 0600 temp file in the same
  // directory, then atomically rename over the target. A plain writeFile
  // would leave a window where the file exists world-readable or truncated.
  const tmp = join(dir, `.${AUTH_FILE}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    await writeFile(tmp, JSON.stringify(creds, null, 2) + "\n", {
      encoding: "utf-8",
      mode: 0o600,
    });
    await rename(tmp, target);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
  // Tighten a pre-existing file created by older versions with default mode.
  await chmod(target, 0o600).catch(() => {});
}

/**
 * Remove stored auth credentials (logout).
 */
export async function clearAuthCredentials(cwd: string): Promise<void> {
  try {
    await unlink(authPath(cwd));
  } catch {
    // File doesn't exist — that's fine
  }
}
