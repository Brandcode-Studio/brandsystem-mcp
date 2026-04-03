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
    const tokens = { color: { primary: { $value: '#ff0000' } } };
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

  it('readRuntime() returns data written by writeRuntime()', async () => {
    await bd.scaffold();
    const runtime = { version: '1.0.0', features: ['logo', 'colors'] };
    await bd.writeRuntime(runtime);
    const result = await bd.readRuntime();
    expect(result).toEqual(runtime);
  });

  it('readPolicy() returns data written by writePolicy()', async () => {
    await bd.scaffold();
    const policy = { allow: ['logo'], deny: ['custom-fonts'] };
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
});
