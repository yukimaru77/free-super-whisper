# Oracle Setup Knowledge

Updated: 2026-06-24

Short operational runbook: `oracle-runbook.md`.

## Current State

- Oracle CLI is installed and available on PATH.
- Verified version: `0.15.0`.
- Working browser path: ChatGPT browser mode.
- Preferred model target: `gpt-5.5-pro`.
- ChatGPT account is signed in through Oracle's private browser profile:
  - `~/.oracle/browser-profile`
- Recent verified smoke sessions:
  - `config-select-smoke`
  - `config-select-visible`
- `config-select-visible` was verified on the actual ChatGPT screen, not only from logs:
  - Composer model label: `Pro Extended`
  - Answer: `ORACLE_CONFIG_SELECT_VISIBLE_20260624`

## Important Config

User config file:

```text
~/.oracle/config.json
```

Current important settings:

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

`modelStrategy: "select"` is important. If it is set to `"current"`, Oracle keeps whatever ChatGPT currently shows in the composer, such as `High`, even when `--model gpt-5.5-pro` is passed.

`manualLoginProfilePoolSize: 2` enables a two-account browser profile pool without hard-coding profile paths in user config. Oracle expands it to `~/.oracle/browser-profile` and `~/.oracle/browser-profile-2`. The profile router now chooses the available profile with the fewest active leases, and when profiles are tied it avoids the profile selected last. `maxConcurrentTabs: 2` is per profile, so two configured profiles allow up to four total ChatGPT tabs while spreading new work as evenly as possible.

`timeoutMs` is intentionally not set in user config. Use a one-off CLI flag only when a particular run needs a custom timeout.

Profile pool status:

- `~/.oracle/browser-profile`: initialized and currently used for the signed-in account.
- `~/.oracle/browser-profile-2`: initialized, signed in, and verified with session `manual-login-profile-2-setup`.

Second-account setup command, if the profile ever needs to be rebuilt:

```bash
oracle --engine browser \
  --browser-manual-login \
  --browser-manual-login-profile-dir "$HOME/.oracle/browser-profile-2" \
  --browser-keep-browser \
  --browser-archive never \
  --slug "manual-login-profile-2-setup" \
  -p "Reply with exactly: PROFILE2_READY"
```

Sign into the second ChatGPT account in the opened Chrome window. After that, normal parallel runs can use both profiles.

## Root Cause Found

The previous Pro issue had two causes:

1. Manual screen inspection used the wrong coordinate system. The screenshot was displayed wider than the real Chrome DevTools viewport, so the click target was missed.
2. The real configuration problem was:

```json5
modelStrategy: "current"
```

This made Oracle reuse the current ChatGPT model instead of selecting Pro. It has been changed to:

```json5
modelStrategy: "select"
```

## Verified Commands

Check Oracle version:

```bash
oracle --version
```

List recent sessions:

```bash
oracle status --hours 2
```

Render a saved session:

```bash
oracle session config-select-visible --render
```

Run a normal Pro smoke test:

```bash
oracle --engine browser \
  --model gpt-5.5-pro \
  --browser-archive never \
  --timeout 8m \
  --slug "config-select-smoke" \
  -p "Reply with exactly: ORACLE_CONFIG_SELECT_SMOKE_20260624"
```

Run a visible Pro smoke test and leave Chrome open for screen inspection:

```bash
oracle --engine browser \
  --model gpt-5.5-pro \
  --browser-keep-browser \
  --browser-archive never \
  --timeout 8m \
  --slug "config-select-visible" \
  -p "Reply with exactly: ORACLE_CONFIG_SELECT_VISIBLE_20260624"
```

Force model selection from the CLI, regardless of config:

```bash
oracle --engine browser \
  --model gpt-5.5-pro \
  --browser-model-strategy select \
  -p "Your prompt"
```

## Account Switching

Oracle uses a private Chrome profile, separate from normal Chrome:

```text
~/.oracle/browser-profile
```

