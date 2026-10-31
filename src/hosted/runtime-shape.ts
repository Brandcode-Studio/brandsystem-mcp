/**
 * Hosted `brand_runtime` shaping — turns whatever UCS serves into a bounded,
 * agent-sized runtime and slices it.
 *
 * Why this exists: with the hosted MCP's service token, UCS's pull endpoint
 * returns `package.runtime = package.brandInstance` (UCS
 * `deriveRuntimeFromCompiled`). That object is the raw ~280k-char brand
 * instance (120 library assets, layout recipes, governance records) — not a
 * compiled runtime. Treating it as one made `full` too large for the response
 * cap (elided wholesale) and left `visual`/`voice`/`minimal` empty, because a
 * brand instance has no `identity`/`voice`/`strategy` keys.
 *
 * Rules enforced here:
 *   - A package value is only treated as a compiled runtime when it has the
 *     compiled shape (`identity` object). Brand-instance-shaped values are
 *     always normalized, wherever they appear.
 *   - Output is built from an allow-list of fields with string/array caps.
 *     Raw upstream sections (libraryAssets, brandGraph, brandKnowledgeCorpus,
 *     assetManifest, layout specs) are never passed through.
 *   - `full` is held under FULL_RUNTIME_MAX_CHARS by shrinking the strategy
 *     summaries, so it can never trip the response-overflow elision.
 *
 * Brand content here is Studio-governed (not caller-authored), so it is
 * length-capped but not fenced. Caller-authored Taste Guidance is fenced in
 * the tool (see tools/runtime.ts and taste-text.ts).
 */
import type { BrandPackagePayload } from "../connectors/brandcode/types.js";

export type RuntimeSlice = "full" | "visual" | "voice" | "minimal";

/**
 * Upper bound for the `full` runtime value, in characters (~4 chars/token).
 * Well below the 50k-char response cap so taste guidance and metadata fit.
 */
export const FULL_RUNTIME_MAX_CHARS = 30_000;


const VERBAL_IDENTITY_LIMIT = 1500;
const PERSPECTIVE_LIMIT = 900;
const LABEL_LIMIT = 120;
const GIST_LIMIT = 160;
const VALUE_LIMIT = 64;
const MAX_ROLE_ENTRIES = 24;
const MAX_LOGO_ASSETS = 8;
const MAX_LAYOUT_RECIPES = 6;
const MAX_LAYOUT_FAMILIES = 6;
const MAX_PHRASES = 20;

/** Strategy caps, tightened progressively if `full` exceeds its budget. */
const STRATEGY_CAPS = [
  { narratives: 20, application_rules: 15, proof_points: 15, stats: 10, strategy_moves: 10 },
  { narratives: 12, application_rules: 10, proof_points: 10, stats: 6, strategy_moves: 6 },
  { narratives: 6, application_rules: 5, proof_points: 5, stats: 3, strategy_moves: 3 },
  { narratives: 0, application_rules: 0, proof_points: 0, stats: 0, strategy_moves: 0 },
] as const;
type StrategyCaps = (typeof STRATEGY_CAPS)[number];

type Rec = Record<string, unknown>;

