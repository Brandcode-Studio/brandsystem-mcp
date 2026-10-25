/**
 * Read/write local connector sidecar files inside .brand/.
 *
 * Files managed:
 *   .brand/brandcode-connector.json  — connection metadata
 *   .brand/brandcode-sync-history.json — rolling sync event log
 *   .brand/brandcode-package.json — raw pulled package payload
 */

import { readBrandFileSafe, writeBrandFileSafe } from "../../lib/safe-write.js";
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

// ---------------------------------------------------------------------------
// Connector config
// ---------------------------------------------------------------------------

export async function readConnectorConfig(
  cwd: string,
): Promise<ConnectorConfig | null> {
  const raw = await readBrandFileSafe(cwd, CONNECTOR_FILE);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as ConnectorConfig;
  } catch {
    return null;
  }
}

export async function writeConnectorConfig(
  cwd: string,
  config: ConnectorConfig,
): Promise<void> {
  await writeBrandFileSafe(
    cwd,
    CONNECTOR_FILE,
    JSON.stringify(config, null, 2) + "\n",
  );
}

// ---------------------------------------------------------------------------
// Sync history
// ---------------------------------------------------------------------------

export async function readSyncHistory(cwd: string): Promise<SyncHistory> {
  const raw = await readBrandFileSafe(cwd, HISTORY_FILE);
  if (raw === null) return { events: [] };
  try {
    const parsed = JSON.parse(raw) as SyncHistory;
    return parsed && Array.isArray(parsed.events) ? parsed : { events: [] };
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

  await writeBrandFileSafe(
    cwd,
    HISTORY_FILE,
    JSON.stringify(history, null, 2) + "\n",
  );
}

// ---------------------------------------------------------------------------
// Raw package payload
// ---------------------------------------------------------------------------

export async function readPackagePayload(
  cwd: string,
): Promise<BrandPackagePayload | null> {
  const raw = await readBrandFileSafe(cwd, PACKAGE_FILE);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as BrandPackagePayload;
  } catch {
    return null;
  }
}

export async function writePackagePayload(
  cwd: string,
  payload: BrandPackagePayload,
): Promise<void> {
  await writeBrandFileSafe(
    cwd,
    PACKAGE_FILE,
    JSON.stringify(payload, null, 2) + "\n",
  );

  // Promotion gate: production_approved is conferred only by Brandcode
  // Studio. If the hosted package declares it, record the approval bound to
  // the post-pull source fingerprint; local edits after this pull demote the
  // effective level back to provisional at the next compile.
  const declared = (payload as { approval?: unknown }).approval;
  if (declared === "production_approved") {
    const { writeApprovalState, computeBrandFingerprint } = await import(
      "../../lib/approval-state.js"
    );
    await writeApprovalState(cwd, {
      level: "production_approved",
      confirmed_at: new Date().toISOString(),
      fingerprint: await computeBrandFingerprint(cwd),
      authority: "brandcode_studio",
    });
  }
}
