import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { BrandDir } from '../../src/lib/brand-dir.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('BrandDir', () => {
  let tmpDir: string;
  let bd: BrandDir;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'brand-dir-test-'));
    bd = new BrandDir(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  it('exists() returns false for non-existent .brand/ dir', async () => {
    expect(await bd.exists()).toBe(false);
  });

  it('scaffold() creates .brand/ and .brand/assets/logo/ directories', async () => {
    await bd.scaffold();
    const { access } = await import('node:fs/promises');
    await expect(access(join(tmpDir, '.brand'))).resolves.toBeUndefined();
    await expect(access(join(tmpDir, '.brand', 'assets', 'logo'))).resolves.toBeUndefined();
  });

  it('exists() returns true after scaffold', async () => {
    await bd.scaffold();
    expect(await bd.exists()).toBe(true);
  });

  it('initBrand() creates config and empty core-identity', async () => {
    const config = { schema_version: '0.1.0', session: 1, client_name: 'Test', created_at: '2026-01-01' };
    await bd.initBrand(config as any);
    const readConfig = await bd.readConfig();
    expect(readConfig.client_name).toBe('Test');
    const identity = await bd.readCoreIdentity();
    expect(identity.colors).toEqual([]);
  });

  it('readConfig() returns data written by writeConfig()', async () => {
    await bd.scaffold();
    const config = { schema_version: '0.1.0', session: 1, client_name: 'Test', created_at: '2026-01-01' };
    await bd.writeConfig(config as any);
    const result = await bd.readConfig();
    expect(result).toEqual(config);
  });

  it('readCoreIdentity() returns data written by writeCoreIdentity()', async () => {
    await bd.scaffold();
    const identity = {
      schema_version: '0.1.0',
      colors: [{ name: 'Red', value: '#ff0000', role: 'primary', source: 'web', confidence: 'high' }],
      typography: [],
      logo: [],
      spacing: null,
    };
    await bd.writeCoreIdentity(identity as any);
    const result = await bd.readCoreIdentity();
    expect(result).toEqual(identity);
  });

  it('readTokens() returns data written by writeTokens()', async () => {
    await bd.scaffold();
    const tokens = { $name: 'Test Brand', brand: { color: { primary: { $value: '#ff0000', $type: 'color' } } } };
    await bd.writeTokens(tokens);
    const result = await bd.readTokens();
    expect(result).toEqual(tokens);
  });

  it('readClarifications() returns data written by writeClarifications()', async () => {
    await bd.scaffold();
    const clarifications = {
      schema_version: '0.1.0',
      items: [{ id: 'clarify-1', field: 'colors', question: 'What is the primary color?', source: 'web', priority: 'high' as const }],
    };
    await bd.writeClarifications(clarifications);
    const result = await bd.readClarifications();
    expect(result).toEqual(clarifications);
  });

  it('path traversal is blocked', async () => {
    await bd.scaffold();
    await expect(bd.writeAsset('../../etc/passwd', 'bad')).rejects.toThrow(/Path traversal blocked/);
  });

  it('path traversal blocks escapes to sibling paths that share the .brand prefix', async () => {
    await bd.scaffold();
    await expect(bd.writeAsset('../../../.brand-evil/owned.txt', 'bad')).rejects.toThrow(/Path traversal blocked/);
  });

  it('readRuntime() returns data written by writeRuntime()', async () => {
    await bd.scaffold();
    const runtime = {
      version: '0.1.0',
      client_name: 'Test Brand',
      compiled_at: '2026-04-03T00:00:00.000Z',
      sessions_completed: 1,
      identity: { colors: { primary: '#ff0000' }, typography: { heading: 'Inter' }, logo: null },
      visual: null,
      voice: null,
      strategy: null,
    };
    await bd.writeRuntime(runtime);
    const result = await bd.readRuntime();
    expect(result).toEqual(runtime);
  });

  it('readPolicy() returns data written by writePolicy()', async () => {
    await bd.scaffold();
    const policy = {
      version: '0.1.0',
      compiled_at: '2026-04-03T00:00:00.000Z',
      visual_rules: [],
      voice_rules: { never_say: [], ai_ism_patterns: [], tone_constraints: null, sentence_patterns: null },
      content_rules: { claims_policies: [], persona_count: 0 },
    };
    await bd.writePolicy(policy);
    const result = await bd.readPolicy();
    expect(result).toEqual(policy);
  });

  it('writeAsset() rejects content over 10MB', async () => {
    await bd.scaffold();
    const huge = Buffer.alloc(10 * 1024 * 1024 + 1);
    await expect(bd.writeAsset('logo/huge.svg', huge)).rejects.toThrow(/10MB limit/);
  });

  it('writeAsset() accepts content at exactly 10MB', async () => {
    await bd.scaffold();
    const exact = Buffer.alloc(10 * 1024 * 1024);
    await expect(bd.writeAsset('logo/big.svg', exact)).resolves.toBeUndefined();
  });

  it('readCoreIdentity() throws on invalid YAML data', async () => {
    await bd.scaffold();
    // Write data that won't pass the schema
    await bd.writeCoreIdentity({ colors: 'not-an-array' } as any);
    await expect(bd.readCoreIdentity()).rejects.toThrow();
  });

  it('readConfig() throws on invalid YAML data', async () => {
    await bd.scaffold();
    await bd.writeConfig({ session: 'not-a-number' } as any);
    await expect(bd.readConfig()).rejects.toThrow();
  });

  it('hasRuntime() returns false before writing, true after', async () => {
    await bd.scaffold();
    expect(await bd.hasRuntime()).toBe(false);
    await bd.writeRuntime({ version: '1.0.0' });
    expect(await bd.hasRuntime()).toBe(true);
  });

  it('hasTokens() returns false before writing, true after', async () => {
    await bd.scaffold();
    expect(await bd.hasTokens()).toBe(false);
    await bd.writeTokens({ $name: 'Test', brand: {} });
    expect(await bd.hasTokens()).toBe(true);
  });

  it('readDesignSynthesis() returns data written by writeDesignSynthesis()', async () => {
    await bd.scaffold();
    const synthesis = {
      schema_version: '0.4.0',
      generated_at: '2026-04-10T00:00:00.000Z',
      source: 'current-brand',
      brand: { client_name: 'Test', website_url: null },
    };
    await bd.writeDesignSynthesis(synthesis);
    const result = await bd.readDesignSynthesis();
    expect(result).toEqual(synthesis);
  });

  it('hasDesignSynthesis() and hasDesignMarkdown() reflect persisted design artifacts', async () => {
    await bd.scaffold();
    expect(await bd.hasDesignSynthesis()).toBe(false);
    expect(await bd.hasDesignMarkdown()).toBe(false);

    await bd.writeDesignSynthesis({ schema_version: '0.4.0' });
    await bd.writeMarkdown('DESIGN.md', '# DESIGN.md');

    expect(await bd.hasDesignSynthesis()).toBe(true);
    expect(await bd.hasDesignMarkdown()).toBe(true);
  });
});