function isRecord(v: unknown): v is Rec {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function pickString(...candidates: unknown[]): string {
  for (const c of candidates) {
    if (typeof c === "string" && c.trim().length > 0) return c.trim();
  }
  return "";
}

/** Collapse whitespace and cap; null for non-strings/empty. */
function cap(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** Keep prose paragraphs but cap length. */
function capProse(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** First sentence (or capped prefix) of a description. */
function gist(value: unknown, max = GIST_LIMIT): string | null {
  const text = cap(value, 2000);
  if (!text) return null;
  const sentence = text.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? text;
  return cap(sentence, max);
}

function scalar(value: unknown): string | number | boolean | null {
  if (typeof value === "number" || typeof value === "boolean") return value;
  return cap(value, VALUE_LIMIT);
}

/** Role map (role → scalar), primitives only, capped. Null when empty. */
function roleMap(value: unknown): Record<string, string | number | boolean> | null {
  if (!isRecord(value)) return null;
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(value).slice(0, MAX_ROLE_ENTRIES)) {
    const s = scalar(v);
    if (s !== null) out[cap(k, 40) ?? k] = s;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function stringList(value: unknown, maxItems: number, maxLen = LABEL_LIMIT): string[] {
  return asArray(value)
    .map((v) => cap(v, maxLen))
    .filter((v): v is string => v !== null)
    .slice(0, maxItems);
}

function compact<T extends Rec>(obj: T): T {
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v === null || v === undefined) delete obj[k];
    else if (Array.isArray(v) && v.length === 0) delete obj[k];
  }
  return obj;
}

/**
 * Generic bound for pre-compiled runtimes we pass through: caps strings,
 * arrays, and depth so a large upstream value can never dominate a response.
 */
function bound(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return capProse(value, VERBAL_IDENTITY_LIMIT);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= 5) return null;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => bound(v, depth + 1));
  if (isRecord(value)) {
    const out: Rec = {};
    for (const [k, v] of Object.entries(value).slice(0, 40)) out[k] = bound(v, depth + 1);
    return out;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Shape detection
// ---------------------------------------------------------------------------

function isCompiledRuntime(v: unknown): v is Rec {
  return isRecord(v) && isRecord(v.identity);
}

function isBrandInstance(v: unknown): v is Rec {
  return (
    isRecord(v) &&
    !isRecord(v.identity) &&
    (isRecord(v.tokens) ||
      isRecord(v.fonts) ||
      Array.isArray(v.assets) ||
      typeof v.verbalIdentity === "string" ||
      Array.isArray(v.narratives))
  );
}

/**
 * Resolve a bounded runtime from a hosted package. Recognized shapes (first
 * match wins):
 *   1. `pkg.runtime` with a compiled shape (has `identity`)
 *   2. `pkg.brandInstance.runtime` with a compiled shape
 *   3. `pkg.brandInstance` — the flat governance instance UCS serves
 *   4. `pkg.runtime` that is itself a brand instance (UCS service-token path
 *      sets `runtime = brandInstance`)
 *   5. `pkg.identity` — the package is a compiled runtime
 */
export function extractHostedRuntime(pkg: BrandPackagePayload | null): Rec | null {
  if (!pkg || !isRecord(pkg)) return null;
  const record = pkg as Rec;
  const instance = isRecord(record.brandInstance) ? record.brandInstance : null;

  if (isCompiledRuntime(record.runtime)) return boundCompiledRuntime(record.runtime);
  if (instance && isCompiledRuntime(instance.runtime)) {
    return boundCompiledRuntime(instance.runtime);
  }
  if (instance && isBrandInstance(instance)) return normalizeBrandInstance(record, instance);
  if (isBrandInstance(record.runtime)) return normalizeBrandInstance(record, record.runtime);
  if (isCompiledRuntime(record)) return boundCompiledRuntime(record);
  return null;
}

/** Allow-listed, bounded copy of a pre-compiled runtime. */
function boundCompiledRuntime(runtime: Rec): Rec {
  return {
    version: pickString(runtime.version) || "hosted",
    client_name: pickString(runtime.client_name, runtime.brand_name) || "hosted brand",
    compiled_at: pickString(runtime.compiled_at) || null,
    sessions_completed:
      typeof runtime.sessions_completed === "number" ? runtime.sessions_completed : 0,
    identity: bound(runtime.identity),
    visual: bound(runtime.visual),
    voice: bound(runtime.voice),
    strategy: bound(runtime.strategy),
    source: "compiled_runtime",
  };
}

// ---------------------------------------------------------------------------
// Brand-instance normalization
// ---------------------------------------------------------------------------

function normalizeBrandInstance(pkg: Rec, instance: Rec): Rec {
  const tokens = isRecord(instance.tokens) ? instance.tokens : {};
  const fonts = isRecord(instance.fonts) ? instance.fonts : {};
  const manifest = isRecord(instance.manifest) ? instance.manifest : {};
  const compilation = isRecord(instance.compilationManifest)
    ? instance.compilationManifest
    : {};

  return {
    version: pickString(
      pkg.runtimeVersion,
      compilation.runtimeVersion,
      manifest.brandcodeVersion,
      manifest.version,
    ) || "hosted",
    client_name:
      pickString(manifest.name, tokens.brandName, pkg.slug) || "hosted brand",
    compiled_at: pickString(compilation.compiledAt) || new Date().toISOString(),
    sessions_completed: 0,
    identity: pickIdentity(tokens, fonts, asArray(instance.assets)),
    visual: pickVisual(instance, tokens),
    voice: pickVoice(instance),
    strategy_source: {
      narratives: asArray(instance.narratives),
      application_rules: asArray(instance.applicationRules),
      proof_points: asArray(instance.proofPoints),
      stats: asArray(instance.stats),
      strategy_moves: asArray(instance.strategyMoves),
    },
    omitted: {
      library_assets: asArray(instance.libraryAssets).length,
      layout_recipes: asArray(instance.layoutRecipes).length,
      verbal_identity_chars:
        typeof instance.verbalIdentity === "string" ? instance.verbalIdentity.length : 0,
    },
    source: "brand_instance",
  };
}

function pickIdentity(tokens: Rec, fonts: Rec, assets: unknown[]): Rec {
  const typography = pickTypography(fonts, tokens);
  const logos = pickLogoAssets(assets);
  return compact({
    colors: roleMap(tokens.colors) ?? {},
    surface: roleMap(tokens.surface),
    text: roleMap(tokens.text),
    action: roleMap(tokens.action),
    typography: typography.families,
    font_fallbacks: typography.fallbacks,
    font_weights: typography.weights,
    font_loading: cap(fonts.strategy, 40),
    logo: logos[0] ?? null,
    logo_assets: logos.map(({ asset_id, name, has_svg }) =>
      compact({ asset_id, name, has_svg } as Rec),
    ),
  });
}

function pickTypography(
  fonts: Rec,
  tokens: Rec,
): {
  families: Record<string, string>;
  fallbacks: Record<string, string[]> | null;
  weights: Record<string, number> | null;
} {
  const families: Record<string, string> = {};
  const fallbacks: Record<string, string[]> = {};
  const roles = isRecord(fonts.roles) ? fonts.roles : null;
  if (roles) {
    // Canonical order — display first so heading-ish roles lead.
    const order = ["display", "heading", "body", "mono"];
    const keys = [
      ...order.filter((r) => r in roles),
      ...Object.keys(roles).filter((r) => !order.includes(r)),
    ].slice(0, 8);
    for (const role of keys) {
      const spec = roles[role];
      const family = cap(isRecord(spec) ? spec.fontFamily : spec, VALUE_LIMIT);
      if (!family) continue;
      families[role] = family;
      const stack = stringList(isRecord(spec) ? spec.fallbackStack : null, 6, 40);
      if (stack.length > 0) fallbacks[role] = stack;
    }
  }
  const tokenTypo = isRecord(tokens.typography) ? tokens.typography : {};
  if (Object.keys(families).length === 0) {
    const family = cap(tokenTypo.fontFamily ?? fonts.fontFamily, VALUE_LIMIT);
    if (family) families.default = family;
    const stack = stringList(fonts.fallbackStack, 6, 40);
    if (family && stack.length > 0) fallbacks.default = stack;
  }
  const weights: Record<string, number> = {};
  if (typeof tokenTypo.displayWeight === "number") weights.display = tokenTypo.displayWeight;
  if (typeof tokenTypo.bodyWeight === "number") weights.body = tokenTypo.bodyWeight;
  return {
    families,
    fallbacks: Object.keys(fallbacks).length > 0 ? fallbacks : null,
    weights: Object.keys(weights).length > 0 ? weights : null,
  };
}

/**
 * Logo asset references: ids/names only (no URLs — delivery goes through
 * get_brand_asset, which never exposes raw private provider URLs).
 */
function pickLogoAssets(assets: unknown[]): Rec[] {
  const out: Rec[] = [];
  for (const asset of assets) {
    if (!isRecord(asset)) continue;
    const kind = pickString(asset.kind, asset.type, asset.role, asset.category);
    if (!/logo/i.test(kind)) continue;
    const format = pickString(asset.format, asset.contentType, asset.mimeType);
    const urlHint = pickString(asset.url, isRecord(asset.refs) ? asset.refs.runtimeUrl : null);
    out.push(
      compact({
        asset_id: cap(pickString(asset.id, asset.asset_id, asset.assetId), LABEL_LIMIT),
        name: cap(pickString(asset.name, asset.title, asset.label), LABEL_LIMIT),
        type: cap(kind, 40),
        has_svg: /svg/i.test(format) || /\.svg(?:$|[?#])/i.test(urlHint),
      }),
    );
    if (out.length >= MAX_LOGO_ASSETS) break;
  }
  return out;
}

/** Primitive-only copy of a small config object (one level of nesting). */
function primitives(value: unknown, maxKeys = 12): Rec | null {
  if (!isRecord(value)) return null;
  const out: Rec = {};
  for (const [k, v] of Object.entries(value).slice(0, maxKeys)) {
    const s = scalar(v);
    if (s !== null) out[k] = s;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function pickVisual(instance: Rec, tokens: Rec): Rec | null {
  const config = isRecord(instance.compositionConfig) ? instance.compositionConfig : {};
  const layout = isRecord(tokens.layout) ? tokens.layout : {};
  const recipes = asArray(instance.layoutRecipes)
    .filter(isRecord)
    .slice(0, MAX_LAYOUT_RECIPES)
    .map((r) =>
      compact({
        name: cap(pickString(r.name, r.sceneName, r.id), LABEL_LIMIT),
        family: cap(r.family, 60),
        surface: cap(r.surfaceLabel, 60),
        dimensions: primitives(r.dimensions, 2),
        intent: cap(pickString(r.description, isRecord(r.layoutSpec) ? r.layoutSpec.intent : null), 80),
      }),
    );
  const families = asArray(instance.adaptiveLayoutFamilies)
    .filter(isRecord)
    .slice(0, MAX_LAYOUT_FAMILIES)
    .map((f) => cap(pickString(f.name, f.id), LABEL_LIMIT))
    .filter((v): v is string => v !== null);

  const visual = compact({
    summary: cap(instance.compositionSummary, 300),
    radius: roleMap(layout.radius),
    frame: primitives(config.frame),
    type_treatment: primitives(config.dossier),
    logo_placement: primitives(config.logo),
    layout_modes: isRecord(config.layout) ? Object.keys(config.layout).slice(0, 12) : [],
    layout_policy: isRecord(instance.layoutPolicy) ? primitives(instance.layoutPolicy) : null,
    layout_recipes: recipes,
    adaptive_layout_families: families,
  } as Rec);
  return Object.keys(visual).length > 0 ? visual : null;
}

function pickVoice(instance: Rec): Rec | null {
  const verbalIdentity = capProse(instance.verbalIdentity, VERBAL_IDENTITY_LIMIT);
  const perspective = capProse(instance.perspective, PERSPECTIVE_LIMIT);
  const phrasesRaw = asArray(instance.brandPhrases);
  const brandPhrases = phrasesRaw
    .filter(isRecord)
    .filter((p) => typeof p.phrase === "string" && p.phrase.trim().length > 0)
    .slice(0, MAX_PHRASES)
    .map((p) =>
      compact({
        phrase: cap(p.phrase, 200),
        usage: cap(p.usage, 200),
        deploy_verbatim: p.deploy_verbatim === true,
      }),
    );

  if (!verbalIdentity && !perspective && brandPhrases.length === 0) return null;
  const rawLength =
    typeof instance.verbalIdentity === "string" ? instance.verbalIdentity.trim().length : 0;
  return {
    verbal_identity: verbalIdentity,
    verbal_identity_truncated: rawLength > VERBAL_IDENTITY_LIMIT,
    perspective,
    brand_phrases: brandPhrases,
    brand_phrase_total: phrasesRaw.length,
  };
}

function summarizeStrategy(source: Rec, caps: StrategyCaps): Rec | null {
  const narratives = asArray(source.narratives).filter(isRecord);
  const rules = asArray(source.application_rules).filter(isRecord);
  const proof = asArray(source.proof_points).filter(isRecord);
  const stats = asArray(source.stats).filter(isRecord);
  const moves = asArray(source.strategy_moves).filter(isRecord);
  if (
    narratives.length + rules.length + proof.length + stats.length + moves.length ===
    0
  ) {
    return null;
  }
  return {
    narratives: narratives.slice(0, caps.narratives).map((n) =>
      compact({
        id: cap(n.id, 60),
        name: cap(n.name, LABEL_LIMIT),
        type: cap(n.type, 60),
        status: cap(n.status, 40),
        gist: gist(n.description),
      }),
    ),
    application_rules: rules.slice(0, caps.application_rules).map((r) =>
      compact({
        id: cap(r.id, 60),
        content_type: cap(r.content_type, LABEL_LIMIT),
        touchpoint: cap(r.touchpoint, 60),
        framework: cap(r.framework, LABEL_LIMIT),
        journey_stage: cap(r.journey_stage, 60),
        tone: gist(r.tone, LABEL_LIMIT),
      }),
    ),
    proof_points: proof.slice(0, caps.proof_points).map((p) =>
      compact({
        id: cap(p.id, 60),
        claim: cap(p.claim, GIST_LIMIT),
        tier: cap(p.tier, 40),
        status: cap(p.status, 40),
      }),
    ),
    stats: stats.slice(0, caps.stats).map((s) =>
      compact({
        stat: cap(s.stat, 40),
        explainer: cap(s.explainer, GIST_LIMIT),
        tier: cap(s.tier, 40),
      }),
    ),
    strategy_moves: moves.slice(0, caps.strategy_moves).map((m) =>
      compact({
        move: typeof m.move === "number" ? m.move : cap(m.move, 40),
        name: cap(m.name, LABEL_LIMIT),
        status: cap(m.status, 40),
        timeline: cap(m.timeline, 60),
      }),
    ),
    counts: {
      narratives: narratives.length,
      application_rules: rules.length,
      proof_points: proof.length,
      stats: stats.length,
      strategy_moves: moves.length,
    },
  };
}

// ---------------------------------------------------------------------------
// Slicing
// ---------------------------------------------------------------------------

/** Where an agent goes for everything this runtime summarizes or omits. */
function moreSection(runtime: Rec, slice: RuntimeSlice): Rec {
  const omitted = isRecord(runtime.omitted) ? runtime.omitted : {};
  if (slice !== "full") {
    // Compact pointers keep the small slices inside their budgets.
    return {
      full_context: "brand_runtime slice='full'",
      ...(slice === "voice"
        ? {
            doctrine: "brand_search mode='doctrine_retrieval' (full verbal identity, narratives)",
            evidence: "brand_search mode='evidence_retrieval' (proof points, stats)",
          }
        : {
            assets: "list_brand_assets category='logo', then get_brand_asset asset_id",
            check: "brand_check (color, font, or draft)",
          }),
    };
  }
  const retrieve: Rec[] = [
    {
      need: "Full narrative text, key messages, application-rule guidance",
      tool: "brand_search",
      args: { query: "<narrative or content type>", mode: "doctrine_retrieval" },
    },
    {
      need: "Proof points and stats with citations",
      tool: "brand_search",
      args: { query: "<claim topic>", mode: "evidence_retrieval" },
    },
    {
      need: "Logo files and library assets (safe delivery refs)",
      tool: "list_brand_assets",
      args: { category: "logo" },
      then: "get_brand_asset with an asset_id",
    },
    {
      need: "Check a draft, color, or font against the brand",
      tool: "brand_check",
    },
  ];
  return compact({
    retrieve,
    omitted: compact({
      library_assets:
        typeof omitted.library_assets === "number" && omitted.library_assets > 0
          ? omitted.library_assets
          : null,
      verbal_identity_full_chars:
        typeof omitted.verbal_identity_chars === "number" &&
        omitted.verbal_identity_chars > VERBAL_IDENTITY_LIMIT
          ? omitted.verbal_identity_chars
          : null,
    } as Rec),
  } as Rec);
}

function minimalIdentity(identity: Rec | null): Rec | null {
  if (!identity) return null;
  const colors = isRecord(identity.colors) ? identity.colors : {};
  const pick = (map: unknown, key: string) => (isRecord(map) ? map[key] : undefined);
  const roleColors = compact({
    primary: colors.primary,
    secondary: colors.secondary,
    accent: colors.accent,
    surface: pick(identity.surface, "default") ?? colors.surface,
    text: pick(identity.text, "primary") ?? colors.text,
    action: pick(identity.action, "primary") ?? colors.action,
  } as Rec);

  const typography = isRecord(identity.typography) ? identity.typography : {};
  const headingRole = ["display", "heading"].find((r) => typeof typography[r] === "string");
  const bodyRole = ["body", "default"].find((r) => typeof typography[r] === "string");
  const fonts: Rec = {};
  if (headingRole) fonts[headingRole] = typography[headingRole];
  if (bodyRole) fonts[bodyRole] = typography[bodyRole];
  if (Object.keys(fonts).length === 0) {
    const first = Object.entries(typography)[0];
    if (first) fonts[first[0]] = first[1];
  }

  return {
    colors: roleColors,
    typography: fonts,
    logo: identity.logo ?? null,
  };
}

/**
 * Slice a runtime from extractHostedRuntime. Never returns raw upstream
 * sections; `full` is held under FULL_RUNTIME_MAX_CHARS.
 */
export function sliceHostedRuntime(runtime: Rec, slice: RuntimeSlice): Rec {
  const base = {
    version: runtime.version,
    client_name: runtime.client_name,
    compiled_at: runtime.compiled_at,
    slice_type: slice,
  };
  const identity = isRecord(runtime.identity) ? runtime.identity : null;

  if (slice === "minimal") {
    return { ...base, identity: minimalIdentity(identity) };
  }

  if (slice === "visual") {
    return { ...base, identity, visual: runtime.visual ?? null, more: moreSection(runtime, slice) };
  }

  const strategySource = isRecord(runtime.strategy_source) ? runtime.strategy_source : null;

  if (slice === "voice") {
    const counts = strategySource
      ? summarizeStrategy(strategySource, STRATEGY_CAPS[STRATEGY_CAPS.length - 1])?.counts
      : isRecord(runtime.strategy) && isRecord(runtime.strategy.counts)
        ? runtime.strategy.counts
        : null;
    return {
      ...base,
      voice: runtime.voice ?? null,
      strategy_counts: counts ?? null,
      more: moreSection(runtime, slice),
    };
  }

  // full
  const build = (caps: StrategyCaps) => ({
    ...base,
    sessions_completed: runtime.sessions_completed,
    identity,
    visual: runtime.visual ?? null,
    voice: runtime.voice ?? null,
    strategy: strategySource ? summarizeStrategy(strategySource, caps) : (runtime.strategy ?? null),
    more: moreSection(runtime, slice),
  });
  let out: Rec = build(STRATEGY_CAPS[0]);
  for (const caps of STRATEGY_CAPS.slice(1)) {
    if (JSON.stringify(out).length <= FULL_RUNTIME_MAX_CHARS) break;
    out = build(caps);
  }
  if (JSON.stringify(out).length > FULL_RUNTIME_MAX_CHARS) {
    // Last resort: drop the layout recipe list (largest visual section).
    const visual = isRecord(out.visual) ? { ...out.visual } : null;
    if (visual) delete visual.layout_recipes;
    out = { ...out, visual };
  }
  // Pre-compiled runtimes are only generically bounded; if one is still too
  // large, summarize its biggest section rather than let the response cap
  // elide the whole runtime.
  for (const key of ["strategy", "visual", "voice", "identity"]) {
    if (JSON.stringify(out).length <= FULL_RUNTIME_MAX_CHARS) break;
    const original = JSON.stringify(out[key] ?? null).length;
    out = {
      ...out,
      [key]: {
        trimmed: true,
        original_chars: original,
        retrieve_with:
          key === "voice" ? "brand_runtime slice='voice'" : key === "strategy" ? "brand_search" : "brand_runtime slice='visual'",
      },
    };
  }
  return out;
}
