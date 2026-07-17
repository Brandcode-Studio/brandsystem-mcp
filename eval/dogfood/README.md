# Dogfood Prompt Capture

Real usage is the source for the 0.12 evaluation holdout. This directory holds
the **capture protocol and tooling** — never the captured prompts themselves.

## Why capture before designing the holdout

The routing scores in [RESULTS.md](../RESULTS.md) are development-set scores:
tool descriptions were tuned against those fixtures. Credible generalization
evidence needs prompts the description authors never saw, phrased by real
users. Those only exist if capture starts *before* anyone designs the holdout.

## What to capture (and what never to)

Capture, per interaction with any brand-related agent request:

| Field | Example |
|---|---|
| `intent` | "wanted a LinkedIn post in client voice" |
| `prompt_redacted` | the user's phrasing with brand/client names replaced by `{BRAND}` |
| `source` | `c5-internal`, `client-a`, `client-b`, ... (stable per-customer key, no real names) |
| `tools_selected` | what the agent actually called first / in sequence |
| `outcome` | `completed`, `wrong-tool`, `abandoned`, `bypassed-mcp` |
| `friction` | free text: where it stalled, what the human had to repair |
| `repair` | what fixed it, if anything |
| `date` | ISO date |

**Never capture:** brand values, extracted content, guideline text, client
names, or anything confidential. The prompt is redacted *before* it is written.
If redaction would gut the prompt, capture only `intent` + metadata.

## How

Append one JSON object per line to a **private** capture file OUTSIDE this
repository (suggested: `~/.brandsystem/dogfood-capture.jsonl`):

```bash
node scripts/dogfood-capture.mjs \
  --intent "write social post in voice" \
  --prompt "Write a launch post for {BRAND} in our voice" \
  --source client-a \
  --tools brand_context \
  --outcome completed
```

The helper validates fields, refuses prompts that still contain a known brand
name (checked against a local denylist file you maintain at
`~/.brandsystem/dogfood-denylist.txt`, one name per line), and appends to the
private JSONL. Nothing under `eval/dogfood/` in the repo ever contains
captured data — `.gitignore` guards `eval/dogfood/*.jsonl` as a second fence.

## From capture to holdout (0.12 protocol)

1. When enough captures exist (~50+ across ≥3 sources), split **by source**,
   not randomly — paraphrases from one person must not straddle sets.
2. Description authors receive the development share only.
3. The holdout share is frozen with canonical serialization; its SHA-256,
   case count, and category distribution are committed publicly in
   `eval/HOLDOUT-COMMITMENTS.md` **before** any testing.
4. A separate evaluator (or isolated session) runs the holdout and publishes
   hash + model id + package commit + date + score.
5. Optionally reveal and rotate the holdout after a release cycle.
