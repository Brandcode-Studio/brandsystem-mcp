import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildServerEntry,
  buildCodexAddArgs,
  buildClineInstallArgs,
  resolveConfigPath,
  mergeMcpConfig,
  runInstall,
} from "../src/cli/install.js";
import {
  getArtifactInventory,
  STANDARD_BRAND_FILES,
  runInspect,
} from "../src/cli/inspect.js";

let dir: string;
let log: ReturnType<typeof vi.spyOn>;
let errorLog: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brandsystem-install-"));
  log = vi.spyOn(console, "log").mockImplementation(() => {});
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  log.mockRestore();
  errorLog.mockRestore();
  await rm(dir, { recursive: true, force: true });
});

function loggedOutput(): string {
  return log.mock.calls.map((c) => String(c[0])).join("\n");
}

describe("buildServerEntry", () => {
  it("builds the standard npx entry for the core profile", () => {
    expect(buildServerEntry("core")).toEqual({
      command: "npx",
      args: ["-y", "@brandsystem/mcp"],
    });
  });

  it("appends --profile=full for the full profile", () => {
    expect(buildServerEntry("full")).toEqual({
      command: "npx",
      args: ["-y", "@brandsystem/mcp", "--profile=full"],
    });
  });
});

describe("buildCodexAddArgs", () => {
  it("builds the official Codex CLI command for core", () => {
    expect(buildCodexAddArgs("core")).toEqual([
      "mcp",
      "add",
      "brandsystem",
      "--",
      "npx",
      "-y",
      "@brandsystem/mcp",
    ]);
  });

  it("passes the full profile through to the MCP server", () => {
    expect(buildCodexAddArgs("full")).toContain("--profile=full");
  });
});

describe("buildClineInstallArgs", () => {
  it("builds the official non-interactive Cline CLI command", () => {
    expect(buildClineInstallArgs("core")).toEqual([
      "mcp",
      "install",
      "brandsystem",
      "--yes",
      "--",
      "npx",
      "-y",
      "@brandsystem/mcp",
    ]);
  });

  it("passes the full profile through to the MCP server", () => {
    expect(buildClineInstallArgs("full")).toContain("--profile=full");
  });
});

describe("resolveConfigPath", () => {
  const home = "/home/tester";

  it("uses project-local paths for claude-code and cursor", () => {
    expect(resolveConfigPath("claude-code", dir, home)).toBe(
      join(dir, ".mcp.json"),
    );
    expect(resolveConfigPath("cursor", dir, home)).toBe(
      join(dir, ".cursor", "mcp.json"),
    );
  });

  it("uses Cline's shared MCP settings path", () => {
    expect(resolveConfigPath("cline", dir, home)).toBe(
      join(home, ".cline", "data", "settings", "cline_mcp_settings.json"),
    );
  });

  it("reports the shared Codex config path", () => {
    expect(resolveConfigPath("codex", dir, home)).toBe(
      join(home, ".codex", "config.toml"),
    );
  });

  it("uses the home-based path for windsurf", () => {
    expect(resolveConfigPath("windsurf", dir, home)).toBe(
      join(home, ".codeium", "windsurf", "mcp_config.json"),
    );
  });

  it("uses the OS-specific path for claude-desktop", () => {
    expect(resolveConfigPath("claude-desktop", dir, home, "darwin")).toBe(
      join(
        home,
        "Library",
        "Application Support",
        "Claude",
        "claude_desktop_config.json",
      ),
    );
    expect(resolveConfigPath("claude-desktop", dir, home, "linux")).toBe(
      join(home, ".config", "Claude", "claude_desktop_config.json"),
    );
  });
});

