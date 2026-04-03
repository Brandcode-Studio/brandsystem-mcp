import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BrandDir } from "../lib/brand-dir.js";
import type { AssetManifest } from "../lib/brand-dir.js";
import { buildResponse, safeParseParams } from "../lib/response.js";
import type { AssetManifestEntry } from "../types/index.js";

const paramsShape = {
  mode: z
    .enum(["scan", "tag"])
    .default("scan")
    .describe('Operation mode: "scan" to catalog assets, "tag" to add metadata to a specific file'),
  file: z
    .string()
    .optional()
    .describe('File to tag, relative to .brand/assets/ (e.g. "illustrations/hero-abstract-01.png"). Required in tag mode.'),
  description: z
    .string()
    .optional()
    .describe("Human-readable description of the asset"),
  usage: z
    .string()
    .optional()
    .describe('Usage context (e.g. "hero sections", "blog headers", "social media")'),
  theme: z
    .enum(["dark", "light", "both"])
    .default("both")
    .describe("Which theme context this asset works in"),
  type: z
    .string()
    .optional()
    .describe('Asset type override (e.g. "illustration", "sticker", "pattern", "icon")'),
};

const ParamsSchema = z.object(paramsShape);
type Params = z.infer<typeof ParamsSchema>;

/** Files to exclude when listing assets in a directory */
function isAssetFile(name: string): boolean {
  if (name.startsWith(".")) return false;
  if (name === "MANIFEST.yaml") return false;
  if (name.endsWith(".md")) return false;
  return true;
}

/** Infer asset type from parent directory name */
function inferType(subdir: string): string | undefined {
  const map: Record<string, string> = {
    logo: "logo",
    illustrations: "illustration",
    stickers: "sticker",
    patterns: "pattern",
    icons: "icon",
  };
  return map[subdir];
}

// ─── Scan Mode ───────────────────────────────────────────────

interface DirSummary {
  directory: string;
  file_count: number;
  manifest_exists: boolean;
  tagged: number;
  needs_tagging: string[];
}

async function handleScan(brandDir: BrandDir) {
  const dirs = await brandDir.listAssetDirs();

  if (dirs.length === 0) {
    return buildResponse({
      what_happened: "No asset directories found in .brand/assets/",
      next_steps: [
        "Create subdirectories under .brand/assets/ (e.g. logo/, illustrations/, stickers/, patterns/, icons/)",
        "Add asset files to those directories, then run brand_ingest_assets again",
      ],
      data: {
        directories: [],
        total_files: 0,
        total_needs_tagging: 0,
      },
    });
  }

  const summaries: DirSummary[] = [];
  let totalFiles = 0;
  let totalNeedsTagging = 0;
  const allNeedsTagging: string[] = [];

  for (const dir of dirs) {
    const allEntries = await brandDir.listAssets(dir);
    const files = allEntries.filter(isAssetFile);
    const manifest = await brandDir.readManifest(dir);
    const taggedFiles = new Set(manifest.assets.map((a) => a.file));

    const needsTagging = files.filter((f) => !taggedFiles.has(f));

    summaries.push({
      directory: dir,
      file_count: files.length,
      manifest_exists: manifest.assets.length > 0,
      tagged: files.length - needsTagging.length,
      needs_tagging: needsTagging,
    });

    totalFiles += files.length;
    totalNeedsTagging += needsTagging.length;
    for (const f of needsTagging) {
      allNeedsTagging.push(`${dir}/${f}`);
    }
  }

  const nextSteps: string[] = [];
  if (totalNeedsTagging > 0) {
    nextSteps.push(
      `${totalNeedsTagging} file(s) need tagging. Use brand_ingest_assets in "tag" mode for each.`
    );
  }
  if (totalFiles === 0) {
    nextSteps.push("Add asset files to .brand/assets/ subdirectories, then scan again");
  }
  if (totalNeedsTagging === 0 && totalFiles > 0) {
    nextSteps.push("All assets are tagged. Run brand_status or brand_report to verify.");
  }

  return buildResponse({
    what_happened: `Scanned ${dirs.length} asset director${dirs.length === 1 ? "y" : "ies"} — ${totalFiles} file(s) found, ${totalNeedsTagging} need tagging`,
    next_steps: nextSteps,
    data: {
      directories: summaries,
      total_files: totalFiles,
      total_needs_tagging: totalNeedsTagging,
      needs_tagging_list: allNeedsTagging,
      ...(totalNeedsTagging > 0
        ? {
            conversation_guide: {
              instruction: [
                "Walk through untagged files one by one.",
                "For each file, ask the user to provide:",
                "  - description: what the asset depicts or represents",
                '  - usage: where it should be used (e.g. "hero sections", "social media")',
                '  - theme: "dark", "light", or "both"',
                "",
                "Then call brand_ingest_assets with mode: 'tag' and the file path plus their answers.",
                "After tagging all files, run a final scan to confirm everything is cataloged.",
              ].join("\n"),
            },
          }
        : {}),
    },
  });
}

