import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { copyFixture, connectWithCwd, callTool } from "../helpers.js";

// ---------------------------------------------------------------------------
// Issue #43 (Colovore field run): preflight engine fixes
// 1. Same-document CSS variable resolution (var(--x) / var(--x, fallback))
// 2. <img> logo detection (filename patterns + alt/aria-label = client_name)
//
// Fixture brand-session1: client_name "Fixture Brand", brand font "Inter",
// primary color #2a4494.
// ---------------------------------------------------------------------------

type Check = {
  id: string;
  status: string;
  message: string;
  details?: string;
};

let client: Client;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  const dir = await copyFixture("brand-session1");
  ({ client, cleanup } = await connectWithCwd(dir));
});

afterAll(async () => {
  await cleanup();
});

async function preflightChecks(html: string): Promise<Check[]> {
  const json = await callTool(client, "brand_preflight", {
    html,
    mode: "check",
  });
  const data = json as { checks?: Check[] };
  expect(Array.isArray(data.checks)).toBe(true);
  return data.checks as Check[];
}

function getCheck(checks: Check[], id: string): Check {
  const check = checks.find((c) => c.id === id);
  expect(check, `expected check ${id} to exist`).toBeDefined();
  return check as Check;
}

describe("brand_preflight CSS variable resolution (#43)", () => {
  it("resolves var() to a brand font and passes T-FAMILY", async () => {
    const checks = await preflightChecks(`
      <html><head><style>
        :root { --font-text: "Inter", sans-serif; }
        body { font-family: var(--font-text); }
      </style></head>
      <body><p style="font-family: var(--font-text)">Hello</p></body></html>
    `);
    const tFamily = getCheck(checks, "T-FAMILY");
    expect(tFamily.status).toBe("pass");
    // No unresolvable-variable info check should appear
    expect(checks.find((c) => c.id === "V-UNRESOLVED")).toBeUndefined();
  });

  it("resolves var() to an off-brand font and names the RESOLVED value", async () => {
    const checks = await preflightChecks(`
      <html><head><style>
        :root { --font-text: "Papyrus", fantasy; }
        body { font-family: var(--font-text); }
      </style></head><body><p>Hello</p></body></html>
    `);
    const tFamily = getCheck(checks, "T-FAMILY");
    expect(tFamily.status).toBe("warn");
    // The resolved font name is reported, not the literal var() token
    expect(tFamily.details?.toLowerCase()).toContain("papyrus");
    expect(`${tFamily.message} ${tFamily.details ?? ""}`).not.toContain("var(");
  });

  it("flags var(--undefined) as unresolvable info, not a font violation", async () => {
    const checks = await preflightChecks(`
      <html><head><style>
        body { font-family: var(--undefined-font); }
      </style></head><body><p>Hello</p></body></html>
    `);
    const info = getCheck(checks, "V-UNRESOLVED");
    expect(info.status).toBe("info");
    expect(info.details).toContain("--undefined-font");
    // Never flagged as a non-brand font
    for (const check of checks) {
      if (check.id === "V-UNRESOLVED") continue;
      expect(`${check.message} ${check.details ?? ""}`).not.toContain(
        "var(--undefined-font)"
      );
    }
    const tFamily = getCheck(checks, "T-FAMILY");
    expect(tFamily.details ?? "").not.toContain("var(");
  });

  it("uses the fallback literal for var(--x, Arial) when undefined", async () => {
    const checks = await preflightChecks(`
      <html><head><style>
        body { font-family: var(--missing-font, Arial); }
      </style></head><body><p>Hello</p></body></html>
    `);
    // Fallback resolved, so nothing is unresolvable
    expect(checks.find((c) => c.id === "V-UNRESOLVED")).toBeUndefined();
    // Arial is a system fallback — T-FAMILY passes
    const tFamily = getCheck(checks, "T-FAMILY");
    expect(tFamily.status).toBe("pass");
    // T-SYSTEM sees the resolved "arial" family (proves substitution happened)
    const tSystem = getCheck(checks, "T-SYSTEM");
    expect(tSystem.status).toBe("warn");
    expect(tSystem.details?.toLowerCase()).toContain("arial");
  });

  it("resolves var() color references against the brand palette", async () => {
    const checks = await preflightChecks(`
      <html><head><style>
        :root { --brand-primary: #2a4494; }
        .hero { background-color: var(--brand-primary); font-family: Inter; }
      </style></head><body><div class="hero">Hello</div></body></html>
    `);
    const cPrimary = getCheck(checks, "C-PRIMARY");
    expect(cPrimary.status).toBe("pass");
    const cPalette = getCheck(checks, "C-PALETTE");
    expect(cPalette.status).toBe("pass");
  });
});

describe("brand_preflight img logo detection (#43)", () => {
  it("recognizes an img wordmark by filename", async () => {
    const checks = await preflightChecks(`
      <html><body>
        <p>Fixture Brand welcomes you</p>
        <img src="assets/acme-wordmark.svg" alt="">
      </body></html>
    `);
    const lPresent = getCheck(checks, "L-PRESENT");
    expect(lPresent.status).toBe("pass");
    expect(lPresent.message).toContain("logo element");
  });

  it("recognizes an img whose alt matches client_name", async () => {
    const checks = await preflightChecks(`
      <html><body>
        <p>Fixture Brand welcomes you</p>
        <img src="header-image.png" alt="Fixture Brand">
      </body></html>
    `);
    const lPresent = getCheck(checks, "L-PRESENT");
    expect(lPresent.status).toBe("pass");
  });

  it("does not treat an unrelated img as logo evidence", async () => {
    const checks = await preflightChecks(`
      <html><body>
        <p>Fixture Brand welcomes you</p>
        <img src="team-photo.jpg" alt="our team at the offsite">
      </body></html>
    `);
    const lPresent = getCheck(checks, "L-PRESENT");
    expect(lPresent.status).toBe("warn");
  });
});
