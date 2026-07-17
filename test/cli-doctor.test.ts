import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkNodeVersion,
  checkPackageVersion,
  checkProfile,
  checkBrandDir,
  checkAuthFile,
  checkClientConfigs,
  runDoctor,
} from "../src/cli/doctor.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "brandsystem-doctor-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("checkNodeVersion", () => {
  it("passes for versions at or above the minimum", () => {
    expect(checkNodeVersion("20.18.1").status).toBe("ok");
    expect(checkNodeVersion("20.19.0").status).toBe("ok");
    expect(checkNodeVersion("22.1.0").status).toBe("ok");
  });

  it("fails for versions below the minimum", () => {
    expect(checkNodeVersion("18.20.0").status).toBe("fail");
    expect(checkNodeVersion("20.18.0").status).toBe("fail");
    expect(checkNodeVersion("20.17.9").status).toBe("fail");
  });

  it("passes for the running Node.js by default", () => {
    expect(checkNodeVersion().status).toBe("ok");
  });
});

describe("checkPackageVersion", () => {
  it("reports the package version", () => {
    const check = checkPackageVersion();
    expect(check.status).toBe("ok");
    expect(check.message).toMatch(/\d+\.\d+\.\d+/);
  });
});

describe("checkProfile", () => {
  it("reports the core tool count for the core profile", () => {
    const check = checkProfile("core");
    expect(check.status).toBe("ok");
    expect(check.message).toContain('"core"');
    expect(check.message).toMatch(/\d+ core tools/);
  });

  it("says full registers the complete surface", () => {
    const check = checkProfile("full");
    expect(check.status).toBe("ok");
    expect(check.message).toContain("complete tool surface");
  });
});

describe("checkBrandDir", () => {
  it("warns with brand_start guidance when .brand/ is missing", async () => {
    const checks = await checkBrandDir(dir);
    expect(checks).toHaveLength(1);
    expect(checks[0].status).toBe("warn");
    expect(checks[0].message).toContain("brand_start");
  });

  it("reports a healthy .brand/ directory", async () => {
    const brand = join(dir, ".brand");
    await mkdir(brand, { recursive: true });
    await writeFile(
      join(brand, "brand.config.yaml"),
      "schema_version: '1.0'\nclient_name: Acme\n",
    );
    await writeFile(
      join(brand, "brand-runtime.json"),
      JSON.stringify({ version: "1", approval: "provisional_extracted" }),
    );
    await writeFile(
      join(brand, "needs-clarification.yaml"),
      "schema_version: '1.0'\nitems: []\n",
    );

    const checks = await checkBrandDir(dir);
    expect(checks.every((c) => c.status === "ok")).toBe(true);
    expect(checks.map((c) => c.message).join("\n")).toContain("Acme");
    expect(checks.map((c) => c.message).join("\n")).toContain(
      "provisional_extracted",
    );
  });

  it("fails when brand.config.yaml is invalid YAML", async () => {
    const brand = join(dir, ".brand");
    await mkdir(brand, { recursive: true });
    await writeFile(join(brand, "brand.config.yaml"), "client_name: [unclosed\n");

    const checks = await checkBrandDir(dir);
    const configCheck = checks.find((c) =>
      c.message.includes("brand.config.yaml"),
    );
    expect(configCheck?.status).toBe("fail");
  });

  it("warns when brand-runtime.json is missing", async () => {
    const brand = join(dir, ".brand");
    await mkdir(brand, { recursive: true });
    await writeFile(join(brand, "brand.config.yaml"), "client_name: Acme\n");

    const checks = await checkBrandDir(dir);
    const runtimeCheck = checks.find((c) =>
      c.message.includes("brand-runtime.json"),
    );
    expect(runtimeCheck?.status).toBe("warn");
    expect(runtimeCheck?.message).toContain("brand_compile");
  });

  it("counts pending clarifications", async () => {
    const brand = join(dir, ".brand");
    await mkdir(brand, { recursive: true });
    await writeFile(
      join(brand, "needs-clarification.yaml"),
      [
        "schema_version: '1.0'",
        "items:",
        "  - id: clarify-1",
        "    field: colors.primary",
        "    question: Which blue?",
        "    source: website",
        "    priority: high",
        "  - id: clarify-2",
        "    field: typography.heading",
        "    question: Which font?",
        "    source: website",
        "    priority: medium",
        "",
      ].join("\n"),
    );

    const checks = await checkBrandDir(dir);
    const clarifyCheck = checks.find((c) =>
      c.message.includes("clarification"),
    );
    expect(clarifyCheck?.status).toBe("warn");
    expect(clarifyCheck?.message).toContain("2 pending");
  });
});

