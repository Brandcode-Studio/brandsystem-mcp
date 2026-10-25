/**
 * Bounds on nesting depth and element count for untrusted HTML/SVG, enforced
 * before any recursive or superlinear code (cheerio selectors, dom-serializer)
 * touches the tree.
 *
 * Why: parse5 (cheerio's HTML parser) and htmlparser2 (its XML parser) both
 * cost O(open-element depth) per tag, cheerio's descendant selectors walk
 * ancestors per candidate, and dom-serializer recurses per level. A 5 MB page
 * of nested tags can block the stdio event loop for many seconds or overflow
 * the stack.
 *
 * HTML (loadHtmlBounded): parse5 is driven through a tree adapter that
 * observes its *actual* open-element stack and element creation, so the
 * bound is exact — no re-implementation of HTML tree construction. When a
 * cap is crossed the parse is aborted and the document re-parsed up to the
 * start of the offending tag, so callers still get the (bounded) prefix,
 * which is where headers, logos, and <head> metadata live.
 *
 * XML/SVG (boundXmlMarkup): htmlparser2's xmlMode has no implied tags, so a
 * one-pass tokenizer mirrors its stack exactly and truncates the markup at
 * the first over-cap start tag.
 */
import * as cheerio from "cheerio";
import { adapter as htmlparser2Adapter } from "parse5-htmlparser2-tree-adapter";

/**
 * Maximum element nesting depth for HTML. Real pages nest a few dozen levels
 * (Blink's own parser flattens beyond 512). parse5's per-tag scope checks are
 * O(depth), so worst-case parse work is roughly depth x element cap; 256
 * keeps a maximally hostile document under ~0.5s while leaving ample
 * headroom for real markup.
 */
export const MAX_HTML_DEPTH = 256;
/** Maximum elements parse5 may create for one document. */
export const MAX_HTML_ELEMENTS = 200_000;

export interface BoundedLoadResult {
  $: cheerio.CheerioAPI;
  /** True when the document was cut short to stay within the caps. */
  truncated: boolean;
  reason?: "depth" | "elements";
  /** Character offset at which the input was cut (only when truncated). */
  truncatedAt?: number;
}

class MarkupLimitError extends Error {
  constructor(
    readonly reason: "depth" | "elements",
    readonly cutAt: number,
  ) {
    super(`markup exceeds ${reason} limit`);
    this.name = "MarkupLimitError";
  }
}

type Adapter = typeof htmlparser2Adapter;

/**
 * Parse untrusted HTML with cheerio/parse5 under depth and element caps.
 * Never throws for over-cap input: it returns the parsed in-bounds prefix
 * with `truncated: true`.
 */
