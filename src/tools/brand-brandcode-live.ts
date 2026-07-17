import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildResponse, safeParseParams } from "../lib/response.js";
import { ERROR_CODES } from "../types/index.js";
import {
  readConnectorConfig,
  writeConnectorConfig,
} from "../connectors/brandcode/persistence.js";
import { readAuthCredentials } from "../lib/auth-state.js";
import { invalidateLiveCache } from "../connectors/brandcode/live-source.js";
import { getLiveCacheEntry } from "../connectors/brandcode/live-cache.js";
import type { ConnectorConfig } from "../connectors/brandcode/types.js";

const DEFAULT_TTL_SECONDS = 60;

const paramsShape = {
  mode: z
    .enum(["on", "off", "status"])
    .default("status")
    .describe(
      '"on" routes read tools through the hosted runtime. "off" returns to local-mirror reads. "status" (default) reports current live-mode state and cache freshness.',
    ),
  cache_ttl_seconds: z
    .number()
    .int()
    .min(5)
    .max(3600)
    .optional()
    .describe(
      "Optional. When turning on, override the per-call cache TTL. Default 60s. Lower = fresher, higher = less load.",
    ),
};

const ParamsSchema = z.object(paramsShape);
type Params = z.infer<typeof ParamsSchema>;

async function handleStatus(config: ConnectorConfig | null) {
  if (!config) {
    return buildResponse({
      what_happened: "No Brandcode connection found — Live Mode requires one.",
      next_steps: [
        'Run brand_brandcode_connect url="your-slug" to connect a hosted brand first',
        "Then brand_brandcode_live mode=\"on\" to enable live reads",
      ],
      data: { error: ERROR_CODES.NOT_FOUND, live_mode: false },
    });
  }

  const live = !!config.liveMode;
  const ttl = config.liveCacheTTLSeconds ?? DEFAULT_TTL_SECONDS;
  const cached = getLiveCacheEntry(config.slug);
  const lines: string[] = [
    "── Live Mode ────────────────────────",
    `Status:          ${live ? "ON" : "off"}`,
    `Brand:           ${config.slug}`,
    `Cache TTL:       ${ttl}s`,
  ];
  if (live) {
    lines.push(
      `Activated at:    ${config.liveModeActivatedAt ?? "unknown"}`,
    );
    if (cached) {
      const age = Math.round((Date.now() - cached.fetchedAt) / 1000);
      lines.push(`Cache:           warm (age ${age}s of ${ttl}s)`);
      lines.push(`Sync token:      ${cached.syncToken}`);
    } else {
      lines.push(`Cache:           cold — next live call will fetch`);
    }
    lines.push(`Remote:          ${config.pullUrl}`);
  } else {
    lines.push(`Last local sync: ${config.lastSyncedAt}`);
    lines.push(`Local sync tok:  ${config.syncToken}`);
  }

  return buildResponse({
    what_happened: live
      ? `Live Mode is ON for "${config.slug}" (cache ${cached ? "warm" : "cold"})`
      : `Live Mode is off for "${config.slug}" — reads serve from local mirror`,
    next_steps: live
      ? [
          'Run brand_brandcode_live mode="off" to return to local-mirror reads',
          "Governance edits in Brand Console propagate on the next read within cache TTL",
        ]
      : [
          'Run brand_brandcode_live mode="on" to route read tools through the hosted runtime',
          "Live Mode requires brand_brandcode_auth; run that first if you haven't",
        ],
    data: {
      status: lines.join("\n"),
      live_mode: live,
      slug: config.slug,
      cache_ttl_seconds: ttl,
      activated_at: config.liveModeActivatedAt,
      cache_warm: !!cached,
      cache_age_seconds: cached
        ? Math.round((Date.now() - cached.fetchedAt) / 1000)
        : null,
      last_synced_at: config.lastSyncedAt,
    },
  });
}