describe("checkAuthFile", () => {
  const future = new Date(Date.now() + 86_400_000).toISOString();
  const past = new Date(Date.now() - 86_400_000).toISOString();

  async function writeAuth(contents: string, mode: number) {
    const brand = join(dir, ".brand");
    await mkdir(brand, { recursive: true });
    const path = join(brand, "brandcode-auth.json");
    await writeFile(path, contents);
    await chmod(path, mode);
    return path;
  }

  it("is ok when no credential file exists", async () => {
    const checks = await checkAuthFile(dir);
    expect(checks).toHaveLength(1);
    expect(checks[0].status).toBe("ok");
    expect(checks[0].message).toContain("not signed in");
  });

  it("warns when the file is group/other-readable (0644)", async () => {
    await writeAuth(
      JSON.stringify({ token: "super-secret-token", expiresAt: future }),
      0o644,
    );
    const checks = await checkAuthFile(dir);
    const permCheck = checks.find((c) => c.message.includes("readable"));
    expect(permCheck?.status).toBe("warn");
    expect(permCheck?.message).toContain("644");
    expect(permCheck?.message).toContain("chmod 600");
  });

  it("passes when the file is owner-only (0600) and unexpired", async () => {
    await writeAuth(
      JSON.stringify({ token: "super-secret-token", expiresAt: future }),
      0o600,
    );
    const checks = await checkAuthFile(dir);
    expect(checks.every((c) => c.status === "ok")).toBe(true);
    const expiryCheck = checks.find((c) => c.message.includes("valid until"));
    expect(expiryCheck?.message).toContain(future);
  });

  it("warns on expired credentials", async () => {
    await writeAuth(
      JSON.stringify({ token: "super-secret-token", expiresAt: past }),
      0o600,
    );
    const checks = await checkAuthFile(dir);
    const expiryCheck = checks.find((c) => c.message.includes("expired"));
    expect(expiryCheck?.status).toBe("warn");
  });

  it("never prints the token", async () => {
    await writeAuth(
      JSON.stringify({ token: "super-secret-token", expiresAt: future }),
      0o644,
    );
    const checks = await checkAuthFile(dir);
    for (const check of checks) {
      expect(check.message).not.toContain("super-secret-token");
    }
  });
});

describe("checkClientConfigs", () => {
  it("suggests install when no configs exist", async () => {
    const checks = await checkClientConfigs(dir, dir);
    expect(checks).toHaveLength(4);
    expect(checks.every((c) => c.status === "ok")).toBe(true);
    expect(checks[0].message).toContain("install --client claude-code");
    expect(checks[1].message).toContain("install --client codex");
    expect(checks[2].message).toContain("install --client cline");
    expect(checks[3].message).toContain("install --client cursor");
  });

  it("finds a brandsystem entry in .mcp.json", async () => {
    await writeFile(
      join(dir, ".mcp.json"),
      JSON.stringify({
        mcpServers: {
          brandsystem: {
            transport: {
              type: "stdio",
              command: "npx",
              args: ["-y", "@brandsystem/mcp"],
            },
          },
        },
      }),
    );
    const checks = await checkClientConfigs(dir, dir);
    const claudeCheck = checks.find((c) => c.message.includes(".mcp.json"));
    expect(claudeCheck?.status).toBe("ok");
    expect(claudeCheck?.message).toContain('"brandsystem" server entry');
  });

  it("warns when a config exists without a brandsystem entry", async () => {
    await mkdir(join(dir, ".cursor"), { recursive: true });
    await writeFile(
      join(dir, ".cursor", "mcp.json"),
      JSON.stringify({ mcpServers: { other: { command: "foo" } } }),
    );
    const checks = await checkClientConfigs(dir, dir);
    const cursorCheck = checks.find((c) => c.message.includes("Cursor"));
    expect(cursorCheck?.status).toBe("warn");
  });

  it("warns on invalid JSON without crashing", async () => {
    await writeFile(join(dir, ".mcp.json"), "{ not json");
    const checks = await checkClientConfigs(dir, dir);
    const claudeCheck = checks.find((c) => c.message.includes(".mcp.json"));
    expect(claudeCheck?.status).toBe("warn");
  });

  it("finds a brandsystem entry in Codex config.toml", async () => {
    await mkdir(join(dir, ".codex"), { recursive: true });
    await writeFile(
      join(dir, ".codex", "config.toml"),
      '[mcp_servers.brandsystem]\ncommand = "npx"\nargs = ["-y", "@brandsystem/mcp"]\n',
    );
    const checks = await checkClientConfigs(dir, dir);
    const codexCheck = checks.find((c) => c.message.includes("Codex"));
    expect(codexCheck?.status).toBe("ok");
    expect(codexCheck?.message).toContain('"brandsystem" server entry');
  });

  it("finds a brandsystem entry in Cline's shared MCP settings", async () => {
    const settingsDir = join(dir, ".cline", "data", "settings");
    await mkdir(settingsDir, { recursive: true });
    await writeFile(
      join(settingsDir, "cline_mcp_settings.json"),
      JSON.stringify({
        mcpServers: {
          brandsystem: { command: "npx", args: ["-y", "@brandsystem/mcp"] },
        },
      }),
    );
    const checks = await checkClientConfigs(dir, dir);
    const clineCheck = checks.find((c) => c.message.includes("Cline"));
    expect(clineCheck?.status).toBe("ok");
    expect(clineCheck?.message).toContain('"brandsystem" server entry');
  });
});

describe("runDoctor", () => {
  it("prints one prefixed line per check and returns 0 with no failures", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const code = await runDoctor(dir);
      expect(code).toBe(0);
      const lines = log.mock.calls
        .map((c) => String(c[0]))
        .filter((l) => /^(ok|warn|fail): /.test(l));
      expect(lines.length).toBeGreaterThanOrEqual(6);
    } finally {
      log.mockRestore();
    }
  });

  it("returns 1 when a check fails", async () => {
    const brand = join(dir, ".brand");
    await mkdir(brand, { recursive: true });
    await writeFile(join(brand, "brand.config.yaml"), "client_name: [broken\n");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const code = await runDoctor(dir);
      expect(code).toBe(1);
    } finally {
      log.mockRestore();
    }
  });
});