To switch accounts, open Oracle's manual-login browser and sign into the desired ChatGPT account there:

```bash
oracle --engine browser \
  --browser-manual-login \
  --browser-keep-browser \
  --browser-manual-login-profile-dir "$HOME/.oracle/browser-profile" \
  --browser-archive never \
  --timeout 20m \
  --slug "manual-login-switch" \
  -p "HI"
```

If Google or OpenAI asks for password, 2FA, or consent, complete it in the opened Chrome window. After login, rerun a Pro smoke test and verify the composer says `Pro Extended`.

## Image Generation And Image Capture

Oracle supports image generation and saving generated images.

From local docs and code:

- `--generate-image <file>` saves a generated image.
- `--aspect <ratio>` sets aspect ratio.
- ChatGPT browser mode can save downloadable generated images as session artifacts.
- Gemini browser mode explicitly supports image generation and image editing.
- Generated browser artifacts are saved under:

```text
~/.oracle/sessions/<session-id>/artifacts/
```

Example ChatGPT browser image command:

```bash
oracle --engine browser \
  --model gpt-5.5-pro \
  --browser-model-strategy select \
  --generate-image /tmp/oracle-image.png \
  --aspect 1:1 \
  -p "Generate a simple image of a clean glass cube on a white background."
```

Example Gemini browser image command from Oracle docs:

```bash
oracle --engine browser \
  --model gemini-3.1-pro \
  --generate-image out.jpg \
  --aspect 1:1 \
  -p "a cute robot holding a banana"
```

Image editing is documented for Gemini browser mode:

```bash
oracle --engine browser \
  --model gemini-3.1-pro \
  --edit-image in.png \
  --output out.jpg \
  -p "Edit this image as requested."
```

For ChatGPT browser mode, use `--file` for reference images and `--generate-image` for the output path:

```bash
oracle --engine browser \
  --model gpt-5.5-pro \
  --browser-model-strategy select \
  --file reference.png \
  --generate-image /tmp/edited-oracle-image.png \
  -p "Use the reference image and create a clean variation."
```

Status: image generation support is verified.

Important implementation note:

- `--generate-image <file>` now explicitly activates ChatGPT's `Create image` composer tool before clicking Send.
- The activation is done immediately before submission, after the prompt text is inserted, so composer clearing or prompt typing does not accidentally remove the tool selection.
- Verified screen state:
  - `Image` pill visible.
  - `Auto` aspect-ratio control visible.
  - CLI verbose log: `[browser] Create image tool activated`.

Verified High image smoke:

```bash
oracle --engine browser \
  --model gpt-5.5 \
  --browser-model-strategy select \
  --browser-thinking-time extended \
  --browser-keep-browser \
  --browser-archive never \
  --timeout 15m \
  --slug "high-image-smoke" \
  --generate-image "$PWD/oracle-high-image.png" \
  --aspect 1:1 \
  -p "Generate one square image: a small blue glass cube on a clean white background, centered, minimal studio lighting. No text, no watermark."
```

Result:

- Session: `high-image-smoke`
- Saved image: `oracle-high-image.png`
- Image dimensions: `1254 x 1254`
- File type: PNG
- ChatGPT screen was checked after completion:
  - Composer label: `High`
- CLI log detail:
  - `Thinking time: High`
  - Model selection evidence may report `resolved=Extra High` during the base Thinking 5.5 selection step, then the thinking-time step changes the visible composer label to `High`. Trust the final screen label for this case.

Verified explicit Create image selection smoke:

```bash
node oracle/dist/scripts/run-cli.js --verbose \
  --engine browser \
  --model gpt-5.5 \
  --browser-model-strategy select \
  --browser-thinking-time extended \
  --browser-keep-browser \
  --browser-archive never \
  --timeout 12m \
  --slug "create-image-before-send" \
  --generate-image "$PWD/oracle-create-image-before-send.png" \
  --aspect 1:1 \
  -p "Generate one square image: a single green dot centered on a clean white background. No text, no watermark."
```