// ─── Tag Mode ────────────────────────────────────────────────

async function handleTag(brandDir: BrandDir, input: Params) {
  if (!input.file) {
    return buildResponse({
      what_happened: "Tag mode requires a file path",
      next_steps: [
        'Provide the "file" parameter with a path relative to .brand/assets/ (e.g. "illustrations/hero-abstract-01.png")',
      ],
      data: { error: "missing_file" },
    });
  }

  // Parse subdir and filename from the relative path
  const parts = input.file.split("/");
  if (parts.length < 2) {
    return buildResponse({
      what_happened: `Invalid file path "${input.file}" — expected format: "subdir/filename"`,
      next_steps: [
        'Provide a path like "illustrations/hero-abstract-01.png" (directory/file)',
      ],
      data: { error: "invalid_path" },
    });
  }

  const subdir = parts[0];
  const filename = parts.slice(1).join("/");

  // Verify the file exists by checking the asset listing
  const allEntries = await brandDir.listAssets(subdir);
  const files = allEntries.filter(isAssetFile);

  if (!files.includes(filename)) {
    return buildResponse({
      what_happened: `File "${filename}" not found in .brand/assets/${subdir}/`,
      next_steps: [
        `Available files in ${subdir}/: ${files.length > 0 ? files.join(", ") : "(none)"}`,
        "Run brand_ingest_assets in scan mode to see all available assets",
      ],
      data: { error: "file_not_found", available: files },
    });
  }

  // Read existing manifest
  const manifest = await brandDir.readManifest(subdir);

  // Build the entry
  const entry: AssetManifestEntry = {
    file: filename,
    description: input.description ?? "",
    usage: input.usage ?? "general purpose",
    theme: input.theme,
  };

  // Add optional type (from explicit param or inferred from directory)
  const assetType = input.type ?? inferType(subdir);
  if (assetType) {
    entry.type = assetType;
  }

  // Update or add
  const existingIndex = manifest.assets.findIndex((a) => a.file === filename);
  if (existingIndex >= 0) {
    manifest.assets[existingIndex] = entry;
  } else {
    manifest.assets.push(entry);
  }

  await brandDir.writeManifest(subdir, manifest);

  // Count remaining untagged
  const taggedFiles = new Set(manifest.assets.map((a) => a.file));
  const remaining = files.filter((f) => !taggedFiles.has(f));

  const nextSteps: string[] = [];
  if (remaining.length > 0) {
    nextSteps.push(
      `${remaining.length} more file(s) in ${subdir}/ need tagging: ${remaining.join(", ")}`
    );
  } else {
    nextSteps.push(`All files in ${subdir}/ are now tagged`);
  }
  nextSteps.push("Run brand_ingest_assets in scan mode to check overall progress");

  return buildResponse({
    what_happened: `${existingIndex >= 0 ? "Updated" : "Added"} manifest entry for "${input.file}"`,
    next_steps: nextSteps,
    data: {
      entry,
      manifest_path: `.brand/assets/${subdir}/MANIFEST.yaml`,
      remaining_untagged: remaining,
    },
  });
}

// ─── Handler + Registration ──────────────────────────────────

async function handler(input: Params) {
  const brandDir = new BrandDir(process.cwd());

  if (!(await brandDir.exists())) {
    return buildResponse({
      what_happened: "No .brand/ directory found",
      next_steps: ["Run brand_start or brand_init first to create the brand system"],
      data: { error: "no_brand_dir" },
    });
  }

  if (input.mode === "tag") {
    return handleTag(brandDir, input);
  }

  return handleScan(brandDir);
}

export function register(server: McpServer) {
  server.tool(
    "brand_ingest_assets",
    "Scan and catalog brand assets (illustrations, stickers, patterns, icons) in .brand/assets/. Mode 'scan' (default) inventories all asset directories and identifies files missing from MANIFEST.yaml. Mode 'tag' adds metadata to a specific file: description, usage context, and theme compatibility. Use after adding asset files to .brand/assets/ subdirectories. Returns directory summaries and untagged file lists.",
    paramsShape,
    async (args) => {
      const parsed = safeParseParams(ParamsSchema, args);
      if (!parsed.success) return parsed.response;
      return handler(parsed.data);
    }
  );
}
