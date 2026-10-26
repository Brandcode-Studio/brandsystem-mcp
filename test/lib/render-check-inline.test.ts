import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inlineLocalResources } from "../../src/lib/render-check.js";

let root: string; // contains cwd and an "outside" sibling
let cwd: string;

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "render-inline-")));
  cwd = join(root, "project");
  await mkdir(join(cwd, "site", "css"), { recursive: true });
  await mkdir(join(cwd, "site", "fonts"), { recursive: true });
  await mkdir(join(root, "outside"), { recursive: true });

  await writeFile(join(cwd, "site", "fonts", "brand.woff2"), Buffer.from([0x77, 0x4f, 0x46, 0x32]));
  await writeFile(join(cwd, "site", "logo.svg"), "<svg xmlns='http://www.w3.org/2000/svg'/>");
  await writeFile(join(cwd, "site", "css", "base.css"), "body{color:#2a4494}");
  await writeFile(
    join(cwd, "site", "css", "main.css"),
    `@import "./base.css";
@font-face{font-family:"Brand Sans";src:url("../fonts/brand.woff2") format("woff2")}
h1{background:url(https://cdn.example.com/bg.png)}
.x::after{content:"</style><script>alert(1)</script>"}`,
  );
  await writeFile(join(cwd, "site", "app.js"), "document.title='</script>ok'");
  await writeFile(join(root, "outside", "secret.css"), "body{color:red}");
  await symlink(join(root, "outside", "secret.css"), join(cwd, "site", "css", "escape.css"));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("inlineLocalResources", () => {
  it("inlines contained CSS, @imports, fonts, images, and scripts; leaves remote refs for the blocker", async () => {
    const html = `<!doctype html><html><head>
<link rel="stylesheet" href="css/main.css">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">
<link rel="stylesheet" href="css/escape.css">
<link rel="stylesheet" href="../../outside/secret.css">
<script src="app.js"></script>
</head><body><img src="logo.svg" alt="Fixture Brand"><img src="missing.png"></body></html>`;
    const { html: out, report } = await inlineLocalResources(html, { baseDir: join(cwd, "site"), cwd });

    // Local CSS (and its @import) inlined
    expect(out).toContain("body{color:#2a4494}");
    expect(out).not.toContain('href="css/main.css"');
    // Font url() became a data: URI
    expect(out).toMatch(/url\("data:font\/woff2;base64,d09GMg=="\)/);
    // Image became a data: URI
    expect(out).toMatch(/<img src="data:image\/svg\+xml;base64,[^"]+" alt="Fixture Brand">/);
    // Script inlined with its closing tag neutralized
    expect(out).toContain("document.title='<\\/script>ok'");
    expect(out).not.toContain('src="app.js"');
    // Inlined CSS cannot break out of its <style> element
    expect(out).toContain('content:"<\\/style><script>alert(1)</script>"');
    expect(out).not.toMatch(/<\/style><script>alert/);

    // Remote references are left in place and reported
    expect(out).toContain("https://fonts.googleapis.com/css2?family=Inter");
    expect(out).toContain("https://cdn.example.com/bg.png");
    expect(report.remote).toEqual(
      expect.arrayContaining(["https://fonts.googleapis.com/css2?family=Inter", "https://cdn.example.com/bg.png"]),
    );

    // Symlink escapes and ../ traversal outside cwd are never read
    expect(out).not.toContain("color:red");
    expect(report.skipped.some((s) => s.includes("escape.css") && s.includes("outside working directory"))).toBe(true);
    expect(report.skipped.some((s) => s.includes("secret.css") && s.includes("outside working directory"))).toBe(true);
    expect(report.skipped.some((s) => s.includes("missing.png") && s.includes("not found"))).toBe(true);
    expect(report.inlined).toBe(5); // main.css, base.css, brand.woff2, app.js, logo.svg
  });

  it("resolves root-relative references against the page directory", async () => {
    const { html: out } = await inlineLocalResources('<link rel="stylesheet" href="/css/base.css">', {
      baseDir: join(cwd, "site"),
      cwd,
    });
    expect(out).toContain("body{color:#2a4494}");
  });
});