Result:

- Session: `create-image-before-send`
- Screen/log evidence: `Create image tool activated`
- Saved images:
  - `oracle-create-image-before-send.png`
  - `oracle-create-image-before-send.2.png`
- Image dimensions: `1254 x 1254`
- File type: PNG

## Deep Research Tool Selection

Deep Research selection is verified.

Verification method:

- Opened a fresh ChatGPT tab in Oracle's manual-login Chrome profile.
- Ran Oracle's Deep Research activation expression only.
- Did not send a prompt.

Observed result:

- Activation outcome: `activated`
- Composer footer text: `Deep research`
- Pill aria label: `Deep research, click to remove`
- The visible composer also showed Deep Research-related controls such as `Apps` and `Sites`.

The test tab was closed after verification.

## Oracle Review Skill, MCP, And Stop Hook

Created local personal plugin:

- Source: `/Users/yukito-nonaka/plugins/oracle-review`
- Installed cache: `/Users/yukito-nonaka/.codex/plugins/cache/personal/oracle-review/0.1.0+codex.20260624075636`
- Marketplace: `/Users/yukito-nonaka/.agents/plugins/marketplace.json`
- Status: `oracle-review@personal` is installed and enabled.

Skill:

- Path: `/Users/yukito-nonaka/plugins/oracle-review/skills/oracle-review/SKILL.md`
- Name: `oracle-review`
- Purpose: operational policy for actively and heavily using long-running GPT-5.5 Pro second opinions in reviews, repeated blockers, evaluation, planning, and latest-information research. The setup is covered by a fixed subscription, so repeated Oracle use has no additional per-run cost.
- It requires Oracle requests to use MCP `consult`, `preset: "chatgpt-pro-heavy"`, and a stable `slug`.
- Slugs should be 3-5 lowercase alphanumeric words separated by hyphens. Oracle normalizes custom slugs to at most five words and ten characters per word, so `oracle-review-live-smoke-20260624-0738` becomes `oracle-review-live-smoke-20260624`.
- It requires the Oracle result to be fetched before finalizing even when it takes 10-60 minutes, reread and digested carefully, but also says not to trust Oracle blindly.
- It says Oracle accuracy improves when the prompt explains the full background from the beginning, and that many files should be passed as split zip archives through `files`.
- It says that if Oracle looks wrong, first suspect missing context, poor framing, or insufficient files/logs/plans, then ask again with better context or a sharper question.
- It forbids final answers, merge, or irreversible design decisions until the required Oracle session is completed and fetched.

Plugin MCP servers:

- `oracle`: runs `/Users/yukito-nonaka/tasks/oracle-setup/oracle/dist/bin/oracle-mcp.js`.
- `oracle-review-guard`: runs `./mcp/oracle-review-guard.cjs` from the installed plugin root.
- `oracle-review-guard` normalizes requested slugs the same way as Oracle before checking `~/.oracle/sessions/<session-id>/meta.json`.

Verified MCP tools:

- `oracle`: `consult`, `chatgpt_image`, `project_sources`, `sessions`
- `oracle-review-guard`: `require_review`, `clear_review`, `review_status`, `review_guard`

Verified live MCP consult:

- Session: `actual-live-verify`
- Tool path: Oracle MCP `consult` with `preset: "chatgpt-pro-heavy"`
- Status: `completed`
- Model: `gpt-5.5-pro`
- Browser mode: ChatGPT `Pro Extended`
- Model selection evidence: `requested=Pro`, `resolved=Pro Extended`, `status=already-selected`, `verified=yes`
- Answer token: `ORACLE_ACTUAL_MCP_OK_20260624`
- Transcript: `/Users/yukito-nonaka/.oracle/sessions/actual-live-verify/artifacts/transcript.md`
- `sessions(detail:true)` successfully retrieved the completed metadata, request, log, and transcript artifact.

Verified guard normalization regression:

