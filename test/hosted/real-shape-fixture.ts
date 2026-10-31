/**
 * SYNTHETIC hosted brand package that mirrors the STRUCTURE and SIZE of what
 * UCS serves the hosted MCP over the service-token pull: the same key paths,
 * item counts, and approximate JSON sizes, with invented values throughout.
 * No real brand content belongs in this file.
 *
 * Production shape notes (2026-10):
 *   - `package.runtime` is the raw brandInstance (UCS deriveRuntimeFromCompiled
 *     returns `payload.brandInstance`), not a compiled runtime.
 *   - brandInstance is ~275k chars, ~195k of which is 120 libraryAssets.
 *   - brandGraph (~380k), brandKnowledgeCorpus (~450k), assetManifest (~200k)
 *     ride alongside.
 */
import type { BrandPackagePayload } from "../../src/connectors/brandcode/types.js";

/** Planted in every bulk section; must never appear in a runtime response. */
export const BULK_SENTINEL = "zz-bulk-sentinel-never-in-runtime";

const pad = (seed: string, len: number) =>
  `${seed} `.repeat(Math.ceil(len / (seed.length + 1))).slice(0, len).trim();

function libraryAsset(i: number) {
  const file = `nw-library-${String(i).padStart(3, "0")}-${BULK_SENTINEL}.png`;
  const path = `/brands/northwind/library/illustration/${file}`;
  return {
    id: `northwind:library:${file}`,
    name: `Library asset ${i}`,
    category: "illustration",
    url: path,
    refs: {
      runtimeUrl: path,
      publicUrl: `https://assets.example.test${path}`,
      chatUrl: `https://assets.example.test${path}?mode=chat`,
      figmaUrl: `https://assets.example.test${path}?mode=figma`,
      localPath: `public${path}`,
      sourcePath: `source${path}`,
      transport: "public_url",
      canInlineData: false,
      figmaBytesEligible: true,
    },
    approved: true,
    sourceMeta: { source: "asset_registry", path: `source${path}` },
    registry: {
      assetSetId: "northwind-library",
      assetSetLabel: "Northwind Library",
      assetSetRole: "supporting_illustration",
      status: "approved",
      includeInRuntime: true,
      effectiveIncludeInRuntime: true,
      runtimeRoles: ["supporting_visual", "editorial_spot"],
      tags: ["nw", "spot"],
      notes: pad("Invented registry note", 400),
      promptFamily: null,
      variantOf: null,
      sourceKind: "registry",
      usage: { allowed: ["social", "web", "deck", "print"], blocked: [] },
    },
  };
}

const reviewIdentity = (id: string) => ({
  objectId: id,
  lastReviewed: null,
  nextReview: null,
  reviewDue: null,
  replacementId: null,
  explicitState: null,
});

function narrative(i: number) {
  return {
    id: `nw-n-${String(i).padStart(3, "0")}`,
    name: `Tidewater narrative ${i}`,
    version: "1.0",
    status: "Active",
    type: "Strategic Narrative",
    description: `Northwind narrative ${i} explains how invented harbors stay calm. ${pad("Second sentence of filler detail", 160)}`,
    key_messages: [
      pad(`Key message A${i}`, 47),
      pad(`Key message B${i}`, 47),
      pad(`Key message C${i}`, 47),
    ],
    proof_points: [`nw-p-00${i % 9}`, `nw-p-01${i % 9}`],
    target_personas: ["P01", "P02", "P03"],
    content_types: ["blog", "deck", "post", "page"],
  };
}

function applicationRule(i: number) {
  return {
    id: `nw-r${String(i).padStart(2, "0")}`,
    content_type: `Synthetic content type ${i}`,
    touchpoint: "web",
    framework: "Hook Proof Ask",
    required_elements: ["hook", "proof"],
    tone: `Calm and specific, never breathless ${i}. ${pad("Tone filler", 50)}`,
    guidance: pad(`Invented guidance for rule ${i}`, 260),
    journey_stage: "Consideration",
    reviewIdentity: reviewIdentity(`nw-r${i}`),
  };
}

