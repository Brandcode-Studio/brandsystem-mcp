/**
 * Hosted asset catalog tools.
 *
 * Reads package asset metadata only. The tools expose official/runtime/
 * production-approved posture and package-safe delivery references, while
 * redacting raw provider URLs and private custody paths.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildResponse, safeParseParams } from "../../lib/response.js";
import type { BrandPackagePayload } from "../../connectors/brandcode/types.js";
import { enforceToolScope } from "../scope.js";
import type { HostedBrandContext } from "../types.js";

const listParamsShape = {
  category: z.string().optional().describe("Filter by asset category."),
  lifecycle: z.string().optional().describe("Filter by lifecycle status."),
  cursor: z.string().optional().describe("Pagination cursor from a prior list response."),
  limit: z.number().int().min(1).max(100).default(25).describe("Page size."),
};

const getParamsShape = {
  asset_id: z.string().describe("Asset identifier from list_brand_assets."),
};

const ListParamsSchema = z.object(listParamsShape);
const GetParamsSchema = z.object(getParamsShape);
type ListParams = z.infer<typeof ListParamsSchema>;

interface HostedAsset {
  id: string;
  title: string;
  category: string | null;
  lifecycle: string | null;
  governance_posture: string;
  format: string | null;
  dimensions: Record<string, unknown> | null;
  description: string | null;
  tags: string[];
  source: string;
  custody: {
    safe_for_mcp: boolean;
    posture: string;
    blocked_private_provider_url: boolean;
  };
  delivery_ref: Record<string, unknown>;
  package_posture: Record<string, unknown>;
  metadata: Record<string, unknown>;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function pickString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return "";
}

function pickBoolean(...values: unknown[]): boolean | null {
  for (const value of values) {
    if (typeof value === "boolean") return value;
  }
  return null;
}

function cleanScalar(value: unknown): unknown {
  if (typeof value === "string") return stripUrls(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  return null;
}

function stripUrls(value: string): string {
  return value.replace(/https?:\/\/\S+/gi, "[redacted-url]");
}

function safeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => stripUrls(item.trim()))
    .filter(Boolean);
}

function dimensionsFrom(asset: Record<string, unknown>): Record<string, unknown> | null {
  const dimensions = asset.dimensions;
  if (isRecord(dimensions)) {
    return sanitizeMetadata(dimensions, ["url", "provider", "private", "blob"]);
  }
  const width = cleanScalar(asset.width);
  const height = cleanScalar(asset.height);
  if (width != null || height != null) {
    return { width, height };
  }
  return null;
}

function lifecycleOf(asset: Record<string, unknown>): string | null {
  return (
    pickString(
      asset.lifecycle,
      asset.lifecycleStatus,
      asset.lifecycle_status,
      asset.status,
      asset.approvalStatus,
      asset.approval_status,
    ) || null
  );
}

function categoryOf(asset: Record<string, unknown>): string | null {
  return (
    pickString(asset.category, asset.kind, asset.type, asset.role, asset.assetType) ||
    null
  );
}

function governancePosture(asset: Record<string, unknown>): string {
  const explicit = pickString(
    asset.governance_posture,
    asset.governancePosture,
    asset.posture,
  ).toLowerCase();
  if (explicit) return explicit.replace(/\s+/g, "_");

  const lifecycle = (lifecycleOf(asset) ?? "").toLowerCase();
  const productionApproved = pickBoolean(
    asset.productionApproved,
    asset.production_approved,
    asset.approvedForProduction,
    asset.approved_for_production,
  );
  const official = pickBoolean(asset.official, asset.isOfficial, asset.canonical);
  const runtime = pickBoolean(asset.runtime, asset.inRuntime, asset.runtimeAsset);

  if (official || lifecycle.includes("official")) return "official";
  if (productionApproved || lifecycle.includes("production")) {
    return "production_approved";
  }
  if (runtime || lifecycle.includes("runtime")) return "runtime";
  if (lifecycle.includes("campaign") || lifecycle.includes("explor")) {
    return "exploratory";
  }
  return "unknown";
}

function isUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function looksPrivateDeliveryUrl(value: string): boolean {
  return /private|provider|raw|blob|blob\.core\.windows\.net|vercel-storage\.com/i.test(
    value,
  );
}

function isTrustedBrandcodePackageUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.toLowerCase();
    return (
      parsed.protocol === "https:" &&
      (hostname === "brandcode.studio" || hostname.endsWith(".brandcode.studio"))
    );
  } catch {
    return false;
  }
}

function hasPrivateCustody(asset: Record<string, unknown>): boolean {
  const custody = [
    asset.custody,
    asset.custodyPosture,
    asset.custody_posture,
    asset.deliveryPosture,
    asset.delivery_posture,
    asset.source,
  ]
    .map((value) => (typeof value === "string" ? value.toLowerCase() : ""))
    .join(" ");
  return /private|provider|raw|blob/.test(custody);
}

function deliveryRef(asset: Record<string, unknown>): {
  ref: Record<string, unknown>;
  blockedPrivateProviderUrl: boolean;
} {
  const packagePath = pickString(
    asset.packagePath,
    asset.package_path,
    asset.packageRef,
    asset.package_ref,
    asset.runtimePackagePath,
    asset.runtime_package_path,
  );
  const packageUrl = pickString(asset.packageUrl, asset.package_url);
  const delivery = asset.deliveryRef ?? asset.delivery_ref;
  if (isRecord(delivery)) {
    const path = pickString(
      delivery.packagePath,
      delivery.package_path,
      delivery.path,
      delivery.ref,
    );
    const posture = pickString(delivery.posture, delivery.delivery_posture);
    if (path) {
      return {
        ref: {
          posture: posture || "package_safe",
          package_path: stripUrls(path),
        },
        blockedPrivateProviderUrl: false,
      };
    }
  }
  if (packagePath) {
    return {
      ref: { posture: "package_safe", package_path: stripUrls(packagePath) },
      blockedPrivateProviderUrl: false,
    };
  }
  if (
    packageUrl &&
    isUrl(packageUrl) &&
    (hasPrivateCustody(asset) || looksPrivateDeliveryUrl(packageUrl))
  ) {
    return {
      ref: {
        posture: "blocked_private_provider_url",
        reason: "No package-safe delivery reference is available for this asset",
      },
      blockedPrivateProviderUrl: true,
    };
  }

  if (packageUrl && isUrl(packageUrl) && isTrustedBrandcodePackageUrl(packageUrl)) {
    return {
      ref: { posture: "package_safe", package_url: packageUrl },
      blockedPrivateProviderUrl: false,
    };
  }

  if (packageUrl && isUrl(packageUrl)) {
    return {
      ref: {
        posture: "blocked_untrusted_package_url",
        reason: "Package delivery URL is not hosted on a trusted Brandcode origin",
      },
      blockedPrivateProviderUrl: true,
    };
  }

  const rawUrl = pickString(
    asset.providerUrl,
    asset.provider_url,
    asset.privateUrl,
    asset.private_url,
    asset.rawUrl,
    asset.raw_url,
    asset.blobUrl,
    asset.blob_url,
    asset.url,
    asset.publicUrl,
    asset.public_url,
  );
  if (rawUrl) {
    return {
      ref: {
        posture: "blocked_private_provider_url",
        reason: "No package-safe delivery reference is available for this asset",
      },
      blockedPrivateProviderUrl: true,
    };
  }
  return {
    ref: {
      posture: "metadata_only",
      reason: "No package-safe delivery reference is present in the hosted package",
    },
    blockedPrivateProviderUrl: false,
  };
}

function packagePosture(asset: Record<string, unknown>, delivery: Record<string, unknown>) {
  return {
    in_runtime_package: Boolean(
      asset.inRuntimePackage ??
        asset.in_runtime_package ??
        pickString(asset.packagePath, asset.package_path),
    ),
    delivery_posture: delivery.posture ?? "metadata_only",
    selected_kit_artifact_support: "not_implemented_in_v1",
  };
}

function sanitizeMetadata(
  source: Record<string, unknown>,
  blockedNeedles: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    const lower = key.toLowerCase();
    if (blockedNeedles.some((needle) => lower.includes(needle))) continue;
    if (typeof value === "string") out[key] = stripUrls(value);
    else if (typeof value === "number" || typeof value === "boolean") out[key] = value;
  }
  return out;
}

function toHostedAsset(
  input: unknown,
  source: string,
  index: number,
): HostedAsset | null {
  if (!isRecord(input)) return null;
  const id =
    pickString(input.id, input.asset_id, input.assetId, input.key, input.slug) ||
    `${source.replace(/[^a-z0-9]+/gi, "-")}-${index + 1}`;
  const title =
    pickString(input.title, input.name, input.label, input.filename, input.fileName) ||
    id;
  const category = categoryOf(input);
  const lifecycle = lifecycleOf(input);
  const delivery = deliveryRef(input);
  const format = pickString(input.format, input.contentType, input.content_type, input.mimeType) || null;
  const description =
    pickString(input.description, input.summary, input.alt, input.altText) || null;

  return {
    id,
    title: stripUrls(title),
    category,
    lifecycle,
    governance_posture: governancePosture(input),
    format,
    dimensions: dimensionsFrom(input),
    description: description ? stripUrls(description) : null,
    tags: safeTags(input.tags),
    source,
    custody: {
      safe_for_mcp: !delivery.blockedPrivateProviderUrl,
      posture: String(delivery.ref.posture ?? "metadata_only"),
      blocked_private_provider_url: delivery.blockedPrivateProviderUrl,
    },
    delivery_ref: delivery.ref,
    package_posture: packagePosture(input, delivery.ref),
    metadata: sanitizeMetadata(input, [
      "url",
      "provider",
      "private",
      "blob",
      "raw",
      "delivery",
      "package",
    ]),
  };
}

function collectAssets(pkg: BrandPackagePayload | null): HostedAsset[] {
  if (!pkg || typeof pkg !== "object") return [];
  const record = pkg as Record<string, unknown>;
  const instance = isRecord(record.brandInstance) ? record.brandInstance : {};
  const data = isRecord(record.brandData) ? record.brandData : {};
  const seen = new Set<string>();
  const out: HostedAsset[] = [];

  const add = (items: unknown[], source: string) => {
    for (const item of items) {
      const asset = toHostedAsset(item, source, out.length);
      if (!asset || seen.has(asset.id)) continue;
      seen.add(asset.id);
      out.push(asset);
    }
  };

  add(asArray(instance.assets), "brandInstance.assets");
  add(asArray(data.assets), "brandData.assets");
  return out;
}

function filterAssets(assets: HostedAsset[], params: ListParams): HostedAsset[] {
  const category = params.category?.trim().toLowerCase();
  const lifecycle = params.lifecycle?.trim().toLowerCase();
  return assets.filter((asset) => {
    if (category) {
      const haystack = [
        asset.category,
        asset.governance_posture,
        asset.title,
        ...asset.tags,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(category)) return false;
    }
    if (lifecycle) {
      const haystack = [
        asset.lifecycle,
        asset.governance_posture,
        asset.custody.posture,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(lifecycle)) return false;
    }
    return true;
  });
}

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  const parsed = Number.parseInt(cursor, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function listAssetSummary(asset: HostedAsset): Record<string, unknown> {
  return {
    id: asset.id,
    title: asset.title,
    category: asset.category,
    lifecycle: asset.lifecycle,
    governance_posture: asset.governance_posture,
    format: asset.format,
    delivery_ref: asset.delivery_ref,
    package_posture: asset.package_posture,
    custody: asset.custody,
    source: asset.source,
  };
}

async function loadAssets(context: HostedBrandContext) {
  const pkg = await context.loadBrandPackage();
  return collectAssets(pkg);
}

export function registerListAssets(
  server: McpServer,
  context: HostedBrandContext,
) {
  server.tool(
    "list_brand_assets",
    "List package-safe hosted brand assets with category/lifecycle filters. Read-only. Returns paginated official/runtime/production-approved posture without raw private provider URLs.",
    listParamsShape,
    async (args) => {
      const scopeError = enforceToolScope("list_brand_assets", context);
      if (scopeError) return scopeError;

      const parsed = safeParseParams(ListParamsSchema, args);
      if (!parsed.success) return parsed.response;

      let assets: HostedAsset[];
      try {
        assets = await loadAssets(context);
      } catch (err) {
        return buildResponse({
          what_happened: `Failed to load hosted assets for "${context.slug}": ${(err as Error).message}`,
          next_steps: [
            "Retry in a moment — the hosted brand service may be temporarily unavailable",
          ],
          data: { error: "fetch_failed", slug: context.slug },
        });
      }

      const filtered = filterAssets(assets, parsed.data);
      const start = decodeCursor(parsed.data.cursor);
      const page = filtered.slice(start, start + parsed.data.limit);
      const nextIndex = start + page.length;
      const nextCursor = nextIndex < filtered.length ? String(nextIndex) : null;

      return buildResponse({
        what_happened:
          page.length > 0
            ? `Listed ${page.length} hosted brand asset${page.length === 1 ? "" : "s"} for "${context.slug}"`
            : `No hosted brand assets matched the requested filters for "${context.slug}"`,
        next_steps:
          page.length > 0
            ? ["Use get_brand_asset with an asset id for full metadata and delivery posture"]
            : ["Try a broader category or lifecycle filter"],
        data: {
          assets: page.map(listAssetSummary),
          total_assets: filtered.length,
          next_cursor: nextCursor,
          filters: {
            category: parsed.data.category ?? null,
            lifecycle: parsed.data.lifecycle ?? null,
          },
          custody_safe: true,
          selected_kit_artifact_support: "not_implemented_in_v1",
          slug: context.slug,
          environment: context.auth.environment,
        },
      });
    },
  );
}

export function registerGetAsset(
  server: McpServer,
  context: HostedBrandContext,
) {
  server.tool(
    "get_brand_asset",
    "Get one package-safe hosted brand asset by id. Read-only. Returns metadata, official/runtime/production-approved posture, and safe delivery refs without raw private provider URLs.",
    getParamsShape,
    async (args) => {
      const scopeError = enforceToolScope("get_brand_asset", context);
      if (scopeError) return scopeError;

      const parsed = safeParseParams(GetParamsSchema, args);
      if (!parsed.success) return parsed.response;

      let assets: HostedAsset[];
      try {
        assets = await loadAssets(context);
      } catch (err) {
        return buildResponse({
          what_happened: `Failed to load hosted assets for "${context.slug}": ${(err as Error).message}`,
          next_steps: [
            "Retry in a moment — the hosted brand service may be temporarily unavailable",
          ],
          data: { error: "fetch_failed", slug: context.slug },
        });
      }

      const asset = assets.find((item) => item.id === parsed.data.asset_id);
      if (!asset) {
        return buildResponse({
          what_happened: `No hosted brand asset found for "${parsed.data.asset_id}"`,
          next_steps: ["Call list_brand_assets to inspect available asset ids"],
          data: {
            error: "asset_not_found",
            asset_id: parsed.data.asset_id,
            slug: context.slug,
          },
        });
      }

      return buildResponse({
        what_happened: `Loaded hosted brand asset "${asset.id}" for "${context.slug}"`,
        next_steps: [
          asset.custody.safe_for_mcp
            ? "Use delivery_ref only; raw provider URLs are intentionally omitted"
            : "Use Brand Console or Runtime Admin to publish a package-safe asset reference before using this asset",
        ],
        data: {
          asset,
          custody_safe: true,
          selected_kit_artifact_support: "not_implemented_in_v1",
          slug: context.slug,
          environment: context.auth.environment,
        },
      });
    },
  );
}
