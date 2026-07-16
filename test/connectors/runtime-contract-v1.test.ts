import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { BrandPackagePayload } from "../../src/connectors/brandcode/types.js";
import {
  BRANDCODE_RUNTIME_CONTRACT_V1,
  RuntimeContractValidationError,
  normalizeRuntimeContract,
  normalizeRuntimeContractFromPackage,
  sliceRuntimeContract,
} from "../../src/connectors/brandcode/runtime-contract/index.js";
import type { HostedBrandContext } from "../../src/hosted/types.js";
import { callHostedTool, connectHostedClient } from "../hosted/helpers.js";

const fixtureDirectory = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures/runtime-contract-v1",
);

async function fixture(name: string): Promise<Record<string, unknown>> {
  return JSON.parse(
    await readFile(join(fixtureDirectory, name), "utf8"),
  ) as Record<string, unknown>;
}

function context(pkg: BrandPackagePayload): HostedBrandContext {
  return {
    slug: "acme",
    auth: {
      token: "bck_test_acme",
      keyId: "bck_test_acme",
      scopes: ["read"],
      allowedSlugs: ["acme"],
      environment: "staging",
    },
    loadBrandPackage: async () => pkg,
    loadTasteGuidance: async () => null,
    ucsBaseUrl: "https://www.brandcode.studio",
    ucsServiceToken: "test-token",
  };
}

describe("UCS runtime contract V1 fixture pin", () => {
  it("matches the exact canonical MCPX-5A fixture bytes", async () => {
    const source = await fixture("SOURCE.json");
    expect(source.canonicalImplementationCommit).toBe(
      "068f06ed31df568986f045753fd7ef7166c14d1e",
    );
    const hashes = source.sha256 as Record<string, string>;
    for (const [name, expected] of Object.entries(hashes)) {
      const bytes = await readFile(join(fixtureDirectory, name));
      expect(createHash("sha256").update(bytes).digest("hex"), name).toBe(
        expected,
      );
    }
  });

  it("keeps the canonical fixture manifest and non-claim intact", async () => {
    const manifest = await fixture("manifest.json");
    expect(manifest.contractVersion).toBe(BRANDCODE_RUNTIME_CONTRACT_V1);
    expect(manifest.compatiblePreviousVersion).toBe(
      "brandcode-runtime-contract/v0.9",
    );
    expect(String(manifest.nonClaim)).toContain("not external MCP adoption");
  });
});

