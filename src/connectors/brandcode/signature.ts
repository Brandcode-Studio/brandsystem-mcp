/**
 * Brandcode Studio package signatures (Ed25519, node:crypto).
 *
 * Studio attaches `signature` next to `package` in the pull response:
 *
 *   { alg: "Ed25519", keyId, digest: "sha256:<hex>", sig: "<base64>", signedAt }
 *
 * `digest` is computePackageDigest(package) (src/lib/package-digest.ts) and
 * `sig` signs buildSignedMessage(): the context line, keyId, signedAt, and
 * digest joined by "\n". The connector stores the signature beside the
 * package as `.brand/brandcode-package.sig.json`, so a package copied out of
 * band (both files) can still be verified.
 *
 * Key sources:
 *   - Pinned keys (signing-keys.ts) verify for any origin.
 *   - BRANDCODE_STUDIO_SIGNING_KEYS (JSON array of
 *     {origin, keyId, publicKey, status?}) adds keys for a NON-default Studio
 *     (staging, local development). An env key verifies only packages served
 *     by its own origin, entries naming a default origin are ignored, and an
 *     env keyId that collides with a pinned keyId is ignored: the env can
 *     never stand in for the production keys.
 *
 * Policy switch: BRANDCODE_REQUIRE_SIGNED_APPROVAL ("true"/"1" or
 * "false"/"0"; default REQUIRE_SIGNED_APPROVAL_DEFAULT) refuses approvals on
 * unsigned packages when on.
 *
 * See docs/SIGNED-PACKAGES.md for the threat model and key rotation.
 */

import { createPublicKey, verify as cryptoVerify, type KeyObject } from "node:crypto";
import { computePackageDigest } from "../../lib/package-digest.js";
import {
  readBrandFileSafe,
  removeBrandFileSafe,
  writeBrandFileSafe,
} from "../../lib/safe-write.js";
import { PINNED_BRANDCODE_SIGNING_KEYS, type PinnedSigningKey } from "./signing-keys.js";
import { DEFAULT_TRUSTED_BRANDCODE_ORIGINS, normalizeTrustedOriginEntry, originOf } from "./trust.js";

export const SIGNATURE_ALG = "Ed25519";
export const SIGNED_MESSAGE_CONTEXT = "brandcode-package-signature/v1";
export const SIGNING_KEYS_ENV = "BRANDCODE_STUDIO_SIGNING_KEYS";
export const REQUIRE_SIGNED_APPROVAL_ENV = "BRANDCODE_REQUIRE_SIGNED_APPROVAL";
/** Flip to true once every supported Studio signs its packages. */
export const REQUIRE_SIGNED_APPROVAL_DEFAULT = false;
export const SIGNATURE_FILE = "brandcode-package.sig.json";
const PACKAGE_FILE = "brandcode-package.json";

const KEY_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;
const MAX_SIG_CHARS = 256;
const MAX_SIGNED_AT_CHARS = 64;

export interface BrandPackageSignature {
  alg: typeof SIGNATURE_ALG;
  keyId: string;
  digest: string;
  sig: string;
  signedAt: string;
}

export type SignatureStatus = "verified" | "invalid" | "unsigned";

export type SignatureFailureReason =
  | "malformed"
  | "unsupported_alg"
  | "digest_mismatch"
  | "unknown_key"
  | "bad_signature";

export interface SignatureVerification {
  status: SignatureStatus;
  /** keyId the signature names (verified or not). */
  key_id?: string;
  /** Where the verifying key came from. */
  key_source?: "pinned" | "env";
  /** "sha256:<hex>" the signature claims. */
  digest?: string;
  signed_at?: string;
  reason?: SignatureFailureReason;
}

