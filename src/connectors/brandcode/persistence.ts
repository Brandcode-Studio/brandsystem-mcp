/**
 * Read/write local connector sidecar files inside .brand/.
 *
 * Files managed:
 *   .brand/brandcode-connector.json  — connection metadata
 *   .brand/brandcode-sync-history.json — rolling sync event log
 *   .brand/brandcode-package.json — raw pulled package payload
 */

import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { readBrandFileSafe, writeBrandFileSafe } from "../../lib/safe-write.js";
import { isTrustedBrandcodeOrigin, originOf } from "./trust.js";
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

/** Where a pulled package came from. */
export interface PackageSource {
  /** Origin (or any URL on it) that served the package. */
  origin: string;
}

/**
 * What happened to an approval level the package declared:
 *   not_declared         — the package declared no production approval.
 *   conferred            — production_approved recorded, bound to this
 *                          package's digest and its trusted origin.
 *   untrusted_origin     — declared, but the package came from an origin
 *                          outside the trusted Brandcode Studio allowlist;
 *                          ignored (effective level: provisional_extracted).
 *   local_sources_present — declared by a trusted origin, but the local
 *                          source YAMLs already hold content that did not
 *                          come from this package (e.g. website extraction);
 *                          ignored so that content cannot inherit approval.
 */
export type PackageApprovalOutcome =
  | "not_declared"
  | "conferred"
  | "untrusted_origin"
  | "local_sources_present";

/**
 * True when any policy-bearing source YAML holds content. A .brand/ freshly
 * scaffolded by a connect has an empty core identity and no other sources.
 */
async function hasLocalSourceContent(cwd: string): Promise<boolean> {
  for (const file of ["visual-identity.yaml", "messaging.yaml", "strategy.yaml"]) {
    try {
      await lstat(join(cwd, ".brand", file));
      return true;
    } catch {
      // absent
    }
  }
  let raw: string;
  try {
    raw = await readFile(join(cwd, ".brand", "core-identity.yaml"), "utf-8");
  } catch {
    return false;
  }
  try {
    const core = parseYaml(raw) as Record<string, unknown> | null;
    if (!core || typeof core !== "object") return false;
    for (const [key, value] of Object.entries(core)) {
      if (key === "schema_version" || value == null) continue;
      if (Array.isArray(value) && value.length === 0) continue;
      if (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) {
        continue;
      }
      return true;
    }
    return false;
  } catch {
    // Unparseable sources are not an empty scaffold.
    return true;
  }
}

export async function writePackagePayload(
  cwd: string,
  payload: BrandPackagePayload,
  source: PackageSource,
): Promise<PackageApprovalOutcome> {
  await writeBrandFileSafe(
    cwd,
    PACKAGE_FILE,
    JSON.stringify(payload, null, 2) + "\n",
  );

  // Promotion gate: production_approved is conferred only by Brandcode
  // Studio, which means only by a package served from a trusted Studio
  // origin. The approval is bound to (a) this package's canonical digest,
  // (b) that origin, and (c) the post-pull source fingerprint; any change to
  // the package or the sources demotes the effective level at the next
  // compile. Writing a new package without a declaration leaves any prior
  // state in place, but its package digest no longer matches, so it demotes.
  const declared = (payload as { approval?: unknown }).approval;
  if (declared !== "production_approved") return "not_declared";

  // Fail closed when a caller omits the source.
  if (!source?.origin || !isTrustedBrandcodeOrigin(source.origin)) return "untrusted_origin";
  if (await hasLocalSourceContent(cwd)) return "local_sources_present";

  const { writeApprovalState, computeBrandFingerprint, computePackageDigest } = await import(
    "../../lib/approval-state.js"
  );
  await writeApprovalState(cwd, {
    level: "production_approved",
    confirmed_at: new Date().toISOString(),
    fingerprint: await computeBrandFingerprint(cwd),
    authority: "brandcode_studio",
    package_sha256: computePackageDigest(payload),
    origin: originOf(source.origin) ?? source.origin,
  });
  return "conferred";
}

/**
 * One-line explanation of a non-trivial approval outcome for tool responses,
 * or null when there is nothing to say.
 */
export function describeApprovalOutcome(
  outcome: PackageApprovalOutcome,
  origin: string,
): string | null {
  switch (outcome) {
    case "conferred":
      return "Studio marked this package production_approved; the approval is bound to this exact package and the current local sources.";
    case "untrusted_origin":
      return `The package declared production_approved, but ${originOf(origin) ?? "its origin"} is not a trusted Brandcode Studio origin, so the approval was ignored — the brand stays provisional_extracted.`;
    case "local_sources_present":
      return "The package declared production_approved, but local source YAMLs already contain content that did not come from Studio (for example a website extraction), so the approval was not applied — the brand stays provisional_extracted.";
    default:
      return null;
  }
}
