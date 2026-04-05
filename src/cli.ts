/**
 * CLI commands for the brandsystem-mcp package.
 *
 * Usage:
 *   npx @brandsystem/mcp brandcode connect <url> [--share-token=TOKEN]
 *   npx @brandsystem/mcp brandcode sync [--share-token=TOKEN]
 *   npx @brandsystem/mcp brandcode status
 */

import { resolveBrandcodeHostedUrl } from "./connectors/brandcode/resolve.js";
import {
  fetchHostedBrandConnect,
  pullHostedBrand,
  BrandcodeClientError,
} from "./connectors/brandcode/client.js";
import {
  readConnectorConfig,
  writeConnectorConfig,
  writePackagePayload,
  appendSyncEvent,
  readSyncHistory,
  readPackagePayload,
} from "./connectors/brandcode/persistence.js";
import { BrandDir } from "./lib/brand-dir.js";
import { SCHEMA_VERSION } from "./schemas/index.js";
import type {
  ConnectorConfig,
  SyncHistoryEvent,
} from "./connectors/brandcode/types.js";

function printHelp() {
  console.log(`
brandsystem-mcp — Brand identity MCP server + Brandcode Studio connector

Commands:
  brandcode connect <url>    Connect to a hosted Brandcode Studio brand
  brandcode sync             Sync with the connected hosted brand
  brandcode status           Show connection and sync status

Options:
  --share-token=TOKEN        Share token for protected brands
  --help                     Show this help message

Without a command, starts the MCP stdio server.
`.trim());
}

function parseFlag(args: string[], flag: string): string | undefined {
  const prefix = `--${flag}=`;
  const match = args.find((a) => a.startsWith(prefix));
  return match ? match.slice(prefix.length) : undefined;
}

async function cmdConnect(url: string, shareToken?: string) {
  const cwd = process.cwd();

  let resolved;
  try {
    resolved = resolveBrandcodeHostedUrl(url);
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(1);
  }

  console.log(`Connecting to hosted brand: ${resolved.slug}...`);

  const fetchOpts = shareToken ? { shareToken } : undefined;

  let connectArtifact;
  try {
    connectArtifact = await fetchHostedBrandConnect(resolved, fetchOpts);
  } catch (err) {
    if (err instanceof BrandcodeClientError && err.status === 403) {
      console.error(
        "Error: Access denied. This brand may require a --share-token.",
      );
    } else {
      console.error(
        `Error: Failed to connect — ${(err as Error).message}`,
      );
    }
    process.exit(1);
  }

  console.log(`Pulling brand package...`);

  let pullResult;
  try {
    pullResult = await pullHostedBrand(resolved, undefined, fetchOpts);
  } catch (err) {
    console.error(
      `Error: Failed to pull brand — ${(err as Error).message}`,
    );
    process.exit(1);
  }

  if (!pullResult.package) {
    console.error("Error: Pull returned no package data.");
    process.exit(1);
  }

  // Scaffold .brand/ if needed
  const brandDir = new BrandDir(cwd);
  if (!(await brandDir.exists())) {
    const brandName = pullResult.brand.name || resolved.slug;
    await brandDir.initBrand({
      schema_version: SCHEMA_VERSION,
      session: 1,
      client_name: brandName,
      website_url: `${resolved.baseUrl}/start/brands/${resolved.slug}`,
      created_at: new Date().toISOString(),
    });
  }

  const now = new Date().toISOString();

  await writePackagePayload(cwd, pullResult.package);

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

  const changedAreas = pullResult.delta?.changedAreas ?? ["full package"];
  const syncEvent: SyncHistoryEvent = {
    timestamp: now,
    syncMode: "first_sync",
    changedAreas,
    advice: {
      headline: `Connected to "${pullResult.brand.name}"`,
      detail: "Brand pulled successfully.",
    },
  };
  await appendSyncEvent(cwd, syncEvent);

  console.log();
  console.log(`  Brand:     ${pullResult.brand.name}`);
  console.log(`  Slug:      ${resolved.slug}`);
  console.log(`  Sync mode: first_sync`);
  console.log(`  Readiness: ${pullResult.brand.readinessStage}`);
  console.log(`  Changed:   ${changedAreas.join(", ")}`);
  console.log();
  console.log(`  Files written:`);
  console.log(`    .brand/brandcode-connector.json`);
  console.log(`    .brand/brandcode-package.json`);
  console.log(`    .brand/brandcode-sync-history.json`);
  console.log();
  console.log(`  Next: npx @brandsystem/mcp brandcode status`);
}

