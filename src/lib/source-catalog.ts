import type { BrandConfigData, CoreIdentityData } from "../schemas/index.js";
import type { ColorEntry, Confidence, Source, SpacingSpec, TypographyEntry } from "../types/index.js";
import { BrandDir } from "./brand-dir.js";
import { DEFAULT_SOURCE_PRIORITY, sourcePriorityRank } from "./confidence.js";

export interface SourceFieldRecord {
  source: Source;
  value: unknown;
  confidence: Confidence;
  recorded_at: string;
  metadata?: Record<string, unknown>;
}

export interface SourceCatalogFile {
  schema_version: string;
  updated_at: string;
  fields: Record<string, SourceFieldRecord[]>;
}

export interface SourceConflict {
  field: string;
  sources: SourceFieldRecord[];
  recommended: Source;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function buildColorField(entry: ColorEntry): string {
  return entry.role === "unknown" ? `colors.${slugify(entry.name)}` : `colors.${entry.role}`;
}

function buildTypographyField(entry: TypographyEntry): string {
  return `typography.${slugify(entry.name)}`;
}

function jsonValue(value: unknown): string {
  return JSON.stringify(value);
}

export function getConfiguredSourcePriority(config?: Pick<BrandConfigData, "source_priority"> | null): Source[] {
  return config?.source_priority && config.source_priority.length > 0
    ? config.source_priority
    : DEFAULT_SOURCE_PRIORITY;
}

export function chooseRecommendedSource(records: SourceFieldRecord[], priority: Source[]): Source {
  return [...records]
    .sort((a, b) => sourcePriorityRank(b.source, priority) - sourcePriorityRank(a.source, priority))[0]?.source ?? "web";
}

export function buildSourceCatalogRecords(input: {
  colors?: ColorEntry[];
  typography?: TypographyEntry[];
  spacing?: SpacingSpec | null;
}): Array<{ field: string; record: SourceFieldRecord }> {
  const recordedAt = new Date().toISOString();
  const records: Array<{ field: string; record: SourceFieldRecord }> = [];

  for (const color of input.colors ?? []) {
    records.push({
      field: buildColorField(color),
      record: {
        source: color.source,
        value: color.value,
        confidence: color.confidence,
        recorded_at: recordedAt,
        metadata: {
          name: color.name,
          role: color.role,
          css_property: color.css_property,
        },
      },
    });
  }

  for (const typography of input.typography ?? []) {
    records.push({
      field: buildTypographyField(typography),
      record: {
        source: typography.source,
        value: {
          family: typography.family,
          size: typography.size ?? null,
          weight: typography.weight ?? null,
          line_height: typography.line_height ?? null,
        },
        confidence: typography.confidence,
        recorded_at: recordedAt,
        metadata: {
          name: typography.name,
          family: typography.family,
          figma_style_id: typography.figma_style_id,
        },
      },
    });
  }

  if (input.spacing?.base_unit) {
    records.push({
      field: "spacing.base_unit",
      record: {
        source: input.spacing.source,
        value: input.spacing.base_unit,
        confidence: input.spacing.confidence,
        recorded_at: recordedAt,
      },
    });
  }

  if (input.spacing?.scale && input.spacing.scale.length > 0) {
    records.push({
      field: "spacing.scale",
      record: {
        source: input.spacing.source,
        value: input.spacing.scale,
        confidence: input.spacing.confidence,
        recorded_at: recordedAt,
      },
    });
  }

  return records;
}

export async function upsertSourceCatalog(
  brandDir: BrandDir,
  entries: Array<{ field: string; record: SourceFieldRecord }>,
): Promise<SourceCatalogFile> {
  const existing: SourceCatalogFile = await brandDir.hasSourceCatalog()
    ? await brandDir.readSourceCatalog<SourceCatalogFile>()
    : {
      schema_version: "0.1.0",
      updated_at: new Date().toISOString(),
      fields: {},
    };

  const next: SourceCatalogFile = {
    schema_version: existing.schema_version ?? "0.1.0",
    updated_at: new Date().toISOString(),
    fields: { ...existing.fields },
  };

  for (const entry of entries) {
    const current = next.fields[entry.field] ?? [];
    const filtered = current.filter((record) => record.source !== entry.record.source);
    next.fields[entry.field] = [...filtered, entry.record];
  }

  await brandDir.writeSourceCatalog(next);
  return next;
}

export function findConflicts(
  catalog: SourceCatalogFile,
  priority: Source[],
  field?: string,
): SourceConflict[] {
  const fields = field ? { [field]: catalog.fields[field] ?? [] } : catalog.fields;
  const conflicts: SourceConflict[] = [];

  for (const [name, records] of Object.entries(fields)) {
    if (!records || records.length < 2) continue;
    const distinctValues = new Set(records.map((record) => jsonValue(record.value)));
    if (distinctValues.size < 2) continue;
    conflicts.push({
      field: name,
      sources: [...records].sort((a, b) => sourcePriorityRank(b.source, priority) - sourcePriorityRank(a.source, priority)),
      recommended: chooseRecommendedSource(records, priority),
    });
  }

  return conflicts.sort((a, b) => a.field.localeCompare(b.field));
}

export function applyConflictResolution(
  identity: CoreIdentityData,
  field: string,
  record: SourceFieldRecord,
): CoreIdentityData {
  if (field.startsWith("colors.")) {
    const role = field.slice("colors.".length);
    const metadata = record.metadata ?? {};
    const name = typeof metadata.name === "string" ? metadata.name : role;
    const colorRole = (typeof metadata.role === "string" ? metadata.role : role) as ColorEntry["role"];
    const nextColors = identity.colors.filter((entry) => (entry.role === "unknown" ? slugify(entry.name) : entry.role) !== role);
    nextColors.push({
      name,
      value: String(record.value),
      role: colorRole,
      source: record.source,
      confidence: record.confidence,
      css_property: typeof metadata.css_property === "string" ? metadata.css_property : undefined,
    });
    return { ...identity, colors: nextColors };
  }

  if (field.startsWith("typography.")) {
    const metadata = record.metadata ?? {};
    const name = typeof metadata.name === "string" ? metadata.name : field.slice("typography.".length);
    const typedValue = (record.value ?? {}) as Record<string, unknown>;
    const nextTypography = identity.typography.filter((entry) => slugify(entry.name) !== field.slice("typography.".length));
    nextTypography.push({
      name,
      family: String(typedValue.family ?? metadata.family ?? name),
      size: typeof typedValue.size === "string" ? typedValue.size : undefined,
      weight: typeof typedValue.weight === "number" ? typedValue.weight : undefined,
      line_height: typeof typedValue.line_height === "string" ? typedValue.line_height : undefined,
      source: record.source,
      confidence: record.confidence,
    });
    return { ...identity, typography: nextTypography };
  }

  if (field === "spacing.base_unit" || field === "spacing.scale") {
    const current = identity.spacing ?? {
      source: record.source,
      confidence: record.confidence,
    };
    const nextSpacing: SpacingSpec = {
      ...current,
      source: record.source,
      confidence: record.confidence,
      ...(field === "spacing.base_unit" ? { base_unit: String(record.value) } : {}),
      ...(field === "spacing.scale" && Array.isArray(record.value)
        ? { scale: record.value.map((value) => Number(value)).filter((value) => Number.isFinite(value)) }
        : {}),
    };
    return { ...identity, spacing: nextSpacing };
  }

  return identity;
}
