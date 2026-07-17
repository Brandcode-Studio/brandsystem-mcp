# Privacy-safe dogfood capture

Real agent friction should inform the development and holdout sets, but raw client prompts do not belong in this public repository.

Capture records in an approved private location with these fields:

```json
{
  "source_group": "opaque customer or project id",
  "captured_at": "ISO-8601 timestamp",
  "client": "Codex app",
  "model": "model id when visible",
  "intent_paraphrase": "redacted statement of the job",
  "expected_outcome": "what successful completion meant",
  "selected_tools": ["brand_start"],
  "outcome": "completed | wrong_tool | no_tool | abandoned | repaired",
  "friction": "redacted failure or hesitation",
  "repair": "what made the job succeed",
  "safe_for_public_development_set": false
}
```

Rules:

- Prefer a paraphrase over a raw prompt.
- Do not capture brand values, unreleased strategy, customer names, credentials, file contents, or personal data.
- Record completed jobs as well as failures so the corpus is not failure-only.
- Treat `safe_for_public_development_set` as false until a human explicitly approves the redacted case.
- Split future evaluation sets by `source_group` to prevent paraphrase leakage.
- Measure over-triggering: unrelated prompts where the agent invokes Brandsystem are first-class failures.

Public reports should contain aggregate counts and approved cases only.
