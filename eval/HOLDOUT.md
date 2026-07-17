# Private holdout protocol

The public prompt fixtures are a development set. Description authors may read and optimize against them, so their score demonstrates fit to known intents rather than generalization.

The 0.12 holdout stays private while producing publicly verifiable evidence.

## Before a description pass

1. Collect privacy-safe dogfood records before selecting holdout cases. Never store credentials, customer data, or confidential brand content in the evaluation set.
2. Split by customer or source group, not randomly. Paraphrases from the same source must not appear in both development and holdout sets.
3. Give description authors access only to the development cases.
4. Store the holdout in a private location available to the independent evaluator, using this shape:

```json
{
  "schema_version": "brandsystem-agent-holdout/v1",
  "cases": [
    {
      "id": "opaque-case-id",
      "prompt": "private prompt or approved paraphrase",
      "category": "negative-unrelated",
      "profile": "core",
      "expected_action": "no_tool",
      "expected_tools": []
    }
  ]
}
```

5. Create the public commitment before testing:

```bash
npm run eval:commit-holdout -- /private/path/holdout.json > holdout-commitment.json
```

The command prints only a canonical SHA-256, case count, negative-case count, and aggregate category/profile distribution. It never prints prompts.

## Publish with every score

- Holdout commitment and package commit.
- Exact model and client/harness version.
- Run date.
- Overall score plus negative-case false-invocation rate.
- Evaluator identity or isolated-session description.
- Any execution failures separate from routing misses.

The SHA proves the cases did not change after commitment. Blindness comes from access separation: description authors must not see the private prompts before scoring.

After a release cycle, the evaluator may reveal and rotate the set. Never weaken labels or move failed cases out of the holdout to improve a score.
