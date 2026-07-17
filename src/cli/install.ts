/**
 * `install` subcommand — write the standard MCP client config for this
 * package.
 *
 * Safety model:
 *   - Default is DRY-RUN: print exactly what would be written and where.
 *   - --write is required to touch disk. When the target exists it is
 *     deep-merged (every existing key preserved; only
 *     mcpServers.brandsystem is added/replaced) and the original is
 *     copied to <file>.backup-<timestamp> first.
 *   - An existing file that is not valid JSON is never overwritten.
 */

import { readFile, writeFile, copyFile, mkdir, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import type { ToolProfile } from "../lib/tool-profile.js";

export const INSTALL_CLIENTS = [
  "claude-code",
  "cursor",
  "windsurf",
  "claude-desktop",
] as const;

export type InstallClient = (typeof INSTALL_CLIENTS)[number];

export interface McpServerEntry {
  command: string;
  args: string[];
}

export interface InstallOptions {
  client: string;
  write: boolean;
  profile: ToolProfile;
  cwd: string;
  /** Overridable for tests. Defaults to os.homedir(). */
  home?: string;
  /** Overridable for tests. Defaults to process.platform. */
  platform?: NodeJS.Platform;
}

export function isInstallClient(value: string): value is InstallClient {
  return (INSTALL_CLIENTS as readonly string[]).includes(value);
}

/** Build the mcpServers.brandsystem entry for a given profile. */
export function buildServerEntry(profile: ToolProfile): McpServerEntry {
  const args = ["-y", "@brandsystem/mcp"];
  if (profile === "full") args.push("--profile=full");
  return { command: "npx", args };
}

/** Resolve where the MCP config lives for each supported client. */
export function resolveConfigPath(
  client: InstallClient,
  cwd: string,
  home: string = homedir(),
  platform: NodeJS.Platform = process.platform,
): string {
  switch (client) {
    case "claude-code":
      return join(cwd, ".mcp.json");
    case "cursor":
      return join(cwd, ".cursor", "mcp.json");
    case "windsurf":
      return join(home, ".codeium", "windsurf", "mcp_config.json");
    case "claude-desktop": {
      if (platform === "darwin") {
        return join(
          home,
          "Library",
          "Application Support",
          "Claude",
          "claude_desktop_config.json",
        );
      }
      if (platform === "win32") {
        const appData =
          process.env.APPDATA ?? join(home, "AppData", "Roaming");
        return join(appData, "Claude", "claude_desktop_config.json");
      }
      return join(home, ".config", "Claude", "claude_desktop_config.json");
    }
  }
}

/**
 * Merge the brandsystem server entry into an existing config file's raw
 * contents. Preserves every existing key (including other servers under
 * mcpServers); only mcpServers.brandsystem is added or replaced.
 *
 * Throws when existingRaw is present but not valid JSON, or when its top
 * level is not an object — the caller must refuse to write in that case.
 */
export function mergeMcpConfig(
  existingRaw: string | null,
  entry: McpServerEntry,
): Record<string, unknown> {
  if (existingRaw === null) {
    return { mcpServers: { brandsystem: entry } };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(existingRaw);
  } catch (err) {
    throw new Error(
      `existing config is not valid JSON (${(err as Error).message}) — fix or remove it manually; refusing to overwrite`,
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      "existing config is not a JSON object — fix or remove it manually; refusing to overwrite",
    );
  }

  const existing = parsed as Record<string, unknown>;
  const servers =
    existing.mcpServers !== null &&
    typeof existing.mcpServers === "object" &&
    !Array.isArray(existing.mcpServers)
      ? (existing.mcpServers as Record<string, unknown>)
      : {};

  return {
    ...existing,
    mcpServers: {
      ...servers,
      brandsystem: entry,
    },
  };
}

async function readIfExists(path: string): Promise<string | null> {
  try {
    await access(path);
  } catch {
    return null;
  }
  return readFile(path, "utf-8");
}

function backupTimestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

/**
 * Run the install command. Returns the exit code.
 * Dry-run by default; pass write: true to apply.
 */
export async function runInstall(opts: InstallOptions): Promise<number> {
  if (!isInstallClient(opts.client)) {
    console.error(
      `Error: Unknown client "${opts.client}". Supported: ${INSTALL_CLIENTS.join(", ")}`,
    );
    return 1;
  }

  const target = resolveConfigPath(
    opts.client,
    opts.cwd,
    opts.home,
    opts.platform,
  );
  const entry = buildServerEntry(opts.profile);
  const existingRaw = await readIfExists(target);

  let merged: Record<string, unknown>;
  try {
    merged = mergeMcpConfig(existingRaw, entry);
  } catch (err) {
    console.error(`Error: ${target}: ${(err as Error).message}`);
    return 1;
  }

  const output = JSON.stringify(merged, null, 2) + "\n";

  if (!opts.write) {
    console.log(`Dry run — nothing was written.`);
    console.log(``);
    console.log(`Target file (${opts.client}):`);
    console.log(`  ${target}`);
    console.log(``);
    console.log(
      existingRaw === null
        ? `The file does not exist yet; it would be created with:`
        : `The file exists; it would be backed up and merged to:`,
    );
    console.log(output.trimEnd());
    console.log(``);
    console.log(`Re-run with --write to apply.`);
    return 0;
  }

  if (existingRaw !== null) {
    const backupPath = `${target}.backup-${backupTimestamp()}`;
    await copyFile(target, backupPath);
    console.log(`Backed up existing config to ${backupPath}`);
  } else {
    await mkdir(dirname(target), { recursive: true });
  }

  await writeFile(target, output, "utf-8");
  console.log(`Wrote "brandsystem" server entry to ${target}`);
  if (opts.client === "claude-desktop") {
    console.log(`Restart Claude Desktop to pick up the new server.`);
  }
  return 0;
}
