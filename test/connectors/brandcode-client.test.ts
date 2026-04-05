import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  fetchHostedBrandConnect,
  fetchHostedBrandDetails,
  fetchHostedBrandList,
  pullHostedBrand,
  BrandcodeClientError,
} from "../../src/connectors/brandcode/client.js";
import type { ResolvedHostedBrand } from "../../src/connectors/brandcode/types.js";

const resolved: ResolvedHostedBrand = {
  slug: "pendium",
  baseUrl: "https://brandcode.studio",
  detailUrl: "https://brandcode.studio/api/brand/hosted/pendium",
  connectUrl: "https://brandcode.studio/api/brand/hosted/pendium/connect",
  pullUrl: "https://brandcode.studio/api/brand/hosted/pendium/pull",
};

const mockBrandRecord = {
  slug: "pendium",
  name: "Pendium",
  updatedAt: "2026-04-05T22:00:00.000Z",
  revisionCount: 3,
  readinessStage: "usable",
  narrativeCount: 5,
  assetCount: 12,
  enabledCapabilityCount: 4,
  primaryConcern: null,
  nextUnlock: null,
  syncToken: "pendium:3:2026-04-05T22:00:00.000Z",
  transport: "blob",
  lastAction: "updated",
  access: { mode: "listed", requiresToken: false, listedInFeed: true },
  links: {
    self: "https://brandcode.studio/api/brand/hosted/pendium",
    connect: "https://brandcode.studio/api/brand/hosted/pendium/connect",
    pull: "https://brandcode.studio/api/brand/hosted/pendium/pull",
    package: "https://brandcode.studio/api/brand/hosted/pendium/package",
    assetManifest: "https://brandcode.studio/api/brand/hosted/pendium/assets",
    studio: "https://brandcode.studio/start/brands/pendium",
    detail: "https://brandcode.studio/api/brand/hosted/pendium",
  },
};

describe("Brandcode client", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetchHostedBrandList calls /api/brand/hosted", async () => {
    const body = {
      contractVersion: "2026-04-05-connect",
      source: "brandcode-studio",
      exportedAt: "2026-04-05T22:00:00.000Z",
      count: 1,
      brands: [mockBrandRecord],
    };
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(body), { status: 200 }),
    );

    const result = await fetchHostedBrandList("https://brandcode.studio");
    expect(result.count).toBe(1);
    expect(result.brands[0].slug).toBe("pendium");
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://brandcode.studio/api/brand/hosted",
      expect.objectContaining({
        headers: expect.objectContaining({ accept: "application/json" }),
      }),
    );
  });

  it("fetchHostedBrandDetails calls the detail URL", async () => {
    const body = {
      contractVersion: "2026-04-05-connect",
      source: "brandcode-studio",
      brand: mockBrandRecord,
    };
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(body), { status: 200 }),
    );

    const result = await fetchHostedBrandDetails(resolved);
    expect(result.brand.slug).toBe("pendium");
  });

  it("fetchHostedBrandConnect returns connect artifact", async () => {
    const body = {
      contractVersion: "2026-04-05-connect",
      source: "brandcode-studio",
      brand: mockBrandRecord,
      connect: {
        strategy: "sync_token_pull",
        files: {
          localSyncState: "remote-sync.json",
          localConnectorConfig: "brandcode-connector.json",
          localPackage: "package.json",
        },
        remote: {
          slug: "pendium",
          detailUrl: resolved.detailUrl,
          connectUrl: resolved.connectUrl,
          pullUrl: resolved.pullUrl,
          packageUrl: "https://brandcode.studio/api/brand/hosted/pendium/package",
          assetManifestUrl:
            "https://brandcode.studio/api/brand/hosted/pendium/assets",
          studioUrl: "https://brandcode.studio/start/brands/pendium",
        },
        sync: {
          currentSyncToken: mockBrandRecord.syncToken,
          shareTokenRequired: false,
          shareTokenTransport: { header: "x-brand-share-token" },
          syncTokenTransport: { queryParam: "syncToken" },
        },
      },
    };
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(body), { status: 200 }),
    );

    const result = await fetchHostedBrandConnect(resolved);
    expect(result.connect.strategy).toBe("sync_token_pull");
    expect(result.connect.sync.currentSyncToken).toBe(
      mockBrandRecord.syncToken,
    );
  });

  it("pullHostedBrand fetches full package without syncToken", async () => {
    const body = {
      contractVersion: "2026-04-05-connect",
      source: "brandcode-studio",
      requestedSyncToken: null,
      upToDate: false,
      brand: mockBrandRecord,
      delta: null,
      package: { slug: "pendium", brandData: {}, brandInstance: {} },
    };
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(body), { status: 200 }),
    );

    const result = await pullHostedBrand(resolved);
    expect(result.upToDate).toBe(false);
    expect(result.package).toBeTruthy();
    expect(fetchSpy).toHaveBeenCalledWith(
      resolved.pullUrl,
      expect.anything(),
    );
  });

  it("pullHostedBrand passes syncToken as query param", async () => {
    const body = {
      contractVersion: "2026-04-05-connect",
      source: "brandcode-studio",
      requestedSyncToken: "pendium:3:2026-04-05T22:00:00.000Z",
      upToDate: true,
      brand: mockBrandRecord,
      delta: null,
      package: null,
    };
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify(body), { status: 200 }),
    );

    const result = await pullHostedBrand(
      resolved,
      "pendium:3:2026-04-05T22:00:00.000Z",
    );
    expect(result.upToDate).toBe(true);
    expect(result.package).toBeNull();
    expect(fetchSpy).toHaveBeenCalledWith(
      expect.stringContaining("?syncToken="),
      expect.anything(),
    );
  });

  it("sends share token header when provided", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          contractVersion: "2026-04-05-connect",
          source: "brandcode-studio",
          brand: mockBrandRecord,
        }),
        { status: 200 },
      ),
    );

    await fetchHostedBrandDetails(resolved, {
      shareToken: "secret-token-123",
    });
    expect(fetchSpy).toHaveBeenCalledWith(
      resolved.detailUrl,
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-brand-share-token": "secret-token-123",
        }),
      }),
    );
  });

  it("throws BrandcodeClientError on 404", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        statusText: "Not Found",
      }),
    );

    await expect(fetchHostedBrandDetails(resolved)).rejects.toThrow(
      BrandcodeClientError,
    );
  });

  it("throws BrandcodeClientError on 403", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: "A valid share token is required" }),
        { status: 403, statusText: "Forbidden" },
      ),
    );

    try {
      await fetchHostedBrandDetails(resolved);
      expect.fail("Should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(BrandcodeClientError);
      expect((err as BrandcodeClientError).status).toBe(403);
    }
  });
});
