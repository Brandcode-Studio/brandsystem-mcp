import { readFile, writeFile, mkdir, access, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { stringify, parse } from "yaml";
import type { BrandConfigData, CoreIdentityData, NeedsClarificationData, VisualIdentityData, MessagingData } from "../schemas/index.js";
import { SCHEMA_VERSION } from "../schemas/index.js";
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
    return join(this.brandPath, ...segments);
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

  private async readYaml<T>(filename: string): Promise<T> {
    const content = await readFile(this.path(filename), "utf-8");
    return parse(content) as T;
  }

  private async writeYaml(filename: string, data: unknown): Promise<void> {
    await this.withLock(filename, async () => {
      const content = stringify(data, { lineWidth: 120 });
      await writeFile(this.path(filename), content, "utf-8");
    });
  }

  // --- JSON helpers ---

  private async readJson<T>(filename: string): Promise<T> {
    const content = await readFile(this.path(filename), "utf-8");
    return JSON.parse(content) as T;
  }

  private async writeJson(filename: string, data: unknown): Promise<void> {
    await this.withLock(filename, async () => {
      const content = JSON.stringify(data, null, 2);
      await writeFile(this.path(filename), content, "utf-8");
    });
  }

  // --- Config ---

  async readConfig(): Promise<BrandConfigData> {
    return this.readYaml<BrandConfigData>("brand.config.yaml");
  }

  async writeConfig(data: BrandConfigData): Promise<void> {
    await this.writeYaml("brand.config.yaml", data);
  }

  // --- Core Identity ---

  async readCoreIdentity(): Promise<CoreIdentityData> {
    return this.readYaml<CoreIdentityData>("core-identity.yaml");
  }

  async writeCoreIdentity(data: CoreIdentityData): Promise<void> {
    await this.writeYaml("core-identity.yaml", data);
  }

  // --- Tokens ---

  async readTokens(): Promise<Record<string, unknown>> {
    return this.readJson<Record<string, unknown>>("tokens.json");
  }

  async writeTokens(data: Record<string, unknown>): Promise<void> {
    await this.writeJson("tokens.json", data);
  }

  // --- Needs Clarification ---

  async readClarifications(): Promise<NeedsClarificationData> {
    return this.readYaml<NeedsClarificationData>("needs-clarification.yaml");
  }

  async writeClarifications(data: NeedsClarificationData): Promise<void> {
    await this.writeYaml("needs-clarification.yaml", data);
  }

  // --- Visual Identity (Session 2) ---

  async readVisualIdentity(): Promise<VisualIdentityData> {
    return this.readYaml<VisualIdentityData>("visual-identity.yaml");
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
    return this.readYaml<MessagingData>("messaging.yaml");
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
    const dir = this.path("assets", subdir);
    await mkdir(dir, { recursive: true });
    const content = stringify(data, { lineWidth: 120 });
    await writeFile(join(dir, "MANIFEST.yaml"), content, "utf-8");
  }
}
