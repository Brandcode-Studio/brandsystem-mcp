import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { CORE_TOOL_NAMES } from "../../src/lib/tool-profile.js";
import { buildResponse } from "../../src/lib/response.js";
import {
  FEEDBACK_OFFER_STEP,
  appendFeedbackOffer,
  detectFailureSignal,
} from "../../src/lib/failure-signals.js";

// brand_feedback writes to ~/.brandsystem/feedback (resolved at import time)
// and POSTs to brandcode.studio. Point HOME at a temp dir and stub fetch so
// this suite never touches the real home directory or the network.
const fakeHome = vi.hoisted(() => {
  const fs = process.getBuiltinModule("node:fs");
  const os = process.getBuiltinModule("node:os");
  const path = process.getBuiltinModule("node:path");
  return fs.mkdtempSync(path.join(os.tmpdir(), "feedback-home-"));
});
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return { ...actual, homedir: () => fakeHome };
});

const { createServer } = await import("../../src/server.js");

const ALIAS_BOMB = [
  "client_name: Reveal Test",
  "a: &a [x, x, x, x, x, x, x, x]",
  "b: &b [*a, *a, *a, *a, *a, *a, *a, *a]",
  "c: &c [*b, *b, *b, *b, *b, *b, *b, *b]",
  "d: &d [*c, *c, *c, *c, *c, *c, *c, *c]",
  "e: &e [*d, *d, *d, *d, *d, *d, *d, *d]",
  "f: &f [*e, *e, *e, *e, *e, *e, *e, *e]",
  "g: &g [*f, *f, *f, *f, *f, *f, *f, *f]",
].join("\n");

type Content = Array<{ type: string; text: string }>;

interface Session {
  client: Client;
  listChanged: () => number;
  close: () => Promise<void>;
}