async function handleOn(config: ConnectorConfig | null, input: Params) {
  const cwd = process.cwd();

  if (!config) {
    return buildResponse({
      what_happened: "Cannot enable Live Mode — no Brandcode connection found.",
      next_steps: [
        'Run brand_brandcode_connect url="your-slug" first to connect a hosted brand',
      ],
      data: { error: ERROR_CODES.NOT_FOUND, live_mode: false },
    });
  }

  const auth = await readAuthCredentials(cwd);
  if (!auth) {
    return buildResponse({
      what_happened: "Cannot enable Live Mode — not authenticated with Brandcode Studio.",
      next_steps: [
        'Run brand_brandcode_auth mode="activate" email="you@example.com" to authenticate',
        "Then brand_brandcode_live mode=\"on\" to enable live reads",
      ],
      data: { error: ERROR_CODES.NOT_AUTHENTICATED, live_mode: false },
    });
  }

  const now = new Date().toISOString();
  const ttl = input.cache_ttl_seconds ?? config.liveCacheTTLSeconds ?? DEFAULT_TTL_SECONDS;
  const updated: ConnectorConfig = {
    ...config,
    liveMode: true,
    liveModeActivatedAt: now,
    liveCacheTTLSeconds: ttl,
  };
  await writeConnectorConfig(cwd, updated);
  invalidateLiveCache(config.slug);

  return buildResponse({
    what_happened: `Live Mode enabled for "${config.slug}" — reads will refresh from the hosted runtime.`,
    next_steps: [
      `Cache TTL is ${ttl}s — governance edits propagate on the next read within that window`,
      "Try brand_runtime to see the live-tagged result",
      'Run brand_brandcode_live mode="off" to return to local-mirror reads',
    ],
    data: {
      live_mode: true,
      slug: config.slug,
      activated_at: now,
      cache_ttl_seconds: ttl,
      sync_token: config.syncToken,
    },
  });
}

async function handleOff(config: ConnectorConfig | null) {
  const cwd = process.cwd();

  if (!config) {
    return buildResponse({
      what_happened: "Nothing to disable — no Brandcode connection found.",
      next_steps: [
        'Run brand_brandcode_connect url="your-slug" to connect a hosted brand first',
      ],
      data: { error: ERROR_CODES.NOT_FOUND, live_mode: false },
    });
  }

  if (!config.liveMode) {
    return buildResponse({
      what_happened: `Live Mode is already off for "${config.slug}".`,
      next_steps: [
        'Run brand_brandcode_live mode="status" to see current state',
      ],
      data: {
        live_mode: false,
        slug: config.slug,
        sync_token: config.syncToken,
        last_synced_at: config.lastSyncedAt,
      },
    });
  }

  const updated: ConnectorConfig = {
    ...config,
    liveMode: false,
    liveModeActivatedAt: undefined,
  };
  await writeConnectorConfig(cwd, updated);
  invalidateLiveCache(config.slug);

  return buildResponse({
    what_happened: `Live Mode disabled for "${config.slug}" — reads now serve from the local mirror.`,
    next_steps: [
      "Run brand_brandcode_sync to refresh the local mirror manually",
      'Run brand_brandcode_live mode="on" later to re-enable',
    ],
    data: {
      live_mode: false,
      slug: config.slug,
      sync_token: config.syncToken,
      last_synced_at: config.lastSyncedAt,
    },
  });
}

async function handler(input: Params) {
  const cwd = process.cwd();
  const config = await readConnectorConfig(cwd);

  if (input.mode === "on") return handleOn(config, input);
  if (input.mode === "off") return handleOff(config);
  return handleStatus(config);
}

export function register(server: McpServer) {
  server.tool(
    "brand_brandcode_live",
    'Enable, disable, or inspect Live Mode on the Brandcode Studio connector. When ON, read-only tools (brand_runtime, brand_check, brand_audit_content, brand_check_compliance, brand_preview, brand_status) refresh from the hosted runtime on each call, within a short cache TTL (default 60s). Governance edits in Brand Console propagate on the next call without a manual sync. Requires a prior brand_brandcode_connect and brand_brandcode_auth. Use when the user says "go live", "enable live mode", "turn off live mode", "is live mode on?", or "make brand reads live". Returns the current mode, cache freshness, and sync token. Network failures during live reads silently fall back to the local mirror.',
    paramsShape,
    { title: "Toggle Brandcode live mode", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (args) => {
      const parsed = safeParseParams(ParamsSchema, args);
      if (!parsed.success) return parsed.response;
      return handler(parsed.data);
    },
  );
}
