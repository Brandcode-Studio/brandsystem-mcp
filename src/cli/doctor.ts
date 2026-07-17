/**
 * `doctor` subcommand — local environment checkup for brandsystem-mcp.
 *
 * All checks are local (no network). Each check returns a DoctorCheck with
 * an "ok" | "warn" | "fail" status; the command prints one line per check
 * and exits 1 only when at least one check fails.
 */

import { readFile, stat, access } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { parse as parseYaml } from "yaml";
import { getVersion } from "../lib/version.js";
import { resolveProfile, CORE_TOOL_NAMES } from "../lib/tool-profile.js";

export type DoctorStatus = "ok" | "warn" | "fail";

export interface DoctorCheck {
  status: DoctorStatus;
  message: string;
}

const MIN_NODE_VERSION = "20.18.1";

function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Node.js runtime version must satisfy the package's engines requirement. */
export function checkNodeVersion(
  current: string = process.versions.node,
): DoctorCheck {
  if (compareVersions(current, MIN_NODE_VERSION) >= 0) {
    return {
      status: "ok",
      message: `Node.js ${current} (>= ${MIN_NODE_VERSION} required)`,
    };
  }
  return {
    status: "fail",
    message: `Node.js ${current} is below the required ${MIN_NODE_VERSION} — upgrade Node.js`,
  };
}

/** Report the installed package version. */
export function checkPackageVersion(): DoctorCheck {
  return {
    status: "ok",
    message: `@brandsystem/mcp version ${getVersion()}`,
  };
}

/** Report which tool profile the server would use and its tool count. */
export function checkProfile(explicit?: string): DoctorCheck {
  const profile = resolveProfile(explicit);
  if (profile === "core") {
    return {
      status: "ok",
      message: `tool profile "core" — registers ${CORE_TOOL_NAMES.size} core tools (set BRANDSYSTEM_PROFILE=full or pass --profile=full for the complete surface)`,
    };
  }
  return {
    status: "ok",
    message: `tool profile "full" — registers the complete tool surface`,
  };
}

/**
 * Check the .brand/ directory in cwd: presence, brand.config.yaml parse,
 * brand-runtime.json approval state, and pending clarification count.
 */
export async function checkBrandDir(cwd: string): Promise<DoctorCheck[]> {
  const brandPath = join(cwd, ".brand");
  if (!(await fileExists(brandPath))) {
    return [
      {
        status: "warn",
        message: `.brand/ not found in ${cwd} — run brand_start to begin`,
      },
    ];
  }

  const checks: DoctorCheck[] = [
    { status: "ok", message: `.brand/ directory present` },
  ];

  // brand.config.yaml
  const configPath = join(brandPath, "brand.config.yaml");
  if (!(await fileExists(configPath))) {
    checks.push({
      status: "warn",
      message: `.brand/brand.config.yaml missing — run brand_start to initialize`,
    });
  } else {
    try {
      const raw = await readFile(configPath, "utf-8");
      const parsed = parseYaml(raw) as Record<string, unknown> | null;
      const clientName =
        parsed && typeof parsed === "object" && parsed.client_name
          ? String(parsed.client_name)
          : "(no client_name)";
      checks.push({
        status: "ok",
        message: `brand.config.yaml parses (client: ${clientName})`,
      });
    } catch (err) {
      checks.push({
        status: "fail",
        message: `brand.config.yaml is not valid YAML — ${(err as Error).message}`,
      });
    }
  }

  // brand-runtime.json
  const runtimePath = join(brandPath, "brand-runtime.json");
  if (!(await fileExists(runtimePath))) {
    checks.push({
      status: "warn",
      message: `brand-runtime.json missing — run brand_compile to generate the runtime contract`,
    });
  } else {
    try {
      const raw = await readFile(runtimePath, "utf-8");
      const runtime = JSON.parse(raw) as Record<string, unknown>;
      const approval =
        typeof runtime.approval === "string"
          ? runtime.approval
          : "(unset — pre-0.9.6 runtime)";
      checks.push({
        status: "ok",
        message: `brand-runtime.json present (approval: ${approval})`,
      });
    } catch (err) {
      checks.push({
        status: "fail",
        message: `brand-runtime.json is not valid JSON — ${(err as Error).message}`,
      });
    }
  }

  // needs-clarification.yaml
  const clarifyPath = join(brandPath, "needs-clarification.yaml");
  if (!(await fileExists(clarifyPath))) {
    checks.push({
      status: "ok",
      message: `no needs-clarification.yaml — no pending clarifications`,
    });
  } else {
    try {
      const raw = await readFile(clarifyPath, "utf-8");
      const parsed = parseYaml(raw) as { items?: unknown[] } | null;
      const pending = Array.isArray(parsed?.items) ? parsed.items.length : 0;
      if (pending > 0) {
        checks.push({
          status: "warn",
          message: `${pending} pending clarification(s) — run brand_clarify to resolve`,
        });
      } else {
        checks.push({
          status: "ok",
          message: `needs-clarification.yaml has 0 pending items`,
        });
      }
    } catch {
      checks.push({
        status: "warn",
        message: `needs-clarification.yaml could not be parsed — pending count unknown`,
      });
    }
  }

  return checks;
}

/**
 * Check the credential file .brand/brandcode-auth.json: permissions and
 * expiry. Never prints the token itself.
 */
