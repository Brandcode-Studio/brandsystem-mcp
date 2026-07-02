import { describe, it, expect, beforeAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../../src/server.js";

// ---------------------------------------------------------------------------
// Standing tool-description quality gate.
//
// CLAUDE.md's "Tool Description Guidelines" section defines criteria for
// every tool description. This test enforces the mechanically-checkable
// subset of those criteria so new tools can't silently regress on them:
//
//   1. Starts with a capitalized verb.
//   2. First sentence (up to the first period) is under 300 characters.
//   3. A small, explicit allowlist of known ambiguous tool-name pairs
//      cross-reference each other with "NOT for ..." disambiguation
//      language.
//
// This does NOT attempt full English grammar/part-of-speech tagging, and it
// does NOT try to auto-detect ambiguous pairs — both are explicitly out of
// scope (see CLAUDE.md and the originating plan). The verb list below was
// calibrated against every description actually shipping today (see
// `grep -A 1 'server.tool(' src/tools/*.ts`), plus two known intentional
// exceptions that use a "label — call this when..." construction from the
// prior "Tool descriptions sharpened across 6 tools" pass documented in
// CHANGELOG.md.
// ---------------------------------------------------------------------------

// Same in-memory client/server setup pattern as test/tools/smoke.test.ts.
let client: Client;
// Registration doesn't change within a run, so every test below shares one
// listTools() result instead of re-issuing the same RPC call.
let tools: Awaited<ReturnType<Client["listTools"]>>["tools"];

beforeAll(async () => {
  const server = createServer();
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();

  client = new Client({ name: "description-quality-test-client", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  ({ tools } = await client.listTools());
});

const MAX_FIRST_SENTENCE_CHARS = 300;

/**
 * Verbs actually observed leading a shipping tool description, generously
 * extended with close synonyms so legitimate future tools don't trip a
 * false positive. Intentionally broad rather than a strict linguistic verb
 * list — the goal is to catch descriptions that clearly don't open with an
 * action word (nouns, articles, "The...", "A...", etc.), not to adjudicate
 * fine-grained grammar.
 */
const KNOWN_LEADING_VERBS = new Set([
  "extract", "generate", "check", "define", "build", "batch", "validate",
  "compile", "resolve", "audit", "scan", "initialize", "init", "add",
  "create", "activate", "connect", "enable", "inspect", "sync", "take",
  "bundle", "screenshot", "send", "review", "update", "read", "write",
  "publish", "score", "run", "load", "fetch", "parse", "detect", "compare",
  "merge", "split", "render", "export", "import", "convert", "apply",
  "record", "capture", "assess", "evaluate", "verify", "compute",
  "discover", "sample", "toggle", "enrich", "diff", "gate", "lint",
  "preview", "start", "stop", "refresh", "clarify", "deepen", "ingest",
]);

/**
 * Tool descriptions where the very first word is an adverb modifying a verb
 * that immediately follows (e.g. "Deeply extract ..."). Treated as passing
 * the verb-start check as long as the second word is a known verb.
 */
function startsWithAdverbThenVerb(words: string[]): boolean {
  if (words.length < 2) return false;
  const second = words[1].toLowerCase().replace(/[^a-z]/g, "");
  return KNOWN_LEADING_VERBS.has(second);
}

/**
 * Two tools from the prior hand-reviewed "Tool descriptions sharpened"
 * pass (see CHANGELOG.md "Unreleased" section) intentionally open with a
 * "Label — call this when ..." construction instead of a bare verb
 * ("Inline brand linter — call this WHILE writing ...", "Publish-time
 * brand gate — single PASS/FAIL verdict ..."). Both function as a verb
 * phrase in effect (an implied "This is the ...") and were a deliberate,
 * reviewed choice, not a regression. Carved out explicitly rather than
 * loosened generally so the verb check stays meaningful for every other
 * tool.
 */
const LABEL_STYLE_EXCEPTIONS = new Set(["brand_check", "brand_check_compliance"]);

function firstWord(description: string): string {
  return description.trim().split(/\s+/)[0] ?? "";
}

function startsWithCapitalizedVerb(name: string, description: string): boolean {
  if (LABEL_STYLE_EXCEPTIONS.has(name)) return true;

  const words = description.trim().split(/\s+/);
  const first = words[0] ?? "";
  if (!/^[A-Z]/.test(first)) return false;

  const bareWord = first.replace(/[^A-Za-z]/g, "");
  if (KNOWN_LEADING_VERBS.has(bareWord.toLowerCase())) return true;

  // Allow "Adverb Verb ..." (e.g. "Deeply extract ...").
  return startsWithAdverbThenVerb(words);
}

function firstSentence(description: string): string {
  const idx = description.indexOf(".");
  return idx === -1 ? description : description.slice(0, idx);
}

// ---------------------------------------------------------------------------
// Explicit allowlist of known ambiguous tool-name pairs (Part 5b scope).
//
// This is NOT a general ambiguous-pair detector — that's explicitly out of
// scope. Only these two curated pairs are checked. Add a pair here only
// after confirming (by reading both tools) that they are genuinely
// confusable by name.
// ---------------------------------------------------------------------------

const AMBIGUOUS_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["brand_extract_web", "brand_extract_site"],
  ["brand_check", "brand_check_compliance"],
];

/** Matches "NOT for ... — use X" / "NOT ... — use X" style disambiguation. */
function hasNotForCrossReference(description: string, otherToolName: string): boolean {
  const notForPattern = /not\s+(?:a\s+|for\s+)?[^.]*?\buse\s+/i;
  if (!notForPattern.test(description)) return false;
  return description.includes(otherToolName);
}

describe("tool description quality", () => {
  it("every tool description starts with a capitalized verb", () => {
    const failures: string[] = [];
    for (const tool of tools) {
      const description = tool.description ?? "";
      if (!startsWithCapitalizedVerb(tool.name, description)) {
        failures.push(`${tool.name}: starts with "${firstWord(description)}"`);
      }
    }
    expect(failures, `Tools failing verb-start check:\n${failures.join("\n")}`).toEqual([]);
  });

  it("every tool description's first sentence is under 300 characters", () => {
    const failures: string[] = [];
    for (const tool of tools) {
      const description = tool.description ?? "";
      const sentence = firstSentence(description);
      if (sentence.length >= MAX_FIRST_SENTENCE_CHARS) {
        failures.push(`${tool.name}: first sentence is ${sentence.length} chars`);
      }
    }
    expect(failures, `Tools with an overlong first sentence:\n${failures.join("\n")}`).toEqual([]);
  });

  describe.each(AMBIGUOUS_PAIRS)("ambiguous pair: %s / %s", (toolA, toolB) => {
    it(`${toolA} disambiguates against ${toolB}`, () => {
      const tool = tools.find((t) => t.name === toolA);
      expect(tool, `${toolA} is not registered`).toBeDefined();
      const description = tool!.description ?? "";
      expect(
        hasNotForCrossReference(description, toolB),
        `${toolA}'s description does not contain a "NOT for ... use ${toolB}" cross-reference:\n${description}`,
      ).toBe(true);
    });

    it(`${toolB} disambiguates against ${toolA}`, () => {
      const tool = tools.find((t) => t.name === toolB);
      expect(tool, `${toolB} is not registered`).toBeDefined();
      const description = tool!.description ?? "";
      expect(
        hasNotForCrossReference(description, toolA),
        `${toolB}'s description does not contain a "NOT for ... use ${toolA}" cross-reference:\n${description}`,
      ).toBe(true);
    });
  });
});