function proofPoint(i: number) {
  return {
    id: `nw-p-${String(i).padStart(3, "0")}`,
    claim: `Invented claim ${i}: ${pad("ninety synthetic harbors report calmer water", 90)}`,
    type: "statistic",
    confidence: 0.8,
    status: "Active",
    tier: "Primary",
    narrative: "nw-n-001",
    source: "Synthetic survey 2026",
    reviewIdentity: reviewIdentity(`nw-p-${i}`),
  };
}

function layoutRecipe(i: number) {
  return {
    id: `nw-recipe-${i}-${pad("long-id", 80).replace(/ /g, "-")}`,
    name: `Recipe ${i}`,
    sceneId: `scene-${i}`,
    sceneName: `Scene ${i}`,
    surfaceId: `surface-${i}`,
    surfaceLabel: "Social square",
    dimensions: { width: 1080, height: 1080 },
    category: "social",
    family: "editorial-spotlight",
    renderer: "svg",
    status: "ready",
    contextTags: ["social", "launch"],
    description: "Invented hero layout for launches",
    fieldNames: ["title", "body"],
    imageSlots: [{ controlName: "heroImage", controlLabel: "Hero", role: "hero", label: "Hero", aspectRatio: null, overlayHint: null, optional: false }],
    textSlots: [{ controlName: "title", controlLabel: "Title" }, { controlName: "body", controlLabel: "Body" }],
    fieldValues: {},
    imageUrls: { logoImage: "/brands/northwind/logo.svg" },
    policy: null,
    layoutSpec: {
      schema: "layout-spec/v1",
      id: `spec-${i}`,
      name: `Recipe ${i}`,
      intent: "Invented launch hero",
      surfaces: [{ id: "a" }, { id: "b" }],
      background: { kind: "gradient", from: "#0b3d5c", to: "#1f7a8c", angle: 135 },
      padding: "64",
      regions: Array.from({ length: 5 }, (_, r) => ({ id: `region-${r}`, note: pad(`${BULK_SENTINEL} region`, 1200) })),
    },
    approval: { approvedAt: "2026-09-01T00:00:00.000Z", specId: `spec-${i}`, contentHash: "abc123" },
    preview: { source: "studio", artifactTurnId: null, query: "launch hero", label: `Recipe ${i}` },
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
  };
}

const logoAsset = (name: string) => ({
  id: `northwind:logo:${name}`,
  name,
  url: `/brands/northwind/${name}`,
  refs: {
    runtimeUrl: `/brands/northwind/${name}`,
    publicUrl: `https://assets.example.test/brands/northwind/${name}`,
    chatUrl: `https://assets.example.test/brands/northwind/${name}`,
    figmaUrl: `https://assets.example.test/brands/northwind/${name}`,
    localPath: null,
    sourcePath: null,
    transport: "public_url",
    canInlineData: true,
    figmaBytesEligible: true,
  },
  category: "logo",
  approved: null,
  sourceMeta: { source: "brand_manifest" },
});

function bulk(label: string, count: number, size: number) {
  return Array.from({ length: count }, (_, i) => ({
    id: `${label}-${i}`,
    text: pad(`${BULK_SENTINEL} ${label} record ${i}`, size),
  }));
}

