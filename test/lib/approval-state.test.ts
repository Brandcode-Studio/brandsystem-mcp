import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  computeBrandFingerprint,
  computePackageDigest,
  readApprovalState,
  writeApprovalState,
  resolveEffectiveApproval,
} from "../../src/lib/approval-state.js";
import { compileRuntime } from "../../src/lib/runtime-compiler.js";
import type { BrandConfigData, CoreIdentityData } from "../../src/schemas/index.js";

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "approval-"));
  await mkdir(join(cwd, ".brand"), { recursive: true });
  await writeFile(join(cwd, ".brand", "core-identity.yaml"), "colors: []\n");
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

describe("approval state (promotion gate)", () => {
  it("defaults to provisional_extracted with no stored state", async () => {
    expect(await resolveEffectiveApproval(cwd)).toBe("provisional_extracted");
  });

  it("honors human_confirmed_local while the source fingerprint matches", async () => {
    await writeApprovalState(cwd, {
      level: "human_confirmed_local",
      confirmed_at: "2026-07-16T00:00:00Z",
      fingerprint: await computeBrandFingerprint(cwd),
      authority: "local_clarify",
    });
    expect(await resolveEffectiveApproval(cwd)).toBe("human_confirmed_local");
  });

  it("demotes to provisional when a source file changes after confirmation", async () => {
    await writeApprovalState(cwd, {
      level: "human_confirmed_local",
      confirmed_at: "2026-07-16T00:00:00Z",
      fingerprint: await computeBrandFingerprint(cwd),
      authority: "local_clarify",
    });
    await writeFile(
      join(cwd, ".brand", "core-identity.yaml"),
      "colors:\n  - value: '#ff0000'\n"
    );
    expect(await resolveEffectiveApproval(cwd)).toBe("provisional_extracted");
  });

  it("refuses production_approved unless conferred by brandcode_studio", async () => {
    await writeApprovalState(cwd, {
      level: "production_approved",
      confirmed_at: "2026-07-16T00:00:00Z",
      fingerprint: await computeBrandFingerprint(cwd),
      authority: "local_clarify",
    });
    expect(await resolveEffectiveApproval(cwd)).toBe("provisional_extracted");
  });

  async function writeStudioApproval(pkg: Record<string, unknown>, origin = "https://www.brandcode.studio") {
    await writeFile(join(cwd, ".brand", "brandcode-package.json"), JSON.stringify(pkg, null, 2));
    await writeApprovalState(cwd, {
      level: "production_approved",
      confirmed_at: "2026-07-16T00:00:00Z",
      fingerprint: await computeBrandFingerprint(cwd),
      authority: "brandcode_studio",
      package_sha256: computePackageDigest(pkg),
      origin,
    });
  }

  it("accepts production_approved from brandcode_studio while fingerprint and package hold", async () => {
    await writeStudioApproval({ slug: "acme", approval: "production_approved", b: 1, a: [1, 2] });
    expect(await resolveEffectiveApproval(cwd)).toBe("production_approved");
  });

  it("package digest ignores key order and formatting", () => {
    expect(computePackageDigest({ a: 1, b: { d: 2, c: 3 } })).toBe(
      computePackageDigest({ b: { c: 3, d: 2 }, a: 1 }),
    );
  });

  it("demotes a legacy brandcode_studio state that is not bound to a package", async () => {
    // Pre-binding states (fingerprint over local YAML only) could have been
    // conferred by any server; they no longer resolve.
    await writeApprovalState(cwd, {
      level: "production_approved",
      confirmed_at: "2026-07-16T00:00:00Z",
      fingerprint: await computeBrandFingerprint(cwd),
      authority: "brandcode_studio",
    });
    expect(await resolveEffectiveApproval(cwd)).toBe("provisional_extracted");
  });

  it("demotes production_approved when the pulled package changes", async () => {
    await writeStudioApproval({ slug: "acme", approval: "production_approved" });
    await writeFile(
      join(cwd, ".brand", "brandcode-package.json"),
      JSON.stringify({ slug: "acme", approval: "production_approved", injected: true }),
    );
    expect(await resolveEffectiveApproval(cwd)).toBe("provisional_extracted");
  });

  it("demotes production_approved when the package file is removed", async () => {
    await writeStudioApproval({ slug: "acme", approval: "production_approved" });
    await rm(join(cwd, ".brand", "brandcode-package.json"));
    expect(await resolveEffectiveApproval(cwd)).toBe("provisional_extracted");
  });

  it("demotes production_approved recorded for an untrusted origin", async () => {
    await writeStudioApproval({ slug: "acme" }, "https://evil.example");
    expect(await resolveEffectiveApproval(cwd)).toBe("provisional_extracted");
  });

  it("demotes production_approved when local sources change after the pull", async () => {
    await writeStudioApproval({ slug: "acme", approval: "production_approved" });
    await writeFile(join(cwd, ".brand", "messaging.yaml"), "voice: {}\n");
    expect(await resolveEffectiveApproval(cwd)).toBe("provisional_extracted");
  });

  it("round-trips state through read/write", async () => {
    const state = {
      level: "human_confirmed_local" as const,
      confirmed_at: "2026-07-16T00:00:00Z",
      fingerprint: "abc",
      authority: "local_clarify",
    };
    await writeApprovalState(cwd, state);
    expect(await readApprovalState(cwd)).toEqual(state);
  });
});

describe("runtime schema_version migration", () => {
  const config: BrandConfigData = {
    schema_version: "0.1.0",
    session: 1,
    client_name: "Acme",
    created_at: "2026-01-01T00:00:00Z",
  };
  const identity: CoreIdentityData = {
    schema_version: "0.1.0",
    colors: [],
    typography: [],
    logo: [],
    spacing: null,
  };

  it("emits schema_version alongside the deprecated version alias", () => {
    const runtime = compileRuntime(config, identity, null, null, null);
    expect(runtime.schema_version).toBe("0.1.0");
    expect(runtime.version).toBe("0.1.0");
  });

  it("carries the approval level passed by the compile pipeline", () => {
    const confirmed = compileRuntime(config, identity, null, null, null, "human_confirmed_local");
    expect(confirmed.approval).toBe("human_confirmed_local");
    expect(confirmed.provenance?.note).toMatch(/Human-reviewed locally/);
    expect(confirmed.provenance?.note).toMatch(/not brand-authority approved/);

    const production = compileRuntime(config, identity, null, null, null, "production_approved");
    expect(production.provenance?.note).toMatch(/Production-approved by Brandcode Studio/);
  });
});
