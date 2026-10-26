import { statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

/**
 * Optional project directory for the stdio server (BRANDSYSTEM_PROJECT_DIR).
 *
 * Every tool resolves `.brand/` from process.cwd(). Hosts that launch the
 * server without a meaningful working directory — Claude Desktop starts
 * bundled (MCPB) servers from the app's own location — need a way to point
 * the server at the folder that holds (or will hold) `.brand/`. The MCPB
 * manifest maps a directory picker onto this variable.
 *
 * Unset/empty: no-op (cwd stays as launched). Invalid: logged to stderr and
 * ignored, never fatal — the server still starts.
 */
export function applyProjectDir(
  raw: string | undefined = process.env.BRANDSYSTEM_PROJECT_DIR,
  chdir: (dir: string) => void = (dir) => process.chdir(dir),
): string | null {
  const value = raw?.trim();
  if (!value) return null;

  const expanded = value === "~" ? homedir() : value.startsWith("~/") ? join(homedir(), value.slice(2)) : value;
  if (!isAbsolute(expanded)) {
    console.error(`[brandsystem-mcp] BRANDSYSTEM_PROJECT_DIR must be an absolute path — ignoring it.`);
    return null;
  }
  const dir = resolve(expanded);
  try {
    if (!statSync(dir).isDirectory()) {
      console.error(`[brandsystem-mcp] BRANDSYSTEM_PROJECT_DIR is not a directory — ignoring it.`);
      return null;
    }
    chdir(dir);
    return dir;
  } catch {
    console.error(`[brandsystem-mcp] BRANDSYSTEM_PROJECT_DIR is not accessible — ignoring it.`);
    return null;
  }
}