export interface ResolvedSigningKey {
  keyId: string;
  key: KeyObject;
  status: "active" | "retired";
  source: "pinned" | "env";
  /** env keys only: the one origin the key may verify for. */
  origin?: string;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** True when unsigned packages may not confer or keep production approval. */
export function requireSignedApproval(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env[REQUIRE_SIGNED_APPROVAL_ENV]?.trim().toLowerCase();
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  return REQUIRE_SIGNED_APPROVAL_DEFAULT;
}

let pinnedOverride: readonly PinnedSigningKey[] | null = null;

/**
 * Test seam: replace the pinned key list. Call with no argument to restore
 * the shipped list.
 */
export function setPinnedSigningKeysForTests(keys?: readonly PinnedSigningKey[]): void {
  pinnedOverride = keys ?? null;
}

function parsePublicKey(text: string): KeyObject | null {
  try {
    const trimmed = text.trim();
    const key = trimmed.includes("-----BEGIN")
      ? createPublicKey({ key: trimmed.replace(/\\n/g, "\n"), format: "pem" })
      : createPublicKey({ key: Buffer.from(trimmed, "base64"), format: "der", type: "spki" });
    return key.asymmetricKeyType === "ed25519" ? key : null;
  } catch {
    return null;
  }
}

function resolvePinnedKeys(): ResolvedSigningKey[] {
  const out: ResolvedSigningKey[] = [];
  for (const entry of pinnedOverride ?? PINNED_BRANDCODE_SIGNING_KEYS) {
    if (!KEY_ID_PATTERN.test(entry.keyId)) continue;
    if (entry.status !== "active" && entry.status !== "retired") continue;
    const key = parsePublicKey(entry.publicKey);
    if (!key) continue;
    out.push({ keyId: entry.keyId, key, status: entry.status, source: "pinned" });
  }
  return out;
}

function resolveEnvKeys(env: NodeJS.ProcessEnv, pinnedIds: Set<string>): ResolvedSigningKey[] {
  const raw = env[SIGNING_KEYS_ENV];
  if (!raw?.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: ResolvedSigningKey[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const { origin, keyId, publicKey, status } = entry as Record<string, unknown>;
    if (typeof origin !== "string" || typeof keyId !== "string" || typeof publicKey !== "string") {
      continue;
    }
    const normalized = normalizeTrustedOriginEntry(origin);
    if (!normalized || DEFAULT_TRUSTED_BRANDCODE_ORIGINS.includes(normalized)) continue;
    if (!KEY_ID_PATTERN.test(keyId) || pinnedIds.has(keyId)) continue;
    const resolvedStatus = status === undefined ? "active" : status;
    if (resolvedStatus !== "active" && resolvedStatus !== "retired") continue;
    const key = parsePublicKey(publicKey);
    if (!key) continue;
    out.push({ keyId, key, status: resolvedStatus, source: "env", origin: normalized });
  }
  return out;
}

/**
 * Keys that may verify a package served by `origin` (or, with no origin, a
 * package of unknown provenance: pinned keys only).
 */
export function getSigningKeys(
  origin?: string,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedSigningKey[] {
  const pinned = resolvePinnedKeys();
  const pinnedIds = new Set(pinned.map((k) => k.keyId));
  const requestOrigin = origin ? originOf(origin) : null;
  const envKeys = requestOrigin
    ? resolveEnvKeys(env, pinnedIds).filter((k) => k.origin === requestOrigin)
    : [];
  return [...pinned, ...envKeys];
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

/** The exact UTF-8 message Studio signs. */
export function buildSignedMessage(fields: {
  keyId: string;
  signedAt: string;
  digest: string;
}): string {
  return [SIGNED_MESSAGE_CONTEXT, fields.keyId, fields.signedAt, fields.digest].join("\n");
}

function parseSignature(value: unknown): BrandPackageSignature | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { alg, keyId, digest, sig, signedAt } = value as Record<string, unknown>;
  if (
    typeof alg !== "string" ||
    typeof keyId !== "string" ||
    typeof digest !== "string" ||
    typeof sig !== "string" ||
    typeof signedAt !== "string"
  ) {
    return null;
  }
  if (!KEY_ID_PATTERN.test(keyId) || !DIGEST_PATTERN.test(digest)) return null;
  if (sig.length === 0 || sig.length > MAX_SIG_CHARS || signedAt.length > MAX_SIGNED_AT_CHARS) {
    return null;
  }
  return { alg: alg as typeof SIGNATURE_ALG, keyId, digest, sig, signedAt };
}

/**
 * Verify a Studio signature over a package payload.
 *
 * `signature` undefined/null → unsigned. Anything else is either verified or
 * invalid with a reason; an invalid signature must never confer approval.
 */
export function verifyPackageSignature(
  payload: unknown,
  signature: unknown,
  options: { origin?: string; env?: NodeJS.ProcessEnv } = {},
): SignatureVerification {
  if (signature === undefined || signature === null) return { status: "unsigned" };
  const parsed = parseSignature(signature);
  if (!parsed) return { status: "invalid", reason: "malformed" };
  const base = { key_id: parsed.keyId, digest: parsed.digest, signed_at: parsed.signedAt };
  if (parsed.alg !== SIGNATURE_ALG) {
    return { status: "invalid", reason: "unsupported_alg", ...base };
  }
  if (parsed.digest !== `sha256:${computePackageDigest(payload)}`) {
    return { status: "invalid", reason: "digest_mismatch", ...base };
  }
  const key = getSigningKeys(options.origin, options.env ?? process.env).find(
    (k) => k.keyId === parsed.keyId,
  );
  if (!key) return { status: "invalid", reason: "unknown_key", ...base };

  let ok = false;
  try {
    ok = cryptoVerify(
      null,
      Buffer.from(buildSignedMessage(parsed), "utf8"),
      key.key,
      Buffer.from(parsed.sig, "base64"),
    );
  } catch {
    ok = false;
  }
  if (!ok) return { status: "invalid", reason: "bad_signature", ...base };
  return { status: "verified", key_source: key.source, ...base };
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/** Store (or, when absent, remove) the signature that came with a package. */
export async function writePackageSignature(cwd: string, signature: unknown): Promise<void> {
  if (signature && typeof signature === "object" && !Array.isArray(signature)) {
    await writeBrandFileSafe(cwd, SIGNATURE_FILE, JSON.stringify(signature, null, 2) + "\n");
  } else {
    await removeBrandFileSafe(cwd, SIGNATURE_FILE);
  }
}

/** Raw stored signature, or null when absent. Unparseable → "malformed" marker. */
export async function readPackageSignature(cwd: string): Promise<unknown> {
  const raw = await readBrandFileSafe(cwd, SIGNATURE_FILE);
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    // Present but unreadable: verification reports it as malformed.
    return { malformed: true };
  }
}

/**
 * Verify the stored signature against the stored package. Returns null when
 * no package is on disk.
 */
export async function verifyStoredPackageSignature(
  cwd: string,
  origin?: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<SignatureVerification | null> {
  const rawPackage = await readBrandFileSafe(cwd, PACKAGE_FILE);
  if (rawPackage === null) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(rawPackage);
  } catch {
    return { status: "invalid", reason: "digest_mismatch" };
  }
  return verifyPackageSignature(payload, await readPackageSignature(cwd), { origin, env });
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

/** Short label for responses: "signed/verified", "signed/invalid", "unsigned". */
export function signatureLabel(v: SignatureVerification): string {
  return v.status === "unsigned" ? "unsigned" : `signed/${v.status}`;
}

const REASON_TEXT: Record<SignatureFailureReason, string> = {
  malformed: "the signature is malformed",
  unsupported_alg: "the signature uses an unsupported algorithm",
  digest_mismatch: "the package does not match the digest that was signed (modified after signing)",
  unknown_key: "the signing key is not one this MCP release trusts",
  bad_signature: "the signature does not verify against the named key",
};

/** One-line human description of a verification outcome. */
export function describeSignatureVerification(v: SignatureVerification): string {
  switch (v.status) {
    case "verified":
      return `Package signature verified (Ed25519, key ${v.key_id}${v.key_source === "env" ? `, from ${SIGNING_KEYS_ENV}` : ""}).`;
    case "invalid":
      return `Package signature is INVALID${v.key_id ? ` (key ${v.key_id})` : ""}: ${REASON_TEXT[v.reason ?? "malformed"]}. Any approval it declares is ignored.`;
    default:
      return requireSignedApproval()
        ? `Package is unsigned; ${REQUIRE_SIGNED_APPROVAL_ENV} is on, so it cannot confer production approval.`
        : "Package is unsigned; approval falls back to the trusted-origin rule.";
  }
}