export function buildRealShapeBrandInstance(): Record<string, unknown> {
  const fontRole = (family: string) => ({
    fontFamily: family,
    checkFamilies: ["Fjord"],
    fallbackStack: ["system-ui", "sans-serif"],
  });
  return {
    manifest: {
      schema: "brandcode-manifest/v1",
      name: "Northwind Tide",
      shortName: "NW",
      slug: "nw",
      version: "1.0",
      brandcodeVersion: "1.0",
      url: "https://example.test",
      assetBaseUrl: "https://assets.example.test/brands/nw",
      status: { verbal_identity: "complete", visual_identity: "complete", governance: "active", production_engines: "ready" },
      documents: {},
      governance: {},
      compilation: {},
      raw: { notes: pad("manifest raw filler", 3000) },
    },
    perspective: pad("Northwind believes calm water is earned, not found.", 1240),
    perspectiveReview: reviewIdentity("perspective"),
    proofPoints: Array.from({ length: 15 }, (_, i) => proofPoint(i + 1)),
    narratives: Array.from({ length: 24 }, (_, i) => narrative(i + 1)),
    brandPhrases: [
      { phrase: "Steady as the tide", arc_position: "close", usage: "Sign-offs and closing lines", deploy_verbatim: true },
      { phrase: "Calm is a craft", arc_position: "open", usage: "Openers on long-form pieces", deploy_verbatim: true },
      { phrase: "Chart the quiet route", arc_position: "pivot", usage: "Transitions into the offer", deploy_verbatim: false },
    ],
    stats: Array.from({ length: 3 }, (_, i) => ({ stat: `${40 + i}%`, explainer: pad(`Invented stat explainer ${i}`, 83), tier: "Primary", proof_point: `nw-p-00${i + 1}` })),
    applicationRules: Array.from({ length: 15 }, (_, i) => applicationRule(i + 1)),
    strategyMoves: [],
    verbalIdentity: `Northwind Tide writes like a harbor pilot: calm, exact, unhurried. ${pad("Verbal identity filler sentence.", 6850)}`,
    tokens: {
      colors: {
        primary: "#0b6e4f",
        dark: "#0d1b2a",
        white: "#ffffff",
        lightGrey: "#eef2f4",
        secondary: "#f2c14e",
        tertiary: "#5fa8d3",
        accentAlt: "#9b5de5",
      },
      surface: {
        default: "#0d1b2a",
        light: "#eef2f4",
        card: "rgba(255, 255, 255, 0.05)",
        cardBorder: "rgba(255, 255, 255, 0.10)",
      },
      text: {
        primary: "rgba(255, 255, 255, 1)",
        secondary: "rgba(255, 255, 255, 0.70)",
        tertiary: "rgba(255, 255, 255, 0.45)",
      },
      action: { primary: "#0b6e4f" },
      typography: { fontFamily: "Fjord Sans, system-ui, sans-serif", displayWeight: 700, bodyWeight: 400 },
      layout: { radius: { card: "24px", pill: "999px", input: "6px", sm: "8px", md: "12px", lg: "32px" } },
      brandName: "Northwind Tide",
    },
    fonts: {
      strategy: "local_first",
      fontFamily: "Fjord Sans, system-ui, sans-serif",
      checkFamilies: ["Fjord"],
      fallbackStack: ["system-ui", "sans-serif"],
      localFaces: Array.from({ length: 5 }, (_, i) => ({ family: "Fjord", weight: 300 + i * 100, style: "normal", display: "swap", sources: [{ url: "/f.woff2" }, { url: "/f.woff" }] })),
      googleFamilies: [{ family: "Fjord", weights: [300, 400, 500, 600, 700], display: "swap" }],
      roles: {
        body: fontRole("Fjord Sans, system-ui, sans-serif"),
        display: fontRole("Fjord Display, system-ui, sans-serif"),
      },
    },
    tokenSource: { source: "tokens.json", path: "brands/nw/tokens" },
    assets: [
      logoAsset("nw-mark-teal.svg"),
      logoAsset("nw-mark-white.svg"),
      logoAsset("nw-wordmark-dark.svg"),
      logoAsset("nw-wordmark-white.svg"),
    ],
    libraryAssets: Array.from({ length: 120 }, (_, i) => libraryAsset(i + 1)),
    layoutPolicy: null,
    layoutRecipes: Array.from({ length: 3 }, (_, i) => layoutRecipe(i + 1)),
    adaptiveLayoutFamilies: [
      { schema: "adaptive/v1", id: "nw-adaptive-editorial", version: "1", brandSlug: "nw", solver: "grid", surfaces: [], requiredSlots: [], compositionSeeds: bulk("seed", 4, 1500), policies: {}, tokenRoles: {}, assetRoles: {}, benchmark: {}, fixedFallbacks: [], lineage: {}, runtimeSource: "studio" },
    ],
    diagnostics: [
      { code: "font_local_face_missing", level: "warn", message: "Synthetic diagnostic message", file: "brands/nw/fonts" },
      { code: "asset_registry_partial", level: "info", message: "Synthetic diagnostic message", file: "brands/nw/assets" },
    ],
    readiness: { stage: "production", doctrine: "ready", categoryFraming: "ready", visual: "ready", assets: "ready", illustration: "ready", export: "ready", reasons: [], primaryConcern: null, nextUnlock: null, dimensionDetails: {} },
    capabilities: { enabled: ["kitchen", "messaging", "templates"], blocked: [] },
    compilationManifest: {
      schema: "compilation-manifest/v1",
      generationId: "gen-synthetic",
      compiledAt: "2026-10-01T12:00:00.000Z",
      runtimeVersion: "2026-10-01",
      brandSlug: "nw",
      sourceHashes: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`source-${i}`, "f".repeat(64)])),
      sourceDigest: "e".repeat(64),
    },
    compositionConfig: {
      frame: { borderRadius: 12, borderColor: "#0b6e4f", borderWidth: 2, accentSeams: false, edgeTreatment: "soft" },
      dossier: { headingFont: "Fjord Display", bodyFont: "Fjord Sans", headingWeight: 700, bodyWeight: 400, typeScale: 1.2, textColor: "rgba(255, 255, 255, 1)", backgroundAlpha: 0.9 },
      logo: { defaultZone: "top-left", scale: 0.8, prominence: "quiet" },
      layout: Object.fromEntries(
        ["hero", "plate", "cutaway", "sidecar", "atlas"].map((mode) => [
          mode,
          { heroScale: 1, heroOffsetX: 0, heroOffsetY: 0, innerRadius: 8, contentInset: 24, footerY: 0.9 },
        ]),
      ),
    },
    compositionSummary: "soft framing, quiet top-left logo, generous inset",
    illustrationSupport: null,
  };
}

