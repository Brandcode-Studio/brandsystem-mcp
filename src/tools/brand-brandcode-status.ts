import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildResponse } from "../lib/response.js";
import { ERROR_CODES } from "../types/index.js";
import {
  readConnectorConfig,
  readSyncHistory,
  readPackagePayload,
} from "../connectors/brandcode/persistence.js";

async function handler() {
  const cwd = process.cwd();

  const config = await readConnectorConfig(cwd);
  if (!config) {
    return buildResponse({
      what_happened:
        "No Brandcode connection found in this project.",
      next_steps: [
        "Run brand_brandcode_connect with a Brandcode Studio URL to connect a hosted brand",
      ],
      data: { error: ERROR_CODES.NOT_FOUND },
    });
  }

  const history = await readSyncHistory(cwd);
  const pkg = await readPackagePayload(cwd);
  const lastEvent = history.events[history.events.length - 1] ?? null;

  const lines: string[] = [
    "── Brandcode Connection ──────────────",
    `Brand:       ${config.slug}`,
    `URL:         ${config.brandUrl}`,
    `Provider:    ${config.provider}`,
    `Last synced: ${config.lastSyncedAt}`,
    `Sync token:  ${config.syncToken}`,
    `Protected:   ${config.shareTokenRequired ? "yes" : "no"}`,
    "",
    "── Pull endpoint ─────────────────────",
    `Pull URL:    ${config.pullUrl}`,
    `Connect URL: ${config.connectUrl}`,
  ];

  if (lastEvent) {
    lines.push("");
    lines.push("── Last sync ─────────────────────────");
    lines.push(`Mode:         ${lastEvent.syncMode}`);
    lines.push(
      `Changed:      ${lastEvent.changedAreas.length > 0 ? lastEvent.changedAreas.join(", ") : "none"}`,
    );
    lines.push(`Headline:     ${lastEvent.advice.headline}`);
    lines.push(`Detail:       ${lastEvent.advice.detail}`);
  }

  if (pkg) {
    const brandInstance = pkg.brandInstance as
      | Record<string, unknown>
      | undefined;
    const brandData = pkg.brandData as Record<string, unknown> | undefined;
    lines.push("");
    lines.push("── Local package ─────────────────────");
    lines.push(`Package file: .brand/brandcode-package.json`);
    if (brandInstance) {
      const readiness = brandInstance.readiness as
        | Record<string, unknown>
        | undefined;
      const capabilities = brandInstance.capabilities as
        | Record<string, unknown>
        | undefined;
      if (readiness) {
        lines.push(`Readiness:    ${readiness.stage ?? "unknown"}`);
      }
      if (capabilities) {
        const enabled = capabilities.enabled as string[] | undefined;
        lines.push(
          `Capabilities: ${enabled ? enabled.length + " enabled" : "unknown"}`,
        );
      }
    }
    if (brandData) {
      const narratives = brandData.narratives as unknown[] | undefined;
      const proofPoints = brandData.proofPoints as unknown[] | undefined;
      const assets = brandData.assets as unknown[] | undefined;
      lines.push(
        `Narratives:   ${narratives ? narratives.length : "n/a"}`,
      );
      lines.push(
        `Proof points: ${proofPoints ? proofPoints.length : "n/a"}`,
      );
      lines.push(`Assets:       ${assets ? assets.length : "n/a"}`);
    }
  }

  lines.push("");
  lines.push("── Sync history ──────────────────────");
  lines.push(`Total syncs:  ${history.events.length}`);
  if (history.events.length > 0) {
    const recentEvents = history.events.slice(-5).reverse();
    for (const event of recentEvents) {
      lines.push(
        `  ${event.timestamp} — ${event.syncMode}${event.changedAreas.length > 0 ? ` (${event.changedAreas.join(", ")})` : ""}`,
      );
    }
  }

  return buildResponse({
    what_happened: `Brandcode connection status for "${config.slug}"`,
    next_steps: [
      "Run brand_brandcode_sync to check for updates from the hosted brand",
      "Run brand_status to see the full local brand identity",
    ],
    data: {
      status: lines.join("\n"),
      connector: config,
      last_sync: lastEvent,
      sync_count: history.events.length,
      has_package: pkg !== null,
    },
  });
}

export function register(server: McpServer) {
  server.tool(
    "brand_brandcode_status",
    'Inspect the Brandcode Studio connection for the current project. Shows connected brand, sync token, last sync time, sync history, and local package summary. Use when the user says "brandcode status", "check connection", or "am I synced?". Returns structured connection data.',
    async () => handler(),
  );
}
