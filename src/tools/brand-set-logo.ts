import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { BrandDir } from "../lib/brand-dir.js";
import { buildResponse } from "../lib/response.js";
import { sanitizeSvg, resolveSvg, resolveImage } from "../lib/svg-resolver.js";
import { fetchLogo } from "../lib/logo-extractor.js";
import type { LogoSpec } from "../types/index.js";

const paramsShape = {
  svg: z.string().optional().describe("Raw SVG markup to use as the logo"),
  url: z.string().optional().describe("URL to fetch the logo from (SVG or PNG)"),
  data_uri: z.string().optional().describe("Base64 data URI of the logo (e.g., data:image/svg+xml;base64,...)"),
  type: z.enum(["wordmark", "logomark"]).default("wordmark").describe('Logo type: "wordmark" (text-based) or "logomark" (icon/symbol). Default: wordmark'),
};

type SetLogoInput = {
  svg?: string;
  url?: string;
  data_uri?: string;
  type: "wordmark" | "logomark";
};

async function handler(input: SetLogoInput) {
  const brandDir = new BrandDir(process.cwd());

  if (!(await brandDir.exists())) {
    return buildResponse({
      what_happened: "No .brand/ directory found",
      next_steps: ["Run brand_init first to create the brand system"],
      data: { error: "not_initialized" },
    });
  }

  // Exactly one input source should be provided
  const inputCount = [input.svg, input.url, input.data_uri].filter(Boolean).length;
  if (inputCount === 0) {
    return buildResponse({
      what_happened: "No logo input provided",
      next_steps: [
        "Provide one of: svg (raw SVG markup), url (link to SVG/PNG), or data_uri (base64 data URI)",
      ],
      data: { error: "no_input" },
    });
  }

  let inline_svg: string | undefined;
  let data_uri: string | undefined;
  let filename: string;

  // --- Handle SVG markup ---
  if (input.svg) {
    const sanitized = sanitizeSvg(input.svg);
    const resolved = resolveSvg(sanitized);
    inline_svg = resolved.inline_svg;
    data_uri = resolved.data_uri;
    filename = `logo-${input.type}.svg`;
    await brandDir.writeAsset(`logo/${filename}`, sanitized);
  }
  // --- Handle URL ---
  else if (input.url) {
    if (!input.url.startsWith("http://") && !input.url.startsWith("https://")) {
      return buildResponse({
        what_happened: "Only http:// and https:// URLs are supported",
        next_steps: ["Provide a logo URL starting with http:// or https://"],
        data: { error: "invalid_protocol" },
      });
    }
    const fetched = await fetchLogo(input.url);
    if (!fetched) {
      return buildResponse({
        what_happened: `Failed to fetch logo from ${input.url}`,
        next_steps: [
          "Check the URL is correct and accessible",
          "Try providing the SVG markup directly with the svg parameter",
        ],
        data: { error: "fetch_failed", url: input.url },
      });
    }

    const isSvg =
      fetched.contentType.includes("svg") ||
      fetched.content.toString("utf-8").trim().startsWith("<");

    if (isSvg) {
      const svgContent = fetched.content.toString("utf-8");
      const sanitized = sanitizeSvg(svgContent);
      const resolved = resolveSvg(sanitized);
      inline_svg = resolved.inline_svg;
      data_uri = resolved.data_uri;
      filename = `logo-${input.type}.svg`;
      await brandDir.writeAsset(`logo/${filename}`, sanitized);
    } else {
      const resolved = resolveImage(fetched.content, fetched.contentType);
      data_uri = resolved.data_uri;
      const ext = fetched.contentType.includes("png") ? "png" : "jpg";
      filename = `logo-${input.type}.${ext}`;
      await brandDir.writeAsset(`logo/${filename}`, fetched.content);
    }
  }
  // --- Handle data URI ---
  else if (input.data_uri) {
    // Check if it's an SVG data URI
    if (input.data_uri.startsWith("data:image/svg+xml")) {
      // Decode the SVG from the data URI
      let svgContent: string;
      if (input.data_uri.includes(";base64,")) {
        const base64 = input.data_uri.split(";base64,")[1];
        svgContent = Buffer.from(base64, "base64").toString("utf-8");
      } else {
        // URL-encoded
        const encoded = input.data_uri.split(",")[1];
        svgContent = decodeURIComponent(encoded);
      }

      const sanitized = sanitizeSvg(svgContent);
      const resolved = resolveSvg(sanitized);
      inline_svg = resolved.inline_svg;
      data_uri = resolved.data_uri;
      filename = `logo-${input.type}.svg`;
      await brandDir.writeAsset(`logo/${filename}`, sanitized);
    } else {
      // Non-SVG data URI (PNG, JPG, etc.) — store as-is
      data_uri = input.data_uri;
      // Extract the binary content from the data URI for file storage
      const matches = input.data_uri.match(/^data:([^;]+);base64,(.+)$/);
      if (matches) {
        const contentType = matches[1];
        const buffer = Buffer.from(matches[2], "base64");
        const ext = contentType.includes("png") ? "png" : "jpg";
        filename = `logo-${input.type}.${ext}`;
        await brandDir.writeAsset(`logo/${filename}`, buffer);
      } else {
        filename = `logo-${input.type}.png`;
      }
    }
  } else {
    // Should never reach here due to the check above
    filename = `logo-${input.type}.svg`;
  }

  // Update core-identity.yaml with the new logo
  const identity = await brandDir.readCoreIdentity();

  // Remove existing logos of the same type
  const otherLogos = identity.logo.filter((l) => l.type !== input.type);

  const newLogo: LogoSpec = {
    type: input.type,
    source: "manual",
    confidence: "confirmed",
    variants: [{
      name: "default",
      file: `logo/${filename}`,
      ...(inline_svg && { inline_svg }),
      ...(data_uri && { data_uri }),
    }],
  };

  identity.logo = [...otherLogos, newLogo];
  await brandDir.writeCoreIdentity(identity);

  return buildResponse({
    what_happened: `Set ${input.type} logo in core-identity.yaml`,
    next_steps: [
      "Show the logo to the user and confirm it looks right",
      "If confirmed, proceed with brand_compile",
    ],
    data: {
      logo_type: input.type,
      file: `.brand/assets/logo/${filename}`,
      ...(inline_svg && { inline_svg }),
      ...(data_uri && { data_uri }),
      conversation_guide: {
        show_logo: "Show the logo to the user and confirm it looks right. If they say it's wrong, ask them to provide a different logo using brand_set_logo again.",
      },
    },
  });
}

export function register(server: McpServer) {
  server.tool(
    "brand_set_logo",
    "Add or replace a logo in the brand system. Accepts raw SVG markup, a URL to a logo file (SVG/PNG), or a base64 data URI. Use when brand_extract_web missed the logo, extracted the wrong image, or the user provides a logo directly. Sanitizes SVG, saves to .brand/assets/logo/, and updates core-identity.yaml with inline_svg and data_uri for portable embedding. Returns logo preview data.",
    paramsShape,
    async (args) => handler(args as SetLogoInput)
  );
}