- Input required slug: `oracle-review-live-smoke-20260624-0738`
- Normalized Oracle session id: `oracle-review-live-smoke-20260624`
- Existing completed session was found through the normalized id.
- `review_guard` returned `allow`.

Verified E2E matrix on 2026-06-24:

- Plain MCP consult:
  - Session: `e2e-plain-20260624`
  - Status: `completed`
  - Result marker: `E2E_PLAIN_OK_20260624`
  - Artifact: `/Users/yukito-nonaka/.oracle/sessions/e2e-plain-20260624/artifacts/transcript.md`
- Direct file attachment:
  - Session: `e2e-file-20260624`
  - File: `/Users/yukito-nonaka/tasks/oracle-setup/tmp/oracle-e2e-20260624/fixtures/notes.txt`
  - Status: `completed`
  - Result marker from file: `FILE_CONTEXT_OK_20260624`
  - Metadata recorded `browserAttachments: "always"` and `files=1`.
- Prebuilt zip attachment:
  - Session: `e2e-zip-20260624`
  - Zip: `/Users/yukito-nonaka/tasks/oracle-setup/tmp/oracle-e2e-20260624/fixture-pack.zip`
  - Status: `completed`
  - Result marker from zip: `ZIP_CONTEXT_OK_20260624`
  - Metadata recorded the zip path and `browserAttachments: "always"`.
- Oracle browser bundle zip:
  - Session: `e2e-bundle-20260624`
  - Files: `readme.md`, `config.json`, `notes.txt`
  - MCP options: `browserBundleFiles: true`, `browserBundleFormat: "zip"`
  - Status: `completed`
  - Result marker: `FILE_CONTEXT_OK_20260624+ZIP_CONTEXT_OK_20260624`
  - Log evidence: `Packed 3 files into 1 bundle`.
- ChatGPT image generation:
  - Initial session `e2e-image-20260624` failed with `chrome-disconnected` after `Create image tool activated`.
  - Retry session `e2e-image-20260624-2` completed.
  - Generated image: `/Users/yukito-nonaka/.oracle/generated/e2e-image-20260624/e2e-image-basic.png`
  - Copied output: `/Users/yukito-nonaka/tasks/oracle-setup/tmp/oracle-e2e-20260624/output/e2e-image-basic.png`
  - Image type: PNG, `1254 x 1254`
  - Model evidence: `gpt-5.5`, `Thinking time: High`, model picker `Thinking 5.5` resolved to `Extra High`.
- ChatGPT image generation with reference upload:
  - Initial session `e2e-image-ref-20260624` failed with `chrome-disconnected` after `Create image tool activated`.
  - Retry session `e2e-image-ref-20260624-2` completed.
  - Reference file: `/Users/yukito-nonaka/tasks/oracle-setup/oracle-create-image-before-send.png`
  - Generated image: `/Users/yukito-nonaka/.oracle/generated/e2e-image-reference-retry.png`
  - Copied output: `/Users/yukito-nonaka/tasks/oracle-setup/tmp/oracle-e2e-20260624/output/e2e-image-reference.png`
  - Image type: PNG, `1254 x 1254`
  - Metadata recorded the reference file and `browserAttachments: "always"`.
- Deep Research:
  - Session: `e2e-deep-20260624`
  - Status: `completed`
  - Metadata recorded `browser.config.researchMode: "deep"`.
  - Artifacts include `deep-research-report`.
  - Marker: `DEEP_RESEARCH_OK_20260624`
  - Report: `/Users/yukito-nonaka/.oracle/sessions/e2e-deep-20260624/artifacts/deep-research-report.md`
- Browser follow-up conversation:
  - Session: `e2e-followup-20260624`
  - Status: `completed`
  - Transcript contains both `FOLLOWUP_FIRST_OK_20260624` and `FOLLOWUP_SECOND_OK_20260624`.
  - Artifact: `/Users/yukito-nonaka/.oracle/sessions/e2e-followup-20260624/artifacts/transcript.md`