export function loadHtmlBounded(
  html: string,
  options: { maxDepth?: number; maxElements?: number } = {},
): BoundedLoadResult {
  const maxDepth = options.maxDepth ?? MAX_HTML_DEPTH;
  const maxElements = options.maxElements ?? MAX_HTML_ELEMENTS;

  let reason: "depth" | "elements" | undefined;
  // Cheap pre-cut: every start tag begins with "<" + ASCII letter, so the
  // (maxElements+1)-th such sequence is a safe place to stop. This avoids a
  // wasted full parse for oversized-but-shallow documents; the adapter below
  // still enforces the exact cap (implicit and reconstructed elements).
  let input = html;
  const cut = nthStartTagOffset(html, maxElements + 1);
  if (cut !== -1) {
    input = html.slice(0, cut);
    reason = "elements";
  }
  // Each retry parses a strictly shorter prefix that ends before the tag
  // that crossed the cap; parse5 is deterministic left-to-right, so the
  // prefix stays in bounds. The attempt cap is a belt-and-braces stop.
  for (let attempt = 0; attempt < 4; attempt++) {
    let depth = 0;
    let elements = 0;
    let lastStart = 0;
    const treeAdapter: Adapter = {
      ...htmlparser2Adapter,
      createElement(tagName, namespaceURI, attrs) {
        elements++;
        if (elements > maxElements) throw new MarkupLimitError("elements", lastStart);
        return htmlparser2Adapter.createElement(tagName, namespaceURI, attrs);
      },
      onItemPush(item) {
        // parse5's open-element stack mirrors the tree path from <html> to
        // the insertion point, so its size is the nesting depth.
        depth++;
        if (depth > maxDepth) throw new MarkupLimitError("depth", lastStart);
        htmlparser2Adapter.onItemPush?.(item);
      },
      onItemPop(item, newTop) {
        depth--;
        htmlparser2Adapter.onItemPop?.(item, newTop);
      },
      // Locations are tracked only to know where to cut; nothing is stored on
      // the nodes, so memory use is unchanged.
      setNodeSourceCodeLocation(_node, location) {
        const start = location?.startOffset;
        if (typeof start === "number" && start > lastStart) lastStart = start;
      },
      updateNodeSourceCodeLocation() {},
      getNodeSourceCodeLocation() {
        return undefined;
      },
    };

    try {
      const $ = cheerio.load(input, { treeAdapter, sourceCodeLocationInfo: true });
      // The stack bound caps parse cost, but a few tree-construction steps
      // (e.g. </form> removing a non-current node) let the tree nest deeper
      // than the stack. Prune anything below maxDepth so recursive consumers
      // (selectors, serializers) never see it.
      if (pruneBelowDepth($.root()[0] as unknown as DomNode, maxDepth)) reason ??= "depth";
      return reason
        ? { $, truncated: true, reason, truncatedAt: input.length }
        : { $, truncated: false };
    } catch (error) {
      if (!(error instanceof MarkupLimitError)) throw error;
      reason ??= error.reason;
      input = input.slice(0, Math.min(error.cutAt, input.length - 1));
    }
  }
  return { $: cheerio.load(""), truncated: true, reason, truncatedAt: 0 };
}

/** Offset of the n-th "<" immediately followed by an ASCII letter, or -1. */
function nthStartTagOffset(input: string, n: number): number {
  let seen = 0;
  let i = input.indexOf("<");
  while (i !== -1) {
    const c = input.charCodeAt(i + 1);
    if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122)) {
      seen++;
      if (seen === n) return i;
    }
    i = input.indexOf("<", i + 1);
  }
  return -1;
}

type DomNode = { type: string; children?: DomNode[]; prev?: DomNode | null; next?: DomNode | null };

function isElement(node: DomNode): boolean {
  return node.type === "tag" || node.type === "script" || node.type === "style";
}

/**
 * Iteratively drop the children of every element at `maxDepth`, so no
 * element sits deeper than the cap. Returns true when anything was pruned.
 */
function pruneBelowDepth(root: DomNode, maxDepth: number): boolean {
  let pruned = false;
  const stack: Array<[DomNode, number]> = [[root, 0]];
  while (stack.length > 0) {
    const [node, depth] = stack.pop()!;
    const children = node.children;
    if (!children || children.length === 0) continue;
    // Only the document and elements have children; theirs sit one level down.
    const childDepth = depth + 1;
    if (childDepth > maxDepth && children.some(isElement)) {
      const kept = children.filter((c) => !isElement(c));
      for (let k = 0; k < kept.length; k++) {
        kept[k].prev = kept[k - 1] ?? null;
        kept[k].next = kept[k + 1] ?? null;
      }
      node.children = kept;
      pruned = true;
      continue;
    }
    for (const child of children) stack.push([child, childDepth]);
  }
  return pruned;
}

// ── XML / SVG ───────────────────────────────────────────────────────────────

export interface MarkupBoundResult {
  /** The input, or its prefix up to (not including) the first over-cap tag. */
  markup: string;
  truncated: boolean;
  reason?: "depth" | "elements";
  /** Offset at which the input was cut (only when truncated). */
  truncatedAt?: number;
  /** Highest nesting depth observed in the kept markup. */
  maxDepthSeen: number;
  /** Start tags counted in the kept markup. */
  elementCount: number;
}

