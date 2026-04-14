import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildResponse, safeParseParams } from "../lib/response.js";
import { ERROR_CODES } from "../types/index.js";
import { resolveBrandcodeHostedUrl } from "../connectors/brandcode/resolve.js";
import { pullHostedBrand } from "../connectors/brandcode/client.js";
import {
  readConnectorConfig,
  writeConnectorConfig,
  writePackagePayload,
  appendSyncEvent,
} from "../connectors/brandcode/persistence.js";
import type { SyncHistoryEvent } from "../connectors/brandcode/types.js";

const paramsShape = {
  share_token: z
    .string()
    .optional()
    .describe("Share token for protected brands (only needed if not stored)"),
};

const ParamsSchema = z.object(paramsShape);
type Params = z.infer<typeof ParamsSchema>;

async function handler(input: Params) {
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

  await writePackagePayload(cwd, pullResult.package);

  // Update connector config with new sync token
  const updatedConfig = {
    ...config,
    syncToken: pullResult.brand.syncToken,
    lastSyncedAt: now,
  };
  await writeConnectorConfig(cwd, updatedConfig);

  // Record sync history
  const changedAreas = pullResult.delta?.changedAreas ?? ["package updated"];
  const syncEvent: SyncHistoryEvent = {
    timestamp: now,
    syncMode: "updated",
    changedAreas,
    advice: {
      headline: `Brand "${config.slug}" updated`,
      detail: `Changed areas: ${changedAreas.join(", ")}. Review the updated brand data.`,
    },
  };
  await appendSyncEvent(cwd, syncEvent);

  return buildResponse({
    what_happened: `Brand "${config.slug}" synced — ${changedAreas.length} area(s) changed`,
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
    },
  });
}

export function register(server: McpServer) {
  server.tool(
    "brand_brandcode_sync",
    'Sync local .brand/ with a previously connected Brandcode Studio brand. Pull-only: fetches the latest package from Studio and updates local files. Delta-aware via syncToken — no-ops when the brand has not changed. Writes to .brand/brandcode-package.json and .brand/brandcode-sync-history.json. Requires a prior brand_brandcode_connect. Use when the user says "sync brand", "update from Studio", "pull latest brand", or "check for brand updates". Returns sync mode (updated/no_change/error), changed areas, and advice. NOT for initial connection — use brand_brandcode_connect first. NOT for checking status without syncing — use brand_brandcode_status.',
    paramsShape,
    async (args) => {
      const parsed = safeParseParams(ParamsSchema, args);
      if (!parsed.success) return parsed.response;
      return handler(parsed.data);
    },
  );
}