export async function checkAuthFile(cwd: string): Promise<DoctorCheck[]> {
  const authPath = join(cwd, ".brand", "brandcode-auth.json");
  if (!(await fileExists(authPath))) {
    return [
      {
        status: "ok",
        message: `no credential file (.brand/brandcode-auth.json) — not signed in to Brandcode Studio`,
      },
    ];
  }

  const checks: DoctorCheck[] = [];

  try {
    const info = await stat(authPath);
    const mode = info.mode & 0o777;
    if (mode & 0o077) {
      checks.push({
        status: "warn",
        message: `credential file is group/other-readable (mode ${mode.toString(8).padStart(3, "0")}) — run: chmod 600 .brand/brandcode-auth.json`,
      });
    } else {
      checks.push({
        status: "ok",
        message: `credential file permissions are owner-only (mode ${mode.toString(8).padStart(3, "0")})`,
      });
    }
  } catch (err) {
    checks.push({
      status: "warn",
      message: `could not stat credential file — ${(err as Error).message}`,
    });
  }

  try {
    const raw = await readFile(authPath, "utf-8");
    const creds = JSON.parse(raw) as { expiresAt?: string };
    if (!creds.expiresAt) {
      checks.push({
        status: "warn",
        message: `credential file has no expiresAt field — cannot verify expiry`,
      });
    } else if (new Date(creds.expiresAt).getTime() < Date.now()) {
      checks.push({
        status: "warn",
        message: `credentials expired at ${creds.expiresAt} — run brand_brandcode_auth to sign in again`,
      });
    } else {
      checks.push({
        status: "ok",
        message: `credentials valid until ${creds.expiresAt}`,
      });
    }
  } catch {
    checks.push({
      status: "warn",
      message: `credential file is not valid JSON — cannot verify expiry`,
    });
  }

  return checks;
}

/**
 * Check MCP client configs for a "brandsystem" server entry.
 */
export async function checkClientConfigs(
  cwd: string,
  home: string = homedir(),
): Promise<DoctorCheck[]> {
  const targets: Array<{
    path: string;
    label: string;
    client: string;
    installKey: string;
    format: "json" | "toml";
  }> = [
    {
      path: join(cwd, ".mcp.json"),
      label: ".mcp.json",
      client: "Claude Code",
      installKey: "claude-code",
      format: "json",
    },
    {
      path: join(home, ".codex", "config.toml"),
      label: "~/.codex/config.toml",
      client: "Codex",
      installKey: "codex",
      format: "toml",
    },
    {
      path: join(
        home,
        ".cline",
        "data",
        "settings",
        "cline_mcp_settings.json",
      ),
      label: "~/.cline/data/settings/cline_mcp_settings.json",
      client: "Cline",
      installKey: "cline",
      format: "json",
    },
    {
      path: join(cwd, ".cursor", "mcp.json"),
      label: join(".cursor", "mcp.json"),
      client: "Cursor",
      installKey: "cursor",
      format: "json",
    },
  ];

  const checks: DoctorCheck[] = [];
  for (const target of targets) {
    if (!(await fileExists(target.path))) {
      checks.push({
        status: "ok",
        message: `no ${target.label} (${target.client}) — run \`install --client ${target.installKey}\` to add one`,
      });
      continue;
    }
    try {
      const raw = await readFile(target.path, "utf-8");
      if (target.format === "toml") {
        if (/^\s*\[mcp_servers\.brandsystem\]\s*$/m.test(raw)) {
          checks.push({
            status: "ok",
            message: `${target.label} (${target.client}) has a "brandsystem" server entry`,
          });
        } else {
          checks.push({
            status: "warn",
            message: `${target.label} (${target.client}) exists but has no "brandsystem" entry — run \`install --client ${target.installKey}\``,
          });
        }
        continue;
      }
      const parsed = JSON.parse(raw) as {
        mcpServers?: Record<string, unknown>;
      };
      if (parsed.mcpServers && "brandsystem" in parsed.mcpServers) {
        checks.push({
          status: "ok",
          message: `${target.label} (${target.client}) has a "brandsystem" server entry`,
        });
      } else {
        checks.push({
          status: "warn",
          message: `${target.label} (${target.client}) exists but has no "brandsystem" entry — run \`install --client ${target.installKey}\``,
        });
      }
    } catch {
      checks.push({
        status: "warn",
        message: `${target.label} (${target.client}) could not be parsed — cannot check for a "brandsystem" entry`,
      });
    }
  }
  return checks;
}

/** Gather all doctor checks for a cwd. */
export async function gatherDoctorChecks(cwd: string): Promise<DoctorCheck[]> {
  return [
    checkNodeVersion(),
    checkPackageVersion(),
    checkProfile(),
    ...(await checkBrandDir(cwd)),
    ...(await checkAuthFile(cwd)),
    ...(await checkClientConfigs(cwd)),
  ];
}

/**
 * Run the doctor checkup: print one line per check and return the exit
 * code (0 when nothing failed, 1 when at least one check failed).
 */
export async function runDoctor(cwd: string): Promise<number> {
  const checks = await gatherDoctorChecks(cwd);
  for (const check of checks) {
    console.log(`${check.status}: ${check.message}`);
  }
  const fails = checks.filter((c) => c.status === "fail").length;
  const warns = checks.filter((c) => c.status === "warn").length;
  console.log(
    `\n${checks.length} checks — ${fails} failed, ${warns} warning(s)`,
  );
  return fails > 0 ? 1 : 0;
}