function isWhitespace(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 12 || code === 13;
}

/**
 * One linear pass over XML/SVG text mirroring htmlparser2's xmlMode stack
 * (no implied tags; `/>` self-closes; an end tag pops to its last matching
 * open element, or is ignored). Returns the input, or its prefix ending just
 * before the first start tag that would exceed `maxDepth` or `maxElements`.
 */
export function boundXmlMarkup(
  input: string,
  options: { maxDepth: number; maxElements: number },
): MarkupBoundResult {
  const { maxDepth, maxElements } = options;
  const len = input.length;
  const names: string[] = [];
  const counts = new Map<string, number>();
  let maxDepthSeen = 0;
  let elementCount = 0;

  const truncate = (at: number, reason: "depth" | "elements"): MarkupBoundResult => ({
    markup: input.slice(0, at),
    truncated: true,
    reason,
    truncatedAt: at,
    maxDepthSeen,
    elementCount,
  });

  let i = 0;
  while (i < len) {
    const lt = input.indexOf("<", i);
    if (lt === -1) break;
    i = lt;
    const next = input.charCodeAt(i + 1);

    if (next === 33 /* ! */) {
      if (input.startsWith("<!--", i)) {
        const end = input.indexOf("-->", i + 4);
        if (end === -1) break;
        i = end + 3;
      } else if (input.startsWith("<![CDATA[", i)) {
        const end = input.indexOf("]]>", i + 9);
        if (end === -1) break;
        i = end + 3;
      } else {
        const gt = input.indexOf(">", i + 2);
        if (gt === -1) break;
        i = gt + 1;
      }
      continue;
    }
    if (next === 63 /* ? */) {
      const gt = input.indexOf(">", i + 2);
      if (gt === -1) break;
      i = gt + 1;
      continue;
    }

    const isEnd = next === 47; /* / */
    let j = isEnd ? i + 2 : i + 1;
    const nameStart = j;
    while (j < len) {
      const c = input.charCodeAt(j);
      if (isWhitespace(c) || c === 47 || c === 62) break;
      j++;
    }
    if (j === nameStart) {
      i += 1;
      continue;
    }
    const name = input.slice(nameStart, j);

    // Attributes up to the closing '>' (quote-aware)
    let selfClosing = false;
    let closed = false;
    while (j < len) {
      const c = input.charCodeAt(j);
      if (c === 62) { closed = true; j++; break; }
      if (c === 34 || c === 39) {
        const endQ = input.indexOf(c === 34 ? '"' : "'", j + 1);
        if (endQ === -1) { j = len; break; }
        j = endQ + 1;
        continue;
      }
      if (c === 47 && input.charCodeAt(j + 1) === 62) { selfClosing = true; closed = true; j += 2; break; }
      j++;
    }
    if (!closed) break;

    const tagStart = i;
    i = j;

    if (isEnd) {
      if ((counts.get(name) ?? 0) > 0) {
        // Amortized linear: every step of the search pops an element.
        while (names.length > 0) {
          const popped = names.pop()!;
          const c = counts.get(popped)! - 1;
          if (c === 0) counts.delete(popped);
          else counts.set(popped, c);
          if (popped === name) break;
        }
      }
      continue;
    }

    elementCount++;
    if (elementCount > maxElements) {
      elementCount--;
      return truncate(tagStart, "elements");
    }
    if (selfClosing) {
      if (names.length + 1 > maxDepth) return truncate(tagStart, "depth");
      continue;
    }
    names.push(name);
    counts.set(name, (counts.get(name) ?? 0) + 1);
    if (names.length > maxDepth) return truncate(tagStart, "depth");
    if (names.length > maxDepthSeen) maxDepthSeen = names.length;
  }

  return { markup: input, truncated: false, maxDepthSeen, elementCount };
}
