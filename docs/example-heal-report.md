# Example heal report

Every run of `pnpm heal` writes three artefacts to `heal-output/` (or `--out`).
The files in [`docs/example/`](example/) come from a real run against the demo
app with `APP_VERSION=2` and `--provider mock`:

| File | What it is |
|---|---|
| [`example/heal-report.json`](example/heal-report.json) | Machine-readable report: options, summary, one record per heal attempt with every candidate and why it passed or failed, one outcome per test, the unified diff. CI asserts on `summary.healedTests`. |
| [`example/heal-report.html`](example/heal-report.html) | Self-contained page (screenshots inlined) for humans. Open it in a browser. |
| [`example/pr-body.md`](example/pr-body.md) | The pull-request body the agent produced. When `gh` or a token is missing this is written to `heal-pr.md` instead of opening a PR, which is what happened here. |

The console output of the same run is in [`demo-run.log`](demo-run.log); the
README GIF is rendered from it.

## Summary of the example run

```json
{
  "testsRun": 12,
  "failures": 18,
  "healableFailures": 18,
  "healedLocators": 18,
  "healedTests": 10,
  "revertedLocators": 0,
  "unhealedTests": 0,
  "skippedFailures": 0,
  "inputTokens": 0,
  "outputTokens": 0,
  "estimatedCostUsd": 0
}
```

Twelve tests ran, ten failed (two never used a renamed element), eighteen
locators were broken across those ten, and all eighteen were healed over four
rounds. Token counts are zero because the mock provider answered.

## One heal record, annotated

This is `heal-012` from the example, the strict-mode case. In v2 the settings
page styles its "back" link as a button, so `page.locator('.btn')` matches two
elements. The mock's first candidate is deliberately bad and the verifier
rejects it; the second one passes.

```json
{
  "id": "heal-012",
  "round": 2,
  "testId": "tests/settings.spec.ts::saves the language choice",
  "relFile": "tests/settings.spec.ts",
  "line": 17,
  "intent": "saves the language choice",
  "action": "click",
  "oldLocator": "page.locator('.btn')",
  "errorLocator": "locator('.btn')",
  "failureKind": "strict-mode",
  "candidates": [
    {
      "locator": "page.locator('form .btn')",
      "kind": "css",
      "confidence": 0.8,
      "status": "rejected",
      "count": 2,
      "detail": "matches 2 elements, expected 1"
    },
    {
      "locator": "page.getByRole('button', { name: 'Save changes' })",
      "kind": "role",
      "confidence": 0.78,
      "status": "passed",
      "count": 1,
      "detail": "matches 1 element(s) and click succeeded"
    }
  ],
  "newLocator": "page.getByRole('button', { name: 'Save changes' })",
  "status": "healed",
  "statusDetail": "the test passed after the patch"
}
```

Fields worth knowing:

- `round`: the run in which this failure surfaced. Line 17 only failed after
  the `#language` locator on line 14 had been healed in round 1.
- `candidates[].status`: `passed`, `rejected` (verification failed, see
  `detail`) or `skipped` (below `--min-confidence`, never evaluated).
- `status`: `healed` (patched and the test went green), `reverted` (patched but
  the test stayed red, so the patch was undone), `unverified` (no candidate
  passed), `no-candidate` (the provider had nothing), `skipped` (the statement
  could not be replayed or patched).
- `screenshot`: path of the "before" screenshot, relative to the output
  directory; the HTML report inlines it and the PR embeds it.