Notes from the E2E run:

- Sub-agent spawning was requested with parallel 8, but the sub-agent platform accepted 6 concurrent agents in this thread. The remaining two cases were started after earlier agents completed.
- Browser execution was naturally bounded by the Oracle config: two profiles times two tabs per profile. Extra work waited for slots.
- The initial two image sessions failed under concurrent load with `Browser session ended (Chrome is no longer reachable)` / `chrome-disconnected`. Treat this as a real failure, inspect `sessions`, then retry with a new slug if appropriate.
- The retry image sessions succeeded after load dropped.
- `oracle-review-guard` correctly blocked while the failed image slugs were still required. After the failures were handled by replacement sessions, the failed slugs and successful replacement slugs were cleared and `review_guard` returned `allow`.
- `mcp__oracle.chatgpt_image` rejected direct external `outputPath` writes unless `ORACLE_MCP_ALLOW_EXTERNAL_OUTPUT=1`; generated files were saved under `~/.oracle/generated` and then copied to the requested workspace output paths.

Stop hook:

- `~/.codex/hooks.json` now keeps `hcom codex-stop` and adds:

```bash
node /Users/yukito-nonaka/plugins/oracle-review/scripts/oracle-review-stop.cjs
```

- Guard state file: `/Users/yukito-nonaka/.oracle/review-required-sessions.json`
- Trust state: `~/.codex/config.toml` has `hooks.state."/Users/yukito-nonaka/.codex/hooks.json:stop:0:1"` with trusted hash `sha256:08003d14d49f7f593f0e637325310216b351b45220ea36059f30a0d32d753fb7`.
- The hook only checks session metadata and returns immediately.
- `completed` allows stop.
- `pending` or `running` blocks stop and instructs the agent to inspect sessions.
- `error`, `partial`, `cancelled`, or missing metadata blocks stop and asks the agent to handle failure.
- Codex hooks are enabled in `~/.codex/config.toml`. If Codex asks to trust the changed hook on a new run, intentionally trust the Oracle review hook.

Typical required review flow:

1. Check for an existing session with Oracle MCP `sessions` using the stable slug.
2. Register the slug with `oracle-review-guard.require_review`.
3. Start Oracle MCP `consult` with `preset: "chatgpt-pro-heavy"` and the same slug.
4. Treat detach or timeout as running or unknown; use `sessions` before retrying.
5. Before final response, fetch the result and compare it with the local conclusion.
6. Clear the slug with `oracle-review-guard.clear_review` after the result or failure has been handled.

## Practical Rules

- For normal Oracle advisory review, use browser mode with `gpt-5.5-pro`.
- Keep file sets tight. Use `--dry-run summary --files-report` before sending large repo context.
- Do not attach secrets by default.
- Use `--browser-archive never` when you want the ChatGPT conversation to remain visible in ChatGPT history.
- Use `--browser-keep-browser` when screen verification matters.
- Treat Oracle output as advisory. Verify against repo code and tests before applying changes.

## Troubleshooting

If Pro is not selected:

1. Check config:

```bash
rg -n "modelStrategy|manualLogin|model:" ~/.oracle/config.json
```

2. Ensure this is set:

```json5
modelStrategy: "select"
```

3. Rerun with an explicit override:

```bash
oracle --engine browser \
  --model gpt-5.5-pro \
  --browser-model-strategy select \
  --browser-keep-browser \
  --browser-archive never \
  -p "Reply with exactly: PRO_CHECK"
```

4. Inspect the actual ChatGPT composer label. It should say `Pro Extended`.

If the login state is wrong:

1. Use manual login mode with `--browser-keep-browser`.
2. Sign into the desired account in the opened Oracle Chrome window.
3. Rerun a Pro smoke test.

If a run crashes but a session exists:

```bash
oracle session <slug> --render
```

Do not rerun the same prompt immediately unless you intentionally want a new session. Use reattach first.
