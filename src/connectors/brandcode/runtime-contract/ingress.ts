import type { BrandPackagePayload } from "../types.js";
import {
  normalizeRuntimeContract,
  type NormalizedRuntimeContract,
} from "./normalize.js";
import {
  BRANDCODE_RUNTIME_CONTRACT_V1,
  type RuntimeContractV1,
} from "./schema.js";

type RuntimeContractSlice = "full" | "visual" | "voice" | "minimal";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isRuntimeContractCandidate(
  value: unknown,
): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    typeof value.schemaVersion === "string" &&
    value.schemaVersion.startsWith("brandcode-runtime-contract/")
  );
}

/**
 * Negotiate the UCS-owned runtime contract at the single hosted package
 * ingress. Legacy package shapes return null and continue through the existing
 * compatibility adapter. Once a package advertises this contract family,
 * validation failures are terminal and must not silently fall back.
 */
export function normalizeRuntimeContractFromPackage(
  pkg: BrandPackagePayload | null,
): NormalizedRuntimeContract | null {
  if (!pkg) return null;
  const record = pkg as Record<string, unknown>;
  const candidates = [
    record,
    record.runtimeContract,
    record.runtime_contract,
    record.fullBrandRuntimeContract,
    record.full_brand_runtime_contract,
    record.runtime,
  ];
  const candidate = candidates.find(isRuntimeContractCandidate);
  return candidate ? normalizeRuntimeContract(candidate) : null;
}

/** Preserve explicit authority objects while trimming only whole contract sections. */
export function sliceRuntimeContract(
  runtime: RuntimeContractV1,
  slice: RuntimeContractSlice,
): Record<string, unknown> {
  if (slice === "full") return runtime;

  const boundary = {
    schemaVersion: BRANDCODE_RUNTIME_CONTRACT_V1,
    manifest: runtime.manifest,
    officialBrand: runtime.officialBrand,
    capabilityWarnings: runtime.capabilityWarnings,
  };

  if (slice === "minimal") return boundary;
  if (slice === "voice") {
    return {
      ...boundary,
      voice: runtime.voice,
      strategy: runtime.strategy,
      tasteGuidance: runtime.tasteGuidance,
    };
  }
  return {
    ...boundary,
    interactionPolicy: runtime.interactionPolicy,
    assets: runtime.assets,
    kits: runtime.kits,
  };
}
