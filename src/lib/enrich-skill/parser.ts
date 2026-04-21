/**
 * SKILL.md parser for the Brandcode Enricher.
 *
 * Ported from UCS `brand-os/lib/skill-parser.mjs` with TypeScript types.
 * Kept intentionally standalone — no framework dependencies, zero allocations
 * in hot paths. The MCP tool vendors this rather than taking a cross-repo
 * dependency on the UCS tree.
 *
 * Shape: accepts raw SKILL.md (string), returns `{ frontmatter, preamble,
 * sections, trailing, raw, frontmatterEnd }`. Sections preserve their raw text
 * so the enricher can append in-place without re-parsing.
 */

export interface ParsedFrontmatter extends Record<string, string | undefined> {
  __raw?: string;
}

export interface ParsedSection {
  heading: string;
  slug: string;
  level: 2 | 3;
  content: string;
  raw: string;
  startLine: number;
  endLine: number;
}

export interface ParsedSkill {
  frontmatter: ParsedFrontmatter | null;
  preamble: string;
  sections: ParsedSection[];
  trailing: string;
  raw: string;
  frontmatterEnd: number;
}

const FRONTMATTER_DELIM = /^---\s*$/;

/**
 * Parse SKILL.md into structured frontmatter + sections.
 */
export function parseSkillMd(md: string): ParsedSkill {
  const raw = md;
  const lines = md.split("\n");
  let cursor = 0;

  // Frontmatter
  let frontmatter: ParsedFrontmatter | null = null;
  let frontmatterEnd = -1;
  if (lines[0] && FRONTMATTER_DELIM.test(lines[0])) {
    for (let i = 1; i < lines.length; i++) {
      if (FRONTMATTER_DELIM.test(lines[i])) {
        frontmatter = parseFrontmatter(lines.slice(1, i).join("\n"));
        frontmatterEnd = i;
        cursor = i + 1;
        break;
      }
    }
  }

  const sections: ParsedSection[] = [];
  const preambleLines: string[] = [];
  type Current = {
    heading: string;
    slug: string;
    level: 2 | 3;
    startLine: number;
    headingLine: string;
    contentLines: string[];
  };
  let current: Current | null = null;

  const finish = (c: Current, endLine: number): ParsedSection => ({
    heading: c.heading,
    slug: c.slug,
    level: c.level,
    startLine: c.startLine,
    endLine,
    content: c.contentLines.join("\n").trim(),
    raw: [c.headingLine, ...c.contentLines].join("\n"),
  });

  for (let i = cursor; i < lines.length; i++) {
    const line = lines[i];
    const h2 = line.match(/^##\s+(.+?)\s*$/);
    const h3 = line.match(/^###\s+(.+?)\s*$/);
    if (h2 || h3) {
      if (current) sections.push(finish(current, i - 1));
      const heading = ((h2 ? h2[1] : h3![1]) as string).trim();
      current = {
        heading,
        slug: slugifyHeading(heading),
        level: h2 ? 2 : 3,
        startLine: i,
        headingLine: line,
        contentLines: [],
      };
      continue;
    }
    if (current) current.contentLines.push(line);
    else preambleLines.push(line);
  }
  if (current) sections.push(finish(current, lines.length - 1));

  return {
    frontmatter,
    preamble: preambleLines.join("\n").trim(),
    sections,
    trailing: "",
    raw,
    frontmatterEnd,
  };
}

/**
 * Serialize a parsed SKILL.md back to string. Round-trips for valid input
 * within whitespace tolerance.
 */
export function serializeSkillMd(parsed: ParsedSkill): string {
  const parts: string[] = [];
  if (parsed.frontmatter && parsed.frontmatter.__raw != null) {
    parts.push("---", parsed.frontmatter.__raw, "---", "");
  }
  if (parsed.preamble) parts.push(parsed.preamble, "");
  for (const section of parsed.sections) {
    const hashes = "#".repeat(section.level);
    parts.push(`${hashes} ${section.heading}`);
    if (section.content) parts.push("", section.content);
    parts.push("");
  }
  if (parsed.trailing) parts.push(parsed.trailing);
  return parts.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

export function slugifyHeading(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Permissive frontmatter parser — handles simple `key: value` and folded
 * block-scalar descriptions (`description: >-`). Preserves `__raw` so the
 * serializer can emit the original block verbatim.
 */
export function parseFrontmatter(yamlText: string): ParsedFrontmatter {
  const obj: ParsedFrontmatter = { __raw: yamlText };
  const lines = yamlText.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const m = line.match(/^([A-Za-z][\w-]*)\s*:\s*(.*)$/);
    if (!m) {
      i++;
      continue;
    }
    const key = m[1];
    const value = m[2].trim();
    if (value === ">-" || value === ">" || value === "|" || value === "|-") {
      const buf: string[] = [];
      i++;
      while (i < lines.length) {
        if (/^[A-Za-z][\w-]*\s*:/.test(lines[i]) || lines[i].trim() === "") {
          if (lines[i].trim() === "") {
            i++;
            continue;
          }
          break;
        }
        buf.push(lines[i].replace(/^\s+/, ""));
        i++;
      }
      obj[key] = buf.join(" ").trim();
      continue;
    }
    obj[key] = stripQuotes(value);
    i++;
  }
  return obj;
}

function stripQuotes(s: string): string {
  if (!s) return s;
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}
