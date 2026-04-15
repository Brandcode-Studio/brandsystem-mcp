/**
 * Firecrawl integration for reliable web extraction.
 *
 * When FIRECRAWL_API_KEY is set, uses Firecrawl's scrape API
 * instead of raw fetch for HTML retrieval. Handles JS rendering,
 * anti-bot protection, and proxy management.
 *
 * Disabled by default. Enable with: FIRECRAWL_API_KEY=fc-...
 */

const FIRECRAWL_API = "https://api.firecrawl.dev/v1/scrape";

export function isFirecrawlAvailable(): boolean {
  return !!process.env.FIRECRAWL_API_KEY;
}

export interface FirecrawlResult {
  success: boolean;
  html: string;
  markdown?: string;
  metadata?: {
    title?: string;
    description?: string;
    language?: string;
    ogImage?: string;
  };
  error?: string;
}

/**
 * Scrape a URL using Firecrawl's API.
 * Returns rendered HTML (JS-executed) with metadata.
 * Falls back gracefully if the API fails.
 */
export async function scrapeWithFirecrawl(url: string): Promise<FirecrawlResult> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    return { success: false, html: "", error: "FIRECRAWL_API_KEY not set" };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000);

    const response = await fetch(FIRECRAWL_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        url,
        formats: ["html", "markdown"],
        waitFor: 3000, // wait for JS to render
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return {
        success: false,
        html: "",
        error: `Firecrawl API returned ${response.status}`,
      };
    }

    const data = await response.json() as {
      success: boolean;
      data?: {
        html?: string;
        markdown?: string;
        metadata?: Record<string, unknown>;
      };
    };

    if (!data.success || !data.data?.html) {
      return {
        success: false,
        html: "",
        error: "Firecrawl returned no HTML",
      };
    }

    return {
      success: true,
      html: data.data.html,
      markdown: data.data.markdown,
      metadata: {
        title: data.data.metadata?.title as string | undefined,
        description: data.data.metadata?.description as string | undefined,
        language: data.data.metadata?.language as string | undefined,
        ogImage: data.data.metadata?.ogImage as string | undefined,
      },
    };
  } catch (err) {
    return {
      success: false,
      html: "",
      error: `Firecrawl error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
