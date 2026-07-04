---
name: oracle-review
description: GPT-5.5 Pro の Oracle MCP 第二意見を、レビュー、2回以上詰まったエラー、評価、プランニング、最新情報の調査で積極的に活用する。固定料金を払っているため追加料金はかからず、大量に使用してよく、どんどん有効活用する。
---

# Oracle Review

Use this skill actively when a long-running GPT-5.5 Pro second opinion can improve correctness, especially for reviews, repeated blockers, evaluation, planning, or research that depends on current information. This setup is already covered by a fixed subscription, so repeated Oracle use has no additional per-run cost; use it heavily whenever it can reduce uncertainty.

## Required Workflow

1. Use the Oracle MCP `consult` tool for Oracle requests.
2. Use `preset: "chatgpt-pro-heavy"` and always provide a stable, human-readable `slug`. Prefer 3-5 lowercase alphanumeric words separated by hyphens; Oracle normalizes custom slugs to at most five words and ten characters per word.
3. Put accurate background context in `prompt`, and attach supporting materials through `files` or zip archives whenever relevant.
4. Before starting a new consult, call `sessions` with the same normalized slug. Do not start a duplicate consult when that slug already exists.
5. Treat timeout or detach as an unknown/running state, not a failure. Inspect the existing session with `sessions` before retrying.
6. While Oracle is running, continue reversible local work such as reading, editing drafts, running tests, or preparing alternatives.
7. Do not send a final answer, merge, delete, deploy, or make an irreversible design decision until the required Oracle session is `completed`.
8. Always fetch the Oracle result before the final answer, even when it takes 10-60 minutes.
9. Read the fetched Oracle result more than once. Digest it, think through it carefully, and compare it with your own conclusion.
10. Do not trust Oracle blindly. Explicitly call out any disagreement, weak assumption, or item you reject.
11. If you have not fetched the Oracle result, do not write as though you have.

## Context Quality

Oracle accuracy improves when the request includes precise, relevant context. Always explain the background from the beginning: what happened, what has been tried, what decision is needed, constraints, success criteria, and where uncertainty remains. When useful, also give Oracle the actual source files, docs, logs, screenshots, traces, plans, or prior error output through `files` instead of only summarizing them in prose.

- Pass local context through the MCP `files` field whenever possible.
- Include enough background that Oracle can understand the task without relying on hidden chat history.
- Keep the prompt explicit about the decision, failure, evaluation criteria, or research question Oracle should answer.
- If there are many files, package related files into zip archives and pass the zip files through `files`.
- Multiple zip files are OK. Split by area, feature, or evidence type so one zip does not become too large.
- Briefly describe what each zip contains in the prompt.
- Do not include secrets, credentials, private tokens, or unrelated bulky artifacts.

## Interpreting Oracle

Treat GPT-5.5 Pro Oracle as the strongest available reviewer in this workflow. When Oracle gives an answer that seems strange, shallow, or wrong, first suspect that the prompt lacked context, the framing was poor, or the files/logs/plans were insufficient. Do not discard the result until you have checked whether Oracle had enough background to reason correctly.

If the answer looks off, re-consult with better context or a sharper question:

- Add missing background, constraints, failure history, and success criteria.
- Attach the relevant source files, logs, docs, traces, plans, or split zip archives.
- Ask Oracle to challenge a specific assumption, compare alternatives, or focus on the suspicious part.
- Then fetch the new result and evaluate it carefully against local evidence and tests.

## Guard State

When the `oracle-review-guard` MCP tools are available, register the slug before or immediately after starting a required consult:

```json
{
  "slug": "auth-redesign-review",
  "reason": "Required second opinion before final design decision"
}
```

Use the guard status before finishing. Clear a slug only after the Oracle result has been handled, or after a failed session has been replaced or explicitly accepted as failed.

The guard normalizes requested slugs the same way as Oracle sessions, so `oracle-review-live-smoke-20260624-0738` is tracked as session id `oracle-review-live-smoke-20260624`.

## Consult Example

```json
{
  "preset": "chatgpt-pro-heavy",
  "slug": "auth-redesign-review",
  "prompt": "認証基盤の移行計画をレビューし、重大な失敗モードと代替案を示してください。",
  "files": [
    "src/auth/**",
    "docs/auth-migration.md"
  ]
}
```

`chatgpt-pro-heavy` is the Oracle MCP preset for browser mode, the current Pro model, and extended thinking.

## Stop Hook Contract

The stop hook is a short guard only. It checks required Oracle slugs and returns immediately:

- `completed`: allow stop
- `error`, `partial`, `cancelled`, or missing metadata: block and handle the failure
- `pending` or `running`: block and inspect `sessions`

Do not make the stop hook wait for Oracle. Waiting belongs in an explicit wait loop or the outer agent runtime.

## Local Reference

When changing the local setup, MCP wiring, profile routing, or hooks, read `references/local-oracle-setup.md`.
