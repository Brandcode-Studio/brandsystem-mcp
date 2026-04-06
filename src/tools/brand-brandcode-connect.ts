import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BrandDir } from "../lib/brand-dir.js";
import { buildResponse, safeParseParams } from "../lib/response.js";
import { SCHEMA_VERSION } from "../schemas/index.js";
import { ERROR_CODES } from "../types/index.js";
import { resolveBrandcodeHostedUrl } from "../connectors/brandcode/resolve.js";
import {
  fetchHostedBrandConnect,
  pullHostedBrand,
} from "../connectors/brandcode/client.js";
import {
  writeConnectorConfig,
  writePackagePayload,
  appendSyncEvent,
} from "../connectors/brandcode/persistence.js";
import type {
  ConnectorConfig,
  SyncHistoryEvent,
} from "../connectors/brandcode/types.js";

const paramsShape = {
  url: z
    .string()
    .describe(
      'Brandcode Studio brand URL or slug. Examples: "https://brandcode.studio/start/brands/pendium", "pendium"',
    ),
  share_token: z
    .string()
    .optional()
    .describe("Share token for protected brands (x-brand-share-token)"),
};

const ParamsSchema = z.object(paramsShape);
type Params = z.infer<typeof ParamsSchema>;

async function handler(input: Params) {
  const brandDir = new BrandDir(process.cwd());

  // Resolve the URL
  let resolved;
  try {
    resolved = resolveBrandcodeHostedUrl(input.url);
  } catch (err) {
    return buildResponse({
      what_happened: `Invalid Brandcode URL: ${(err as Error).message}`,
      next_steps: [
        'Provide a valid Brandcode Studio URL (e.g. "https://brandcode.studio/start/brands/pendium") or a bare slug',
      ],
      data: { error: ERROR_CODES.VALIDATION_FAILED },
    });
  }

  const fetchOpts = input.share_token
    ? { shareToken: input.share_token }
    : undefined;

  // Fetch connect artifact to learn about the brand
  let connectArtifact;
  try {
    connectArtifact = await fetchHostedBrandConnect(resolved, fetchOpts);
  } catch (err) {
    return buildResponse({
      what_happened: `Failed to connect to hosted brand "${resolved.slug}": ${(err as Error).message}`,
      next_steps: [
        "Check that the brand URL is correct and the brand is published",
        "If this is a protected brand, provide a share_token",
      ],
      data: { error: ERROR_CODES.FETCH_FAILED },
    });
  }

  // Pull the full package
  let pullResult;
  try {
    pullResult = await pullHostedBrand(resolved, undefined, fetchOpts);
  } catch (err) {
    return buildResponse({
      what_happened: `Connected but failed to pull brand package: ${(err as Error).message}`,
      next_steps: ["Try again — the pull endpoint may be temporarily unavailable"],
      data: { error: ERROR_CODES.FETCH_FAILED },
    });
  }

  if (!pullResult.package) {
    return buildResponse({
      what_happened: "Pull returned no package data",
      next_steps: ["This is unexpected for a first connection — contact support"],
      data: { error: ERROR_CODES.NO_BRAND_DATA },
    });
  }

  // Scaffold .brand/ if it doesn't exist
  if (!(await brandDir.exists())) {
    const brandName =
      pullResult.brand.name || connectArtifact.brand.name || resolved.slug;
    await brandDir.initBrand({
      schema_version: SCHEMA_VERSION,
      session: 1,
      client_name: brandName,
      website_url: `${resolved.baseUrl}/start/brands/${resolved.slug}`,
      created_at: new Date().toISOString(),
    });
  }

  const cwd = process.cwd();
  const now = new Date().toISOString();

  // Save the raw package
  await writePackagePayload(cwd, pullResult.package);

  // Save connector config
  const connectorConfig: ConnectorConfig = {
    provider: "brandcode",
    brandUrl: `${resolved.baseUrl}/start/brands/${resolved.slug}`,
    slug: resolved.slug,
    pullUrl: resolved.pullUrl,
    connectUrl: resolved.connectUrl,
    syncToken: pullResult.brand.syncToken,
    lastSyncedAt: now,
    shareTokenRequired: connectArtifact.connect.sync.shareTokenRequired,
  };
  await writeConnectorConfig(cwd, connectorConfig);

  // Record sync history
  const changedAreas = pullResult.delta?.changedAreas ?? ["full package"];
  const syncEvent: SyncHistoryEvent = {
    timestamp: now,
    syncMode: "first_sync",
    changedAreas,
    advice: {
      headline: `Connected to "${pullResult.brand.name}"`,
      detail:
        "Brand pulled successfully. Run brand_status to see the imported brand, or brand_brandcode_status to check sync state.",
    },
  };
  await appendSyncEvent(cwd, syncEvent);

  return buildResponse({
    what_happened: `Connected to hosted brand "${pullResult.brand.name}" (${resolved.slug})`,
    next_steps: [
      "Run brand_status to see the imported brand identity",
      "Run brand_brandcode_status to inspect connection and sync details",
      "Run brand_brandcode_sync later to pull updates",
    ],
    data: {
      client_name: pullResult.brand.name,
      slug: resolved.slug,
      sync_mode: "first_sync",
      sync_token: pullResult.brand.syncToken,
      readiness_stage: pullResult.brand.readinessStage,
      narrative_count: pullResult.brand.narrativeCount,
      asset_count: pullResult.brand.assetCount,
      changed_areas: changedAreas,
      connector_file: ".brand/brandcode-connector.json",
      package_file: ".brand/brandcode-package.json",
    },
  });
}

export function register(server: McpServer) {
  server.tool(
    "brand_brandcode_connect",
    'Connect a local .brand/ to a hosted Brandcode Studio brand. Pulls the full brand package and saves connection metadata for future syncs. Use when the user says "connect to Brandcode", "pull from Studio", or provides a brandcode.studio URL. Returns brand name, sync token, and changed areas.',
    paramsShape,
    async (args) => {
      const parsed = safeParseParams(ParamsSchema, args);
      if (!parsed.success) return parsed.response;
      return handler(parsed.data);
    },
  );
}
