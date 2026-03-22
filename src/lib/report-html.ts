import type { CoreIdentity, BrandConfig, ClarificationItem } from "../types/index.js";
import { sanitizeSvg } from "./svg-resolver.js";

export interface ReportData {
  config: BrandConfig;
  identity: CoreIdentity;
  clarifications: ClarificationItem[];
  tokenCount: number;
  auditSummary: { pass: number; warn: number; fail: number };
}

/**
 * Generate a plain-text brand instruction block that can be pasted
 * into any AI tool's custom instructions / project context / system prompt.
 * Written as a directive to an AI, not a description for a human.
 */
export function generateBrandInstructions(config: BrandConfig, identity: CoreIdentity): string {
  const lines: string[] = [];

  lines.push(`# Brand Identity: ${config.client_name}`);
  lines.push("");
  lines.push(`Apply these guidelines to all visual output, code-generated artifacts, and design work for ${config.client_name}.`);

  // Logo
  const logoVariant = identity.logo[0]?.variants[0];
  if (logoVariant?.inline_svg) {
    lines.push("");
    lines.push("## Logo");
    lines.push("");
    lines.push(`IMPORTANT: Always use the SVG below for the ${config.client_name} logo. Never type the company name in a font — always embed this vector markup. For dark backgrounds, add fill="#ffffff" to override the path fills.`);
    lines.push("");
    lines.push("```svg");
    lines.push(logoVariant.inline_svg.trim());
    lines.push("```");
    if (logoVariant.data_uri) {
      lines.push("");
      lines.push("For `<img>` tags or contexts that don't support inline SVG, use this data URI as the src:");
      lines.push("");
      lines.push("```");
      lines.push(logoVariant.data_uri);
      lines.push("```");
    }
  }

  // Colors
  const namedColors = identity.colors.filter((c) => c.role !== "unknown" && c.confidence !== "low");
  const unknownColors = identity.colors.filter((c) => c.role === "unknown" && c.confidence !== "low");
  if (namedColors.length > 0 || unknownColors.length > 0) {
    lines.push("");
    lines.push("## Colors");
    lines.push("");
    lines.push("Use these exact hex values. Do not substitute approximate colors.");
    lines.push("");
    lines.push("| Role | Hex |");
    lines.push("|------|-----|");
    for (const c of namedColors) {
      lines.push(`| ${c.role} | ${c.value} |`);
    }
    for (const c of unknownColors) {
      lines.push(`| (unassigned) | ${c.value} |`);
    }
  }

  // Typography
  const fonts = identity.typography.filter((t) => t.confidence !== "low");
  if (fonts.length > 0) {
    lines.push("");
    lines.push("## Typography");
    lines.push("");
    for (const f of fonts) {
      lines.push(`- ${f.family}`);
    }
  }

  // Rules
  lines.push("");
  lines.push("## Rules");
  lines.push("");
  if (logoVariant?.inline_svg) {
    lines.push("- Never approximate the logo with text in a similar font — always use the SVG above");
  }
  lines.push("- Use exact hex values from the color table — no \"close enough\" substitutions");
  lines.push("- When generating HTML, CSS, or any visual code, reference these brand values directly");
  if (identity.colors.some((c) => c.role === "surface") && identity.colors.some((c) => c.role === "text")) {
    lines.push("- For dark-themed content, swap surface and text colors and invert the logo to white");
  }

  return lines.join("\n");
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function confidenceBadge(c: string): string {
  const cls: Record<string, string> = {
    confirmed: "badge-confirmed",
    high: "badge-high",
    medium: "badge-medium",
    low: "badge-low",
  };
  return `<span class="badge ${cls[c] || "badge-low"}">${c}</span>`;
}

function roleBadge(role: string): string {
  if (role === "unknown") return `<span class="badge badge-warn">needs role</span>`;
  return `<span class="badge badge-role">${role}</span>`;
}

/** Relative luminance for contrast detection */
function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => {
    const s = parseInt(h.substring(i, i + 2), 16) / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function buildColorCards(identity: CoreIdentity): string {
  return identity.colors
    .map((c) => {
      const isLight = luminance(c.value) > 0.7;
      return `
    <div class="color-card">
      <div class="color-swatch${isLight ? " is-light" : ""}" style="background:${c.value}"></div>
      <div class="color-info">
        <div class="color-role">${roleBadge(c.role)}</div>
        <div class="color-hex">${c.value}</div>
        <div class="color-meta">${confidenceBadge(c.confidence)} <span class="source">via ${c.source}</span></div>
      </div>
    </div>`;
    })
    .join("\n");
}

function buildFontCards(identity: CoreIdentity): string {
  return identity.typography
    .map(
      (t) => `
    <div class="font-card">
      <div class="font-specimen">${escapeHtml(t.family)}</div>
      <div class="font-meta">
        ${confidenceBadge(t.confidence)}
        <span class="source">via ${t.source}</span>
        ${t.weight ? `<span class="detail">weight ${t.weight}</span>` : ""}
      </div>
    </div>`
    )
    .join("\n");
}

function buildLogoSection(identity: CoreIdentity): string {
  if (identity.logo.length === 0) {
    return `
    <div class="empty-state">
      No logo detected. Add one via Figma extraction or manual upload.
    </div>`;
  }

  const blocks: string[] = [];
  for (const logo of identity.logo) {
    for (const variant of logo.variants) {
      const rawSvg = variant.inline_svg || "";
      if (!rawSvg) continue;
      const svgMarkup = sanitizeSvg(rawSvg);

      blocks.push(`
    <div class="logo-pair">
      <div class="logo-display logo-light">${svgMarkup}</div>
      <div class="logo-display logo-dark">${svgMarkup}</div>
    </div>
    <div class="logo-meta-row">
      <span>Type: ${logo.type}</span>
      <span>${confidenceBadge(logo.confidence)}</span>
      <span class="source">via ${logo.source}</span>
    </div>`);
    }
  }

  return blocks.join("\n") || `<div class="empty-state">Logo file found but no inline SVG available.</div>`;
}

let copyBlockCounter = 0;
function nextCopyId(): string {
  return `copy-ref-${++copyBlockCounter}`;
}

function buildUsageSection(identity: CoreIdentity): string {
  const parts: string[] = [];

  // Logo usage
  const logoVariant = identity.logo[0]?.variants[0];
  if (logoVariant?.inline_svg) {
    const svgId = nextCopyId();
    const uriId = nextCopyId();
    parts.push(`
    <div class="usage-block">
      <h3>Logo SVG</h3>
      <p>Never type the company name in a font. Always use this vector:</p>
      <div class="copy-wrap" id="${svgId}">
        <button class="copy-btn" onclick="copyBlock('${svgId}')">Copy</button>
        <pre><code>${escapeHtml(logoVariant.inline_svg.trim())}</code></pre>
      </div>
      ${logoVariant.data_uri ? `<h3>Logo Data URI</h3>
      <p>For &lt;img&gt; tags — use as src value:</p>
      <div class="copy-wrap compact" id="${uriId}">
        <button class="copy-btn" onclick="copyBlock('${uriId}')">Copy</button>
        <pre><code>${escapeHtml(logoVariant.data_uri)}</code></pre>
      </div>` : ""}
    </div>`);
  }

  // Color quick-ref
  const namedColors = identity.colors.filter((c) => c.role !== "unknown");
  if (namedColors.length > 0) {
    const colorLine = namedColors.map((c) => `${c.role}: ${c.value}`).join("  |  ");
    const colorId = nextCopyId();
    parts.push(`
    <div class="usage-block">
      <h3>Colors</h3>
      <div class="copy-wrap" id="${colorId}">
        <button class="copy-btn" onclick="copyBlock('${colorId}')">Copy</button>
        <pre><code>${escapeHtml(colorLine)}</code></pre>
      </div>
    </div>`);
  }

  // Font quick-ref
  const highConfFonts = identity.typography.filter((t) => t.confidence !== "low");
  if (highConfFonts.length > 0) {
    const fontLine = highConfFonts.map((t) => t.family).join(", ");
    const fontId = nextCopyId();
    parts.push(`
    <div class="usage-block">
      <h3>Fonts</h3>
      <div class="copy-wrap" id="${fontId}">
        <button class="copy-btn" onclick="copyBlock('${fontId}')">Copy</button>
        <pre><code>font-family: ${escapeHtml(fontLine)}</code></pre>
      </div>
    </div>`);
  }

  return parts.join("\n");
}

function buildComparisonSection(config: BrandConfig, identity: CoreIdentity): string {
  const hasLogo = identity.logo.length > 0 && identity.logo[0]?.variants[0]?.inline_svg;
  const primaryColor = identity.colors.find((c) => c.role === "primary");
  const colorCount = identity.colors.filter((c) => c.confidence !== "low").length;
  const brandFonts = identity.typography.filter((t) => t.confidence !== "low");
  const clientName = escapeHtml(config.client_name);

  return `
  <section>
    <h2>Your Brand vs. Generic AI</h2>
    <p style="font-size:13px;color:#8b8894;line-height:1.6;margin-bottom:16px">
      This is what your AI tools know now vs. what they&rsquo;d guess without a brand system.
    </p>
    <table class="comp-table">
      <thead><tr><th></th><th>With Your Brand System</th><th>Without It</th></tr></thead>
      <tbody>
        <tr>
          <td class="comp-label">Logo</td>
          <td class="comp-yours">${
            hasLogo
              ? `<div class="comp-logo-preview">${sanitizeSvg(identity.logo[0].variants[0].inline_svg || "")}</div><span>Embedded vector &mdash; renders everywhere, no files needed</span>`
              : `<span class="comp-missing">Not yet extracted &mdash; add via Figma or upload</span>`
          }</td>
          <td class="comp-generic">Would type &ldquo;${clientName}&rdquo; in a similar-looking font, or skip the logo entirely</td>
        </tr>
        <tr>
          <td class="comp-label">Colors</td>
          <td class="comp-yours">${
            primaryColor
              ? `<span class="comp-swatch" style="background:${primaryColor.value}"></span> ${primaryColor.value} (primary) + ${colorCount - 1} more &mdash; exact hex with roles`
              : colorCount > 0
                ? `${colorCount} colors extracted with hex values`
                : `<span class="comp-missing">Not yet extracted</span>`
          }</td>
          <td class="comp-generic">Would pick a blue primary or &ldquo;professional-looking&rdquo; defaults</td>
        </tr>
        <tr>
          <td class="comp-label">Fonts</td>
          <td class="comp-yours">${
            brandFonts.length > 0
              ? brandFonts.map((f) => f.family).join(", ") + " &mdash; from your actual CSS"
              : `<span class="comp-missing">Not yet extracted</span>`
          }</td>
          <td class="comp-generic">Would default to Inter, system-ui, or Arial</td>
        </tr>
        <tr>
          <td class="comp-label">Tokens</td>
          <td class="comp-yours">Machine-readable DTCG format &mdash; any tool can consume it</td>
          <td class="comp-generic">Would re-interpret a PDF or screenshot every time</td>
        </tr>
      </tbody>
    </table>
  </section>`;
}

function buildSessionProgression(): string {
  return `
  <section>
    <h2>Brand System Depth</h2>
    <p style="font-size:13px;color:#8b8894;line-height:1.6;margin-bottom:16px">
      Your brand system gets more powerful with each session.
    </p>
    <div class="session-track">
      <div class="session-item session-complete">
        <div class="session-marker">&check;</div>
        <div>
          <div class="session-name">Core Identity</div>
          <div class="session-desc">Colors, typography, logo, design tokens. The basics every AI tool needs.</div>
        </div>
      </div>
      <div class="session-item session-next">
        <div class="session-marker">2</div>
        <div>
          <div class="session-name">Full Visual Identity</div>
          <div class="session-desc">Composition rules, patterns, illustration language, anti-patterns, automated preflight. Makes output <em>recognizable</em>, not just color-correct.</div>
        </div>
      </div>
      <div class="session-item session-future">
        <div class="session-marker">3</div>
        <div>
          <div class="session-name">Brand Voice &amp; Messaging</div>
          <div class="session-desc">Voice profile, key messages, audience personas. Written content sounds like you, not like AI.</div>
        </div>
      </div>
      <div class="session-item session-future">
        <div class="session-marker">4</div>
        <div>
          <div class="session-name">Claims &amp; Evidence</div>
          <div class="session-desc">Proof points with confidence scores. What you can say, what needs qualification, what to never claim.</div>
        </div>
      </div>
      <div class="session-item session-future">
        <div class="session-marker">5</div>
        <div>
          <div class="session-name">Content Strategy</div>
          <div class="session-desc">Application rules by content type. Blog posts, social, email, case studies &mdash; each with its own governance.</div>
        </div>
      </div>
      <div class="session-item session-future">
        <div class="session-marker">6</div>
        <div>
          <div class="session-name">Full Operations</div>
          <div class="session-desc">Production engines, measurement loops, content library. The complete brand operating system.</div>
        </div>
      </div>
    </div>
  </section>`;
}

function buildClarifications(items: ClarificationItem[]): string {
  if (items.length === 0) return "";
  return `
  <section>
    <h2>Needs Clarification</h2>
    <div class="clarify-list">
      ${items
        .map(
          (item, i) => `
      <div class="clarify-card">
        <div class="clarify-num">${i + 1}</div>
        <div>
          <div class="clarify-q">${escapeHtml(item.question)}</div>
          <div class="clarify-field">${escapeHtml(item.field)} &bull; ${item.priority} priority</div>
        </div>
      </div>`
        )
        .join("\n")}
    </div>
  </section>`;
}

export function generateReportHTML(data: ReportData): string {
  copyBlockCounter = 0;
  const { config, identity, clarifications, tokenCount, auditSummary } = data;
  const overall = auditSummary.fail > 0 ? "FAIL" : auditSummary.warn > 0 ? "WARN" : "PASS";

  const brandInstructions = escapeHtml(generateBrandInstructions(config, identity));
  const clientName = escapeHtml(config.client_name);

  const mcpConfig = `{
  "mcpServers": {
    "brandsystem": {
      "command": "npx",
      "args": ["@brandsystem/mcp"]
    }
  }
}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${clientName} — Brand Identity Report</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Inter,system-ui,-apple-system,sans-serif;background:#0e0c10;color:#e8e6ea;max-width:720px;margin:0 auto;padding:40px 24px 64px}

.badge{display:inline-block;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;padding:3px 8px;border-radius:3px;vertical-align:middle}
.badge-confirmed{background:#1a3a2a;color:#34d399}
.badge-high{background:#1a3a2a;color:#4ade80}
.badge-medium{background:#1a1a3a;color:#818cf8}
.badge-low{background:#3a1a1a;color:#f87171}
.badge-warn{background:#3a2a0a;color:#fbbf24}
.badge-role{background:#1a2030;color:#7dd3fc;text-transform:capitalize}
.source{font-size:11px;color:#6b6876}
.detail{font-size:11px;color:#6b6876}

header{border-bottom:1px solid #2a2830;padding-bottom:28px;margin-bottom:40px}
.overline{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.14em;color:#6b6876;margin-bottom:6px}
h1{font-size:28px;font-weight:700;color:#fff;margin-bottom:4px}
.subtitle{font-size:14px;color:#8b8894}
.audit-line{margin-top:12px;font-size:13px;color:#8b8894}
.audit-line strong{color:#4ade80}

section{margin-bottom:48px}
h2{font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.1em;color:#6b6876;margin-bottom:16px;padding-bottom:6px;border-bottom:1px solid #2a2830}

.logo-pair{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:8px}
.logo-display{border-radius:10px;padding:36px;display:flex;align-items:center;justify-content:center}
.logo-display svg{width:100%;max-width:280px;height:auto}
.logo-light{background:#fff}
.logo-dark{background:#1a171a}
.logo-dark svg path,.logo-dark svg polygon,.logo-dark svg rect,.logo-dark svg circle{fill:#fff !important}
.logo-meta-row{display:flex;gap:12px;align-items:center;font-size:12px;color:#6b6876;margin-bottom:8px}

.color-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px}
.color-card{border-radius:10px;overflow:hidden;background:#1a1820;border:1px solid #2a2830}
.color-swatch{height:64px}
.color-swatch.is-light{border-bottom:1px solid #2a2830}
.color-info{padding:10px 12px}
.color-role{margin-bottom:2px}
.color-hex{font-size:13px;font-family:'SF Mono',ui-monospace,monospace;color:#a0a0a0;margin-bottom:4px}
.color-meta{display:flex;gap:6px;align-items:center;flex-wrap:wrap}

.font-list{display:flex;flex-direction:column;gap:12px}
.font-card{background:#1a1820;border:1px solid #2a2830;border-radius:10px;padding:20px}
.font-specimen{font-size:22px;font-weight:600;color:#fff;margin-bottom:6px}
.font-meta{display:flex;gap:8px;align-items:center}

.usage-block{margin-bottom:24px}
.usage-block h3{font-size:14px;font-weight:600;color:#c8c6ca;margin-bottom:8px}
.usage-block p{font-size:13px;color:#8b8894;line-height:1.6;margin-bottom:8px}

.clarify-list{display:flex;flex-direction:column;gap:10px}
.clarify-card{background:#1a1820;border:1px solid #2a2830;border-radius:8px;padding:14px 16px;display:flex;gap:12px;align-items:flex-start}
.clarify-num{flex-shrink:0;width:22px;height:22px;background:#2a2830;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#8b8894}
.clarify-q{font-size:13px;color:#c8c6ca;line-height:1.5}
.clarify-field{font-size:11px;font-family:'SF Mono',ui-monospace,monospace;color:#6b6876;margin-top:4px}

.empty-state{background:#1a1820;border:1px dashed #2a2830;border-radius:10px;padding:32px;text-align:center;font-size:14px;color:#6b6876}

.portable-notice{background:#1a2030;border:1px solid #1a3a4a;border-radius:8px;padding:14px 16px;font-size:13px;color:#7dd3fc;line-height:1.6;margin-bottom:40px}
.portable-notice strong{color:#bae6fd}

/* Copyable code blocks */
.copy-wrap{position:relative;margin-bottom:12px}
.copy-wrap pre{background:#16141a;border:1px solid #2a2830;border-radius:8px;padding:14px 18px;padding-right:70px;overflow-x:auto;max-height:160px;overflow-y:auto}
.copy-wrap code{font-family:'SF Mono',ui-monospace,monospace;font-size:11px;color:#c4b5fd;white-space:pre-wrap;word-break:break-word;line-height:1.6}
.copy-wrap.compact code{font-size:9px;color:#818cf8}
.copy-btn{position:absolute;top:8px;right:8px;background:#2a2830;border:1px solid #3a3840;color:#a8a6ac;font-size:11px;font-weight:600;padding:5px 12px;border-radius:4px;cursor:pointer;transition:all .15s}
.copy-btn:hover{background:#3a3840;color:#e8e6ea}
.copy-btn.copied{background:#1a3a2a;border-color:#2a4a3a;color:#4ade80}

/* Platform tabs */
.tab-bar{display:flex;gap:4px;margin-bottom:0;overflow-x:auto}
.tab-btn{background:#1a1820;border:1px solid #2a2830;border-bottom:none;border-radius:8px 8px 0 0;padding:10px 16px;font-size:12px;font-weight:600;color:#6b6876;cursor:pointer;white-space:nowrap;transition:all .15s}
.tab-btn:hover{color:#a8a6ac;background:#1e1c24}
.tab-btn.active{background:#1a1820;color:#e8e6ea;border-color:#3a3840}
.tab-panel{display:none;background:#1a1820;border:1px solid #2a2830;border-radius:0 8px 8px 8px;padding:24px}
.tab-panel.active{display:block}
.tab-panel h3{font-size:14px;font-weight:600;color:#c8c6ca;margin-bottom:12px}
.tab-panel p,.tab-panel li{font-size:13px;color:#a8a6ac;line-height:1.7}
.tab-panel ol,.tab-panel ul{padding-left:20px;margin-bottom:16px}
.tab-panel li{margin-bottom:4px}
.tab-panel li strong{color:#c8c6ca}
.tab-panel .tip{background:#1a2030;border:1px solid #1a3a4a;border-radius:6px;padding:10px 14px;font-size:12px;color:#7dd3fc;line-height:1.5;margin-top:12px}
.tab-panel .tip strong{color:#bae6fd}
.tab-section-label{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:#6b6876;margin:16px 0 8px}

/* Fix section */
.fix-list{display:flex;flex-direction:column;gap:10px}
.fix-item{background:#1a1820;border:1px solid #2a2830;border-radius:8px;padding:14px 18px}
.fix-item strong{display:block;font-size:13px;color:#c8c6ca;margin-bottom:2px}
.fix-item span{font-size:12px;color:#6b6876;line-height:1.5}

/* Comparison table */
.comp-table{width:100%;border-collapse:collapse;font-size:13px}
.comp-table th{text-align:left;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:#6b6876;padding:8px 12px;border-bottom:1px solid #2a2830}
.comp-table td{padding:12px;border-bottom:1px solid #1e1c24;vertical-align:top;line-height:1.6}
.comp-label{font-weight:600;color:#c8c6ca;width:80px}
.comp-yours{color:#4ade80}
.comp-generic{color:#6b6876;font-style:italic}
.comp-swatch{display:inline-block;width:14px;height:14px;border-radius:3px;vertical-align:middle;margin-right:6px;border:1px solid #2a2830}
.comp-logo-preview{max-width:120px;margin-bottom:6px}
.comp-logo-preview svg{width:100%;height:auto}
.comp-missing{color:#fbbf24;font-style:normal}

/* Session progression */
.session-track{display:flex;flex-direction:column;gap:0}
.session-item{display:flex;gap:14px;align-items:flex-start;padding:14px 0;border-left:2px solid #2a2830;margin-left:11px;padding-left:22px;position:relative}
.session-item:last-child{border-left-color:transparent}
.session-marker{position:absolute;left:-12px;width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;background:#2a2830;color:#6b6876;flex-shrink:0}
.session-complete .session-marker{background:#1a3a2a;color:#4ade80}
.session-complete .session-name{color:#4ade80}
.session-next .session-marker{background:#1a2030;color:#7dd3fc;border:2px solid #3a5a7a}
.session-next .session-name{color:#7dd3fc}
.session-future .session-name{color:#6b6876}
.session-name{font-size:14px;font-weight:600;margin-bottom:2px}
.session-desc{font-size:12px;color:#6b6876;line-height:1.5}

footer{border-top:1px solid #2a2830;padding-top:20px;font-size:11px;color:#4a4856}
</style>
</head>
<body>

<header>
  <div class="overline">brandsystem.app &mdash; brand identity report</div>
  <h1>${clientName}</h1>
  <div class="subtitle">${config.website_url ? `Source: ${escapeHtml(config.website_url)}` : "Manual entry"}${config.industry ? ` &bull; ${escapeHtml(config.industry)}` : ""}</div>
  <div class="audit-line">
    Audit: <strong>${auditSummary.pass} pass</strong> &bull; ${auditSummary.warn} warn &bull; ${auditSummary.fail} fail
    &mdash; ${tokenCount} DTCG tokens &bull; ${clarifications.length} item${clarifications.length !== 1 ? "s" : ""} need clarification
  </div>
</header>

<div class="portable-notice">
  <strong>This document is portable.</strong> Upload it to any AI conversation and say
  &ldquo;Use this as my brand guidelines for all visual output.&rdquo;
  Logos are embedded as vectors &mdash; no external files needed.
</div>

${buildSessionProgression()}

<section>
  <h2>Logo</h2>
  ${buildLogoSection(identity)}
</section>

<section>
  <h2>Colors &mdash; ${identity.colors.length} extracted</h2>
  <div class="color-grid">
    ${buildColorCards(identity)}
  </div>
</section>

<section>
  <h2>Typography &mdash; ${identity.typography.length} font${identity.typography.length !== 1 ? "s" : ""}</h2>
  <div class="font-list">
    ${buildFontCards(identity)}
  </div>
</section>

<section>
  <h2>Quick Reference</h2>
  ${buildUsageSection(identity)}
</section>

${buildComparisonSection(config, identity)}

${buildClarifications(clarifications)}

<!-- USE YOUR BRAND — Platform Tabs -->
<section>
  <h2>Use Your Brand</h2>
  <div class="tab-bar">
    <button class="tab-btn active" data-tab="claude">Claude</button>
    <button class="tab-btn" data-tab="chatgpt">ChatGPT</button>
    <button class="tab-btn" data-tab="gemini">Gemini</button>
    <button class="tab-btn" data-tab="code">Coding Tools</button>
  </div>

  <!-- CLAUDE -->
  <div class="tab-panel active" id="tab-claude">
    <h3>Set up in Claude</h3>
    <ol>
      <li>Go to <strong>claude.ai</strong> and create a new <strong>Project</strong></li>
      <li>Open the project, then click <strong>Project knowledge</strong> in the sidebar</li>
      <li>Upload this HTML file as a knowledge source &mdash; Claude will read it directly</li>
      <li>In <strong>Project instructions</strong>, paste the prompt below</li>
    </ol>
    <div class="tab-section-label">Paste into Project Instructions</div>
    <div class="copy-wrap" id="copy-claude">
      <button class="copy-btn" onclick="copyBlock('copy-claude')">Copy</button>
      <pre><code>You have access to the ${clientName} brand identity report in this project's knowledge.

For ALL visual output — HTML artifacts, SVG graphics, diagrams, mockups — apply the brand:
- Use the exact SVG logo from the report. Never type the company name in a font.
- Use the exact hex color values. Primary is for CTAs and emphasis.
- Reference the brand fonts by name in CSS font-family declarations.
- For dark backgrounds, invert the logo fills to #ffffff.

When generating any visual artifact, load the brand report first and follow its color, typography, and logo specifications exactly.</code></pre>
    </div>
    <div class="tip">
      <strong>Pro tip:</strong> You can also create a <strong>Claude Skill</strong> that wraps these instructions,
      so you can invoke it from any project with a slash command. In your project, look for
      Skills in the sidebar to set one up.
    </div>
  </div>

  <!-- CHATGPT -->
  <div class="tab-panel" id="tab-chatgpt">
    <h3>Set up in ChatGPT</h3>
    <ol>
      <li>Go to <strong>Explore GPTs</strong> &rarr; <strong>Create</strong></li>
      <li>Name it <strong>&ldquo;${clientName} Brand Assistant&rdquo;</strong></li>
      <li>Upload this HTML file under <strong>Knowledge</strong></li>
      <li>Paste the prompt below into <strong>Instructions</strong></li>
      <li>Save &mdash; now you have a branded GPT</li>
    </ol>
    <div class="tab-section-label">Paste into GPT Instructions</div>
    <div class="copy-wrap" id="copy-chatgpt">
      <button class="copy-btn" onclick="copyBlock('copy-chatgpt')">Copy</button>
      <pre><code>You are the ${clientName} brand assistant. You have the brand identity report in your knowledge base.

For ALL visual output — HTML, SVG, code, mockups — you MUST:
- Use the exact SVG logo from the brand report. Never type "${clientName}" in a font.
- Use the exact hex colors from the report. Do not approximate.
- Use the brand font names in CSS font-family.
- For dark backgrounds, set logo path fills to #ffffff.

Before generating any visual content, reference the brand report and apply its specifications.</code></pre>
    </div>
    <div class="tip">
      <strong>Alternative:</strong> Go to <strong>Settings &rarr; Personalization &rarr; Custom Instructions</strong>
      to apply your brand across all conversations (character limit is tighter &mdash; skip the logo SVG and
      focus on colors + fonts).
    </div>
  </div>

  <!-- GEMINI -->
  <div class="tab-panel" id="tab-gemini">
    <h3>Set up in Gemini</h3>
    <ol>
      <li>Open <strong>Gemini</strong> and click <strong>Gem manager</strong> &rarr; <strong>New Gem</strong></li>
      <li>Name it <strong>&ldquo;${clientName} Brand&rdquo;</strong></li>
      <li>Paste the prompt below into the Gem&rsquo;s instructions</li>
      <li>Upload this HTML file if the Gem supports file attachments</li>
      <li>Save the Gem</li>
    </ol>
    <div class="tab-section-label">Paste into Gem Instructions</div>
    <div class="copy-wrap" id="copy-gemini">
      <button class="copy-btn" onclick="copyBlock('copy-gemini')">Copy</button>
      <pre><code>You are a brand-compliant design assistant for ${clientName}.

Apply these brand specifications to all visual output:

${brandInstructions}</code></pre>
    </div>
  </div>

  <!-- CODING TOOLS -->
  <div class="tab-panel" id="tab-code">
    <h3>Set up in your coding tool</h3>
    <p style="margin-bottom:16px">
      For production-grade brand compliance, install the <strong>brandsystem MCP server</strong>.
      It gives your coding tool direct access to your brand identity &mdash; logo vectors, exact colors,
      font families &mdash; at the moment of creation.
    </p>

    <div class="tab-section-label">Step 1 &mdash; Add the MCP server</div>
    <div class="copy-wrap" id="copy-mcp">
      <button class="copy-btn" onclick="copyBlock('copy-mcp')">Copy</button>
      <pre><code>${escapeHtml(mcpConfig)}</code></pre>
    </div>
    <ul style="margin-bottom:16px">
      <li><strong>Claude Code</strong> &mdash; save as <code>.mcp.json</code> in your project root</li>
      <li><strong>Cursor</strong> &mdash; save as <code>.cursor/mcp.json</code></li>
      <li><strong>Windsurf</strong> &mdash; add to Windsurf MCP settings</li>
    </ul>

    <div class="tab-section-label">Step 2 &mdash; Upload this report + paste the prompt</div>
    <p>Upload this HTML file to your project, restart your editor, then paste:</p>
    <div class="copy-wrap" id="copy-code-prompt">
      <button class="copy-btn" onclick="copyBlock('copy-code-prompt')">Copy</button>
      <pre><code>I've uploaded my brand identity report (brand-report.html) from brandsystem.app. The basic brand extraction (colors, fonts, logo) is already done — this report has everything from the initial web scan.

Before we start, check if the brandsystem MCP server is available by looking for brand_status in your tools. If it's not there, help me install it:
- For Claude Code: create a .mcp.json file in the project root with the brandsystem server config (command: "npx", args: ["@brandsystem/mcp"])
- For Cursor: create .cursor/mcp.json with the same config
- Then restart so the MCP loads

Once the MCP is available:
1. Run brand_init with client name "${clientName}"${config.website_url ? ` and website "${escapeHtml(config.website_url)}"` : ""}
2. Import the existing identity from the uploaded brand report — don't re-scan the website, the basics are already captured
3. Then let's go deeper — Figma extraction for higher-accuracy colors, the full logo set, and typography weights</code></pre>
    </div>

    <div class="tip">
      <strong>What this unlocks:</strong> The MCP server gives your coding tool direct access to your brand
      identity at the moment of creation. It supports Figma extraction (higher accuracy than web),
      design token compilation (DTCG format), brand auditing, and preflight checks.
      No more copy-pasting hex values &mdash; the brand is just <em>there</em>.
    </div>

    <div class="tip" style="margin-top:8px">
      <strong>Alternative:</strong> Skip the MCP and just upload this HTML file to your project. Add this to
      your <code>CLAUDE.md</code>, <code>.cursorrules</code>, or project rules:
    </div>
    <div class="copy-wrap" id="copy-rules-line" style="margin-top:8px">
      <button class="copy-btn" onclick="copyBlock('copy-rules-line')">Copy</button>
      <pre><code>Use the brand identity in brand-report.html for all visual output. Use the inline SVG for the logo — never type the company name in a font. Use exact hex values from the report for all colors.</code></pre>
    </div>
  </div>
</section>

<!-- SOMETHING LOOK WRONG? -->
<section>
  <h2>Something Look Wrong?</h2>
  <p style="font-size:13px;color:#8b8894;line-height:1.6;margin-bottom:20px">
    Go back to your AI chat and paste one of these prompts to fix what&rsquo;s off.
  </p>
  <div class="fix-list">

    <div class="fix-item">
      <strong>Connect to Figma</strong>
      <span>Extract logo, colors, and typography directly from your design file (highest accuracy)</span>
      <div class="copy-wrap" id="copy-fix-figma" style="margin-top:10px">
        <button class="copy-btn" onclick="copyBlock('copy-fix-figma')">Copy</button>
        <pre><code>I have a Figma file with my brand's design system. Can you walk me through connecting to it to extract our exact colors, typography, and logo? The web extraction got close but I need higher accuracy from the source design file.</code></pre>
      </div>
    </div>

    <div class="fix-item">
      <strong>Upload brand guidelines</strong>
      <span>Share your brand guidelines PDF or document for accurate extraction</span>
      <div class="copy-wrap" id="copy-fix-guidelines" style="margin-top:10px">
        <button class="copy-btn" onclick="copyBlock('copy-fix-guidelines')">Copy</button>
        <pre><code>I'm uploading our brand guidelines document. Please extract the correct colors (with their roles — primary, secondary, accent, etc.), typography (font families, weights, and usage), and any logo specifications. Compare what you find against the brand report I set up earlier and tell me what needs to be corrected.</code></pre>
      </div>
    </div>

    <div class="fix-item">
      <strong>Upload an on-brand asset</strong>
      <span>Share a file you know is correct and we&rsquo;ll sample from it</span>
      <div class="copy-wrap" id="copy-fix-asset" style="margin-top:10px">
        <button class="copy-btn" onclick="copyBlock('copy-fix-asset')">Copy</button>
        <pre><code>I'm uploading a file that I know is on-brand (it was approved by our design team). Please sample the colors, fonts, and any logo usage from it and compare against the brand report I set up. Update the brand identity with any corrections you find.</code></pre>
      </div>
    </div>

    <div class="fix-item">
      <strong>Send to your design team</strong>
      <span>Forward this report for review &mdash; they can send back corrections</span>
      <div class="copy-wrap" id="copy-fix-team" style="margin-top:10px">
        <button class="copy-btn" onclick="copyBlock('copy-fix-team')">Copy</button>
        <pre><code>Can you draft a short message I can send to our design team? I need them to review this brand identity report and tell me:
1. Are the colors correct? What are the actual hex values and roles (primary, secondary, accent)?
2. Are the fonts correct? What are the exact family names and weights?
3. Can they send me the logo as an SVG file?
4. Anything else that's wrong or missing?</code></pre>
      </div>
    </div>

    <div class="fix-item">
      <strong>Scan a different page</strong>
      <span>If this wasn&rsquo;t your main brand page, try a different URL</span>
      <div class="copy-wrap" id="copy-fix-rescan" style="margin-top:10px">
        <button class="copy-btn" onclick="copyBlock('copy-fix-rescan')">Copy</button>
        <pre><code>The brand extraction didn't get the right results from that URL. Let's try scanning a different page — I think [PASTE YOUR URL HERE] would be a better source for our brand colors and logo. Please re-run the extraction and update the report.</code></pre>
      </div>
    </div>

  </div>
</section>

<footer>
  Generated by <a href="https://brandsystem.app" style="color:#818cf8;text-decoration:none">brandsystem.app</a> v0.1.0 &bull; ${new Date().toISOString().split("T")[0]}
  &bull; Audit: ${overall} (${auditSummary.pass}/${auditSummary.warn}/${auditSummary.fail})
</footer>

<script>
// Tab switching
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
  });
});

// Click to copy
function copyBlock(wrapperId) {
  const wrap = document.getElementById(wrapperId);
  const code = wrap.querySelector('code');
  const btn = wrap.querySelector('.copy-btn');
  navigator.clipboard.writeText(code.textContent).then(() => {
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = 'Copy'; btn.classList.remove('copied'); }, 2000);
  });
}
</script>
</body>
</html>`;
}
