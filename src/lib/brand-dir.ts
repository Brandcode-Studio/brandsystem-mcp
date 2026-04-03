import { readFile, writeFile, mkdir, access, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { stringify, parse } from "yaml";
import type { BrandConfigData, CoreIdentityData, NeedsClarificationData, VisualIdentityData, MessagingData, ContentStrategyData } from "../schemas/index.js";
import { SCHEMA_VERSION, BrandConfigSchema, CoreIdentitySchema, NeedsClarificationSchema, VisualIdentitySchema, MessagingSchema, ContentStrategySchema } from "../schemas/index.js";
import type { AssetManifestEntry } from "../types/index.js";

export interface AssetManifest {
  assets: AssetManifestEntry[];
}

export class BrandDir {
  readonly root: string;
  readonly brandPath: string;
  private locks = new Map<string, Promise<void>>();

  constructor(cwd: string) {
    this.root = cwd;
    this.brandPath = join(cwd, ".brand");
  }

  private async withLock<T>(filename: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(filename) ?? Promise.resolve();
    let resolve: () => void;
    const next = new Promise<void>((r) => { resolve = r; });
    this.locks.set(filename, next);
    await prev;
    try {
      return await fn();
    } finally {
      resolve!();
    }
  }

  private path(...segments: string[]): string {
    const full = join(this.brandPath, ...segments);
    const resolved = resolve(full);
    if (!resolved.startsWith(resolve(this.brandPath))) {
      throw new Error(`Path traversal blocked: ${segments.join("/")}`);
    }
    return full;
  }

  async exists(): Promise<boolean> {
    try {
      await access(this.brandPath);
      return true;
    } catch {
      return false;
    }
  }

  async scaffold(): Promise<void> {
    await mkdir(this.brandPath, { recursive: true });
    await mkdir(this.path("assets", "logo"), { recursive: true });
  }

  /**
   * Scaffold + write initial config and empty core identity in one call.
   * Shared by brand_start and brand_init to avoid duplicated init logic.
   */
  async initBrand(config: BrandConfigData): Promise<void> {
    await this.scaffold();
    await this.writeConfig(config);
    await this.writeCoreIdentity({
      schema_version: SCHEMA_VERSION,
      colors: [],
      typography: [],
      logo: [],
      spacing: null,
    });
  }

  // --- YAML helpers ---

  private async readYaml(filename: string): Promise<unknown> {
    const content = await readFile(this.path(filename), "utf-8");
    return parse(content);
  }

  private async writeYaml(filename: string, data: unknown): Promise<void> {
    await this.withLock(filename, async () => {
      const content = stringify(data, { lineWidth: 120 });
      await writeFile(this.path(filename), content, "utf-8");
    });
  }

  // --- JSON helpers ---

  private async readJson(filename: string): Promise<unknown> {
    const content = await readFile(this.path(filename), "utf-8");
    return JSON.parse(content);
  }

  private async writeJson(filename: string, data: unknown): Promise<void> {
    await this.withLock(filename, async () => {
      const content = JSON.stringify(data, null, 2);
      await writeFile(this.path(filename), content, "utf-8");
    });
  }

  // --- Config ---

  async readConfig(): Promise<BrandConfigData> {
    const raw = await this.readYaml("brand.config.yaml");
    return BrandConfigSchema.parse(raw);
  }

  async writeConfig(data: BrandConfigData): Promise<void> {
    await this.writeYaml("brand.config.yaml", data);
  }

  // --- Core Identity ---

  async readCoreIdentity(): Promise<CoreIdentityData> {
    const raw = await this.readYaml("core-identity.yaml");
    return CoreIdentitySchema.parse(raw);
  }

  async writeCoreIdentity(data: CoreIdentityData): Promise<void> {
    await this.writeYaml("core-identity.yaml", data);
  }

  // --- Tokens ---

  async readTokens(): Promise<Record<string, unknown>> {
    // TODO: add schema validation
    return await this.readJson("tokens.json") as Record<string, unknown>;
  }

  async writeTokens(data: Record<string, unknown>): Promise<void> {
    await this.writeJson("tokens.json", data);
  }

  // --- Needs Clarification ---

  async readClarifications(): Promise<NeedsClarificationData> {
    const raw = await this.readYaml("needs-clarification.yaml");
    return NeedsClarificationSchema.parse(raw);
  }

  async writeClarifications(data: NeedsClarificationData): Promise<void> {
    await this.writeYaml("needs-clarification.yaml", data);
  }

  // --- Visual Identity (Session 2) ---

  async readVisualIdentity(): Promise<VisualIdentityData> {
    const raw = await this.readYaml("visual-identity.yaml");
    return VisualIdentitySchema.parse(raw);
  }

  async writeVisualIdentity(data: VisualIdentityData): Promise<void> {
    await this.writeYaml("visual-identity.yaml", data);
  }

  async hasVisualIdentity(): Promise<boolean> {
    try {
      await access(this.path("visual-identity.yaml"));
      return true;
    } catch {
      return false;
    }
  }

  async writeMarkdown(filename: string, content: string): Promise<void> {
    await this.withLock(filename, async () => {
      await writeFile(this.path(filename), content, "utf-8");
    });
  }

  async readMarkdown(filename: string): Promise<string> {
    return readFile(this.path(filename), "utf-8");
  }

  // --- Messaging (Session 3) ---

  async readMessaging(): Promise<MessagingData> {
    const raw = await this.readYaml("messaging.yaml");
    return MessagingSchema.parse(raw);
  }

  async writeMessaging(data: MessagingData): Promise<void> {
    await this.writeYaml("messaging.yaml", data);
  }

  async hasMessaging(): Promise<boolean> {
    try {
      await access(this.path("messaging.yaml"));
      return true;
    } catch {
      return false;
    }
  }

  // --- Content Strategy (Session 4) ---

  async readStrategy(): Promise<ContentStrategyData> {
    const raw = await this.readYaml("strategy.yaml");
    return ContentStrategySchema.parse(raw);
  }

  async writeStrategy(data: ContentStrategyData): Promise<void> {
    await this.writeYaml("strategy.yaml", data);
  }

  async hasStrategy(): Promise<boolean> {
    try {
      await access(this.path("strategy.yaml"));
      return true;
    } catch {
      return false;
    }
  }

  // --- Runtime + Policy ---

  async readRuntime(): Promise<Record<string, unknown>> {
    // TODO: add schema validation
    return await this.readJson("brand-runtime.json") as Record<string, unknown>;
  }

  async writeRuntime(data: unknown): Promise<void> {
    await this.writeJson("brand-runtime.json", data);
  }

  async readPolicy(): Promise<Record<string, unknown>> {
    // TODO: add schema validation
    return await this.readJson("interaction-policy.json") as Record<string, unknown>;
  }

  async writePolicy(data: unknown): Promise<void> {
    await this.writeJson("interaction-policy.json", data);
  }

  async hasRuntime(): Promise<boolean> {
    try {
      await access(this.path("brand-runtime.json"));
      return true;
    } catch {
      return false;
    }
  }

  // --- Asset scanning ---

  async listAssets(subdir: string): Promise<string[]> {
    const dir = this.path("assets", subdir);
    try {
      const entries = await readdir(dir);
      return entries.filter((e) => !e.startsWith(".") && !e.endsWith(".md") && e !== "MANIFEST.yaml");
    } catch {
      return [];
    }
  }

  async listAssetDirs(): Promise<string[]> {
    const assetsDir = this.path("assets");
    try {
      const entries = await readdir(assetsDir);
      const dirs: string[] = [];
      for (const entry of entries) {
        const s = await stat(join(assetsDir, entry));
        if (s.isDirectory()) dirs.push(entry);
      }
      return dirs;
    } catch {
      return [];
    }
  }

  // --- Assets ---

  async writeAsset(relativePath: string, content: string | Buffer): Promise<void> {
    const MAX_ASSET_BYTES = 10 * 1024 * 1024; // 10 MB
    const size = typeof content === "string" ? Buffer.byteLength(content, "utf-8") : content.length;
    if (size > MAX_ASSET_BYTES) {
      throw new Error(
        `Asset "${relativePath}" is ${(size / 1024 / 1024).toFixed(1)}MB, exceeding the 10MB limit`
      );
    }
    await this.withLock(`asset:${relativePath}`, async () => {
      const fullPath = join(this.brandPath, "assets", relativePath);
      const resolved = resolve(fullPath);
      const assetsDir = resolve(this.brandPath, "assets");
      // Allow writing to .brand/ root for specific files
      const brandDir = resolve(this.brandPath);
      if (!resolved.startsWith(assetsDir) && !resolved.startsWith(brandDir)) {
        throw new Error(`Path traversal blocked: ${relativePath} resolves outside .brand/`);
      }
      const dir = resolved.substring(0, resolved.lastIndexOf("/"));
      await mkdir(dir, { recursive: true });
      await writeFile(resolved, content, typeof content === "string" ? "utf-8" : undefined);
    });
  }

  async readAsset(relativePath: string): Promise<string> {
    return readFile(this.path("assets", relativePath), "utf-8");
  }

  // --- Asset Manifests ---

  async readManifest(subdir: string): Promise<AssetManifest> {
    try {
      const content = await readFile(
        this.path("assets", subdir, "MANIFEST.yaml"),
        "utf-8"
      );
      const parsed = parse(content) as AssetManifest | null;
      return parsed ?? { assets: [] };
    } catch {
      return { assets: [] };
    }
  }

  async writeManifest(subdir: string, data: AssetManifest): Promise<void> {
    await this.withLock(`manifest:${subdir}`, async () => {
      const dir = this.path("assets", subdir);
      await mkdir(dir, { recursive: true });
      const content = stringify(data, { lineWidth: 120 });
      await writeFile(join(dir, "MANIFEST.yaml"), content, "utf-8");
    });
  }
}
