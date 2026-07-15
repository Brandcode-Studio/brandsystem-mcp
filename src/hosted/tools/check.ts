/**
 * Hosted `brand_check` tool.
 *
 * Read-only governance checks against the live UCS Brand package. This keeps
 * the hosted Use MCP local to package knowledge: no canonical governance
 * mutation, feedback append, telemetry, history, or selected-kit artifact paths.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { buildResponse, safeParseParams } from "../../lib/response.js";
import type { BrandPackagePayload } from "../../connectors/brandcode/types.js";
import type { TasteGuidanceProjection } from "../../connectors/brandcode/taste-guidance.js";
import { enforceToolScope } from "../scope.js";
import type { HostedBrandContext } from "../types.js";

const paramsShape = {
  text: z
    .string()
    .optional()
    .describe("Copy to check for voice and claim governance."),
  color: z
    .string()
    .optional()
    .describe("Hex color to check against hosted brand colors."),
  font: z
    .string()
    .optional()
    .describe("Font family to check against hosted typography."),
  css: z
    .string()
    .optional()
    .describe(
      "CSS snippet to check for color/font usage and governed styling anti-patterns.",
    ),
  artifact_kind: z
    .string()
    .min(1)
    .max(120)
    .optional()
    .describe(
      "Optional artifact class used to select relevant approved Taste Guidance, such as social-layout or illustration.",
    ),
  surface: z
    .string()
    .min(1)
    .max(80)
    .optional()
    .describe(
      "Optional creation surface used to select relevant approved Taste Guidance, such as social, chef, or web.",
    ),
};

const ParamsSchema = z.object(paramsShape);
type Params = z.infer<typeof ParamsSchema>;

type Verdict = "pass" | "review" | "fail";
type FindingLevel = "info" | "warning" | "error";

interface Finding {
  code: string;
  level: FindingLevel;
  message: string;
  matched?: string;
  source?: string;
  status?: string;
}

interface FieldCheck {
  status: Verdict;
  message: string;
  sources: string[];
  input?: string;
  matched?: Array<Record<string, unknown>>;
  detected?: Record<string, unknown>;
}

interface SourceTerm {
  value: string;
  matchValue: string;
  source: string;
  label: string;
  status?: string;
  kind: string;
}

interface GovernanceModel {
  colors: SourceTerm[];
  fonts: SourceTerm[];
  brandPhrases: SourceTerm[];
  proofPoints: SourceTerm[];
  applicationRules: SourceTerm[];
  forbidden: SourceTerm[];
  sources: string[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function asArray(value: unknown, nestedKey?: string): unknown[] {
  if (Array.isArray(value)) return value;
  if (nestedKey && isRecord(value) && Array.isArray(value[nestedKey])) {
    return value[nestedKey] as unknown[];
  }
  return [];
}

function pickString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return stripUrls(value.trim());
    }
  }
  return "";
}

function joinText(...values: unknown[]): string {
  return values
    .flatMap((value) => {
      if (typeof value === "string") return [value];
      if (Array.isArray(value)) {
        return value.filter((item): item is string => typeof item === "string");
      }
      return [];
    })
    .map((value) => stripUrls(value).trim())
    .filter(Boolean)
    .join(" ");
}

function stripUrls(value: string): string {
  return value.replace(/https?:\/\/\S+/gi, "[redacted-url]");
}

function compact(value: string): string {
  return stripUrls(value).replace(/\s+/g, " ").trim();
}

function normalizeText(value: string): string {
  return compact(value).toLowerCase();
}

function containsTerm(input: string, term: string): boolean {
  const normalizedInput = normalizeText(input);
  const normalizedTerm = normalizeText(term);
  return normalizedTerm.length > 0 && normalizedInput.includes(normalizedTerm);
}

function normalizeHex(value: string): string | null {
  const trimmed = value.trim().toLowerCase();
  const match = trimmed.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return null;
  const hex = match[1];
  if (hex.length === 3) {
    return `#${hex
      .split("")
      .map((char) => `${char}${char}`)
      .join("")}`;
  }
  return `#${hex}`;
}

function normalizeFont(value: string): string {
  return value.split(",")[0].replace(/["']/g, "").trim().toLowerCase();
}

function statusOf(item: Record<string, unknown>): string | undefined {
  return pickString(item.status, item.lifecycle, item.state) || undefined;
}

function sourceTerm(
  value: string,
  source: string,
  kind: string,
  extras: {
    label?: string;
    status?: string;
    matchValue?: string;
  } = {},
): SourceTerm | null {
  const safeValue = compact(value);
  const matchValue = compact(extras.matchValue ?? value);
  if (!safeValue || !matchValue) return null;
  return {
    value: safeValue,
    matchValue,
    source,
    label: extras.label ? compact(extras.label) : safeValue,
    status: extras.status,
    kind,
  };
}

function addSource(sources: Set<string>, source: string) {
  sources.add(source);
}

function collectColorTerms(
  value: unknown,
  source: string,
  out: SourceTerm[],
  sources: Set<string>,
) {
  if (!isRecord(value)) return;
  addSource(sources, source);
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === "string") {
      const hex = normalizeHex(raw);
      if (hex) {
        const term = sourceTerm(hex, source, "color", {
          label: `${key}: ${hex}`,
          matchValue: hex,
        });
        if (term) out.push(term);
      }
    } else if (isRecord(raw)) {
      collectColorTerms(raw, `${source}.${key}`, out, sources);
    }
  }
}

function collectFontTerms(
  value: unknown,
  source: string,
  out: SourceTerm[],
  sources: Set<string>,
) {
  if (!isRecord(value)) return;
  addSource(sources, source);
  for (const [key, raw] of Object.entries(value)) {
    if (/^(strategy|status|source|source_label|notes?)$/i.test(key)) continue;
    if (typeof raw === "string") {
      const family = normalizeFont(raw);
      if (family) {
        const term = sourceTerm(raw, source, "font", {
          label: `${key}: ${stripUrls(raw)}`,
          matchValue: family,
        });
        if (term) out.push(term);
      }
    } else if (Array.isArray(raw)) {
      for (const item of raw) {
        if (typeof item !== "string") continue;
        const family = normalizeFont(item);
        const term = sourceTerm(item, source, "font", {
          label: `${key}: ${stripUrls(item)}`,
          matchValue: family,
        });
        if (term) out.push(term);
      }
    } else if (isRecord(raw)) {
      const family = pickString(raw.fontFamily, raw.family, raw.name);
      if (family) {
        const term = sourceTerm(family, `${source}.${key}`, "font", {
          label: `${key}: ${family}`,
          matchValue: normalizeFont(family),
        });
        if (term) out.push(term);
      }
      collectFontTerms(raw, `${source}.${key}`, out, sources);
    }
  }
}

function collectStructuredText(
  value: unknown,
  nestedKey: string,
  source: string,
  kind: string,
  out: SourceTerm[],
  sources: Set<string>,
) {
  const items = asArray(value, nestedKey);
  if (items.length === 0) return;
  addSource(sources, source);
  for (const item of items) {
    if (typeof item === "string") {
      const term = sourceTerm(item, source, kind);
      if (term) out.push(term);
      continue;
    }
    if (!isRecord(item)) continue;
    const text =
      kind === "application_rule"
        ? joinText(
            item.rule,
            item.description,
            item.required_elements,
            item.requiredElements,
            item.text,
          )
        : joinText(
            item.phrase,
            item.claim,
            item.rule,
            item.title,
            item.name,
            item.canonical_text,
            item.canonicalText,
            item.text,
            item.description,
            item.summary,
            item.required_elements,
            item.requiredElements,
          );
    const label = pickString(
      item.id,
      item.key,
      item.title,
      item.name,
      item.phrase,
      item.claim,
    );
    const term = sourceTerm(text, source, kind, {
      label: label || text,
      status: statusOf(item),
    });
    if (term) out.push(term);
  }
}

function prohibitionMatchValue(value: string): string {
  const cleaned = compact(value);
  const prohibition = cleaned.match(
    /\b(?:never|avoid|do not|don't|dont|must not)\s+(.+)/i,
  );
  if (prohibition?.[1]) return prohibition[1].trim();
  return cleaned.replace(/^(forbidden|blocked|unsupported)\s+/i, "").trim();
}

function extractForbiddenTerms(
  value: unknown,
  source: string,
  kind: string,
  out: SourceTerm[],
  sources: Set<string>,
) {
  if (typeof value === "string") {
    const matchValue = prohibitionMatchValue(value);
    const term = sourceTerm(value, source, kind, { matchValue });
    if (term) {
      out.push(term);
      addSource(sources, source);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      extractForbiddenTerms(item, source, kind, out, sources);
    }
    return;
  }
  if (!isRecord(value)) return;

  const text = joinText(
    value.phrase,
    value.term,
    value.value,
    value.name,
    value.title,
    value.rule,
    value.description,
  );
  if (text) {
    const matchValue = prohibitionMatchValue(text);
    const label = pickString(
      value.id,
      value.key,
      value.name,
      value.title,
      text,
    );
    const term = sourceTerm(text, source, kind, {
      label: label || text,
      matchValue,
      status: statusOf(value),
    });
    if (term) {
      out.push(term);
      addSource(sources, source);
    }
  }
}

function scanForbiddenFields(
  value: unknown,
  source: string,
  out: SourceTerm[],
  sources: Set<string>,
  depth = 0,
) {
  if (!isRecord(value) || depth > 4) return;
  for (const [key, raw] of Object.entries(value)) {
    const nextSource = `${source}.${key}`;
    if (
      /(never|forbidden|blocked|anti.?pattern|do.?not|dont|disallow|unsupported)/i.test(
        key,
      )
    ) {
      extractForbiddenTerms(raw, nextSource, "forbidden", out, sources);
    }
    if (isRecord(raw))
      scanForbiddenFields(raw, nextSource, out, sources, depth + 1);
  }
}

function collectGovernance(pkg: BrandPackagePayload | null): GovernanceModel {
  const sources = new Set<string>();
  const colors: SourceTerm[] = [];
  const fonts: SourceTerm[] = [];
  const brandPhrases: SourceTerm[] = [];
  const proofPoints: SourceTerm[] = [];
  const applicationRules: SourceTerm[] = [];
  const forbidden: SourceTerm[] = [];

  if (!pkg || typeof pkg !== "object") {
    return {
      colors,
      fonts,
      brandPhrases,
      proofPoints,
      applicationRules,
      forbidden,
      sources: [],
    };
  }

  const record = pkg as Record<string, unknown>;
  const instance = isRecord(record.brandInstance) ? record.brandInstance : {};
  const runtime = isRecord(record.runtime) ? record.runtime : {};
  const instanceRuntime = isRecord(instance.runtime) ? instance.runtime : {};
  const identity = isRecord(runtime.identity) ? runtime.identity : {};
  const instanceRuntimeIdentity = isRecord(instanceRuntime.identity)
    ? instanceRuntime.identity
    : {};

  collectColorTerms(
    isRecord(instance.tokens) ? instance.tokens.colors : undefined,
    "brandInstance.tokens.colors",
    colors,
    sources,
  );
  collectColorTerms(
    isRecord(instance.tokens) ? instance.tokens.action : undefined,
    "brandInstance.tokens.action",
    colors,
    sources,
  );
  collectColorTerms(
    identity.colors,
    "runtime.identity.colors",
    colors,
    sources,
  );
  collectColorTerms(
    instanceRuntimeIdentity.colors,
    "brandInstance.runtime.identity.colors",
    colors,
    sources,
  );

  collectFontTerms(instance.fonts, "brandInstance.fonts", fonts, sources);
  collectFontTerms(
    isRecord(instance.tokens) ? instance.tokens.typography : undefined,
    "brandInstance.tokens.typography",
    fonts,
    sources,
  );
  collectFontTerms(
    identity.typography,
    "runtime.identity.typography",
    fonts,
    sources,
  );
  collectFontTerms(
    instanceRuntimeIdentity.typography,
    "brandInstance.runtime.identity.typography",
    fonts,
    sources,
  );

  collectStructuredText(
    instance.brandPhrases,
    "entries",
    "brandInstance.brandPhrases",
    "brand_phrase",
    brandPhrases,
    sources,
  );
  collectStructuredText(
    instance.proofPoints,
    "claims",
    "brandInstance.proofPoints",
    "proof_point",
    proofPoints,
    sources,
  );
  collectStructuredText(
    instance.applicationRules,
    "rules",
    "brandInstance.applicationRules",
    "application_rule",
    applicationRules,
    sources,
  );

  const capabilities = isRecord(instance.capabilities)
    ? instance.capabilities
    : {};
  for (const key of ["blocked", "disabled", "unsupported", "disallowed"]) {
    extractForbiddenTerms(
      capabilities[key],
      `brandInstance.capabilities.${key}`,
      "blocked_capability",
      forbidden,
      sources,
    );
  }

  for (const term of applicationRules) {
    if (
      /(never|avoid|do not|don't|dont|must not|forbidden|blocked|unsupported)/i.test(
        term.value,
      )
    ) {
      const forbiddenTerm = sourceTerm(
        term.value,
        term.source,
        "application_rule",
        {
          label: term.label,
          status: term.status,
          matchValue: prohibitionMatchValue(term.value),
        },
      );
      if (forbiddenTerm) forbidden.push(forbiddenTerm);
    }
  }

  scanForbiddenFields(
    instance.voice,
    "brandInstance.voice",
    forbidden,
    sources,
  );
  scanForbiddenFields(
    instance.verbalIdentity,
    "brandInstance.verbalIdentity",
    forbidden,
    sources,
  );
  scanForbiddenFields(
    record.interactionPolicy,
    "interactionPolicy",
    forbidden,
    sources,
  );
  scanForbiddenFields(runtime.voice, "runtime.voice", forbidden, sources);
  scanForbiddenFields(runtime.policy, "runtime.policy", forbidden, sources);

  return {
    colors: dedupeTerms(colors),
    fonts: dedupeTerms(fonts),
    brandPhrases: dedupeTerms(brandPhrases),
    proofPoints: dedupeTerms(proofPoints),
    applicationRules: dedupeTerms(applicationRules),
    forbidden: dedupeTerms(forbidden),
    sources: Array.from(sources).sort(),
  };
}

function dedupeTerms(terms: SourceTerm[]): SourceTerm[] {
  const seen = new Set<string>();
  const out: SourceTerm[] = [];
  for (const term of terms) {
    const key = `${term.kind}:${term.source}:${normalizeText(term.matchValue)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(term);
  }
  return out;
}

function addFinding(findings: Finding[], finding: Finding) {
  findings.push({
    ...finding,
    message: stripUrls(finding.message),
    matched: finding.matched ? stripUrls(finding.matched) : undefined,
    source: finding.source ? stripUrls(finding.source) : undefined,
  });
}

function statusFromFindings(findings: Finding[], fallback: Verdict): Verdict {
  if (findings.some((finding) => finding.level === "error")) return "fail";
  if (findings.some((finding) => finding.level === "warning")) return "review";
  if (findings.some((finding) => finding.level === "info")) return fallback;
  return fallback;
}

function checkText(
  input: string,
  governance: GovernanceModel,
): {
  check: FieldCheck;
  findings: Finding[];
} {
  const findings: Finding[] = [];
  const sources = [
    "brandInstance.brandPhrases",
    "brandInstance.proofPoints",
    "brandInstance.applicationRules",
    "brandInstance.capabilities",
    "voice governance",
  ];
  const matched: Array<Record<string, unknown>> = [];
  const hasTextGovernance =
    governance.brandPhrases.length > 0 ||
    governance.proofPoints.length > 0 ||
    governance.applicationRules.length > 0 ||
    governance.forbidden.length > 0;

  if (!hasTextGovernance) {
    addFinding(findings, {
      code: "text_governance_unavailable",
      level: "info",
      message:
        "Hosted package does not report enough text governance to strongly evaluate this copy",
    });
    return {
      check: {
        status: "review",
        input: compact(input),
        message:
          "Text needs review because hosted text governance is incomplete",
        sources,
      },
      findings,
    };
  }

  for (const term of governance.forbidden) {
    if (!containsTerm(input, term.matchValue)) continue;
    matched.push({
      kind: term.kind,
      label: term.label,
      source: term.source,
      status: term.status,
    });
    addFinding(findings, {
      code:
        term.kind === "blocked_capability"
          ? "blocked_capability_used"
          : "forbidden_language_used",
      level: "error",
      message: `Text uses blocked or forbidden hosted governance: ${term.label}`,
      matched: term.matchValue,
      source: term.source,
      status: term.status,
    });
  }

  for (const term of governance.proofPoints) {
    if (!containsTerm(input, term.matchValue)) continue;
    const status = term.status ?? "unknown";
    const isWatch = /watch|draft|experimental|candidate/i.test(status);
    matched.push({
      kind: "proof_point",
      label: term.label,
      source: term.source,
      status,
    });
    addFinding(findings, {
      code: isWatch ? "watch_proof_point_used" : "active_proof_point_used",
      level: isWatch ? "warning" : "info",
      message: isWatch
        ? `Text references a Watch proof point that needs review: ${term.label}`
        : `Text references an Active proof point: ${term.label}`,
      matched: term.matchValue,
      source: term.source,
      status,
    });
  }

  for (const term of governance.brandPhrases) {
    if (!containsTerm(input, term.matchValue)) continue;
    matched.push({
      kind: "brand_phrase",
      label: term.label,
      source: term.source,
      status: term.status,
    });
    addFinding(findings, {
      code: "brand_phrase_used",
      level: "info",
      message: `Text uses a hosted brand phrase: ${term.label}`,
      matched: term.matchValue,
      source: term.source,
      status: term.status,
    });
  }

  for (const term of governance.applicationRules) {
    if (!containsTerm(input, term.matchValue)) continue;
    matched.push({
      kind: "application_rule",
      label: term.label,
      source: term.source,
      status: term.status,
    });
    addFinding(findings, {
      code: "application_rule_referenced",
      level: "info",
      message: `Text references an application rule: ${term.label}`,
      matched: term.matchValue,
      source: term.source,
      status: term.status,
    });
  }

  const status = statusFromFindings(findings, "pass");
  return {
    check: {
      status,
      input: compact(input),
      matched,
      message:
        status === "fail"
          ? "Text conflicts with hosted governance"
          : status === "review"
            ? "Text needs review against hosted governance"
            : "Text passed the hosted governance signals available in the package",
      sources,
    },
    findings,
  };
}

function checkColorValue(
  input: string,
  governance: GovernanceModel,
): {
  status: Verdict;
  matched?: SourceTerm;
  finding?: Finding;
  normalized?: string;
} {
  const normalized = normalizeHex(input);
  if (!normalized) {
    return {
      status: "review",
      finding: {
        code: "unsupported_color_format",
        level: "warning",
        message: `Color "${stripUrls(input)}" is not a hex value that hosted brand_check can evaluate yet`,
      },
    };
  }
  if (governance.colors.length === 0) {
    return {
      status: "review",
      normalized,
      finding: {
        code: "color_governance_unavailable",
        level: "info",
        message:
          "Hosted package does not report brand colors, so this color cannot be strongly evaluated",
      },
    };
  }
  const matched = governance.colors.find(
    (term) => term.matchValue === normalized,
  );
  if (matched) {
    return { status: "pass", matched, normalized };
  }
  return {
    status: "review",
    normalized,
    finding: {
      code: "color_not_in_hosted_palette",
      level: "warning",
      message: `Color ${normalized} is not reported in the hosted brand palette`,
      matched: normalized,
      source: "hosted color tokens",
    },
  };
}

function checkColor(
  input: string,
  governance: GovernanceModel,
): {
  check: FieldCheck;
  findings: Finding[];
} {
  const result = checkColorValue(input, governance);
  const findings: Finding[] = [];
  if (result.finding) addFinding(findings, result.finding);
  return {
    check: {
      status: result.status,
      input: stripUrls(input),
      matched: result.matched
        ? [
            {
              label: result.matched.label,
              source: result.matched.source,
              value: result.matched.value,
            },
          ]
        : [],
      message:
        result.status === "pass"
          ? "Color is present in hosted brand colors"
          : "Color needs review against hosted brand colors",
      sources: ["brandInstance.tokens.colors", "runtime.identity.colors"],
    },
    findings,
  };
}

function checkFontValue(
  input: string,
  governance: GovernanceModel,
): {
  status: Verdict;
  matched?: SourceTerm;
  finding?: Finding;
  normalized?: string;
} {
  const normalized = normalizeFont(input);
  if (!normalized) {
    return {
      status: "review",
      finding: {
        code: "unsupported_font_format",
        level: "warning",
        message:
          "Font input is empty or not a family name hosted brand_check can evaluate",
      },
    };
  }
  if (governance.fonts.length === 0) {
    return {
      status: "review",
      normalized,
      finding: {
        code: "font_governance_unavailable",
        level: "info",
        message:
          "Hosted package does not report brand fonts, so this font cannot be strongly evaluated",
      },
    };
  }
  const matched = governance.fonts.find((term) => {
    const known = normalizeFont(term.matchValue);
    return (
      normalized === known ||
      normalized.includes(known) ||
      known.includes(normalized)
    );
  });
  if (matched) return { status: "pass", matched, normalized };
  return {
    status: "review",
    normalized,
    finding: {
      code: "font_not_in_hosted_typography",
      level: "warning",
      message: `Font "${stripUrls(input)}" is not reported in hosted brand typography`,
      matched: stripUrls(input),
      source: "hosted typography",
    },
  };
}

function checkFont(
  input: string,
  governance: GovernanceModel,
): {
  check: FieldCheck;
  findings: Finding[];
} {
  const result = checkFontValue(input, governance);
  const findings: Finding[] = [];
  if (result.finding) addFinding(findings, result.finding);
  return {
    check: {
      status: result.status,
      input: stripUrls(input),
      matched: result.matched
        ? [
            {
              label: result.matched.label,
              source: result.matched.source,
              value: result.matched.value,
            },
          ]
        : [],
      message:
        result.status === "pass"
          ? "Font is present in hosted brand typography"
          : "Font needs review against hosted brand typography",
      sources: [
        "brandInstance.fonts.roles",
        "brandInstance.tokens.typography",
        "runtime.identity.typography",
      ],
    },
    findings,
  };
}

function cssColors(input: string): string[] {
  return Array.from(new Set(input.match(/#[0-9a-f]{3,6}\b/gi) ?? []));
}

function cssFonts(input: string): string[] {
  const fonts: string[] = [];
  const re = /font-family\s*:\s*([^;}{]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(input))) {
    fonts.push(match[1].trim());
  }
  return Array.from(new Set(fonts));
}

function cssAntiPatternFindings(
  input: string,
  governance: GovernanceModel,
): Finding[] {
  const findings: Finding[] = [];
  const text = input.toLowerCase();
  const governedTerms = governance.forbidden
    .filter((term) =>
      /shadow|gradient|blur|opacity|radius/.test(term.value.toLowerCase()),
    )
    .map((term) => term.value.toLowerCase());
  if (governedTerms.length === 0) return findings;

  const patterns = [
    { css: /box-shadow|text-shadow/, label: "shadow" },
    {
      css: /linear-gradient|radial-gradient|conic-gradient/,
      label: "gradient",
    },
    { css: /filter\s*:\s*blur|backdrop-filter\s*:\s*blur/, label: "blur" },
    { css: /opacity\s*:\s*(0?\.\d+|0)/, label: "opacity" },
    { css: /border-radius/, label: "radius" },
  ];
  for (const pattern of patterns) {
    if (!pattern.css.test(text)) continue;
    const source = governance.forbidden.find((term) =>
      term.value.toLowerCase().includes(pattern.label),
    );
    addFinding(findings, {
      code: "unsupported_css_style",
      level: "error",
      message: `CSS uses ${pattern.label}, which hosted governance marks as unsupported`,
      matched: pattern.label,
      source: source?.source,
      status: source?.status,
    });
  }
  return findings;
}

function checkCss(
  input: string,
  governance: GovernanceModel,
): {
  check: FieldCheck;
  findings: Finding[];
} {
  const colors = cssColors(input);
  const fonts = cssFonts(input);
  const findings: Finding[] = [];
  const matched: Array<Record<string, unknown>> = [];

  for (const color of colors) {
    const result = checkColorValue(color, governance);
    if (result.finding)
      addFinding(findings, {
        ...result.finding,
        code: `css_${result.finding.code}`,
      });
    if (result.matched) {
      matched.push({
        kind: "color",
        label: result.matched.label,
        source: result.matched.source,
        value: result.matched.value,
      });
    }
  }
  for (const font of fonts) {
    const result = checkFontValue(font, governance);
    if (result.finding)
      addFinding(findings, {
        ...result.finding,
        code: `css_${result.finding.code}`,
      });
    if (result.matched) {
      matched.push({
        kind: "font",
        label: result.matched.label,
        source: result.matched.source,
        value: result.matched.value,
      });
    }
  }
  findings.push(...cssAntiPatternFindings(input, governance));

  if (colors.length === 0 && fonts.length === 0 && findings.length === 0) {
    addFinding(findings, {
      code: "css_no_governed_signals_detected",
      level: "info",
      message:
        "CSS did not include detectable hex colors, font-family declarations, or governed styling anti-patterns",
    });
  }

  const status = statusFromFindings(
    findings,
    matched.length > 0 ? "pass" : "review",
  );
  return {
    check: {
      status,
      input: stripUrls(input),
      matched,
      detected: {
        colors: colors.map((color) => normalizeHex(color) ?? color),
        fonts: fonts.map(stripUrls),
      },
      message:
        status === "fail"
          ? "CSS conflicts with hosted governance"
          : status === "review"
            ? "CSS needs review against hosted governance"
            : "CSS uses hosted brand color/font signals available in the package",
      sources: [
        "brandInstance.tokens.colors",
        "brandInstance.fonts.roles",
        "brandInstance.tokens.typography",
        "runtime.identity",
        "voice/application governance",
      ],
    },
    findings,
  };
}

function aggregateVerdict(checks: Record<string, FieldCheck>): Verdict {
  const statuses = Object.values(checks).map((check) => check.status);
  if (statuses.includes("fail")) return "fail";
  if (statuses.includes("review")) return "review";
  return "pass";
}

function recommendationsFor(verdict: Verdict, findings: Finding[]): string[] {
  if (findings.length === 0 && verdict === "pass") {
    return [
      "Proceed using the cited hosted package sources as the governance basis",
    ];
  }
  const recommendations = new Set<string>();
  for (const finding of findings) {
    if (finding.level === "error") {
      recommendations.add(
        "Remove or rewrite failing copy/styles before production use",
      );
    } else if (finding.level === "warning") {
      recommendations.add(
        "Treat warning findings as review gates before publishing",
      );
    } else if (/unavailable|no_governed/.test(finding.code)) {
      recommendations.add(
        "Call brand_runtime or brand_status to inspect available hosted governance before relying on this check",
      );
    }
  }
  if (recommendations.size === 0) {
    recommendations.add(
      "Use matched sources as provenance when applying this guidance",
    );
  }
  return Array.from(recommendations);
}

function hasInput(params: Params): boolean {
  return [params.text, params.color, params.font, params.css].some(
    (value) => typeof value === "string" && value.trim().length > 0,
  );
}

function normalizeScope(value: string | undefined) {
  return value?.trim().toLowerCase() ?? null;
}

function buildTasteCounterprompt(
  projection: TasteGuidanceProjection | null,
  input: Pick<Params, "artifact_kind" | "surface">,
) {
  const artifactKind = normalizeScope(input.artifact_kind);
  const surface = normalizeScope(input.surface);
  const guidance = (projection?.guidance ?? []).filter((item) => {
    const itemArtifactKind = normalizeScope(
      item.scope.artifactKind ?? undefined,
    );
    const itemSurfaces = item.scope.surfaces.map((value) =>
      value.trim().toLowerCase(),
    );
    const globallyScoped = !itemArtifactKind && itemSurfaces.length === 0;
    return (
      globallyScoped ||
      (artifactKind !== null && itemArtifactKind === artifactKind) ||
      (surface !== null && itemSurfaces.includes(surface))
    );
  });

  return {
    status: guidance.length > 0 ? "available" : "empty",
    artifact_kind: input.artifact_kind ?? null,
    surface: input.surface ?? null,
    semantic_verdict: "not_evaluated",
    guidance: guidance.slice(0, 12).map((item) => ({
      id: item.id,
      directive: item.directive,
      polarity: item.polarity,
      reason: item.reason,
      scope: {
        artifact_kind: item.scope.artifactKind,
        pattern_ref: item.scope.patternRef,
        surfaces: item.scope.surfaces,
      },
      provenance: item.provenance,
      reviewed_at: item.reviewedAt,
      canonical_mutation: false,
    })),
    boundary:
      "Human-reviewed Taste Guidance is a revision counterprompt, not an automated semantic or visual compliance verdict.",
  };
}

export function registerCheck(server: McpServer, context: HostedBrandContext) {
  server.tool(
    "brand_check",
    "Validate draft text, color, font, and CSS against live hosted governance. Read-only. Returns verdict, field checks, findings, recommendations, and cited hosted sources.",
    paramsShape,
    async (args) => {
      const scopeError = enforceToolScope("brand_check", context);
      if (scopeError) return scopeError;

      const parsed = safeParseParams(ParamsSchema, args);
      if (!parsed.success) return parsed.response;
      if (!hasInput(parsed.data)) {
        return buildResponse({
          what_happened: "brand_check needs at least one field to evaluate",
          next_steps: [
            "Provide text, color, font, css, or a combination of fields",
          ],
          data: {
            error: "no_input",
            verdict: "review",
            checks: {},
            findings: [
              {
                code: "no_input",
                level: "warning",
                message: "No checkable hosted brand_check input was provided",
              },
            ],
            recommendations: [
              "Provide text, color, font, or css for a read-only hosted governance check",
            ],
            sources_consulted: [],
            runtime_origin: "hosted",
            slug: context.slug,
          },
        });
      }

      let pkg: BrandPackagePayload | null;
      try {
        pkg = await context.loadBrandPackage();
      } catch (err) {
        return buildResponse({
          what_happened: `Failed to load hosted brand "${context.slug}": ${(err as Error).message}`,
          next_steps: [
            "Retry in a moment — the hosted brand service may be temporarily unavailable",
          ],
          data: {
            error: "fetch_failed",
            slug: context.slug,
          },
        });
      }

      const governance = collectGovernance(pkg);
      const checks: Record<string, FieldCheck> = {};
      const findings: Finding[] = [];

      if (parsed.data.text?.trim()) {
        const result = checkText(parsed.data.text, governance);
        checks.text = result.check;
        findings.push(...result.findings);
      }
      if (parsed.data.color?.trim()) {
        const result = checkColor(parsed.data.color, governance);
        checks.color = result.check;
        findings.push(...result.findings);
      }
      if (parsed.data.font?.trim()) {
        const result = checkFont(parsed.data.font, governance);
        checks.font = result.check;
        findings.push(...result.findings);
      }
      if (parsed.data.css?.trim()) {
        const result = checkCss(parsed.data.css, governance);
        checks.css = result.check;
        findings.push(...result.findings);
      }

      const verdict = aggregateVerdict(checks);
      const wantsTasteCounterprompt = Boolean(
        parsed.data.artifact_kind || parsed.data.surface,
      );
      let tasteCounterprompt:
        | ReturnType<typeof buildTasteCounterprompt>
        | {
            status: "unavailable" | "not_requested";
            semantic_verdict: "not_evaluated";
            guidance: never[];
            boundary: string;
          };
      if (!wantsTasteCounterprompt) {
        tasteCounterprompt = {
          status: "not_requested",
          semantic_verdict: "not_evaluated",
          guidance: [],
          boundary:
            "Provide artifact_kind or surface to request scoped human-reviewed Taste Guidance.",
        };
      } else {
        try {
          tasteCounterprompt = buildTasteCounterprompt(
            await context.loadTasteGuidance(),
            parsed.data,
          );
        } catch {
          tasteCounterprompt = {
            status: "unavailable",
            semantic_verdict: "not_evaluated",
            guidance: [],
            boundary:
              "Taste Guidance was unavailable; the ordinary hosted governance verdict remains valid and no semantic Taste verdict was inferred.",
          };
        }
      }
      const recommendations = recommendationsFor(verdict, findings);
      if (tasteCounterprompt.guidance.length > 0) {
        recommendations.push(
          "Use the matching human-reviewed Taste Guidance as a revision counterprompt before publishing",
        );
      }
      return buildResponse({
        what_happened: `Hosted brand_check returned ${verdict} for "${context.slug}"`,
        next_steps: [
          verdict === "pass"
            ? "Use the checks and sources_consulted fields as hosted governance provenance"
            : "Review findings and recommendations before applying this brand work",
          ...(tasteCounterprompt.guidance.length > 0
            ? [
                "Revise with the scoped Taste counterprompt, then check the artifact again",
              ]
            : []),
        ],
        data: {
          verdict,
          checks,
          findings,
          recommendations,
          taste_counterprompt: tasteCounterprompt,
          sources_consulted: governance.sources,
          runtime_origin: "hosted",
          custody_safe: true,
          selected_kit_artifact_support: "not_implemented_in_v1",
          slug: context.slug,
          environment: context.auth.environment,
        },
      });
    },
  );
}