describe("mergeMcpConfig", () => {
  const entry = buildServerEntry("core");

  it("creates a fresh config when no file exists", () => {
    expect(mergeMcpConfig(null, entry)).toEqual({
      mcpServers: { brandsystem: entry },
    });
  });

  it("preserves other servers and top-level keys", () => {
    const existing = JSON.stringify({
      someSetting: true,
      mcpServers: {
        other: { command: "other-server", args: ["--flag"] },
      },
    });
    const merged = mergeMcpConfig(existing, entry);
    expect(merged.someSetting).toBe(true);
    expect((merged.mcpServers as Record<string, unknown>).other).toEqual({
      command: "other-server",
      args: ["--flag"],
    });
    expect((merged.mcpServers as Record<string, unknown>).brandsystem).toEqual(
      entry,
    );
  });

  it("replaces an existing brandsystem entry", () => {
    const existing = JSON.stringify({
      mcpServers: { brandsystem: { command: "old", args: [] } },
    });
    const merged = mergeMcpConfig(existing, buildServerEntry("full"));
    expect((merged.mcpServers as Record<string, unknown>).brandsystem).toEqual(
      buildServerEntry("full"),
    );
  });

  it("throws on invalid JSON", () => {
    expect(() => mergeMcpConfig("{ not json", entry)).toThrow(/not valid JSON/);
  });

  it("throws when the top level is not an object", () => {
    expect(() => mergeMcpConfig("[1,2,3]", entry)).toThrow(/not a JSON object/);
  });
});