describe("external runtime contract V1 normalization", () => {
  it("preserves explicit authority objects, reviewed Taste, warnings, and ordering", async () => {
    const source = await fixture("current-producer.json");
    const result = normalizeRuntimeContract(source);

    expect(result.negotiation).toEqual({
      producerVersion: BRANDCODE_RUNTIME_CONTRACT_V1,
      consumerVersion: BRANDCODE_RUNTIME_CONTRACT_V1,
      status: "exact",
      warnings: [],
    });
    expect(result.runtime.manifest).toMatchObject({
      objectType: "full_brand_runtime",
      authority: "compiled_runtime",
    });
    expect(result.runtime.officialBrand.authority).toBe("official");
    expect(result.runtime.assets[0]?.authority).toBe("production_approved");
    expect(result.runtime.assets[0]?.deliveryHandle).toEqual({
      assetId: "logo-primary",
      brandSlug: "acme",
      resolverRef: "/assets/logo.svg",
      transport: "package_path",
      posture: "package_non_expiring",
      integritySha256: "a".repeat(64),
      expiresAt: null,
    });
    expect(result.runtime.kits.selected?.authority).toBe("selected_context");
    expect(result.runtime.kits.selected?.memberAssetIds).toEqual([
      "exploratory-concept",
      "logo-primary",
    ]);
    expect(result.runtime.kits.campaigns[0]?.authority).toBe(
      "exploratory_context",
    );
    expect(result.runtime.tasteGuidance).toEqual([
      expect.objectContaining({
        id: "taste-1",
        reviewStatus: "approved",
        authority: "reviewed_memory",
      }),
    ]);
    expect(result.runtime.strategy.moves.map((entry) => entry.id)).toEqual([
      "1",
      "2",
    ]);
    expect(result.runtime.interactionPolicy.supportedSurfaces).toEqual([
      "chef",
      "kitchen",
      "messaging",
    ]);
    expect(result.runtime.capabilityWarnings).toEqual([
      { code: "asset:hero", message: "No approved hero image is available." },
    ]);
    expect(result.runtime).not.toHaveProperty("futureConsumerHint");
  });

  it("negotiates the compatible previous producer with an explicit warning", async () => {
    const result = normalizeRuntimeContract(
      await fixture("previous-producer.json"),
    );
    expect(result.negotiation.status).toBe("compatible_previous");
    expect(result.negotiation.producerVersion).toBe(
      "brandcode-runtime-contract/v0.9",
    );
    expect(result.negotiation.warnings).toEqual([
      "Normalized compatible previous producer brandcode-runtime-contract/v0.9.",
    ]);
    expect(result.runtime.officialBrand).toMatchObject({
      objectType: "official_brand",
      authority: "official",
    });
  });

  it("is deterministic when producer arrays arrive in a different order", async () => {
    const source = await fixture("current-producer.json");
    const reordered = structuredClone(source);
    (reordered.voice as { phrases: unknown[] }).phrases.reverse();
    (reordered.strategy as { moves: unknown[] }).moves.reverse();
    (reordered.knowledge as { descriptors: unknown[] }).descriptors.reverse();
    const policy = reordered.interactionPolicy as {
      supportedSurfaces: unknown[];
      rules: unknown[];
    };
    policy.supportedSurfaces.reverse();
    policy.rules.reverse();
    const assets = reordered.assets as Array<{ runtimeRoles: unknown[] }>;
    assets[0]?.runtimeRoles.reverse();
    expect(normalizeRuntimeContract(reordered).runtime).toEqual(
      normalizeRuntimeContract(source).runtime,
    );
  });

  it("fails missing semantics and unsupported major versions explicitly", async () => {
    for (const [name, issue] of [
      ["missing-required-semantic.json", "officialBrand"],
      ["unsupported-major.json", "unsupported major version"],
    ] as const) {
      const source = await fixture(name);
      try {
        normalizeRuntimeContract(source);
        throw new Error("expected normalization to fail");
      } catch (error) {
        expect(error).toBeInstanceOf(RuntimeContractValidationError);
        expect(
          (error as RuntimeContractValidationError).issues.some((entry) =>
            entry.includes(issue),
          ),
        ).toBe(true);
      }
    }
  });

  it("fails unsafe, mismatched, and integrity-free delivery handles closed", async () => {
    const source = await fixture("invalid-delivery-handle.json");
    expect(() => normalizeRuntimeContract(source)).toThrow(
      "must use a trusted Brandcode HTTPS origin",
    );

    const mismatch = await fixture("current-producer.json");
    const assets = mismatch.assets as Array<Record<string, unknown>>;
    const handle = assets[0]?.deliveryHandle as Record<string, unknown>;
    handle.assetId = "other-asset";
    handle.brandSlug = "wrong-brand";
    try {
      normalizeRuntimeContract(mismatch);
      throw new Error("expected identity binding to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(RuntimeContractValidationError);
      expect((error as RuntimeContractValidationError).issues).toEqual(
        expect.arrayContaining([
          expect.stringContaining("assetId must match"),
          expect.stringContaining("brandSlug must match"),
        ]),
      );
    }
  });

  it("rejects malformed or tampered integrity digests", async () => {
    const source = await fixture("current-producer.json");
    const assets = source.assets as Array<Record<string, unknown>>;
    const handle = assets[0]?.deliveryHandle as Record<string, unknown>;
    handle.integritySha256 = "tampered";
    expect(() => normalizeRuntimeContract(source)).toThrow(
      "must be a lowercase SHA-256 digest",
    );
  });

  it("rejects double-encoded package traversal", async () => {
    const source = await fixture("current-producer.json");
    const assets = source.assets as Array<Record<string, unknown>>;
    const handle = assets[0]?.deliveryHandle as Record<string, unknown>;
    handle.resolverRef = "/assets/%252e%252e/private/logo.svg";
    expect(() => normalizeRuntimeContract(source)).toThrow(
      "safe root-relative package path",
    );
  });

  it("rejects unreviewed Taste instead of inferring approved authority", async () => {
    const source = await fixture("current-producer.json");
    const guidance = source.tasteGuidance as Array<Record<string, unknown>>;
    if (guidance[0]) guidance[0].reviewStatus = "candidate";
    expect(() => normalizeRuntimeContract(source)).toThrow(
      "tasteGuidance[0].reviewStatus must equal approved",
    );
  });
});

describe("hosted runtime ingress adoption", () => {
  it("negotiates a canonical contract carried at the existing runtime ingress", async () => {
    const source = await fixture("current-producer.json");
    const pkg = { runtime: source } as BrandPackagePayload;
    const ingress = normalizeRuntimeContractFromPackage(pkg);
    expect(ingress?.runtime.officialBrand.authority).toBe("official");

    const { client } = await connectHostedClient(context(pkg));
    const response = await callHostedTool(client, "brand_runtime", {
      slice: "full",
    });
    expect(response.runtime_contract_negotiation).toMatchObject({
      status: "exact",
    });
    expect(response.runtime).toMatchObject({
      schemaVersion: BRANDCODE_RUNTIME_CONTRACT_V1,
      manifest: { authority: "compiled_runtime" },
      officialBrand: { authority: "official" },
      kits: {
        selected: { authority: "selected_context" },
        campaigns: [{ authority: "exploratory_context" }],
      },
    });
  });

  it("preserves authority objects in every canonical slice", async () => {
    const runtime = normalizeRuntimeContract(
      await fixture("current-producer.json"),
    ).runtime;
    for (const slice of ["minimal", "voice", "visual"] as const) {
      const result = sliceRuntimeContract(runtime, slice);
      expect(result.officialBrand).toEqual(runtime.officialBrand);
      expect(result.manifest).toEqual(runtime.manifest);
    }
    expect(sliceRuntimeContract(runtime, "voice")).toHaveProperty(
      "tasteGuidance",
    );
    expect(sliceRuntimeContract(runtime, "visual")).toHaveProperty("assets");
  });

  it("serves governed delivery and selected-kit context without authority inflation", async () => {
    const source = await fixture("current-producer.json");
    const pkg = { runtime: source } as BrandPackagePayload;
    const { client } = await connectHostedClient(context(pkg));
    const listed = await callHostedTool(client, "list_brand_assets", {});
    expect(listed.selected_kit_artifact_support).toBe(
      "implemented_contract_v1",
    );
    expect(listed.total_assets).toBe(1);
    const assets = listed.assets as Array<Record<string, unknown>>;
    expect(assets.map((asset) => asset.id)).toEqual(["logo-primary"]);
    expect(assets[0]).toMatchObject({
      governance_posture: "production_approved",
      delivery_handle: {
        asset_id: "logo-primary",
        brand_slug: "acme",
        transport: "package_path",
        posture: "package_non_expiring",
      },
      selected_kit_context: {
        is_member: true,
        kit_id: "kit-social",
        authority: "selected_context",
      },
    });
    expect(JSON.stringify(listed)).not.toContain('exploratory-concept"');
  });

  it("blocks expired signed handles while retaining production authority metadata", async () => {
    const source = await fixture("current-producer.json");
    const assets = source.assets as Array<Record<string, unknown>>;
    assets[0]!.deliveryHandle = {
      assetId: "logo-primary",
      brandSlug: "acme",
      resolverRef:
        "https://www.brandcode.studio/api/runtime/assets/logo-primary",
      transport: "trusted_brandcode_url",
      posture: "signed_expiring",
      integritySha256: null,
      expiresAt: "2020-01-01T00:00:00.000Z",
    };
    const { client } = await connectHostedClient(
      context({ runtime: source } as BrandPackagePayload),
    );
    const response = await callHostedTool(client, "get_brand_asset", {
      asset_id: "logo-primary",
    });
    expect(response.asset).toMatchObject({
      governance_posture: "production_approved",
      custody: { safe_for_mcp: false },
      delivery_ref: { posture: "blocked_expired_handle" },
      delivery_handle: null,
    });
    expect(JSON.stringify(response)).not.toContain(
      "/api/runtime/assets/logo-primary",
    );
  });

  it("returns a structured incompatibility instead of legacy fallback", async () => {
    const pkg = {
      runtime: await fixture("unsupported-major.json"),
    } as BrandPackagePayload;
    const { client } = await connectHostedClient(context(pkg));
    const response = await callHostedTool(client, "brand_runtime", {
      slice: "full",
    });
    expect(response.error).toBe("runtime_contract_invalid");
    expect(response.contract).toBe(BRANDCODE_RUNTIME_CONTRACT_V1);
    expect(response.issues).toEqual(
      expect.arrayContaining([
        expect.stringContaining("unsupported major version"),
      ]),
    );
  });

  it("leaves legacy packages on the existing compatibility path", () => {
    expect(
      normalizeRuntimeContractFromPackage({
        runtime: { version: "legacy", identity: { colors: {} } },
      }),
    ).toBeNull();
  });
});
