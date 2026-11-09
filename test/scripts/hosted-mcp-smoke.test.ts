import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const scriptPath = join(repoRoot, "scripts", "hosted-mcp-smoke.mjs");

function smokeEnv() {
  const env = { ...process.env };
  for (const key of [
    "BRANDCODE_MCP_SMOKE_URL",
    "BRANDCODE_MCP_SMOKE_FULL_KEY",
    "BRANDCODE_MCP_SMOKE_READ_KEY",
    "BRANDCODE_MCP_SMOKE_ASSET_ID",
    "BRANDCODE_MCP_SMOKE_SKIP_FEEDBACK",
    "BRANDCODE_MCP_SMOKE_TIMEOUT_MS",
  ]) {
    delete env[key];
  }
  return env;
}

describe("hosted MCP smoke harness", () => {
  it("prints help without hosted secrets", async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      [scriptPath, "--help"],
      { cwd: repoRoot, env: smokeEnv() },
    );

    expect(stdout).toContain("BRANDCODE_MCP_SMOKE_URL");
    expect(stdout).toContain("BRANDCODE_MCP_SMOKE_FULL_KEY");
    expect(stdout).toContain("BRANDCODE_MCP_SMOKE_READ_KEY");
  });

  it("reports a blocked env-missing path without failing", async () => {
    const { stdout } = await execFileAsync(
      process.execPath,
      [scriptPath, "--json"],
      { cwd: repoRoot, env: smokeEnv() },
    );
    const result = JSON.parse(stdout) as {
      status: string;
      checks: Array<{ name: string; status: string; missing_env?: string[] }>;
    };

    expect(result.status).toBe("blocked");
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0]).toMatchObject({
      name: "environment",
      status: "blocked",
      missing_env: [
        "BRANDCODE_MCP_SMOKE_URL",
        "BRANDCODE_MCP_SMOKE_FULL_KEY",
      ],
    });
  });
});

describe("hosted smoke brand_runtime slice checks", () => {
  // The checks live in a zero-dependency .mjs shared with the smoke script.
  const load = () => import("../../scripts/hosted-runtime-checks.mjs");

  it("fails a visual slice that returns no identity colors (2026-10 regression)", async () => {
    const { evaluateRuntimeSlice } = await load();
    const verdict = evaluateRuntimeSlice("visual", {
      runtime: { slice_type: "visual" },
      runtime_origin: "hosted",
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toContain("no identity colors");
  });

  it("fails a full slice whose runtime was elided by the response cap", async () => {
    const { evaluateRuntimeSlice } = await load();
    const verdict = evaluateRuntimeSlice("full", {
      runtime_origin: "hosted",
      response_overflow: { runtime: { elided: true, original_chars: 277084 } },
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.detail).toContain("elided");
  });

  it("fails a voice slice with no voice section", async () => {
    const { evaluateRuntimeSlice } = await load();
    const verdict = evaluateRuntimeSlice("voice", {
      runtime: { slice_type: "voice", taste_workflow: {} },
    });
    expect(verdict.ok).toBe(false);
  });

  it("passes slices that carry identity and voice", async () => {
    const { evaluateRuntimeSlice } = await load();
    const runtime = {
      identity: { colors: { primary: "#0b6e4f" } },
      voice: { verbal_identity: "Calm." },
    };
    for (const slice of ["minimal", "visual", "voice", "full"]) {
      expect(evaluateRuntimeSlice(slice, { runtime }).ok, slice).toBe(true);
    }
  });

  it("accepts a UCS runtime contract without legacy identity keys", async () => {
    const { evaluateRuntimeSlice } = await load();
    const verdict = evaluateRuntimeSlice("visual", {
      runtime: { schemaVersion: "brandcode-runtime-contract/v1", manifest: {} },
    });
    expect(verdict.ok).toBe(true);
  });
});