async function connect(profile: "core" | "full"): Promise<Session> {
  const server = createServer({ profile });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "feedback-reveal-test", version: "0.0.0" });
  let changes = 0;
  client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
    changes++;
  });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return {
    client,
    listChanged: () => changes,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

async function toolNames(client: Client): Promise<string[]> {
  const { tools } = await client.listTools();
  return tools.map((t) => t.name).sort();
}

function nextSteps(result: { content: unknown; structuredContent?: unknown }): string[] {
  const text = JSON.parse((result.content as Content)[0].text);
  const structured = result.structuredContent as { _metadata: { next_steps: string[] } };
  // Text payload and structuredContent must stay in sync.
  expect(text._metadata.next_steps).toEqual(structured._metadata.next_steps);
  return structured._metadata.next_steps;
}

/** Let in-flight notifications reach the client. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 10));

let workDir: string;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "feedback-reveal-"));
  vi.spyOn(process, "cwd").mockReturnValue(workDir);
  fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await rm(workDir, { recursive: true, force: true });
});

afterAll(async () => {
  await rm(fakeHome, { recursive: true, force: true });
});

async function corruptBrandDir(): Promise<void> {
  await mkdir(join(workDir, ".brand"), { recursive: true });
  await writeFile(join(workDir, ".brand", "brand.config.yaml"), ALIAS_BOMB);
  await writeFile(join(workDir, ".brand", "core-identity.yaml"), ALIAS_BOMB);
}

describe("brand_feedback reveal after failures (core profile)", () => {
  it("starts with the 12 core tools and brand_feedback hidden", async () => {
    const s = await connect("core");
    try {
      const names = await toolNames(s.client);
      expect(names).toEqual([...CORE_TOOL_NAMES].sort());
      expect(names).toHaveLength(12);
      expect(names).not.toContain("brand_feedback");
      expect(s.listChanged()).toBe(0);
    } finally {
      await s.close();
    }
  });

  it("successful calls neither reveal brand_feedback nor add the feedback line", async () => {
    const s = await connect("core");
    try {
      const result = await s.client.callTool({ name: "brand_status", arguments: {} });
      expect(result.isError).toBeFalsy();
      expect(nextSteps(result as never)).not.toContain(FEEDBACK_OFFER_STEP);
      await flush();
      expect(s.listChanged()).toBe(0);
      expect(await toolNames(s.client)).not.toContain("brand_feedback");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      await s.close();
    }
  });

  it("an isError response emits list_changed, lists brand_feedback, and adds the offer line", async () => {
    await corruptBrandDir();
    const s = await connect("core");
    try {
      const result = await s.client.callTool({ name: "brand_status", arguments: {} });
      expect(result.isError).toBe(true);
      const steps = nextSteps(result as never);
      expect(steps).toContain(FEEDBACK_OFFER_STEP);
      // Exactly one feedback mention, and no "requires the full profile" note on it.
      expect(steps.filter((step) => step.includes("brand_feedback"))).toEqual([FEEDBACK_OFFER_STEP]);

      await flush();
      expect(s.listChanged()).toBeGreaterThanOrEqual(1);
      const names = await toolNames(s.client);
      expect(names).toContain("brand_feedback");
      expect(names).toHaveLength(13);
      // Only brand_feedback is revealed — the review/triage tools stay full-only.
      expect(names).not.toContain("brand_feedback_review");
      expect(names).not.toContain("brand_feedback_triage");

      // Revealing never sends anything by itself.
      expect(fetchMock).not.toHaveBeenCalled();

      // Calling it works once revealed, and is the only thing that sends.
      const fb = await s.client.callTool({
        name: "brand_feedback",
        arguments: { category: "bug", summary: "reveal test — please ignore" },
      });
      expect(fb.isError).toBeFalsy();
      const fbJson = JSON.parse((fb.content as Content)[0].text);
      expect(fbJson.feedbackId).toBeTruthy();
      expect(fbJson.remote_sent).toBe(true);
      expect(fetchMock).toHaveBeenCalled();
      const [url] = fetchMock.mock.calls[0] as [string];
      expect(url).toBe("https://www.brandcode.studio/api/feedback");
      expect(fbJson.stored_at.startsWith(fakeHome)).toBe(true);

      // Stays revealed; a second failure doesn't emit another change.
      const before = s.listChanged();
      await s.client.callTool({ name: "brand_status", arguments: {} });
      await flush();
      expect(s.listChanged()).toBe(before);
      expect(await toolNames(s.client)).toContain("brand_feedback");
    } finally {
      await s.close();
    }
  });

  it("brand_feedback cannot be called before it is revealed", async () => {
    const s = await connect("core");
    try {
      const result = await s.client.callTool({
        name: "brand_feedback",
        arguments: { category: "bug", summary: "should not send" },
      });
      expect(result.isError).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      await s.close();
    }
  });
});

describe("brand_feedback in the full profile", () => {
  it("is always listed and never toggled", async () => {
    await corruptBrandDir();
    const s = await connect("full");
    try {
      const before = await toolNames(s.client);
      expect(before).toContain("brand_feedback");
      expect(before).toContain("brand_feedback_review");
      const result = await s.client.callTool({ name: "brand_status", arguments: {} });
      expect(result.isError).toBe(true);
      expect(nextSteps(result as never)).toContain(FEEDBACK_OFFER_STEP);
      await flush();
      expect(s.listChanged()).toBe(0);
      expect(await toolNames(s.client)).toEqual(before);
    } finally {
      await s.close();
    }
  });
});

describe("detectFailureSignal", () => {
  const ok = (data: Record<string, unknown>) =>
    buildResponse({ what_happened: "ok", next_steps: ["next"], data });

  it("flags isError results", () => {
    expect(detectFailureSignal("brand_status", { ...ok({}), isError: true })).toBe("tool_error");
  });

  it("flags response_overflow", () => {
    const result = ok({ big: "x".repeat(60000) });
    expect(detectFailureSignal("brand_context", result)).toBe("response_overflow");
  });

  it("flags fetch/parse/render failure codes but not precondition or input errors", () => {
    expect(detectFailureSignal("brand_start", ok({ error: "auto_fetch_failed" }))).toBe("tool_failure_code");
    expect(detectFailureSignal("brand_extract_pdf", ok({ error: "fetch_failed" }))).toBe("tool_failure_code");
    expect(detectFailureSignal("brand_status", ok({ error: "not_initialized" }))).toBeNull();
    expect(detectFailureSignal("brand_check", ok({ error: "validation_failed" }))).toBeNull();
  });

  it("flags LOW extraction quality only", () => {
    expect(detectFailureSignal("brand_start", ok({ extraction_quality: { score: "LOW" } }))).toBe(
      "low_extraction_quality"
    );
    expect(detectFailureSignal("brand_extract_web", ok({ extraction_quality: { score: "MEDIUM" } }))).toBeNull();
    expect(detectFailureSignal("brand_extract_web", ok({ extraction_quality: { score: "HIGH" } }))).toBeNull();
  });

  it("flags a PDF extraction that found no colors and no typography", () => {
    const empty = ok({ success: true, extracted: { colors: [], typography: [] } });
    const some = ok({ success: true, extracted: { colors: [{ value: "#000" }], typography: [] } });
    expect(detectFailureSignal("brand_extract_pdf", empty)).toBe("empty_extraction");
    expect(detectFailureSignal("brand_extract_pdf", some)).toBeNull();
  });

  it("leaves normal success responses alone", () => {
    expect(detectFailureSignal("brand_status", ok({ status: "fine" }))).toBeNull();
  });
});

describe("appendFeedbackOffer", () => {
  it("replaces older brand_feedback mentions and keeps the text twin in sync", () => {
    const result = buildResponse({
      what_happened: "failed",
      next_steps: ["Retry", "If this keeps happening, run brand_feedback to report the issue."],
      data: { error: "fetch_failed" },
    });
    appendFeedbackOffer(result);
    const steps = (result.structuredContent._metadata as { next_steps: string[] }).next_steps;
    expect(steps).toEqual(["Retry", FEEDBACK_OFFER_STEP]);
    expect(JSON.parse(result.content[0].text)._metadata.next_steps).toEqual(steps);
  });

  it("states what is sent accurately and that nothing sends automatically", () => {
    expect(FEEDBACK_OFFER_STEP).toContain("brand_feedback");
    expect(FEEDBACK_OFFER_STEP).toContain("not your .brand/ files");
    expect(FEEDBACK_OFFER_STEP).toContain("nothing is sent unless you call it");
  });
});
