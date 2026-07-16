/**
 * External consumer types pinned to the UCS-owned Runtime Contract V1.
 *
 * Canonical source: UCS app/tools/lib/runtime-contract/schema.ts
 * Canonical implementation commit: 068f06ed31df568986f045753fd7ef7166c14d1e
 * Do not evolve this copy independently; adopt a new UCS fixture bundle.
 */
export const BRANDCODE_RUNTIME_CONTRACT_V1 =
  "brandcode-runtime-contract/v1" as const;
export const BRANDCODE_RUNTIME_CONTRACT_PREVIOUS =
  "brandcode-runtime-contract/v0.9" as const;

export type RuntimeContractProvenanceClass =
  "official_source" | "compiled_source" | "reviewed_memory" | "package_overlay";

export type RuntimeContractDeliveryHandle = {
  assetId: string;
  brandSlug: string;
  resolverRef: string;
  transport: "package_path" | "trusted_brandcode_url";
  posture: "package_non_expiring" | "signed_expiring";
  integritySha256: string | null;
  expiresAt: string | null;
};

export type RuntimeContractV1 = {
  schemaVersion: typeof BRANDCODE_RUNTIME_CONTRACT_V1;
  manifest: {
    objectType: "full_brand_runtime";
    runtimeId: string;
    brandSlug: string;
    brandName: string;
    runtimeVersion: string;
    generatedAt: string;
    authority: "compiled_runtime";
    provenanceClass: RuntimeContractProvenanceClass;
  };
  officialBrand: {
    objectType: "official_brand";
    slug: string;
    name: string;
    version: string;
    authority: "official";
    provenanceClass: RuntimeContractProvenanceClass;
  };
  voice: {
    verbalIdentity: string;
    phrases: Array<{ phrase: string; usage: string }>;
  };
  strategy: {
    perspective: string | null;
    moves: Array<{ id: string; name: string; status: string }>;
  };
  knowledge: {
    corpusId: string | null;
    documentCount: number;
    descriptors: Array<{ id: string; sourceClass: string; status: string }>;
  };
  interactionPolicy: {
    mutability: "read_only" | "writable";
    defaultSurface: string;
    supportedSurfaces: string[];
    rules: Array<{ id: string; touchpoint: string; guidance: string }>;
  };
  assets: Array<{
    objectType: "production_approved_asset";
    id: string;
    name: string;
    category: string;
    authority: "production_approved";
    approvalState: "approved";
    provenanceClass: RuntimeContractProvenanceClass;
    deliveryRef: string | null;
    deliveryHandle: RuntimeContractDeliveryHandle | null;
    runtimeRoles: string[];
  }>;
  kits: {
    selected: {
      objectType: "selected_brand_kit";
      id: string;
      name: string;
      authority: "selected_context";
      provenanceClass: RuntimeContractProvenanceClass;
      memberAssetIds: string[];
    } | null;
    campaigns: Array<{
      objectType: "campaign_exploratory_kit";
      id: string;
      name: string;
      authority: "exploratory_context";
      provenanceClass: RuntimeContractProvenanceClass;
    }>;
  };
  tasteGuidance: Array<{
    objectType: "reviewed_taste_guidance";
    id: string;
    guidance: string;
    reviewStatus: "approved";
    authority: "reviewed_memory";
    provenanceClass: "reviewed_memory";
  }>;
  capabilityWarnings: Array<{ code: string; message: string }>;
};

export const RUNTIME_CONTRACT_V1_JSON_SCHEMA = {
  $id: BRANDCODE_RUNTIME_CONTRACT_V1,
  title: "Brandcode Full Brand Runtime Contract V1",
  type: "object",
  additionalProperties: true,
  required: [
    "schemaVersion",
    "manifest",
    "officialBrand",
    "voice",
    "strategy",
    "knowledge",
    "interactionPolicy",
    "assets",
    "kits",
    "tasteGuidance",
    "capabilityWarnings",
  ],
  properties: {
    schemaVersion: { const: BRANDCODE_RUNTIME_CONTRACT_V1 },
    manifest: {
      type: "object",
      required: [
        "objectType",
        "runtimeId",
        "brandSlug",
        "brandName",
        "runtimeVersion",
        "generatedAt",
        "authority",
        "provenanceClass",
      ],
      properties: {
        objectType: { const: "full_brand_runtime" },
        runtimeId: { type: "string" },
        brandSlug: { type: "string" },
        brandName: { type: "string" },
        runtimeVersion: { type: "string" },
        generatedAt: { type: "string", format: "date-time" },
        authority: { const: "compiled_runtime" },
        provenanceClass: { type: "string" },
      },
    },
    officialBrand: {
      type: "object",
      required: [
        "objectType",
        "slug",
        "name",
        "version",
        "authority",
        "provenanceClass",
      ],
      properties: {
        objectType: { const: "official_brand" },
        slug: { type: "string" },
        name: { type: "string" },
        version: { type: "string" },
        authority: { const: "official" },
        provenanceClass: { type: "string" },
      },
    },
    voice: { type: "object", required: ["verbalIdentity", "phrases"] },
    strategy: { type: "object", required: ["perspective", "moves"] },
    knowledge: {
      type: "object",
      required: ["corpusId", "documentCount", "descriptors"],
    },
    interactionPolicy: {
      type: "object",
      required: ["mutability", "defaultSurface", "supportedSurfaces", "rules"],
    },
    assets: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: true,
        required: [
          "objectType",
          "id",
          "name",
          "category",
          "authority",
          "approvalState",
          "provenanceClass",
          "deliveryRef",
          "runtimeRoles",
        ],
        properties: {
          deliveryHandle: {
            anyOf: [
              { type: "null" },
              {
                type: "object",
                additionalProperties: true,
                required: [
                  "assetId",
                  "brandSlug",
                  "resolverRef",
                  "transport",
                  "posture",
                  "integritySha256",
                  "expiresAt",
                ],
              },
            ],
          },
        },
      },
    },
    kits: { type: "object", required: ["selected", "campaigns"] },
    tasteGuidance: {
      type: "array",
      items: { type: "object", additionalProperties: true },
    },
    capabilityWarnings: {
      type: "array",
      items: { type: "object", additionalProperties: true },
    },
  },
} as const;
