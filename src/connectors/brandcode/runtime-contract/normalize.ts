/**
 * External consumer normalizer pinned to the UCS-owned Runtime Contract V1.
 *
 * Canonical source: UCS app/tools/lib/runtime-contract/normalize.ts lines 2-423
 * Canonical implementation commit: 1c919eac48fd4bd54f8be39a0c2288df2f53b8a9
 * Producer projection remains UCS-only. Conformance is locked by copied fixtures.
 */
import {
  BRANDCODE_RUNTIME_CONTRACT_PREVIOUS,
  BRANDCODE_RUNTIME_CONTRACT_V1,
  type RuntimeContractProvenanceClass,
  type RuntimeContractV1,
} from "./schema.js";

export type RuntimeContractNegotiation = {
  producerVersion: string;
  consumerVersion: typeof BRANDCODE_RUNTIME_CONTRACT_V1;
  status: "exact" | "compatible_previous";
  warnings: string[];
};

export type NormalizedRuntimeContract = {
  runtime: RuntimeContractV1;
  negotiation: RuntimeContractNegotiation;
};

export class RuntimeContractValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Invalid Brandcode runtime contract: ${issues.join("; ")}`);
    this.name = "RuntimeContractValidationError";
    this.issues = issues;
  }
}

type UnknownRecord = Record<string, unknown>;

function record(value: unknown, path: string, issues: string[]): UnknownRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    issues.push(`${path} must be an object`);
    return {};
  }
  return value as UnknownRecord;
}

function stringValue(value: unknown, path: string, issues: string[]): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    issues.push(`${path} must be a non-empty string`);
    return "";
  }
  return value.trim();
}

function nullableString(
  value: unknown,
  path: string,
  issues: string[],
): string | null {
  if (value === null) return null;
  return stringValue(value, path, issues);
}

function isoDateTime(value: unknown, path: string, issues: string[]): string {
  const normalized = stringValue(value, path, issues);
  if (normalized && Number.isNaN(new Date(normalized).getTime())) {
    issues.push(`${path} must be an ISO date-time`);
  }
  return normalized;
}

function array(value: unknown, path: string, issues: string[]): unknown[] {
  if (!Array.isArray(value)) {
    issues.push(`${path} must be an array`);
    return [];
  }
  return value;
}

function literal<T extends string>(
  value: unknown,
  expected: T,
  path: string,
  issues: string[],
): T {
  if (value !== expected) issues.push(`${path} must equal ${expected}`);
  return expected;
}

function provenance(
  value: unknown,
  path: string,
  issues: string[],
): RuntimeContractProvenanceClass {
  const allowed: RuntimeContractProvenanceClass[] = [
    "official_source",
    "compiled_source",
    "reviewed_memory",
    "package_overlay",
  ];
  if (!allowed.includes(value as RuntimeContractProvenanceClass)) {
    issues.push(`${path} must name a supported provenance class`);
    return "compiled_source";
  }
  return value as RuntimeContractProvenanceClass;
}

function sorted<T>(values: T[], key: (value: T) => string): T[] {
  return [...values].sort((left, right) => key(left).localeCompare(key(right)));
}

function previousToV1(input: UnknownRecord): UnknownRecord {
  const brand = record(input.brand, "brand", []);
  return {
    ...input,
    schemaVersion: BRANDCODE_RUNTIME_CONTRACT_V1,
    officialBrand: {
      ...brand,
      objectType: "official_brand",
      authority: "official",
    },
  };
}

export function normalizeRuntimeContract(
  input: unknown,
): NormalizedRuntimeContract {
  const issues: string[] = [];
  const root = record(input, "$", issues);
  const producerVersion = stringValue(
    root.schemaVersion,
    "schemaVersion",
    issues,
  );
  if (
    producerVersion !== BRANDCODE_RUNTIME_CONTRACT_V1 &&
    producerVersion !== BRANDCODE_RUNTIME_CONTRACT_PREVIOUS
  ) {
    issues.push(
      `schemaVersion ${producerVersion || "<missing>"} has an unsupported major version`,
    );
  }
  const source =
    producerVersion === BRANDCODE_RUNTIME_CONTRACT_PREVIOUS
      ? previousToV1(root)
      : root;
  const manifest = record(source.manifest, "manifest", issues);
  const officialBrand = record(source.officialBrand, "officialBrand", issues);
  const voice = record(source.voice, "voice", issues);
  const strategy = record(source.strategy, "strategy", issues);
  const knowledge = record(source.knowledge, "knowledge", issues);
  const interactionPolicy = record(
    source.interactionPolicy,
    "interactionPolicy",
    issues,
  );
  const kits = record(source.kits, "kits", issues);

  const phraseEntries = array(voice.phrases, "voice.phrases", issues).map(
    (entry, index) => {
      const item = record(entry, `voice.phrases[${index}]`, issues);
      return {
        phrase: stringValue(
          item.phrase,
          `voice.phrases[${index}].phrase`,
          issues,
        ),
        usage: stringValue(item.usage, `voice.phrases[${index}].usage`, issues),
      };
    },
  );
  const moveEntries = array(strategy.moves, "strategy.moves", issues).map(
    (entry, index) => {
      const item = record(entry, `strategy.moves[${index}]`, issues);
      return {
        id: stringValue(item.id, `strategy.moves[${index}].id`, issues),
        name: stringValue(item.name, `strategy.moves[${index}].name`, issues),
        status: stringValue(
          item.status,
          `strategy.moves[${index}].status`,
          issues,
        ),
      };
    },
  );
  const descriptors = array(
    knowledge.descriptors,
    "knowledge.descriptors",
    issues,
  ).map((entry, index) => {
    const item = record(entry, `knowledge.descriptors[${index}]`, issues);
    return {
      id: stringValue(item.id, `knowledge.descriptors[${index}].id`, issues),
      sourceClass: stringValue(
        item.sourceClass,
        `knowledge.descriptors[${index}].sourceClass`,
        issues,
      ),
      status: stringValue(
        item.status,
        `knowledge.descriptors[${index}].status`,
        issues,
      ),
    };
  });
  const rules = array(
    interactionPolicy.rules,
    "interactionPolicy.rules",
    issues,
  ).map((entry, index) => {
    const item = record(entry, `interactionPolicy.rules[${index}]`, issues);
    return {
      id: stringValue(item.id, `interactionPolicy.rules[${index}].id`, issues),
      touchpoint: stringValue(
        item.touchpoint,
        `interactionPolicy.rules[${index}].touchpoint`,
        issues,
      ),
      guidance: stringValue(
        item.guidance,
        `interactionPolicy.rules[${index}].guidance`,
        issues,
      ),
    };
  });
  const supportedSurfaces = array(
    interactionPolicy.supportedSurfaces,
    "interactionPolicy.supportedSurfaces",
    issues,
  ).map((value, index) =>
    stringValue(value, `interactionPolicy.supportedSurfaces[${index}]`, issues),
  );

  const assets = array(source.assets, "assets", issues).map((entry, index) => {
    const item = record(entry, `assets[${index}]`, issues);
    return {
      objectType: literal(
        item.objectType,
        "production_approved_asset",
        `assets[${index}].objectType`,
        issues,
      ),
      id: stringValue(item.id, `assets[${index}].id`, issues),
      name: stringValue(item.name, `assets[${index}].name`, issues),
      category: stringValue(item.category, `assets[${index}].category`, issues),
      authority: literal(
        item.authority,
        "production_approved",
        `assets[${index}].authority`,
        issues,
      ),
      approvalState: literal(
        item.approvalState,
        "approved",
        `assets[${index}].approvalState`,
        issues,
      ),
      provenanceClass: provenance(
        item.provenanceClass,
        `assets[${index}].provenanceClass`,
        issues,
      ),
      deliveryRef: nullableString(
        item.deliveryRef,
        `assets[${index}].deliveryRef`,
        issues,
      ),
      runtimeRoles: sorted(
        array(item.runtimeRoles, `assets[${index}].runtimeRoles`, issues).map(
          (value, roleIndex) =>
            stringValue(
              value,
              `assets[${index}].runtimeRoles[${roleIndex}]`,
              issues,
            ),
        ),
        (value) => value,
      ),
    };
  });

  const selectedSource = kits.selected;
  const selected =
    selectedSource === null
      ? null
      : (() => {
          const item = record(selectedSource, "kits.selected", issues);
          return {
            objectType: literal(
              item.objectType,
              "selected_brand_kit",
              "kits.selected.objectType",
              issues,
            ),
            id: stringValue(item.id, "kits.selected.id", issues),
            name: stringValue(item.name, "kits.selected.name", issues),
            authority: literal(
              item.authority,
              "selected_context",
              "kits.selected.authority",
              issues,
            ),
            provenanceClass: provenance(
              item.provenanceClass,
              "kits.selected.provenanceClass",
              issues,
            ),
          };
        })();
  const campaigns = array(kits.campaigns, "kits.campaigns", issues).map(
    (entry, index) => {
      const item = record(entry, `kits.campaigns[${index}]`, issues);
      return {
        objectType: literal(
          item.objectType,
          "campaign_exploratory_kit",
          `kits.campaigns[${index}].objectType`,
          issues,
        ),
        id: stringValue(item.id, `kits.campaigns[${index}].id`, issues),
        name: stringValue(item.name, `kits.campaigns[${index}].name`, issues),
        authority: literal(
          item.authority,
          "exploratory_context",
          `kits.campaigns[${index}].authority`,
          issues,
        ),
        provenanceClass: provenance(
          item.provenanceClass,
          `kits.campaigns[${index}].provenanceClass`,
          issues,
        ),
      };
    },
  );
  const tasteGuidance = array(
    source.tasteGuidance,
    "tasteGuidance",
    issues,
  ).map((entry, index) => {
    const item = record(entry, `tasteGuidance[${index}]`, issues);
    return {
      objectType: literal(
        item.objectType,
        "reviewed_taste_guidance",
        `tasteGuidance[${index}].objectType`,
        issues,
      ),
      id: stringValue(item.id, `tasteGuidance[${index}].id`, issues),
      guidance: stringValue(
        item.guidance,
        `tasteGuidance[${index}].guidance`,
        issues,
      ),
      reviewStatus: literal(
        item.reviewStatus,
        "approved",
        `tasteGuidance[${index}].reviewStatus`,
        issues,
      ),
      authority: literal(
        item.authority,
        "reviewed_memory",
        `tasteGuidance[${index}].authority`,
        issues,
      ),
      provenanceClass: literal(
        item.provenanceClass,
        "reviewed_memory",
        `tasteGuidance[${index}].provenanceClass`,
        issues,
      ),
    };
  });
  const capabilityWarnings = array(
    source.capabilityWarnings,
    "capabilityWarnings",
    issues,
  ).map((entry, index) => {
    const item = record(entry, `capabilityWarnings[${index}]`, issues);
    return {
      code: stringValue(item.code, `capabilityWarnings[${index}].code`, issues),
      message: stringValue(
        item.message,
        `capabilityWarnings[${index}].message`,
        issues,
      ),
    };
  });

  if (issues.length > 0) throw new RuntimeContractValidationError(issues);

  const runtime: RuntimeContractV1 = {
    schemaVersion: BRANDCODE_RUNTIME_CONTRACT_V1,
    manifest: {
      objectType: literal(
        manifest.objectType,
        "full_brand_runtime",
        "manifest.objectType",
        issues,
      ),
      runtimeId: stringValue(manifest.runtimeId, "manifest.runtimeId", issues),
      brandSlug: stringValue(manifest.brandSlug, "manifest.brandSlug", issues),
      brandName: stringValue(manifest.brandName, "manifest.brandName", issues),
      runtimeVersion: stringValue(
        manifest.runtimeVersion,
        "manifest.runtimeVersion",
        issues,
      ),
      generatedAt: isoDateTime(
        manifest.generatedAt,
        "manifest.generatedAt",
        issues,
      ),
      authority: literal(
        manifest.authority,
        "compiled_runtime",
        "manifest.authority",
        issues,
      ),
      provenanceClass: provenance(
        manifest.provenanceClass,
        "manifest.provenanceClass",
        issues,
      ),
    },
    officialBrand: {
      objectType: literal(
        officialBrand.objectType,
        "official_brand",
        "officialBrand.objectType",
        issues,
      ),
      slug: stringValue(officialBrand.slug, "officialBrand.slug", issues),
      name: stringValue(officialBrand.name, "officialBrand.name", issues),
      version: stringValue(
        officialBrand.version,
        "officialBrand.version",
        issues,
      ),
      authority: literal(
        officialBrand.authority,
        "official",
        "officialBrand.authority",
        issues,
      ),
      provenanceClass: provenance(
        officialBrand.provenanceClass,
        "officialBrand.provenanceClass",
        issues,
      ),
    },
    voice: {
      verbalIdentity: stringValue(
        voice.verbalIdentity,
        "voice.verbalIdentity",
        issues,
      ),
      phrases: sorted(
        phraseEntries,
        (entry) => `${entry.phrase}:${entry.usage}`,
      ),
    },
    strategy: {
      perspective:
        typeof strategy.perspective === "string" &&
        strategy.perspective.trim().length > 0
          ? strategy.perspective.trim()
          : null,
      moves: sorted(moveEntries, (entry) => entry.id),
    },
    knowledge: {
      corpusId: nullableString(
        knowledge.corpusId,
        "knowledge.corpusId",
        issues,
      ),
      documentCount:
        typeof knowledge.documentCount === "number" &&
        knowledge.documentCount >= 0
          ? knowledge.documentCount
          : (() => {
              issues.push(
                "knowledge.documentCount must be a non-negative number",
              );
              return 0;
            })(),
      descriptors: sorted(descriptors, (entry) => entry.id),
    },
    interactionPolicy: {
      mutability:
        interactionPolicy.mutability === "writable"
          ? "writable"
          : literal(
              interactionPolicy.mutability,
              "read_only",
              "interactionPolicy.mutability",
              issues,
            ),
      defaultSurface: stringValue(
        interactionPolicy.defaultSurface,
        "interactionPolicy.defaultSurface",
        issues,
      ),
      supportedSurfaces: sorted(supportedSurfaces, (value) => value),
      rules: sorted(rules, (entry) => entry.id),
    },
    assets: sorted(assets, (entry) => entry.id),
    kits: { selected, campaigns: sorted(campaigns, (entry) => entry.id) },
    tasteGuidance: sorted(tasteGuidance, (entry) => entry.id),
    capabilityWarnings: sorted(
      capabilityWarnings,
      (entry) => `${entry.code}:${entry.message}`,
    ),
  };

  if (issues.length > 0) throw new RuntimeContractValidationError(issues);
  const semanticIssues: string[] = [];
  if (runtime.manifest.brandSlug !== runtime.officialBrand.slug) {
    semanticIssues.push("manifest.brandSlug must match officialBrand.slug");
  }
  if (runtime.manifest.brandName !== runtime.officialBrand.name) {
    semanticIssues.push("manifest.brandName must match officialBrand.name");
  }
  if (semanticIssues.length > 0) {
    throw new RuntimeContractValidationError(semanticIssues);
  }

  return {
    runtime,
    negotiation: {
      producerVersion,
      consumerVersion: BRANDCODE_RUNTIME_CONTRACT_V1,
      status:
        producerVersion === BRANDCODE_RUNTIME_CONTRACT_V1
          ? "exact"
          : "compatible_previous",
      warnings:
        producerVersion === BRANDCODE_RUNTIME_CONTRACT_PREVIOUS
          ? [
              `Normalized compatible previous producer ${BRANDCODE_RUNTIME_CONTRACT_PREVIOUS}.`,
            ]
          : [],
    },
  };
}
