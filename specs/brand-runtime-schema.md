# brand-runtime.json Schema

The brand runtime is a compiled, read-only document produced by `brand_compile`. It is the single-document contract an AI agent reads to produce on-brand content. It merges data from all 4 session YAMLs into a flat, fast-access structure.

## When it's produced

`brand_compile` writes `brand-runtime.json` on every compilation. The runtime always reflects the current state of the `.brand/` directory — sessions that haven't been completed yet produce `null` sections.

## Schema

```jsonc
{
  // Schema version (matches SCHEMA_VERSION from schemas/index.ts)
  "version": "0.1.0",

  // Brand name from brand.config.yaml
  "client_name": "Acme Corp",

  // ISO 8601 timestamp of last compilation
  "compiled_at": "2026-04-02T12:00:00.000Z",

  // Highest completed session (1-4)
  "sessions_completed": 2,

  // --- Session 1: Core Identity ---
  "identity": {
    // Role → hex color (medium+ confidence only)
    "colors": {
      "primary": "#1a1a1a",
      "secondary": "#ff6600",
      "accent": "#0099ff"
    },
    // Name → font family (medium+ confidence only)
    "typography": {
      "Heading": "Inter",
      "Body": "Georgia"
    },
    // First logo spec summary (null if no logo)
    "logo": {
      "type": "wordmark",       // "wordmark" | "logomark"
      "has_svg": true            // Whether inline SVG is available
    }
  },

  // --- Session 2: Visual Identity (null until Session 2 complete) ---
  "visual": {
    "composition": {
      "energy": "high-tension, asymmetric",
      "grid": "8px base, flexible columns",
      "layout": "asymmetric tension"
    },
    "signature": {
      "description": "Bold geometric overlays with high contrast",
      "elements": ["diagonal cuts", "overlapping type"]
    },
    // Only hard-severity anti-patterns (enforceable rules)
    "anti_patterns": [
      "no drop shadows",
      "no stock photography"
    ]
  },

  // --- Session 3: Voice (null until Session 3 complete) ---
  "voice": {
    "tone_descriptors": ["bold", "precise", "warm"],
    "register": "professional but approachable",
    "never_sounds_like": "corporate buzzword salad",
    // Preferred term → term it replaces
    "anchor_terms": {
      "craft": "make",
      "perspective": "opinion"
    },
    "never_say": ["synergy", "leverage", "disrupt"],
    "jargon_policy": "define on first use",
    "ai_ism_patterns": ["delve", "landscape", "in today's"],
    "conventions": {
      "person": "we",
      "reader_address": "you",
      "oxford_comma": true,
      "sentence_length": 18
    }
  },

  // --- Session 4: Strategy (null until Session 4 complete) ---
  "strategy": {
    "persona_count": 3,
    "persona_names": ["The Overwhelmed VP", "The Skeptical Engineer"],
    "journey_stages": ["First Touch", "Context & Meaning", "Validation", "Decision"],
    "theme_count": 4,
    "matrix_size": 12
  }
}
```

## Key design decisions

1. **Flat over nested**: Colors are `role → hex` not the full `ColorEntry` object. The runtime is for consumption, not editing.
2. **Confidence filter**: Only medium+ confidence values appear. Low-confidence data stays in `needs-clarification.yaml`.
3. **Hard rules only**: `anti_patterns` includes only `severity: "hard"` rules. Soft rules live in the full `visual-identity.yaml`.
4. **Strategy is summarized**: Full personas/journey data is large. The runtime provides counts and names; tools that need full detail read `strategy.yaml` directly.
5. **Null sections are explicit**: A `null` value means the session hasn't been completed yet, not that data is missing.

## Consumers

- `brand_runtime` tool — returns this document to the agent
- `brand_write` tool — could use this instead of reading 4 YAMLs separately
- External integrations — agents can read `.brand/brand-runtime.json` directly