async function cmdSync(shareToken?: string) {
  const cwd = process.cwd();
  const config = await readConnectorConfig(cwd);

  if (!config) {
    console.error(
      "Error: No Brandcode connection found. Run `brandcode connect <url>` first.",
    );
    process.exit(1);
  }

  console.log(`Syncing "${config.slug}"...`);

  const resolved = resolveBrandcodeHostedUrl(config.brandUrl);
  const fetchOpts = shareToken ? { shareToken } : undefined;

  let pullResult;
  try {
    pullResult = await pullHostedBrand(resolved, config.syncToken, fetchOpts);
  } catch (err) {
    console.error(`Error: Sync failed — ${(err as Error).message}`);
    process.exit(1);
  }

  const now = new Date().toISOString();

  if (pullResult.upToDate) {
    await appendSyncEvent(cwd, {
      timestamp: now,
      syncMode: "no_change",
      changedAreas: [],
      advice: {
        headline: "Already up to date",
        detail: `Local brand matches hosted brand "${config.slug}".`,
      },
    });

    console.log();
    console.log(`  Already up to date.`);
    console.log(`  Sync token: ${config.syncToken}`);
    console.log(`  Last synced: ${config.lastSyncedAt}`);
    return;
  }

  if (!pullResult.package) {
    console.error("Error: Sync indicated changes but returned no package.");
    process.exit(1);
  }

  await writePackagePayload(cwd, pullResult.package);

  const updatedConfig = {
    ...config,
    syncToken: pullResult.brand.syncToken,
    lastSyncedAt: now,
  };
  await writeConnectorConfig(cwd, updatedConfig);

  const changedAreas = pullResult.delta?.changedAreas ?? ["package updated"];
  await appendSyncEvent(cwd, {
    timestamp: now,
    syncMode: "updated",
    changedAreas,
    advice: {
      headline: `Brand "${config.slug}" updated`,
      detail: `Changed areas: ${changedAreas.join(", ")}`,
    },
  });

  console.log();
  console.log(`  Sync mode: updated`);
  console.log(`  Changed:   ${changedAreas.join(", ")}`);
  console.log(`  New token: ${pullResult.brand.syncToken}`);
}

async function cmdStatus() {
  const cwd = process.cwd();
  const config = await readConnectorConfig(cwd);

  if (!config) {
    console.log("No Brandcode connection found in this project.");
    console.log(
      "Run `npx @brandsystem/mcp brandcode connect <url>` to connect.",
    );
    return;
  }

  const history = await readSyncHistory(cwd);
  const pkg = await readPackagePayload(cwd);
  const lastEvent = history.events[history.events.length - 1] ?? null;

  console.log();
  console.log(`  Brand:       ${config.slug}`);
  console.log(`  URL:         ${config.brandUrl}`);
  console.log(`  Last synced: ${config.lastSyncedAt}`);
  console.log(`  Sync token:  ${config.syncToken}`);
  console.log(`  Protected:   ${config.shareTokenRequired ? "yes" : "no"}`);

  if (lastEvent) {
    console.log();
    console.log(`  Last sync:`);
    console.log(`    Mode:    ${lastEvent.syncMode}`);
    console.log(
      `    Changed: ${lastEvent.changedAreas.length > 0 ? lastEvent.changedAreas.join(", ") : "none"}`,
    );
    console.log(`    ${lastEvent.advice.headline}`);
  }

  if (pkg) {
    const brandData = pkg.brandData as Record<string, unknown> | undefined;
    if (brandData) {
      const narratives = brandData.narratives as unknown[] | undefined;
      const assets = brandData.assets as unknown[] | undefined;
      console.log();
      console.log(`  Package:`);
      console.log(
        `    Narratives: ${narratives ? narratives.length : "n/a"}`,
      );
      console.log(`    Assets:     ${assets ? assets.length : "n/a"}`);
    }
  }

  console.log();
  console.log(`  Sync history: ${history.events.length} event(s)`);

  if (history.events.length > 0) {
    const recent = history.events.slice(-3).reverse();
    for (const e of recent) {
      console.log(`    ${e.timestamp} — ${e.syncMode}`);
    }
  }

  console.log();
  console.log(`  Next: npx @brandsystem/mcp brandcode sync`);
}

export async function runCli(args: string[]): Promise<void> {
  if (args.includes("--help") || args.includes("-h")) {
    printHelp();
    return;
  }

  const [group, command, ...rest] = args;

  if (group !== "brandcode") {
    printHelp();
    process.exit(1);
  }

  const shareToken = parseFlag(args, "share-token");

  switch (command) {
    case "connect": {
      const url = rest.find((a) => !a.startsWith("--"));
      if (!url) {
        console.error("Error: Missing brand URL or slug.");
        console.error(
          "Usage: npx @brandsystem/mcp brandcode connect <url>",
        );
        process.exit(1);
      }
      await cmdConnect(url, shareToken);
      break;
    }
    case "sync":
      await cmdSync(shareToken);
      break;
    case "status":
      await cmdStatus();
      break;
    default:
      console.error(`Unknown command: brandcode ${command ?? ""}`);
      printHelp();
      process.exit(1);
  }
}
