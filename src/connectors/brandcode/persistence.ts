/**
 * Read/write local connector sidecar files inside .brand/.
 *
 * Files managed:
 *   .brand/brandcode-connector.json  — connection metadata
 *   .brand/brandcode-sync-history.json — rolling sync event log
 *   .brand/brandcode-package.json — raw pulled package payload
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type {
  ConnectorConfig,
  SyncHistory,
  SyncHistoryEvent,
  BrandPackagePayload,
} from "./types.js";

const CONNECTOR_FILE = "brandcode-connector.json";
const HISTORY_FILE = "brandcode-sync-history.json";
const PACKAGE_FILE = "brandcode-package.json";
const MAX_HISTORY_EVENTS = 50;

function brandPath(cwd: string): string {
  return join(cwd, ".brand");
}

// ---------------------------------------------------------------------------
// Connector config
// ---------------------------------------------------------------------------

export async function readConnectorConfig(
  cwd: string,
): Promise<ConnectorConfig | null> {
  try {
    const raw = await readFile(
      join(brandPath(cwd), CONNECTOR_FILE),
      "utf-8",
    );
    return JSON.parse(raw) as ConnectorConfig;
  } catch {
    return null;
  }
}

export async function writeConnectorConfig(
  cwd: string,
  config: ConnectorConfig,
): Promise<void> {
  const dir = brandPath(cwd);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, CONNECTOR_FILE),
    JSON.stringify(config, null, 2) + "\n",
    "utf-8",
  );
}

// ---------------------------------------------------------------------------
// Sync history
// ---------------------------------------------------------------------------

export async function readSyncHistory(cwd: string): Promise<SyncHistory> {
  try {
    const raw = await readFile(
      join(brandPath(cwd), HISTORY_FILE),
      "utf-8",
    );
    return JSON.parse(raw) as SyncHistory;
  } catch {
    return { events: [] };
  }
}

export async function appendSyncEvent(
  cwd: string,
  event: SyncHistoryEvent,
): Promise<void> {
  const history = await readSyncHistory(cwd);
  history.events.push(event);

  // Keep a rolling window
  if (history.events.length > MAX_HISTORY_EVENTS) {
    history.events = history.events.slice(-MAX_HISTORY_EVENTS);
  }

  const dir = brandPath(cwd);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, HISTORY_FILE),
    JSON.stringify(history, null, 2) + "\n",
    "utf-8",
  );
}

// ---------------------------------------------------------------------------
// Raw package payload
// ---------------------------------------------------------------------------

export async function readPackagePayload(
  cwd: string,
): Promise<BrandPackagePayload | null> {
  try {
    const raw = await readFile(
      join(brandPath(cwd), PACKAGE_FILE),
      "utf-8",
    );
    return JSON.parse(raw) as BrandPackagePayload;
  } catch {
    return null;
  }
}

export async function writePackagePayload(
  cwd: string,
  payload: BrandPackagePayload,
): Promise<void> {
  const dir = brandPath(cwd);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, PACKAGE_FILE),
    JSON.stringify(payload, null, 2) + "\n",
    "utf-8",
  );
}
