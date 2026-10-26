/**
 * Signed brand packages: Ed25519 signatures from Brandcode Studio decide
 * whether a package's production_approved declaration may be conferred.
 * Keys are generated in-test and pinned through the test seam; the shipped
 * pinned list is empty until key provisioning.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile, access } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/server.js";
import { setBrandcodeTransportForTests } from "../../src/connectors/brandcode/client.js";
import {
  persistPulledPackage,
  writePackagePayload,
} from "../../src/connectors/brandcode/persistence.js";
import {
  REQUIRE_SIGNED_APPROVAL_DEFAULT,
  REQUIRE_SIGNED_APPROVAL_ENV,
  SIGNING_KEYS_ENV,
  buildSignedMessage,
  getSigningKeys,
  requireSignedApproval,
  setPinnedSigningKeysForTests,
  verifyPackageSignature,
} from "../../src/connectors/brandcode/signature.js";
import { PINNED_BRANDCODE_SIGNING_KEYS } from "../../src/connectors/brandcode/signing-keys.js";
import { TRUSTED_ORIGINS_ENV } from "../../src/connectors/brandcode/trust.js";
import { canonicalJson, computePackageDigest } from "../../src/lib/package-digest.js";
import { readApprovalState, resolveEffectiveApproval } from "../../src/lib/approval-state.js";
import { checkProvenanceIntegrity } from "../../src/lib/provenance-integrity.js";
import { BrandDir } from "../../src/lib/brand-dir.js";

// Shared with UCS (tests/studio/fixtures/brand-package-signature-vector.json).
const vector = JSON.parse(
  readFileSync(new URL("./fixtures/package-signature-vector.json", import.meta.url), "utf8"),
) as {
  package: Record<string, unknown>;
  canonical: string;
  digest: string;
  signedMessage: string;
  publicKeyPem: string;
  publicKeyBase64: string;
  signature: { alg: string; keyId: string; digest: string; sig: string; signedAt: string };
};

const STUDIO = "https://www.brandcode.studio";
const STAGING = "https://staging.brandcode.example";
const ENV_KEYS = [TRUSTED_ORIGINS_ENV, SIGNING_KEYS_ENV, REQUIRE_SIGNED_APPROVAL_ENV];

interface TestKey {
  keyId: string;
  privateKey: KeyObject;
  publicPem: string;
}

function makeKey(keyId: string): TestKey {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    keyId,
    privateKey,
    publicPem: publicKey.export({ format: "pem", type: "spki" }).toString(),
  };
}

function signWith(
  payload: unknown,
  key: TestKey,
  overrides: { keyId?: string; digest?: string } = {},
) {
  const keyId = overrides.keyId ?? key.keyId;
  const digest = overrides.digest ?? `sha256:${computePackageDigest(payload)}`;
  const signedAt = "2026-10-25T12:00:00.000Z";
  const sig = sign(
    null,
    Buffer.from(buildSignedMessage({ keyId, signedAt, digest }), "utf8"),
    key.privateKey,
  ).toString("base64");
  return { alg: "Ed25519", keyId, digest, sig, signedAt };
}

const studioKey = makeKey("studio-2026-10");
const pkg = { slug: "acme", approval: "production_approved", identity: { name: "Acme" } };

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  setPinnedSigningKeysForTests([
    { keyId: studioKey.keyId, publicKey: studioKey.publicPem, status: "active" },
  ]);
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  setPinnedSigningKeysForTests();
  setBrandcodeTransportForTests();
  vi.restoreAllMocks();
});

// ── Shared vector ───────────────────────────────────────────────────────

describe("shared canonicalization test vector (matches UCS)", () => {
  it("canonical JSON and digest match byte for byte", () => {
    expect(canonicalJson(vector.package)).toBe(vector.canonical);
    expect(`sha256:${computePackageDigest(vector.package)}`).toBe(vector.digest);
  });

  it("the signed message format matches and the vector signature verifies", () => {
    expect(buildSignedMessage(vector.signature)).toBe(vector.signedMessage);
    for (const publicKey of [vector.publicKeyPem, vector.publicKeyBase64]) {
      setPinnedSigningKeysForTests([
        { keyId: vector.signature.keyId, publicKey, status: "retired" },
      ]);
      expect(verifyPackageSignature(vector.package, vector.signature)).toMatchObject({
        status: "verified",
        key_id: vector.signature.keyId,
        key_source: "pinned",
      });
    }
  });
});

// ── Verification ────────────────────────────────────────────────────────

describe("verifyPackageSignature", () => {
  it("absent signature is unsigned", () => {
    expect(verifyPackageSignature(pkg, undefined).status).toBe("unsigned");
    expect(verifyPackageSignature(pkg, null).status).toBe("unsigned");
  });

  it("verifies a valid signature regardless of key order in the payload", () => {
    const signature = signWith(pkg, studioKey);
    const reordered = { identity: { name: "Acme" }, approval: "production_approved", slug: "acme" };
    expect(verifyPackageSignature(reordered, signature)).toMatchObject({ status: "verified" });
  });

  it("rejects a tampered body (digest mismatch)", () => {
    const signature = signWith(pkg, studioKey);
    const tampered = { ...pkg, identity: { name: "Evil" } };
    expect(verifyPackageSignature(tampered, signature)).toMatchObject({
      status: "invalid",
      reason: "digest_mismatch",
    });
  });

  it("rejects a tampered body whose digest field was rewritten to match", () => {
    const tampered = { ...pkg, identity: { name: "Evil" } };
    const signature = {
      ...signWith(pkg, studioKey),
      digest: `sha256:${computePackageDigest(tampered)}`,
    };
    expect(verifyPackageSignature(tampered, signature)).toMatchObject({
      status: "invalid",
      reason: "bad_signature",
    });
  });

  it("rejects a signature made with the wrong key under a pinned keyId", () => {
    const attacker = makeKey("attacker");
    const signature = signWith(pkg, attacker, { keyId: studioKey.keyId });
    expect(verifyPackageSignature(pkg, signature)).toMatchObject({
      status: "invalid",
      reason: "bad_signature",
    });
  });

  it("rejects an unknown keyId", () => {
    const signature = signWith(pkg, makeKey("someone-else"));
    expect(verifyPackageSignature(pkg, signature)).toMatchObject({
      status: "invalid",
      reason: "unknown_key",
    });
  });

  it("rejects malformed and unsupported signatures", () => {
    expect(verifyPackageSignature(pkg, "nope")).toMatchObject({ reason: "malformed" });
    expect(verifyPackageSignature(pkg, { alg: "Ed25519" })).toMatchObject({ reason: "malformed" });
    expect(
      verifyPackageSignature(pkg, { ...signWith(pkg, studioKey), alg: "RS256" }),
    ).toMatchObject({ reason: "unsupported_alg" });
  });

  it("pins exactly one active Studio key and allows unsigned approval by default", () => {
    expect(PINNED_BRANDCODE_SIGNING_KEYS.map((k) => [k.keyId, k.status])).toEqual([["studio-2026-10", "active"]]);
    expect(REQUIRE_SIGNED_APPROVAL_DEFAULT).toBe(false);
    expect(requireSignedApproval({})).toBe(false);
    expect(requireSignedApproval({ [REQUIRE_SIGNED_APPROVAL_ENV]: "true" })).toBe(true);
    expect(requireSignedApproval({ [REQUIRE_SIGNED_APPROVAL_ENV]: "1" })).toBe(true);
  });
});

describe("BRANDCODE_STUDIO_SIGNING_KEYS (non-default studios only)", () => {
  const stagingKey = makeKey("staging-1");

  it("verifies only packages served by the key's own non-default origin", () => {
    process.env[SIGNING_KEYS_ENV] = JSON.stringify([
      { origin: STAGING, keyId: stagingKey.keyId, publicKey: stagingKey.publicPem },
    ]);
    const signature = signWith(pkg, stagingKey);
    expect(verifyPackageSignature(pkg, signature, { origin: `${STAGING}/start/brands/acme` }))
      .toMatchObject({ status: "verified", key_source: "env" });
    expect(verifyPackageSignature(pkg, signature, { origin: "https://other.example" }))
      .toMatchObject({ status: "invalid", reason: "unknown_key" });
    expect(verifyPackageSignature(pkg, signature)).toMatchObject({ reason: "unknown_key" });
  });

  it("ignores env keys that name a default Studio origin", () => {
    process.env[SIGNING_KEYS_ENV] = JSON.stringify([
      { origin: STUDIO, keyId: stagingKey.keyId, publicKey: stagingKey.publicPem },
    ]);
    expect(getSigningKeys(STUDIO).map((k) => k.keyId)).toEqual([studioKey.keyId]);
    expect(verifyPackageSignature(pkg, signWith(pkg, stagingKey), { origin: STUDIO }))
      .toMatchObject({ reason: "unknown_key" });
  });

  it("never lets an env key override a pinned keyId", () => {
    const impostor = makeKey(studioKey.keyId);
    process.env[SIGNING_KEYS_ENV] = JSON.stringify([
      { origin: STAGING, keyId: studioKey.keyId, publicKey: impostor.publicPem },
    ]);
    expect(verifyPackageSignature(pkg, signWith(pkg, impostor), { origin: STAGING }))
      .toMatchObject({ status: "invalid", reason: "bad_signature" });
  });

  it("tolerates garbage env values", () => {
    process.env[SIGNING_KEYS_ENV] = "{not json";
    expect(getSigningKeys(STAGING)).toHaveLength(1);
    process.env[SIGNING_KEYS_ENV] = JSON.stringify([{ origin: "http://evil.example", keyId: "x", publicKey: "y" }]);
    expect(getSigningKeys("http://evil.example")).toHaveLength(1);
  });
});

// ── Approval policy ─────────────────────────────────────────────────────

describe("approval policy with signatures", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "bc-sig-"));
    await new BrandDir(cwd).initBrand({
      schema_version: "0.1.0",
      session: 1,
      client_name: "acme",
      created_at: "2026-10-01T00:00:00Z",
    });
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  async function noApprovalFile(): Promise<void> {
    await expect(access(join(cwd, ".brand", "approval.json"))).rejects.toThrow();
    expect(await resolveEffectiveApproval(cwd)).toBe("provisional_extracted");
  }

  it("a valid signature confers and records the signing key", async () => {
    const result = await persistPulledPackage(cwd, pkg, {
      origin: STUDIO,
      signature: signWith(pkg, studioKey),
    });
    expect(result.approval).toBe("conferred");
    expect(result.signature).toMatchObject({ status: "verified", key_id: studioKey.keyId });
    expect((await readApprovalState(cwd))?.signature_key_id).toBe(studioKey.keyId);
    expect(await resolveEffectiveApproval(cwd)).toBe("production_approved");
    const stored = JSON.parse(await readFile(join(cwd, ".brand", "brandcode-package.sig.json"), "utf8"));
    expect(stored.keyId).toBe(studioKey.keyId);
  });

  it("a valid signature is portable: it confers even from an untrusted origin", async () => {
    const result = await persistPulledPackage(cwd, pkg, {
      origin: "https://mirror.example",
      signature: signWith(pkg, studioKey),
    });
    expect(result.approval).toBe("conferred");
    expect(await resolveEffectiveApproval(cwd)).toBe("production_approved");
  });

  it("a valid signature still respects the empty-local-sources rule", async () => {
    await writeFile(join(cwd, ".brand", "messaging.yaml"), "voice: {}\n");
    const result = await persistPulledPackage(cwd, pkg, {
      origin: STUDIO,
      signature: signWith(pkg, studioKey),
    });
    expect(result.approval).toBe("local_sources_present");
  });

  it("a tampered body is refused even from the trusted origin", async () => {
    const tampered = { ...pkg, identity: { name: "Evil" } };
    const result = await persistPulledPackage(cwd, tampered, {
      origin: STUDIO,
      signature: signWith(pkg, studioKey),
    });
    expect(result.approval).toBe("signature_invalid");
    expect(result.signature.reason).toBe("digest_mismatch");
    await noApprovalFile();
  });

  it("a wrong-key signature is refused", async () => {
    const result = await persistPulledPackage(cwd, pkg, {
      origin: STUDIO,
      signature: signWith(pkg, makeKey("x"), { keyId: studioKey.keyId }),
    });
    expect(result.approval).toBe("signature_invalid");
    expect(result.signature.reason).toBe("bad_signature");
    await noApprovalFile();
  });

  it("an unknown keyId is refused", async () => {
    expect(
      await writePackagePayload(cwd, pkg, {
        origin: STUDIO,
        signature: signWith(pkg, makeKey("unpinned")),
      }),
    ).toBe("signature_invalid");
    await noApprovalFile();
  });

  it("unsigned + BRANDCODE_REQUIRE_SIGNED_APPROVAL=true is refused", async () => {
    process.env[REQUIRE_SIGNED_APPROVAL_ENV] = "true";
    const result = await persistPulledPackage(cwd, pkg, { origin: STUDIO });
    expect(result).toMatchObject({ approval: "unsigned_refused", signature: { status: "unsigned" } });
    await noApprovalFile();
  });

  it("unsigned + require=false keeps the trusted-origin behavior", async () => {
    expect(await writePackagePayload(cwd, pkg, { origin: "https://evil.example" })).toBe(
      "untrusted_origin",
    );
    await noApprovalFile();
    const result = await persistPulledPackage(cwd, pkg, { origin: STUDIO });
    expect(result).toMatchObject({ approval: "conferred", signature: { status: "unsigned" } });
    expect((await readApprovalState(cwd))?.signature_key_id).toBeUndefined();
    expect(await resolveEffectiveApproval(cwd)).toBe("production_approved");

    // Turning the requirement on later demotes the unsigned approval.
    process.env[REQUIRE_SIGNED_APPROVAL_ENV] = "true";
    expect(await resolveEffectiveApproval(cwd)).toBe("provisional_extracted");
  });

  it("a signed approval demotes when the stored signature is tampered or removed", async () => {
    await persistPulledPackage(cwd, pkg, { origin: STUDIO, signature: signWith(pkg, studioKey) });
    const sigPath = join(cwd, ".brand", "brandcode-package.sig.json");
    const original = await readFile(sigPath, "utf8");

    const forged = JSON.parse(original);
    forged.sig = Buffer.alloc(64, 1).toString("base64");
    await writeFile(sigPath, JSON.stringify(forged));
    expect(await resolveEffectiveApproval(cwd)).toBe("provisional_extracted");

    await rm(sigPath);
    expect(await resolveEffectiveApproval(cwd)).toBe("provisional_extracted");

    await writeFile(sigPath, original);
    expect(await resolveEffectiveApproval(cwd)).toBe("production_approved");
  });

  it("a signed approval demotes when its key is no longer pinned", async () => {
    await persistPulledPackage(cwd, pkg, { origin: STUDIO, signature: signWith(pkg, studioKey) });
    setPinnedSigningKeysForTests([]);
    expect(await resolveEffectiveApproval(cwd)).toBe("provisional_extracted");
  });

  it("a retired key still verifies", async () => {
    setPinnedSigningKeysForTests([
      { keyId: studioKey.keyId, publicKey: studioKey.publicPem, status: "retired" },
    ]);
    expect(
      await writePackagePayload(cwd, pkg, { origin: STUDIO, signature: signWith(pkg, studioKey) }),
    ).toBe("conferred");
  });

  it("a later unsigned pull removes the stale signature file", async () => {
    await persistPulledPackage(cwd, pkg, { origin: STUDIO, signature: signWith(pkg, studioKey) });
    await persistPulledPackage(cwd, { slug: "acme" }, { origin: STUDIO });
    await expect(access(join(cwd, ".brand", "brandcode-package.sig.json"))).rejects.toThrow();
  });
});

// ── Provenance detector ─────────────────────────────────────────────────

describe("provenance-integrity flags tampered signed packages", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "bc-sig-prov-"));
    await new BrandDir(cwd).initBrand({
      schema_version: "0.1.0",
      session: 1,
      client_name: "acme",
      created_at: "2026-10-01T00:00:00Z",
    });
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  function sigFinding(findings: Awaited<ReturnType<typeof checkProvenanceIntegrity>>) {
    return findings.find((f) => f.check === "Provenance: Studio package signature");
  }

  it("passes for a verified package and fails once the package is edited", async () => {
    await persistPulledPackage(cwd, pkg, { origin: STUDIO, signature: signWith(pkg, studioKey) });
    expect(sigFinding(await checkProvenanceIntegrity(cwd))).toMatchObject({ status: "pass" });

    const pkgPath = join(cwd, ".brand", "brandcode-package.json");
    const edited = JSON.parse(await readFile(pkgPath, "utf8"));
    edited.identity.name = "Evil";
    await writeFile(pkgPath, JSON.stringify(edited));
    const finding = sigFinding(await checkProvenanceIntegrity(cwd));
    expect(finding?.status).toBe("fail");
    expect(finding?.detail).toMatch(/INVALID/);
  });

  it("fails when the signature of a signed approval is removed", async () => {
    await persistPulledPackage(cwd, pkg, { origin: STUDIO, signature: signWith(pkg, studioKey) });
    await rm(join(cwd, ".brand", "brandcode-package.sig.json"));
    expect(sigFinding(await checkProvenanceIntegrity(cwd))).toMatchObject({ status: "fail" });
  });

  it("does not report a signature finding for a brand with no pulled package", async () => {
    expect(sigFinding(await checkProvenanceIntegrity(cwd))).toBeUndefined();
  });

  it("passes (neutral) for an unsigned package", async () => {
    await mkdir(join(cwd, ".brand"), { recursive: true });
    await persistPulledPackage(cwd, { slug: "acme" }, { origin: STUDIO });
    expect(sigFinding(await checkProvenanceIntegrity(cwd))).toMatchObject({
      status: "pass",
      detail: expect.stringMatching(/unsigned/),
    });
  });
});

// ── Tool responses ──────────────────────────────────────────────────────

describe("connector tools surface the signature outcome", () => {
  let tmpDir: string;
  let prevCwd: string;
  let client: Client;

  function json(body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  function studio(signature: unknown, syncToken = "acme:1", body: Record<string, unknown> = pkg) {
    return async (url: string) => {
      const brand = { slug: "acme", name: "Acme", syncToken, readinessStage: "usable", narrativeCount: 0, assetCount: 0 };
      if (url.endsWith("/connect")) {
        return json({ brand, connect: { sync: { shareTokenRequired: false } } });
      }
      return json({ upToDate: false, brand, delta: null, package: body, signature });
    };
  }

  async function call(name: string, args: Record<string, unknown>) {
    const result = await client.callTool({ name, arguments: args });
    const content = result.content as Array<{ type: string; text: string }>;
    return JSON.parse(content[0].text) as Record<string, unknown>;
  }

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "bc-sig-tools-"));
    prevCwd = process.cwd();
    process.chdir(tmpDir);
    const server = createServer({ profile: "full" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    client = new Client({ name: "sig-test", version: "1.0.0" });
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    process.chdir(prevCwd);
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("brand_brandcode_connect reports signed/verified and confers", async () => {
    setBrandcodeTransportForTests({ trustedFetch: vi.fn(studio(signWith(pkg, studioKey))) });
    const res = await call("brand_brandcode_connect", { url: "acme" });
    expect(res.approval_outcome).toBe("conferred");
    expect(res.package_signature).toMatchObject({ status: "signed/verified", key_id: studioKey.keyId });
  });

  it("brand_brandcode_connect reports unsigned", async () => {
    setBrandcodeTransportForTests({ trustedFetch: vi.fn(studio(undefined)) });
    const res = await call("brand_brandcode_connect", { url: "acme" });
    expect(res.package_signature).toMatchObject({ status: "unsigned" });
  });

  it("brand_brandcode_sync reports signed/invalid for a tampered package and refuses approval", async () => {
    setBrandcodeTransportForTests({ trustedFetch: vi.fn(studio(undefined)) });
    await call("brand_brandcode_connect", { url: "acme" });

    const tampered = { ...pkg, identity: { name: "Evil" } };
    setBrandcodeTransportForTests({
      trustedFetch: vi.fn(studio(signWith(pkg, studioKey), "acme:2", tampered)),
    });
    const res = await call("brand_brandcode_sync", {});
    expect(res.approval_outcome).toBe("signature_invalid");
    expect(res.package_signature).toMatchObject({ status: "signed/invalid", reason: "digest_mismatch" });
    expect(await resolveEffectiveApproval(tmpDir)).toBe("provisional_extracted");
  });
});
