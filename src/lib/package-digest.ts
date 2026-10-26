/**
 * Canonical digest of a pulled Brandcode package.
 *
 * The digest binds production_approved to one exact package (approval-state)
 * and is what Brandcode Studio signs (connectors/brandcode/signature.ts).
 * Brandcode Studio (UCS app/tools/lib/brand-package-signing.ts) replicates
 * this canonicalization byte for byte; both repos pin the same test vector
 * (test/connectors/fixtures/package-signature-vector.json). Changing this
 * function invalidates every stored approval and every Studio signature.
 */

import { createHash } from "node:crypto";

/** JSON with object keys sorted recursively, so digests ignore key order. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
}

/** sha256 (hex) of the canonical form of a pulled package payload. */
export function computePackageDigest(payload: unknown): string {
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}
