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
 *   - The package spec is pinned to the running version
 *     (`@brandsystem/mcp@<version>`) so a project-level config committed to a
 *     repo never auto-executes a future publish. `--unpinned` opts into the
 *     floating latest spec explicitly.
 */

import { readFile, writeFile, copyFile, mkdir, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import type { ToolProfile } from "../lib/tool-profile.js";
import { getVersion } from "../lib/version.js";

export const PACKAGE_NAME = "@brandsystem/mcp";

export const INSTALL_CLIENTS = [
  "claude-code",
  "cline",
  "codex",
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
  /** Overridable for tests. Runs the official Codex CLI for Codex installs. */
  commandRunner?: CommandRunner;
  /** Write the floating `@brandsystem/mcp` spec instead of pinning the version. */
  unpinned?: boolean;
  /** Overridable for tests. Defaults to the running package version. */
  version?: string;
}

export type CommandRunner = (
  command: string,
  args: string[],
) => Promise<number>;

export function isInstallClient(value: string): value is InstallClient {
  return (INSTALL_CLIENTS as readonly string[]).includes(value);
}

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * The npm spec written into client configs: pinned to the running version by
 * default (`@brandsystem/mcp@1.2.3`), or the floating `@brandsystem/mcp` when
 * `unpinned` is set.
 */
export function packageSpec(opts: { unpinned?: boolean; version?: string } = {}): string {
  if (opts.unpinned) return PACKAGE_NAME;
  const version = opts.version ?? getVersion();
  if (!SEMVER.test(version)) {
    throw new Error(`Cannot pin ${PACKAGE_NAME}: invalid version "${version}". Use --unpinned to write the floating spec.`);
  }
  return `${PACKAGE_NAME}@${version}`;
}

/** Build the mcpServers.brandsystem entry for a given profile. */
export function buildServerEntry(
  profile: ToolProfile,
  spec: string = packageSpec(),
): McpServerEntry {
  const args = ["-y", spec];
  if (profile === "full") args.push("--profile=full");
  return { command: "npx", args };
}

/** Build the official `codex mcp add` invocation for this package. */
export function buildCodexAddArgs(
  profile: ToolProfile,
  spec: string = packageSpec(),
): string[] {
  const serverArgs = ["npx", "-y", spec];
  if (profile === "full") serverArgs.push("--profile=full");
  return ["mcp", "add", "brandsystem", "--", ...serverArgs];
}

/** Build the official `cline mcp install` invocation for this package. */
export function buildClineInstallArgs(
  profile: ToolProfile,
  spec: string = packageSpec(),
): string[] {
  const serverArgs = ["npx", "-y", spec];
  if (profile === "full") serverArgs.push("--profile=full");
  return ["mcp", "install", "brandsystem", "--yes", "--", ...serverArgs];
}

function pinningNote(spec: string, unpinned: boolean | undefined): string {
  return unpinned
    ? `Using the floating spec ${spec}: every launch runs whatever version is latest on npm. Omit --unpinned to pin the current version.`
    : `Pinned to ${spec}. To upgrade, re-run install from a newer version; pass --unpinned to track the latest release instead (not recommended for configs committed to a repository).`;
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
    case "cline":
      return join(
        home,
        ".cline",
        "data",
        "settings",
        "cline_mcp_settings.json",
      );
    case "codex":
      return join(home, ".codex", "config.toml");
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

async function runCommand(command: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
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

  let spec: string;
  try {
    spec = packageSpec({ unpinned: opts.unpinned, version: opts.version });
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    return 1;
  }

  if (opts.client === "codex" || opts.client === "cline") {
    const client = opts.client;
    const command = client;
    const target = resolveConfigPath(client, opts.cwd, opts.home, opts.platform);
    const args = client === "codex"
      ? buildCodexAddArgs(opts.profile, spec)
      : buildClineInstallArgs(opts.profile, spec);
    const renderedCommand = [command, ...args].join(" ");
    const displayName = client === "codex" ? "Codex" : "Cline";

    if (!opts.write) {
      console.log(`Dry run — nothing was written.`);
      console.log(``);
      console.log(`${displayName} stores MCP configuration in:`);
      console.log(`  ${target}`);
      console.log(``);
      console.log(`The official ${displayName} CLI would run:`);
      console.log(`  ${renderedCommand}`);
      console.log(``);
      console.log(pinningNote(spec, opts.unpinned));
      console.log(``);
      console.log(`Re-run with --write to apply.`);
      return 0;
    }

    try {
      const exitCode = await (opts.commandRunner ?? runCommand)(command, args);
      if (exitCode !== 0) {
        console.error(
          `Error: ${displayName} CLI exited with code ${exitCode}. No brandsystem configuration was confirmed.`,
        );
        return 1;
      }
    } catch (err) {
      const message = (err as NodeJS.ErrnoException).code === "ENOENT"
        ? `${displayName} CLI was not found. Install ${displayName}, then retry this command.`
        : (err as Error).message;
      console.error(`Error: ${message}`);
      return 1;
    }

    console.log(`Added "brandsystem" to ${displayName} through the official ${displayName} CLI.`);
    console.log(`Start a new ${displayName} task, then ask: "How do I use my brand guidelines with AI?"`);
    return 0;
  }

  const target = resolveConfigPath(
    opts.client,
    opts.cwd,
    opts.home,
    opts.platform,
  );
  const entry = buildServerEntry(opts.profile, spec);
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
    console.log(pinningNote(spec, opts.unpinned));
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
  console.log(`Wrote "brandsystem" server entry (${spec}) to ${target}`);
  if (opts.client === "claude-desktop") {
    console.log(`Restart Claude Desktop to pick up the new server.`);
  }
  return 0;
}
