# Holdout commitments

Public, append-only log of frozen holdout evaluation sets. Full protocol:
[eval/HOLDOUT.md](HOLDOUT.md).

## Why this file exists

The prompts in `eval/fixtures/prompts.json` are a **development set**: the
people who write tool descriptions can read those prompts and (deliberately or
not) optimize against them, so development-set scores measure fit to known
intents, not generalization. Holdout sets close that gap:

- **Blindness by separation, not secrecy theater.** The holdout is split from
  the development set **by customer/source** (never randomly), so paraphrases
  of a dev prompt cannot leak into the holdout. Description authors see the
  development set only; a separate evaluator (or isolated session) holds the
  private prompts.
- **Frozen before testing.** The holdout file is canonically serialized
  (object keys sorted recursively, no insignificant whitespace, LF line
  endings only) and its SHA-256 is committed **here, publicly, before any
  model is scored against it**. The hash proves the cases did not change after
  the fact; the source split plus author separation provide the blindness.
- **Never committed itself.** The holdout file lives OUTSIDE this repository
  (passed to the harness via `BRANDSYSTEM_EVAL_HOLDOUT=/path/to/holdout.json`)
  and is never checked in. Only the commitment block below — hash, case count,
  and aggregate category/profile distribution — is public. Prompts are never
  printed.
- **Reveal-and-rotate (optional).** After a release cycle, the evaluator may
  publish the holdout's contents (anyone can verify them against the committed
  hash) and rotate in a fresh frozen set. Never weaken labels or move failed
  cases out of a holdout to improve a score.

## How to add a commitment

```bash
node scripts/agent-eval.mjs commit-holdout --file /private/path/holdout.json
```

Append the printed block below, commit it, and only then run
`BRANDSYSTEM_EVAL_HOLDOUT=/private/path/holdout.json npm run eval -- --with-llm`.
Every published holdout score must reference its commitment hash, the provider
and exact model id, the package commit, and the run date.

---

## Commitments

_None recorded yet. The first frozen holdout (collected from privacy-safe
dogfood capture, per the 0.12 plan) will be committed here before any testing._