describe("runInstall", () => {
  it("prints a dry-run Codex command without invoking it", async () => {
    const commandRunner = vi.fn(async () => 0);
    const code = await runInstall({
      client: "codex",
      write: false,
      profile: "core",
      cwd: dir,
      home: "/home/tester",
      commandRunner,
    });
    expect(code).toBe(0);
    expect(commandRunner).not.toHaveBeenCalled();
    expect(loggedOutput()).toContain(
      "codex mcp add brandsystem -- npx -y @brandsystem/mcp",
    );
  });

  it("uses the official Codex CLI when --write is explicit", async () => {
    const commandRunner = vi.fn(async () => 0);
    const code = await runInstall({
      client: "codex",
      write: true,
      profile: "full",
      cwd: dir,
      commandRunner,
    });
    expect(code).toBe(0);
    expect(commandRunner).toHaveBeenCalledWith("codex", [
      "mcp",
      "add",
      "brandsystem",
      "--",
      "npx",
      "-y",
      "@brandsystem/mcp",
      "--profile=full",
    ]);
    expect(loggedOutput()).toContain("official Codex CLI");
  });

  it("reports a failed Codex CLI invocation", async () => {
    const code = await runInstall({
      client: "codex",
      write: true,
      profile: "core",
      cwd: dir,
      commandRunner: async () => 2,
    });
    expect(code).toBe(1);
    expect(errorLog).toHaveBeenCalledWith(expect.stringContaining("code 2"));
  });

  it("dry-run prints the target and writes nothing", async () => {
    const code = await runInstall({
      client: "claude-code",
      write: false,
      profile: "core",
      cwd: dir,
    });
    expect(code).toBe(0);
    expect(loggedOutput()).toContain(join(dir, ".mcp.json"));
    expect(loggedOutput()).toContain("--write");
    const files = await readdir(dir);
    expect(files).toEqual([]);
  });

  it("--write creates the config file", async () => {
    const code = await runInstall({
      client: "claude-code",
      write: true,
      profile: "core",
      cwd: dir,
    });
    expect(code).toBe(0);
    const written = JSON.parse(await readFile(join(dir, ".mcp.json"), "utf-8"));
    expect(written).toEqual({
      mcpServers: {
        brandsystem: { command: "npx", args: ["-y", "@brandsystem/mcp"] },
      },
    });
  });

  it("--write creates intermediate directories for cursor", async () => {
    const code = await runInstall({
      client: "cursor",
      write: true,
      profile: "full",
      cwd: dir,
    });
    expect(code).toBe(0);
    const written = JSON.parse(
      await readFile(join(dir, ".cursor", "mcp.json"), "utf-8"),
    );
    expect(written.mcpServers.brandsystem.args).toContain("--profile=full");
  });

  it("--write merges with an existing config and creates a backup", async () => {
    const existing = {
      topLevel: "keep-me",
      mcpServers: { other: { command: "other-server", args: [] } },
    };
    await writeFile(
      join(dir, ".mcp.json"),
      JSON.stringify(existing, null, 2) + "\n",
    );

    const code = await runInstall({
      client: "claude-code",
      write: true,
      profile: "core",
      cwd: dir,
    });
    expect(code).toBe(0);

    const written = JSON.parse(await readFile(join(dir, ".mcp.json"), "utf-8"));
    expect(written.topLevel).toBe("keep-me");
    expect(written.mcpServers.other).toEqual({
      command: "other-server",
      args: [],
    });
    expect(written.mcpServers.brandsystem).toEqual(buildServerEntry("core"));

    const backups = (await readdir(dir)).filter((f) =>
      f.startsWith(".mcp.json.backup-"),
    );
    expect(backups).toHaveLength(1);
    const backupContent = JSON.parse(
      await readFile(join(dir, backups[0]), "utf-8"),
    );
    expect(backupContent).toEqual(existing);
  });

  it("refuses to overwrite an invalid JSON config", async () => {
    await writeFile(join(dir, ".mcp.json"), "{ definitely not json");

    const code = await runInstall({
      client: "claude-code",
      write: true,
      profile: "core",
      cwd: dir,
    });
    expect(code).toBe(1);

    // Original untouched, no backup created
    expect(await readFile(join(dir, ".mcp.json"), "utf-8")).toBe(
      "{ definitely not json",
    );
    const backups = (await readdir(dir)).filter((f) =>
      f.includes(".backup-"),
    );
    expect(backups).toHaveLength(0);
  });

  it("rejects unknown clients", async () => {
    const code = await runInstall({
      client: "vscode",
      write: false,
      profile: "core",
      cwd: dir,
    });
    expect(code).toBe(1);
  });

  it("targets a home-relative path for windsurf", async () => {
    const fakeHome = join(dir, "home");
    const code = await runInstall({
      client: "windsurf",
      write: true,
      profile: "core",
      cwd: dir,
      home: fakeHome,
    });
    expect(code).toBe(0);
    const written = JSON.parse(
      await readFile(
        join(fakeHome, ".codeium", "windsurf", "mcp_config.json"),
        "utf-8",
      ),
    );
    expect(written.mcpServers.brandsystem).toEqual(buildServerEntry("core"));
  });

  it("uses the official Cline CLI when --write is explicit", async () => {
    const commandRunner = vi.fn(async () => 0);
    const code = await runInstall({
      client: "cline",
      write: true,
      profile: "full",
      cwd: dir,
      commandRunner,
    });
    expect(code).toBe(0);
    expect(commandRunner).toHaveBeenCalledWith("cline", [
      "mcp",
      "install",
      "brandsystem",
      "--yes",
      "--",
      "npx",
      "-y",
      "@brandsystem/mcp",
      "--profile=full",
    ]);
    expect(loggedOutput()).toContain("official Cline CLI");
  });
});

describe("inspect helpers", () => {
  it("reports all standard files missing in an empty .brand/", async () => {
    await mkdir(join(dir, ".brand"), { recursive: true });
    const inventory = await getArtifactInventory(dir);
    expect(inventory).toHaveLength(STANDARD_BRAND_FILES.length);
    expect(inventory.every((e) => !e.exists)).toBe(true);
  });

  it("marks present files", async () => {
    const brand = join(dir, ".brand");
    await mkdir(brand, { recursive: true });
    await writeFile(join(brand, "brand.config.yaml"), "client_name: Acme\n");
    await writeFile(join(brand, "tokens.json"), "{}");

    const inventory = await getArtifactInventory(dir);
    const present = inventory.filter((e) => e.exists).map((e) => e.file);
    expect(present.sort()).toEqual(["brand.config.yaml", "tokens.json"]);
  });

  it("runInspect prints version, profile, and inventory without crashing", async () => {
    const code = await runInspect(dir, "core");
    expect(code).toBe(0);
    const output = loggedOutput();
    expect(output).toMatch(/@brandsystem\/mcp \d+\.\d+\.\d+/);
    expect(output).toContain("Profile: core");
    expect(output).toContain("brand_start");
  });
});
