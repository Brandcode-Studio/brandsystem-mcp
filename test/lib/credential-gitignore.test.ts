/**
 * The Studio credential file must be gitignored no matter which tool created
 * .brand/ — brand_start (the recommended entry point) never ran brand_init's
 * root .gitignore step, so credentials written after it were committable.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/server.js";
import {
  ensureGitignoreEntry,
  ensureCredentialsGitignored,
} from "../../src/lib/credential-gitignore.js";
import { readAuthCredentials, writeAuthCredentials } from "../../src/lib/auth-state.js";

let dir: string;

function git(args: string[]): { code: number; out: string } {
  const env = { ...process.env };
  for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR"]) delete env[key];
  try {
    const out = execFileSync("git", args, { cwd: dir, env, stdio: "pipe" });
    return { code: 0, out: String(out) };
  } catch (err) {
    return { code: (err as { status: number }).status, out: "" };
  }
}

function b64url(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "cred-gitignore-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("ensureGitignoreEntry", () => {
  it("creates the file when missing", async () => {
    const path = join(dir, ".gitignore");
    await ensureGitignoreEntry(path, "secret.json");
    expect(await readFile(path, "utf-8")).toBe("secret.json\n");
  });

  it("appends without rewriting existing content, adding a newline when needed", async () => {
    const path = join(dir, ".gitignore");
    await writeFile(path, "node_modules/\n# keep me\ndist");
    await ensureGitignoreEntry(path, "secret.json");
    expect(await readFile(path, "utf-8")).toBe("node_modules/\n# keep me\ndist\nsecret.json\n");
  });

  it("is idempotent and treats an anchored entry as present", async () => {
    const path = join(dir, ".gitignore");
    await writeFile(path, "/secret.json\n");
    await ensureGitignoreEntry(path, "secret.json");
    await ensureGitignoreEntry(path, "secret.json");
    expect(await readFile(path, "utf-8")).toBe("/secret.json\n");
  });
});

describe("credential storage is self-protecting", () => {
  it("writes .brand/.gitignore and the root entry, preserving user content", async () => {
    await mkdir(join(dir, ".brand"), { recursive: true });
    await writeFile(join(dir, ".brand", ".gitignore"), "scratch/\n");
    await writeFile(join(dir, ".gitignore"), "node_modules/\n");
    await ensureCredentialsGitignored(dir);
    expect(await readFile(join(dir, ".brand", ".gitignore"), "utf-8")).toBe(
      "scratch/\nbrandcode-auth.json\n",
    );
    expect(await readFile(join(dir, ".gitignore"), "utf-8")).toBe(
      "node_modules/\n.brand/brandcode-auth.json\n",
    );
  });

  it("heals credentials that predate the fix when they are read", async () => {
    await mkdir(join(dir, ".brand"), { recursive: true });
    await writeFile(
      join(dir, ".brand", "brandcode-auth.json"),
      JSON.stringify({
        email: "a@b.c",
        token: "t",
        expiresAt: "2099-01-01T00:00:00.000Z",
        studioUrl: "https://www.brandcode.studio",
      }),
    );
    expect(await readAuthCredentials(dir)).not.toBeNull();
    expect(await readFile(join(dir, ".brand", ".gitignore"), "utf-8")).toContain(
      "brandcode-auth.json",
    );
  });

  it("keeps credentials out of git with only .brand/.gitignore (no root .gitignore)", async () => {
    expect(git(["init", "-q"]).code).toBe(0);
    await writeAuthCredentials(dir, {
      email: "a@b.c",
      token: "t",
      expiresAt: "2099-01-01T00:00:00.000Z",
      studioUrl: "https://www.brandcode.studio",
    });
    await rm(join(dir, ".gitignore"));
    expect(git(["check-ignore", "-q", ".brand/brandcode-auth.json"]).code).toBe(0);
  });

  it("credentials written after brand_start are ignored by git", async () => {
    expect(git(["init", "-q"]).code).toBe(0);
    const prevCwd = process.cwd();
    process.chdir(dir);
    try {
      const server = createServer({ profile: "full" });
      const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: "cred-gitignore", version: "1.0.0" });
      await server.connect(serverTransport);
      await client.connect(clientTransport);

      await client.callTool({ name: "brand_start", arguments: { client_name: "Acme" } });
      // brand_start creates a committable .brand/ ...
      expect(git(["check-ignore", "-q", ".brand/brand.config.yaml"]).code).toBe(1);

      const jwt = `${b64url({ alg: "none" })}.${b64url({ email: "owner@example.com" })}.sig`;
      await client.callTool({
        name: "brand_brandcode_auth",
        arguments: { mode: "set_key", key: jwt },
      });
      await client.close();
    } finally {
      process.chdir(prevCwd);
    }

    // ... but the credential file it later holds is not.
    await expect(
      readFile(join(dir, ".brand", "brandcode-auth.json"), "utf-8"),
    ).resolves.toContain("owner@example.com");
    expect(git(["check-ignore", "-q", ".brand/brandcode-auth.json"]).code).toBe(0);
    git(["add", "-A"]);
    const staged = git(["diff", "--cached", "--name-only"]).out;
    expect(staged).toContain(".brand/brand.config.yaml");
    expect(staged).not.toContain("brandcode-auth.json");
  });
});
