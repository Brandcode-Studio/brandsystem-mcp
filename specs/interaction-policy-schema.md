# interaction-policy.json Schema

The interaction policy is a compiled, read-only document produced by `brand_compile`. It contains the enforceable rules extracted from the brand system — the subset that can be automatically checked by preflight tools and content scoring.

## When it's produced

`brand_compile` writes `interaction-policy.json` alongside `brand-runtime.json` on every compilation.

## Schema

```jsonc
{
  // Schema version
  "version": "0.1.0",

  // ISO 8601 timestamp of last compilation
  "compiled_at": "2026-04-02T12:00:00.000Z",

  // --- Visual rules (from Session 2 anti-patterns) ---
  "visual_rules": [
    {
      "id": "preflight-no-shadows",    // preflight_id or auto-generated
      "rule": "no drop shadows",
      "severity": "hard",              // "hard" = auto-enforced, "soft" = flagged
      "category": "visual"
    }
  ],

  // --- Voice rules (from Session 3 voice codex) ---
  "voice_rules": {
    // Words that must never appear in brand content
    "never_say": ["synergy", "leverage", "disrupt"],

    // Patterns that indicate AI-generated slop
    "ai_ism_patterns": ["delve", "landscape", "in today's"],

    // Tone boundaries
    "tone_constraints": {
      "never_sounds_like": "corporate buzzword salad",
      "avoid_patterns": ["Starting with 'In today's...'", "Ending with '..and beyond'"]
    },

    // Sentence structure preferences
    "sentence_patterns": {
      "prefer": ["Short declarative sentences", "Active voice"],
      "avoid": ["Passive constructions", "Triple-nested subordinate clauses"]
    }
  },

  // --- Content rules (from Session 4 strategy) ---
  "content_rules": {
    // Claims density limits per journey stage
    "claims_policies": [
      { "stage": "First Touch", "max_per_piece": 1 },
      { "stage": "Validation", "max_per_piece": 3 },
      { "stage": "Decision", "max_per_piece": null }
    ],
    // Active persona count (for content targeting validation)
    "persona_count": 3
  }
}
```

## Key design decisions

1. **Rules are extracted, not authored**: Every rule in the policy traces back to a source YAML. No new rules are invented during compilation.
2. **IDs are stable**: Visual rules use `preflight_id` when available, falling back to `visual-N`. This lets preflight tools reference specific rules.
3. **Both severities included**: Unlike the runtime (hard only), the policy includes both hard and soft rules so tools can decide their enforcement level.
4. **Voice rules are denormalized**: `never_say` and `ai_ism_patterns` are extracted as flat arrays for fast lookup, rather than preserving the full object structure.

## Consumers

- `brand_preflight` tool — checks HTML/CSS against visual rules
- `brand_audit_content` tool — scores content against voice rules
- `brand_check_compliance` tool — binary pass/fail using policy rules
- `brand_audit_drift` tool — batch checking against all policy rules
