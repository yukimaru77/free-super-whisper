# Oracle Runbook

Updated: 2026-06-24

This is the short operational summary. Keep detailed history in `oracle-knowledge.md`.

## Current Config

User config:

```text
~/.oracle/config.json
```

Important settings:

```json5
{
  engine: "browser",
  model: "gpt-5.5-pro",
  heartbeatSeconds: 30,
  browser: {
    manualLogin: true,
    modelStrategy: "select",
    manualLoginProfilePoolSize: 2,
    thinkingTime: "extended",
    maxConcurrentTabs: 2,
    inputTimeoutMs: 120000,
    autoReattachDelayMs: 5000,
    autoReattachIntervalMs: 30000,
    autoReattachTimeoutMs: 120000,
  },
}
```

Do not set global `timeoutMs` unless there is a specific reason. Long browser/Deep Research runs should be treated as durable sessions and inspected with `sessions` or `oracle session`, not blindly retried.

## Profiles And Routing

Oracle uses private Chrome profiles, separate from normal Chrome:

```text
~/.oracle/browser-profile
~/.oracle/browser-profile-2
```

Both are signed in. `manualLoginProfilePoolSize: 2` expands to those two profiles.

Routing behavior:

- `maxConcurrentTabs: 2` is per profile.
- Total regular capacity is 4 browser tabs.
- The router chooses the available profile with the fewest active leases.
- If active counts tie, it avoids the profile selected last.
- With 2 empty profiles and 4 new jobs, expected routing is `profile-1, profile-2, profile-1, profile-2`.
- A 5th job waits until one slot is released.

## Main MCP Workflow

Use Oracle through MCP for agent work:

```json
{
  "preset": "chatgpt-pro-heavy",
  "slug": "auth-redesign-review",
  "prompt": "Full background, exact question, constraints, desired output.",
  "files": [
    "src/auth/**",
    "docs/auth-migration.md"
  ]
}
```

Rules:

- Use `mcp__oracle.consult`.
- Use `preset: "chatgpt-pro-heavy"` for Pro Extended browser runs.
- Always use a stable slug with 3-5 lowercase alphanumeric words.
- Oracle normalizes slugs to at most five words and ten characters per word.
- Before starting, call `sessions` for the normalized slug to avoid duplicates.
- After any timeout/detach, inspect `sessions`; do not assume failure.

## Guard Workflow

When an Oracle result gates a final answer:

1. `oracle-review-guard.require_review({ slug, reason })`
2. Start `mcp__oracle.consult`.
3. Continue reversible local work while Oracle runs.
4. Before final response, fetch `mcp__oracle.sessions({ id: slug, detail: true })`.
5. Read the result carefully and compare it with the local conclusion.
6. Clear only after handling the result or an accepted failure:
   `oracle-review-guard.clear_review({ slug })`

The stop hook blocks finalization when required sessions are missing, running, or failed.

## Context And Files

Accuracy depends on context quality:

- Explain the background from the beginning.
- Include what happened, what was tried, exact errors, constraints, success criteria, and open uncertainty.
- Prefer real files/logs/docs/traces/plans through `files` over prose summaries.
- Do not include secrets, credentials, private tokens, or unrelated bulky artifacts.

File handling options:

- Direct files/globs:
  ```json
  { "files": ["src/auth/**", "docs/auth-migration.md"] }
  ```
- Prebuilt zip files:
  ```json
  { "files": ["/path/to/context-pack.zip"] }
  ```
- Oracle browser bundle zip:
  ```json
  {
    "browserAttachments": "always",
    "browserBundleFiles": true,
    "browserBundleFormat": "zip",
    "files": ["src/auth/**", "docs/auth-migration.md"]
  }
  ```

Use multiple smaller zips when one zip would become too large or mix unrelated areas.

## Deep Research

Use Deep Research when a report-style investigation is worth the wait:

```json
{
  "preset": "chatgpt-pro-heavy",
  "slug": "vendor-risk-research",
  "browserResearchMode": "deep",
  "prompt": "Research question, scope, output format, constraints."
}
```

Verified behavior:

- Metadata records `browser.config.researchMode: "deep"`.
- Artifacts include `deep-research-report`.
- Typical latency can be much longer than normal consults.

## Image Generation

Use the image MCP wrapper for ChatGPT image generation:

```json
{
  "slug": "image-smoke-test",
  "model": "gpt-5.5",
  "browserModelStrategy": "select",
  "browserThinkingTime": "high",
  "aspectRatio": "1:1",
  "prompt": "Generate one square image: ..."
}
```

For reference images:

```json
{
  "slug": "image-reference-test",
  "model": "gpt-5.5",
  "browserModelStrategy": "select",
  "browserThinkingTime": "high",
  "browserAttachments": "always",
  "files": ["/path/to/reference.png"],
  "aspectRatio": "1:1",
  "prompt": "Using the reference image as a loose style cue, ..."
}
```

Notes:

- ChatGPT image generation selects the `Create image` tool before Send.
- Generated images are saved under `~/.oracle/generated`.
- MCP rejects direct external `outputPath` writes unless `ORACLE_MCP_ALLOW_EXTERNAL_OUTPUT=1`; copy the file afterward if needed.
- Image jobs are more fragile under high concurrency than text jobs. If an image run fails with `chrome-disconnected`, inspect `sessions`, then retry with a new slug.

## CLI Fallback

Use CLI directly when needed:

```bash
oracle status --hours 2
oracle session <slug> --render
oracle session <slug> --harvest
```

Pro smoke:

```bash
oracle --engine browser \
  --model gpt-5.5-pro \
  --browser-model-strategy select \
  --slug "pro-smoke-check" \
  -p "Reply with exactly: PRO_SMOKE_OK"
```

Image smoke:

```bash
oracle --engine browser \
  --model gpt-5.5 \
  --browser-model-strategy select \
  --browser-thinking-time high \
  --generate-image "$PWD/image-smoke.png" \
  --aspect 1:1 \
  --slug "image-smoke-check" \
  -p "Generate one square image: a blue cube on white. No text."
```

## Verified E2E Cases

Verified on 2026-06-24:

- Plain consult
- Direct file attachment
- Prebuilt zip attachment
- Oracle browser bundle zip
- ChatGPT image generation
- Reference-image generation
- Deep Research
- Browser follow-up conversation
- Guard block/clear behavior
- Profile pool routing with least-loaded + avoid-last tie break

Detailed session IDs and artifact paths are in `oracle-knowledge.md`.

## Troubleshooting

If Pro is not selected:

- Check `modelStrategy: "select"`.
- Run with `--browser-model-strategy select`.
- Inspect the ChatGPT composer; it should show `Pro Extended`.

If a run detaches or times out:

- Use `mcp__oracle.sessions({ id, detail: true })`.
- Or CLI: `oracle session <slug> --render`.
- Do not rerun immediately unless a fresh session is intentional.

If image generation disconnects:

- Check `sessions` and `output.log`.
- Confirm whether `Create image tool activated` happened.
- Retry with a new slug after load drops.

If guard blocks finalization:

- Run `oracle-review-guard.review_status`.
- Fetch completed results or handle failed sessions.
- Clear only after the result/failure has actually been handled.

