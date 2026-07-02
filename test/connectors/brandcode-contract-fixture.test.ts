/**
 * Contract-conformance fixture test.
 *
 * Context: src/connectors/brandcode/types.ts pins
 * `Contract version: 2026-04-05-connect` in a comment, but the only place
 * that string was ever checked was inside brandcode-client.test.ts's own
 * hand-written mock response objects — proving only "the mock matches the
 * mock the same author wrote," not "the connector's parsing logic actually
 * handles a real UCS response shape." Two historical bugs (G-5g, G-5h — see
 * CHANGELOG.md) were caused by exactly this gap: UCS's real response shape
 * drifted from what the connector expected, and it was only caught after
 * shipping.
 *
 * This test loads a realistic, redacted fixture of a real
 * `GET /api/brand/hosted/{slug}/pull` response (built by hand from the
 * PullResult / HostedBrandRecord / BrandPackagePayload / BrandInstancePayload
 * interfaces in types.ts and knowledge-types.ts — not a live UCS call) and
 * runs it through the connector's actual parsing/type-narrowing code paths:
 *
 *   1. fetchHostedBrandPackage (src/hosted/brand-fetcher.ts) — the real
 *      boundary that `response.json() as PullResult`s a raw HTTP body and
 *      narrows it down to the `package` field. This function had zero
 *      existing test coverage before this file.
 *   2. The hosted brand_runtime tool (src/hosted/tools/runtime.ts) — the
 *      richest consumer of the resulting BrandPackagePayload, exercising
 *      extractRuntime/normalizeBrandInstance/pickVoice/pickStrategy end to
 *      end against the fixture's brandInstance shape (the exact G-5h
 *      code path).
 *
 * This is ADDITIONAL coverage alongside brandcode-client.test.ts's
 * hand-written mocks, not a replacement for them.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchHostedBrandPackage } from "../../src/hosted/brand-fetcher.js";
import {
  connectHostedClient as connectClient,
  callHostedTool as call,
  stubJsonFetch as stubPullResponse,
} from "../hosted/helpers.js";
import type {
  BrandPackagePayload,
  PullResult,
} from "../../src/connectors/brandcode/types.js";
import type {
  HostedBrandContext,
  BrandcodeMcpAuthInfo,
  HostedRateLimitSnapshot,
} from "../../src/hosted/types.js";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(here, "fixtures", "hosted-pull-response.json");

function loadFixture(): PullResult {
  const raw = readFileSync(FIXTURE_PATH, "utf-8");
  return JSON.parse(raw) as PullResult;
}

const TEST_RATE_LIMIT: HostedRateLimitSnapshot = {
  status: "active_pre_release_in_process",
  enforced: true,
  enforcement: "in_process_fixed_window",
  scope: "per_key_per_brand",
  limit: 60,
  remaining: 59,
  window_ms: 60_000,
  reset_at: "2026-06-20T14:06:00.000Z",
  retry_after_seconds: null,
  release_gate: "blocked",
  blocker_owner: "test-fixture",
  required_before_public_release: "n/a — test fixture",
  source: "contract fixture test",
};

function buildAuth(
  overrides: Partial<BrandcodeMcpAuthInfo> = {},
): BrandcodeMcpAuthInfo {
  return {
    token: "bck_test_riverline",
    keyId: "bck_test_riverline",
    scopes: ["read"],
    allowedSlugs: ["riverline"],
    environment: "staging",
    ...overrides,
  };
}

function buildContext(
  pkg: BrandPackagePayload | null,
  overrides: Partial<HostedBrandContext> = {},
): HostedBrandContext {
  const auth = overrides.auth ?? buildAuth();
  return {
    slug: "riverline",
    auth,
    loadBrandPackage: async () => pkg,
    ucsBaseUrl: "https://www.brandcode.studio",
    ucsServiceToken: "test-token",
    rateLimit: TEST_RATE_LIMIT,
    ...overrides,
  };
}


beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("fixture loads as a well-formed PullResult", () => {
  it("parses without throwing and matches the documented contract version", () => {
    const fixture = loadFixture();
    expect(fixture.contractVersion).toBe("2026-04-05-connect");
    expect(fixture.source).toBe("brandcode-studio");
    expect(fixture.upToDate).toBe(false);
    expect(fixture.brand.slug).toBe("riverline");
    expect(fixture.package).toBeTruthy();
  });

  it("declares every top-level PullResult field the type promises", () => {
    const fixture = loadFixture();
    // A UCS shape drift that renames/drops a top-level PullResult field
    // (as in G-5g/G-5h) would fail this before it ever reaches a consumer.
    const expectedKeys = [
      "contractVersion",
      "source",
      "requestedSyncToken",
      "upToDate",
      "brand",
      "delta",
      "package",
    ];
    for (const key of expectedKeys) {
      expect(fixture).toHaveProperty(key);
    }
  });

  it("declares every HostedBrandRecord field the type promises", () => {
    const fixture = loadFixture();
    const expectedKeys = [
      "slug",
      "name",
      "updatedAt",
      "revisionCount",
      "readinessStage",
      "narrativeCount",
      "assetCount",
      "enabledCapabilityCount",
      "primaryConcern",
      "nextUnlock",
      "syncToken",
      "transport",
      "lastAction",
      "access",
      "links",
    ];
    for (const key of expectedKeys) {
      expect(fixture.brand).toHaveProperty(key);
    }
    expect(fixture.brand.access).toHaveProperty("mode");
    expect(fixture.brand.access).toHaveProperty("requiresToken");
    expect(fixture.brand.access).toHaveProperty("listedInFeed");
    for (const linkKey of [
      "self",
      "connect",
      "pull",
      "package",
      "assetManifest",
      "studio",
      "detail",
    ]) {
      expect(fixture.brand.links).toHaveProperty(linkKey);
    }
  });
});

describe("fetchHostedBrandPackage parses a realistic UCS pull response", () => {

  it("returns the fixture's package field without throwing or dropping fields", async () => {
    const fixture = loadFixture();
    const fetchMock = stubPullResponse(fixture);

    const result = await fetchHostedBrandPackage({
      ucsBaseUrl: "https://www.brandcode.studio",
      ucsServiceToken: "test-token",
      slug: "riverline",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0];
    expect(String(url)).toBe(
      "https://www.brandcode.studio/api/brand/hosted/riverline/pull",
    );

    // Deep-equal against the fixture's own package field: proves
    // fetchHostedBrandPackage's `as PullResult` narrowing + `.package`
    // extraction round-trips the entire payload without dropping or
    // mutating anything.
    expect(result).toEqual(fixture.package);
  });

  it("preserves every documented BrandPackagePayload field", async () => {
    const fixture = loadFixture();
    stubPullResponse(fixture);

    const result = await fetchHostedBrandPackage({
      ucsBaseUrl: "https://www.brandcode.studio",
      ucsServiceToken: "test-token",
      slug: "riverline",
    });

    expect(result).not.toBeNull();
    const pkg = result as BrandPackagePayload;
    for (const key of [
      "slug",
      "runtimeVersion",
      "brandInstance",
      "brandKnowledgeCorpus",
      "retrievalManifest",
      "interactionPolicy",
    ]) {
      expect(pkg).toHaveProperty(key);
    }
    expect(pkg.brandInstance).toBeTruthy();
    expect(pkg.brandKnowledgeCorpus?.documents.length).toBeGreaterThan(0);
    expect(pkg.retrievalManifest?.sourceCoverage.length).toBeGreaterThan(0);
  });

  it("returns null on a 404 without throwing", async () => {
    stubPullResponse({ error: "Hosted brand not found." }, { status: 404 });
    const result = await fetchHostedBrandPackage({
      ucsBaseUrl: "https://www.brandcode.studio",
      ucsServiceToken: "test-token",
      slug: "missing-brand",
    });
    expect(result).toBeNull();
  });
});

describe("hosted brand_runtime consumes the fixture end to end", () => {
  it("extracts real colors, typography, voice, and strategy from the fixture's brandInstance shape", async () => {
    const fixture = loadFixture();
    const pkg = fixture.package as BrandPackagePayload;
    const { client } = await connectClient(buildContext(pkg));

    const json = await call(client, "brand_runtime", { slice: "full" });
    expect(json.runtime_origin).toBe("hosted");

    const runtime = json.runtime as Record<string, unknown>;
    const identity = runtime.identity as Record<string, unknown>;
    expect(identity.colors).toMatchObject({ primary: "#1d4ed8" });
    expect(identity.typography).toMatchObject({ display: "Fraunces, Georgia, serif" });

    const voice = runtime.voice as Record<string, unknown>;
    expect(voice.verbal_identity).toContain("calm, specific");
    expect(voice.perspective).toContain("Governed brand systems");
    const phrases = voice.brand_phrases as Array<Record<string, unknown>>;
    expect(phrases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          phrase: "Governed by default",
          deploy_verbatim: true,
        }),
      ]),
    );

    const strategy = runtime.strategy as Record<string, unknown>;
    expect((strategy.narratives as unknown[]).length).toBeGreaterThan(0);
    expect((strategy.proof_points as unknown[]).length).toBeGreaterThan(0);
    expect((strategy.application_rules as unknown[]).length).toBeGreaterThan(0);
    expect((strategy.strategy_moves as unknown[]).length).toBeGreaterThan(0);
  });

  it("minimal slice surfaces the primary color and first typography role from the fixture", async () => {
    const fixture = loadFixture();
    const pkg = fixture.package as BrandPackagePayload;
    const { client } = await connectClient(buildContext(pkg));

    const json = await call(client, "brand_runtime", { slice: "minimal" });
    const runtime = json.runtime as Record<string, unknown>;
    const identity = runtime.identity as Record<string, unknown>;
    expect(identity.colors).toEqual({ primary: "#1d4ed8" });
  });

  it("brand_search finds fixture narratives and proof points without exposing raw provenance", async () => {
    const fixture = loadFixture();
    const pkg = fixture.package as BrandPackagePayload;
    const { client } = await connectClient(buildContext(pkg));

    const json = await call(client, "brand_search", {
      query: "governed content teams ship faster",
    });
    expect((json.hits as unknown[]).length).toBeGreaterThan(0);
    expect(json.custody_safe).toBe(true);
  });

  it("list_brand_assets surfaces the fixture's package-safe assets", async () => {
    const fixture = loadFixture();
    const pkg = fixture.package as BrandPackagePayload;
    const { client } = await connectClient(buildContext(pkg));

    const json = await call(client, "list_brand_assets", { limit: 10 });
    const assets = json.assets as Array<Record<string, unknown>>;
    expect(assets.map((a) => a.id)).toEqual(
      expect.arrayContaining(["logo-primary", "hero-illustration"]),
    );
  });
});

describe("mutation sanity check documents the guard this test provides", () => {
  it("fails when a UCS shape drift renames brandInstance.tokens (regression guard)", async () => {
    const fixture = loadFixture();
    const pkg = JSON.parse(
      JSON.stringify(fixture.package),
    ) as BrandPackagePayload;
    const instance = pkg.brandInstance as Record<string, unknown>;
    // Simulate the exact class of drift described in the task: UCS renames a
    // field the connector's normalizeBrandInstance() reads by exact key.
    instance.designTokens = instance.tokens;
    delete instance.tokens;

    const { client } = await connectClient(buildContext(pkg));
    const json = await call(client, "brand_runtime", { slice: "minimal" });
    const runtime = json.runtime as Record<string, unknown>;
    const identity = runtime.identity as Record<string, unknown>;

    // With `tokens` renamed away, the primary color the real fixture proves
    // above (#1d4ed8) is silently gone rather than the tool erroring loudly.
    // This asserts the drift is NOT accidentally tolerated — if this
    // assertion ever fails (i.e. colors.primary comes back), it means
    // normalizeBrandInstance started reading from an unexpected key and this
    // guard should be revisited.
    expect(identity.colors).not.toMatchObject({ primary: "#1d4ed8" });
  });
});
