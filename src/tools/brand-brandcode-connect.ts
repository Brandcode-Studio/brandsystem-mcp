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
  saveBrandToStudio,
  BrandcodeClientError,
} from "../connectors/brandcode/client.js";
import {
  readConnectorConfig,
  writeConnectorConfig,
  writePackagePayload,
  appendSyncEvent,
} from "../connectors/brandcode/persistence.js";
import { readAuthCredentials } from "../lib/auth-state.js";
import type {
  ConnectorConfig,
  SyncHistoryEvent,
} from "../connectors/brandcode/types.js";

const paramsShape = {
  mode: z
    .enum(["pull", "save"])
    .default("pull")
    .describe(
      '"pull" connects to an existing hosted brand and downloads it. "save" uploads the local .brand/ to Studio (requires auth via brand_brandcode_auth).',
    ),
  url: z
    .string()
    .optional()
    .describe(
      'Brandcode Studio brand URL or slug. Required for mode="pull". Examples: "https://brandcode.studio/start/brands/pendium", "pendium"',
    ),
  share_token: z
    .string()
    .optional()
    .describe("Share token for protected brands (x-brand-share-token)"),
};

const ParamsSchema = z.object(paramsShape);
type Params = z.infer<typeof ParamsSchema>;

async function handlePull(input: Params) {
  const brandDir = new BrandDir(process.cwd());

  if (!input.url) {
    return buildResponse({
      what_happened: "URL is required for pull mode",
      next_steps: [
        'Provide a Brandcode Studio URL or slug: brand_brandcode_connect url="pendium"',
      ],
      data: { error: ERROR_CODES.VALIDATION_FAILED },
    });
  }

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

async function handleSave() {
  const cwd = process.cwd();
  const brandDir = new BrandDir(cwd);

  // Require .brand/ to exist
  if (!(await brandDir.exists())) {
    return buildResponse({
      what_happened: "No .brand/ directory found",
      next_steps: [
        "Run brand_start or brand_init first to create a local brand",
        "Then run brand_brandcode_connect mode=\"save\" to upload it",
      ],
      data: { error: ERROR_CODES.NOT_INITIALIZED },
    });
  }

  // Require auth
  const creds = await readAuthCredentials(cwd);
  if (!creds) {
    return buildResponse({
      what_happened: "Not authenticated — login required to save brands",
      next_steps: [
        'Run brand_brandcode_auth mode="activate" email="you@example.com" to connect — displays a short code, no token copy needed',
      ],
      data: { error: ERROR_CODES.NOT_AUTHENTICATED },
    });
  }

  // Read the brand config to get the name/slug
  let config;
  try {
    config = await brandDir.readConfig();
  } catch {
    return buildResponse({
      what_happened: "Could not read .brand/brand.config.yaml",
      next_steps: ["Run brand_audit to check .brand/ directory health"],
      data: { error: ERROR_CODES.NO_BRAND_DATA },
    });
  }

  // Build the payload — read all available brand files
  const payload: Record<string, unknown> = {
    client_name: config.client_name,
    slug: config.client_name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, ""),
    config,
  };

  // Include core identity if available
  try {
    payload.core_identity = await brandDir.readCoreIdentity();
  } catch {
    // Optional
  }

  // Include package payload if available (from prior pull)
  const existingPackage = await import("../connectors/brandcode/persistence.js")
    .then((m) => m.readPackagePayload(cwd));
  if (existingPackage) {
    payload.existing_package = existingPackage;
  }

  // Upload to Studio
  try {
    const result = await saveBrandToStudio(
      creds.studioUrl,
      payload,
      creds.token,
    );

    const now = new Date().toISOString();

    // Update connector config to point at the newly saved brand
    const connectorConfig: ConnectorConfig = {
      provider: "brandcode",
      brandUrl: `${creds.studioUrl}/start/brands/${result.slug}`,
      slug: result.slug,
      pullUrl: `${creds.studioUrl}/api/brand/hosted/${result.slug}/pull`,
      connectUrl: `${creds.studioUrl}/api/brand/hosted/${result.slug}/connect`,
      syncToken: result.syncToken,
      lastSyncedAt: now,
      shareTokenRequired: false,
    };
    await writeConnectorConfig(cwd, connectorConfig);

    // Record sync history
    const syncEvent: SyncHistoryEvent = {
      timestamp: now,
      syncMode: "first_sync",
      changedAreas: ["full package (saved)"],
      advice: {
        headline: `Brand saved to Studio as "${result.slug}"`,
        detail: `Brand uploaded and available at ${creds.studioUrl}/start/brands/${result.slug}`,
      },
    };
    await appendSyncEvent(cwd, syncEvent);

    return buildResponse({
      what_happened: `Brand "${config.client_name}" saved to Studio as "${result.slug}"`,
      next_steps: [
        `View your brand at ${creds.studioUrl}/start/brands/${result.slug}`,
        'Run brand_brandcode_sync direction="push" to push future updates',
        "Run brand_brandcode_status to check connection details",
      ],
      data: {
        client_name: config.client_name,
        slug: result.slug,
        sync_token: result.syncToken,
        owner_email: result.ownerEmail,
        brand_url: `${creds.studioUrl}/start/brands/${result.slug}`,
        connector_file: ".brand/brandcode-connector.json",
      },
    });
  } catch (err) {
    if (err instanceof BrandcodeClientError) {
      if (err.status === 401) {
        return buildResponse({
          what_happened: "Authentication expired or invalid",
          next_steps: [
            'Run brand_brandcode_auth mode="logout" then mode="login" to re-authenticate',
          ],
          data: { error: ERROR_CODES.AUTH_EXPIRED },
        });
      }
      if (err.status === 403) {
        return buildResponse({
          what_happened: "This brand is owned by a different account",
          next_steps: [
            "You can only save to brands you own",
            "Check your authenticated email with brand_brandcode_auth mode=\"status\"",
          ],
          data: { error: ERROR_CODES.FORBIDDEN },
        });
      }
    }
    return buildResponse({
      what_happened: `Failed to save brand: ${(err as Error).message}`,
      next_steps: [
        "Check network connectivity and try again",
        "Run brand_brandcode_auth mode=\"status\" to verify authentication",
      ],
      data: { error: ERROR_CODES.FETCH_FAILED },
    });
  }
}

async function handler(input: Params) {
  if (input.mode === "save") {
    return handleSave();
  }
  return handlePull(input);
}

export function register(server: McpServer) {
  server.tool(
    "brand_brandcode_connect",
    'Connect a local .brand/ to Brandcode Studio. Two modes: "pull" (default) downloads an existing hosted brand by URL/slug. "save" uploads the local .brand/ to Studio (requires prior auth via brand_brandcode_auth). THE tool when the user says "make our brand available to my whole team", "share our brand with the team", "connect to Brandcode", "pull from Studio", "save brand to Studio", or "upload my brand". Returns brand name, slug, sync token, and connection details.',
    paramsShape,
    { title: "Connect to Brandcode Studio", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    async (args) => {
      const parsed = safeParseParams(ParamsSchema, args);
      if (!parsed.success) return parsed.response;
      return handler(parsed.data);
    },
  );
}