/**
 * Full package as the hosted MCP receives it with a service token
 * (`runtime` = the raw brandInstance). Pass `{ serviceTokenShape: false }`
 * for the public-pull shape (no `runtime` key).
 */
export function buildRealShapePackage(
  opts: { serviceTokenShape?: boolean } = {},
): BrandPackagePayload {
  const brandInstance = buildRealShapeBrandInstance();
  const pkg: BrandPackagePayload = {
    slug: "nw",
    runtimeVersion: "2026-10-01",
    brandInstance,
    brandData: { notes: bulk("brand-data", 30, 1600) },
    assetManifest: { assets: bulk("asset-manifest", 120, 1640) },
    links: { studio: "https://example.test/s", console: "https://example.test/c", package: "https://example.test/p", assetManifest: "https://example.test/a" },
    studioRuntime: { classification: "compiled_brand_runtime", mutability: "read_only", supportedSurfaces: ["kitchen"], defaultSurface: "kitchen" },
    assetRequirements: { requirements: bulk("asset-requirement", 30, 1560) },
    brandGraph: { nodes: bulk("graph-node", 240, 1580) },
    brandKnowledgeCorpus: { documents: bulk("corpus-doc", 280, 1610) } as unknown as BrandPackagePayload["brandKnowledgeCorpus"],
    retrievalManifest: { coverage: {}, blindSpots: [] } as unknown as BrandPackagePayload["retrievalManifest"],
  };
  if (opts.serviceTokenShape !== false) pkg.runtime = brandInstance;
  return pkg;
}
