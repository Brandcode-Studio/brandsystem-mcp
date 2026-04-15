import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BrandDir } from "../lib/brand-dir.js";
import { buildResponse, safeParseParams } from "../lib/response.js";
import { ERROR_CODES } from "../types/index.js";
import { resolveBrandcodeHostedUrl } from "../connectors/brandcode/resolve.js";
import {
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
import { readPackagePayload } from "../connectors/brandcode/persistence.js";
import { computeBrandDiff } from "../lib/brand-diff.js";
import type { SyncHistoryEvent } from "../connectors/brandcode/types.js";

const paramsShape = {
  direction: z
    .enum(["pull", "push"])
    .default("pull")
    .describe(
      '"pull" (default) fetches the latest from Studio. "push" uploads local .brand/ to Studio (requires auth).',
    ),
  share_token: z
    .string()
    .optional()
    .describe("Share token for protected brands (only needed for pull)"),
};

const ParamsSchema = z.object(paramsShape);
type Params = z.infer<typeof ParamsSchema>;

async function handlePull(input: Params) {
  const cwd = process.cwd();

  // Read existing connector config
  const config = await readConnectorConfig(cwd);
  if (!config) {
    return buildResponse({
      what_happened:
        "No Brandcode connection found. Run brand_brandcode_connect first.",
      next_steps: [
        "Run brand_brandcode_connect with a Brandcode Studio URL to establish a connection",
      ],
      data: { error: ERROR_CODES.NOT_FOUND },
    });
  }

  // Resolve from stored config
  const resolved = resolveBrandcodeHostedUrl(config.brandUrl);
  const fetchOpts = input.share_token
    ? { shareToken: input.share_token }
    : undefined;

  // Pull with current sync token for delta-aware behavior
  let pullResult;
  try {
    pullResult = await pullHostedBrand(
      resolved,
      config.syncToken,
      fetchOpts,
    );
  } catch (err) {
    return buildResponse({
      what_happened: `Sync failed: ${(err as Error).message}`,
      next_steps: [
        "Check network connectivity and try again",
        "Run brand_brandcode_status to verify connection details",
      ],
      data: { error: ERROR_CODES.FETCH_FAILED },
    });
  }

  const now = new Date().toISOString();

  // No-op: brand is already up to date
  if (pullResult.upToDate) {
    const syncEvent: SyncHistoryEvent = {
      timestamp: now,
      syncMode: "no_change",
      changedAreas: [],
      advice: {
        headline: "Already up to date",
        detail: `Local brand matches hosted brand "${config.slug}". No changes to apply.`,
      },
    };
    await appendSyncEvent(cwd, syncEvent);

    return buildResponse({
      what_happened: `Brand "${config.slug}" is already up to date`,
      next_steps: [
        "No action needed — local brand matches hosted version",
        "Run brand_status to work with the current brand",
      ],
      data: {
        sync_mode: "no_change",
        slug: config.slug,
        sync_token: config.syncToken,
        last_synced_at: config.lastSyncedAt,
      },
    });
  }

  // Updated: replace local package
  if (!pullResult.package) {
    return buildResponse({
      what_happened: "Sync indicated changes but returned no package",
      next_steps: ["This is unexpected — try again or contact support"],
      data: { error: ERROR_CODES.NO_BRAND_DATA },
    });
  }

  // Capture old package for diff before overwriting
  const oldPackage = await readPackagePayload(cwd);

  await writePackagePayload(cwd, pullResult.package);

  // Update connector config with new sync token
  const updatedConfig = {
    ...config,
    syncToken: pullResult.brand.syncToken,
    lastSyncedAt: now,
  };
  await writeConnectorConfig(cwd, updatedConfig);

  // Compute brand diff — normalize package structure to find runtime
  const extractRuntime = (pkg: Record<string, unknown> | null): Record<string, unknown> | null => {
    if (!pkg) return null;
    // Direct runtime key
    if (pkg.runtime && typeof pkg.runtime === "object") return pkg.runtime as Record<string, unknown>;
    // Nested under brandInstance
    const instance = pkg.brandInstance as Record<string, unknown> | undefined;
    if (instance?.runtime && typeof instance.runtime === "object") return instance.runtime as Record<string, unknown>;
    // Package itself looks like a runtime (has identity + voice/visual keys)
    if (pkg.identity && typeof pkg.identity === "object") return pkg;
    return null;
  };
  const oldRuntime = extractRuntime(oldPackage as Record<string, unknown> | null);
  const newRuntime = extractRuntime(pullResult.package as Record<string, unknown>);
  const diff = computeBrandDiff(oldRuntime, newRuntime);

  // Record sync history
  const changedAreas = pullResult.delta?.changedAreas ?? ["package updated"];
  const syncEvent: SyncHistoryEvent = {
    timestamp: now,
    syncMode: "updated",
    changedAreas,
    advice: {
      headline: diff.changes.length > 0 ? diff.headline : `Brand "${config.slug}" updated`,
      detail: diff.changes.length > 0 ? diff.formatted : `Changed areas: ${changedAreas.join(", ")}. Review the updated brand data.`,
    },
  };
  await appendSyncEvent(cwd, syncEvent);

  const whatHappened = diff.changes.length > 0
    ? `Brand "${config.slug}" synced — ${diff.headline}`
    : `Brand "${config.slug}" synced — ${changedAreas.length} area(s) changed`;

  return buildResponse({
    what_happened: whatHappened,
    next_steps: [
      "Run brand_status to see the updated brand identity",
      "Run brand_brandcode_status to review sync details",
    ],
    data: {
      sync_mode: "updated",
      slug: config.slug,
      sync_token: pullResult.brand.syncToken,
      previous_sync_token: config.syncToken,
      changed_areas: changedAreas,
      delta: pullResult.delta,
      readiness_stage: pullResult.brand.readinessStage,
      brand_diff: diff.changes.length > 0 ? {
        headline: diff.headline,
        formatted: diff.formatted,
        changes: diff.changes,
      } : undefined,
    },
  });
}

async function handlePush() {
  const cwd = process.cwd();
  const brandDir = new BrandDir(cwd);

  // Require existing connection
  const connConfig = await readConnectorConfig(cwd);
  if (!connConfig) {
    return buildResponse({
      what_happened: "No Brandcode connection found",
      next_steps: [
        'Run brand_brandcode_connect mode="save" to save brand to Studio first',
        "Or brand_brandcode_connect url=\"slug\" to connect to an existing hosted brand",
      ],
      data: { error: ERROR_CODES.NOT_FOUND },
    });
  }

  // Require .brand/
  if (!(await brandDir.exists())) {
    return buildResponse({
      what_happened: "No .brand/ directory found",
      next_steps: ["Run brand_start or brand_init first"],
      data: { error: ERROR_CODES.NOT_INITIALIZED },
    });
  }

  // Require auth
  const creds = await readAuthCredentials(cwd);
  if (!creds) {
    return buildResponse({
      what_happened: "Not authenticated — login required to push",
      next_steps: [
        'Run brand_brandcode_auth mode="login" email="you@example.com" to authenticate',
      ],
      data: { error: ERROR_CODES.NOT_AUTHENTICATED },
    });
  }

  // Build payload from local brand state
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

  const payload: Record<string, unknown> = {
    client_name: config.client_name,
    slug: connConfig.slug,
    config,
  };

  try {
    payload.core_identity = await brandDir.readCoreIdentity();
  } catch {
    // Optional
  }

  // Push to Studio (uses the save endpoint which handles create-or-update)
  try {
    const result = await saveBrandToStudio(
      creds.studioUrl,
      payload,
      creds.token,
    );

    const now = new Date().toISOString();

    // Update connector config with new sync token
    const updatedConfig = {
      ...connConfig,
      syncToken: result.syncToken,
      lastSyncedAt: now,
    };
    await writeConnectorConfig(cwd, updatedConfig);

    // Record sync history
    const syncEvent: SyncHistoryEvent = {
      timestamp: now,
      syncMode: "updated",
      changedAreas: ["pushed from local"],
      advice: {
        headline: `Brand "${connConfig.slug}" pushed to Studio`,
        detail: "Local changes uploaded. Studio version updated.",
      },
    };
    await appendSyncEvent(cwd, syncEvent);

    return buildResponse({
      what_happened: `Brand "${connConfig.slug}" pushed to Studio`,
      next_steps: [
        `View at ${creds.studioUrl}/start/brands/${connConfig.slug}`,
        "Run brand_brandcode_status to verify sync state",
      ],
      data: {
        slug: connConfig.slug,
        sync_token: result.syncToken,
        previous_sync_token: connConfig.syncToken,
        owner_email: result.ownerEmail,
        brand_url: `${creds.studioUrl}/start/brands/${connConfig.slug}`,
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
            "You can only push to brands you own",
            "Check your authenticated email with brand_brandcode_auth mode=\"status\"",
          ],
          data: { error: ERROR_CODES.FORBIDDEN },
        });
      }
    }
    return buildResponse({
      what_happened: `Push failed: ${(err as Error).message}`,
      next_steps: [
        "Check network connectivity and try again",
        "Run brand_brandcode_auth mode=\"status\" to verify authentication",
      ],
      data: { error: ERROR_CODES.FETCH_FAILED },
    });
  }
}

async function handler(input: Params) {
  if (input.direction === "push") {
    return handlePush();
  }
  return handlePull(input);
}

export function register(server: McpServer) {
  server.tool(
    "brand_brandcode_sync",
    'Sync local .brand/ with a connected Brandcode Studio brand. Two directions: "pull" (default) fetches the latest from Studio, delta-aware via syncToken. "push" uploads local changes to Studio (requires auth via brand_brandcode_auth). Requires a prior brand_brandcode_connect. Use when the user says "sync brand", "push to Studio", "pull latest brand", or "update Studio". Returns sync mode, changed areas, and sync token. NOT for initial connection — use brand_brandcode_connect. NOT for checking status — use brand_brandcode_status.',
    paramsShape,
    async (args) => {
      const parsed = safeParseParams(ParamsSchema, args);
      if (!parsed.success) return parsed.response;
      return handler(parsed.data);
    },
  );
}
