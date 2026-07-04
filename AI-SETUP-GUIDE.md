# AI Setup & Repair Guide for super-whisper

> **Who this file is for:** an AI coding agent (Claude Code / Codex / opencode),
> not a human. If `./install.sh` failed, or the tool stopped working because
> ChatGPT's web UI changed, run your agent in this directory and tell it:
> *"Read AI-SETUP-GUIDE.md and fix my super-whisper setup."*
>
> Humans: you can read it too, but the fastest path is handing it to an agent.

You are setting up or repairing "super-whisper" for the user on this machine.
Work from the super-whisper directory (the one containing this file). Talk to
the user in THEIR language (if they write Japanese, answer in Japanese). Do the
steps in order, verify each one, and adapt when reality differs — everything in
the "FIELD NOTES" section was verified working on 2026-07-04, but ChatGPT's web
UI changes; when something does not match, do not give up and do not ask the
user to do it manually. Probe the live page, find the control by meaning, patch
the selector or scorer in this package's source, and continue.

## WHAT THE PRODUCT DOES

A global hotkey (Ctrl+Z via skhd) toggles voice dictation:

- 1st press: a persistent, signed-in Chrome profile opens chatgpt.com in the
  background, navigates into the ChatGPT project "Transcript Normalizer"
  (created automatically with normalizer instructions if missing), pins the
  lightest "Instant" model, and clicks ChatGPT's dictation (mic) button.
- 2nd press: submits the dictation, sends the transcript as a message, waits
  for the assistant's reply (the cleaned-up text), copies the reply to the
  clipboard, pastes it into the app that was focused at the 1st press, and
  deletes the throwaway conversation.

The CLI already implements all of this: `bin/super-whisper.ts` (run through
tsx). Your job is environment setup + a working end-to-end test.

## SETUP STEPS

These are the same steps `./install-core.sh` performs deterministically
(./install.sh is the interactive entry that picks hotkeys and launches you).
When install-core.sh failed, find which step broke and continue from there.

1. **Prerequisites.** macOS only. Check and install what is missing (ask before
   installing anything with brew): Google Chrome, Node.js >= 20, pnpm (or use
   npm), skhd (`brew install koekeishiya/formulae/skhd`). Then run
   `pnpm install` (or npm install) in the super-whisper directory and verify
   `npx tsc --noEmit` passes and
   `node --no-deprecation --import tsx bin/super-whisper.ts voice status` runs.

2. **Browser profile sign-in — DO THIS FIRST before any dictation test.** The
   tool uses its own persistent Chrome profile at
   `~/.super-whisper/browser-profile` (NOT the user's normal Chrome profile).
   If that directory is missing or has never been signed in, run:

   ```
   node --no-deprecation --import tsx bin/super-whisper.ts login
   ```

   This opens Chrome on chatgpt.com's login screen. Tell the user: "sign in to
   ChatGPT in the window that just opened" and wait for the command to confirm
   the session. Without this, every later step fails on a login wall.

3. **Hotkey.** Create `~/.local/bin/super-whisper-toggle` (chmod +x):

   ```bash
   #!/bin/bash
   set -euo pipefail
   cd <ABSOLUTE PATH OF THIS super-whisper DIR>
   exec /usr/bin/env node --no-deprecation --import tsx bin/super-whisper.ts voice toggle >> /tmp/super-whisper-toggle.log 2>&1
   ```

   Append to `~/.skhdrc` (create if missing; keep existing content):

   ```
   ctrl - z : $HOME/.local/bin/super-whisper-toggle &
   ```

   Then start/restart skhd (`skhd --restart-service`, or
   `brew services restart skhd`). Ask the user if Ctrl+Z is acceptable or they
   want another key.

4. **macOS permissions** — the user must click these; you cannot automate TCC:
   - Microphone: the FIRST dictation makes macOS ask "Google Chrome would like
     to access the microphone" → Allow (one time).
   - Accessibility: the paste-back sends Cmd+V through System Events; skhd (and
     the terminal during your tests) must be allowed under System Settings →
     Privacy & Security → Accessibility. TRAP: the grant only takes effect
     after the granted process RESTARTS — run `skhd --restart-service` after
     toggling it on, or the paste keeps failing with osascript error 1002
     ("not allowed to send keystrokes"). If the user doesn't want auto-paste,
     add `--no-paste` to the toggle script; the reply is still copied to the
     clipboard either way.
     TRAP: macOS attributes the keystroke to the **node binary** (the real
     Homebrew path like /opt/homebrew/Cellar/node/<version>/bin/node), not
     only to skhd. After a node upgrade the new binary has no grant and the
     paste silently breaks with error 1002 again — re-enable the new "node"
     entry in the Accessibility list. Diagnose with:
     `sqlite3 "/Library/Application Support/com.apple.TCC/TCC.db" "select client,auth_value from access where service='kTCCServiceAccessibility'"`
     (auth_value 2 = allowed, 0 = denied).
     DANGER: never tell the user to toggle skhd's Accessibility checkbox OFF
     while skhd is running. skhd holds a system-wide keyboard event tap, and
     revoking the permission from the live process can wedge the tap and
     freeze ALL keyboard/mouse input until a forced power-off (this happened
     during a real install). Sequence is always: `skhd --stop-service` →
     change permission → `skhd --start-service`.

5. **End-to-end test.** Run the toggle once (recording starts — first run also
   auto-creates the project, sets its instructions, pins the model; watch the
   log), ask the user to say a sentence, run the toggle again. Success =
   cleaned text lands in the clipboard AND is pasted into the app the user was
   in. Check `/tmp/super-whisper-toggle.log` and `voice status --json` when
   debugging. Also verify: the conversation was deleted from the project, and
   Chrome did NOT steal focus during the flow.

## FIELD NOTES (verified 2026-07-04 — trust these first, adapt if drifted)

All browser control is CDP (chrome-remote-interface): JS clicks via
Runtime.evaluate work in a BACKGROUND tab — never bring the window to front,
that steals the user's focus. Real keystrokes only where noted.

- Dictation buttons: in the composer, aria-labels "Start dictation" to begin
  and "Submit dictation" to finish. The code scores visible buttons by label
  (`src/browser/actions/voiceInput.ts`); candidates are restricted to the
  composer form/dialog because page-level buttons can carry voice-like labels
  — a pinned conversation titled 音声入力… was once clicked as "Unpin …" (bad).
  Pin/unpin labels are hard-excluded.
- Transcript: after "Submit dictation", ChatGPT inserts the text into the
  composer (`#prompt-textarea`). The code waits until the dictation UI is gone
  AND the text has been stable ~700-1500ms; an enabled send button
  (`button[data-testid="send-button"]`) is the "transcription done" accelerator.
- Model pill: `[data-testid="model-switcher-dropdown-button"],
  button.__composer-pill[aria-haspopup="menu"]`. The menu lists EFFORT TIERS,
  not model names: Instant / Medium / High / Extra High / Pro Extended (plus a
  "GPT-5.5" submenu). We pin "Instant" (lightest). If the tier names change,
  pick whatever is the cheapest/fastest tier.
- Project URLs look like `/g/g-p-<32 hex>/project` and NEWLY created projects
  have NO name slug in the URL. Resolved URLs are cached in
  `~/.super-whisper/voice-projects.json`; stale cache self-heals (a deleted
  project redirects away shortly after load — the code requires the path to
  stay stable before trusting it).
- Sidebar project rows are NOT `<a>` anchors: each row is a div with the name
  plus a `button[aria-label="Open project home"]`. chatgpt.com/projects lists
  all projects too.
- Creating a project: sidebar "New project" button → dialog with a name input
  → "Create project" button → lands on the project page.
- Project instructions (THE TRICKY ONE): on the project page click the
  "Show project details" button → menu item "Project settings" (a div with
  role=menuitem) → a dialog with Project name, an "Instructions" textarea,
  Memory, and "Delete project". TWO TRAPS: (1) React ignores JS value
  assignment — you MUST type via CDP Input.insertText after focusing the
  textarea; (2) a "Save" button ONLY APPEARS once the form is dirty, and
  closing without pressing Save silently DISCARDS the text. Verify by
  reopening the dialog and reading the textarea back.
- Disposing of a conversation: header "…" button (options-like label, never
  the sidebar project-options button) → the tool ARCHIVES first (menu item
  matching the archive dictionary; no confirm dialog) and only falls back to
  Delete (menu item testid delete-chat-menu-item → confirm dialog testid
  delete-conversation-confirm-button; URL navigates away on success).
- NEVER dispatch two click events on the send button. An extra .click() after
  the pointer-event sequence once DOUBLE-SENT every transcript (two identical
  conversations per dictation) and tripped ChatGPT's "too many requests"
  limit. Upstream oracle clicks exactly once (dispatchClickSequence) — do the
  same, and verify the send registered (composer emptied / URL moved to /c/ /
  stop button visible) before ever considering a retry click.
- Paste-back: at start, capture the frontmost app with `lsappinfo front` and
  `lsappinfo info -only bundleID -only name <ASN>` (needs NO permissions —
  osascript System Events often fails without Automation grants). At finish,
  activate with `open -b <bundleId>` and send Cmd+V via
  osascript System Events keystroke (needs Accessibility, see step 4).
- The prompts and the user dictionary are LOCAL FILES (source of truth):
  ~/.super-whisper/prompts/normalizer.md, prompts/dictionary-extractor.md,
  dictionary.txt. `super-whisper sync` pushes them to both projects
  (src/whisperPrompts.ts composes; identical content = "nothing to save" is
  success, not an error). The feedback collector appends locally FIRST,
  then pushes the recomposed instructions.
- Per-feature model tiers come from ~/.super-whisper/config.json
  (dictationModel / dictionaryModel; defaults instant / thinking→Medium),
  resolved in src/whisperConfig.ts; --model overrides per invocation.
- Concurrency: hotkey presses that arrive while another voice command is
  running are DROPPED, not queued (toggle gives up on the lock after 1.5s).
  This matters: a queued toggle once fired as "finish" the instant a slow
  cold start completed, submitting the dictation before the user spoke.
  If the state ever wedges, `voice cancel` then `voice start --force`
  recovers, and deleting `~/.super-whisper/voice-input-session.json` is the
  nuclear option.
- After a machine crash Chrome shows a "didn't shut down correctly — restore
  pages?" bubble on the next launch; `--hide-crash-restore-bubble` in
  `src/browser/chromeLifecycle.ts` suppresses it.
- LOCALIZED UI: ChatGPT localizes almost every label to the ACCOUNT language
  (Settings → Language). LIVE-MEASURED locales (2026-07-05): en, ja, zh-Hans,
  zh-Hant(TW), zh-Hant(HK), ko, ru — all in `src/browser/uiLabels.ts` and
  `src/browser/actions/effortTierSelection.ts` with "measured" comments.
  Highlights: TW and HK Traditional Chinese use DIFFERENT terms (項目/置頂/提交
  vs 專案/釘選/送出); ru keeps Instant/Medium/High in English; ja dictation is
  音声入力を開始/音声入力を送信. Stable testids discovered:
  `delete-chat-menu-item` (conversation-menu delete),
  `delete-conversation-confirm-button` (confirm), `settings-menu-item`,
  `accounts-profile-button`, `close-button`. Tier selection also falls back
  to MENU POSITION (Instant = topmost menuitemradio) for unmeasured locales.
- Onboarding popovers ("Got it" / 知道了 / 明白了 …) appear after a language
  change and SWALLOW composer clicks. dismissOnboardingBubbles() in
  `src/browser/actions/voiceInput.ts` clears them before starting dictation;
  add new translations there if a locale's popover still blocks.
- Correction-feedback flow (Ctrl+Shift+Z): its own state file
  (~/.super-whisper/voice-feedback-session.json) and its own tab; dictates
  into the auto-created "Whisper Dictionary" project (mid "Medium" tier)
  whose instructions turn spoken feedback into "wrong(reading) → correct" lines (the reading is inferred romaji, so future transcriptions of the same SOUND also match); the
  finish step sends and immediately returns, and a DETACHED collector
  process (`feedback-collect`, log /tmp/super-whisper-feedback.log) waits
  for the reply in its own tab, appends the pairs to the normalizer's
  instructions under "## User dictionary", deletes the throwaway
  conversation, and posts a macOS notification.
- Conversation-delete hazard: sidebar project rows expose "…のプロジェクト
  オプションを開く" buttons whose menu contains a PROJECT delete. The
  conversation-delete code must only click the conversation header "…"
  (top-right position required, project-ish labels excluded) — never fall
  back to "any options-like button". After a successful delete, wait ~1s
  before navigating away or the deletion may not commit server-side.

## OBSERVABILITY — READ THIS FIRST WHEN DEBUGGING

Every voice run is fully traced. Before probing anything live, reconstruct
what happened from the artifacts in `~/.super-whisper/logs/`:

- `metrics.jsonl` — one line per run: action, status (ok/error/dropped),
  duration, and the error message. `tail -5` tells you instantly whether
  failures are new, frequent, or one-off.
- `trace-<runId>.jsonl` — every log line and milestone of one run as
  structured events with timestamps and elapsed ms. The newest file is the
  latest run: `ls -t ~/.super-whisper/logs/trace-* | head -1`.
- `<runId>-*-failure.png` — a SCREENSHOT of the automated tab taken at the
  moment the run failed. Open it. Nine times out of ten the bug is visible:
  an onboarding popover, a login wall, a renamed button, a stuck spinner.
- `<runId>-*-failure.json` — the page URL plus every visible control
  (tag/role/testid/aria/text) at the failure moment — diff these labels
  against `src/browser/uiLabels.ts` to spot renamed UI strings.

Debug recipe for a reported failure:
1. `tail -5 ~/.super-whisper/logs/metrics.jsonl` — find the failing runId.
2. Open its `-failure.png`. If a control was renamed, the fix is a token in
   `src/browser/uiLabels.ts`; confirm the new label in `-failure.json`.
3. Read `trace-<runId>.jsonl` to see which step the time went to and what
   the last successful action was.
4. Only then fall back to the live probe loop below.

Old runs are pruned automatically (last 200 kept). The human-readable
mirror of every trace is /tmp/super-whisper-toggle.log.

## HOW EVERY FACT ABOVE WAS DISCOVERED (repeat this method when stuck)

None of the field notes came from documentation — each one came out of the
same short debugging loop. When a step fails for you, don't search the web
for "chatgpt selectors"; run this loop instead:

1. Get a live handle on the page. `voice status --json` gives chromePort and
   chromeTargetId. `fetch http://127.0.0.1:<port>/json/list`, find the target,
   open its webSocketDebuggerUrl with plain Node (global WebSocket — no
   libraries needed), and send Runtime.evaluate. Write these as tiny throwaway
   .mjs scripts; five lines of boilerplate is enough.

2. Dump visible controls BEFORE and AFTER each click:

   ```js
   Array.from(document.querySelectorAll('button,[role="button"],[role="menuitem"],[role="tab"],textarea,input'))
     .filter(el => el.offsetParent)
     .map(el => [el.tagName, el.getAttribute('aria-label'),
                 el.getAttribute('data-testid'), el.getAttribute('placeholder'),
                 (el.textContent||'').trim().slice(0,80)].join(' | '))
   ```

   The before/after DIFF is the answer to "what did that click open?". That is
   exactly how "Show project details" was found to open a menu containing
   "Project settings", and what the settings dialog contains.

3. Scope the dump. A whole-page dump is drowned in sidebar noise; dump inside
   `document.querySelector('main')` or the open `[role="dialog"]` instead. The
   instructions dialog's structure was only visible after scoping to dialogs.

4. Change state FIRST, then dump. The "Save" button does not exist until the
   form is dirty — a pristine-dialog dump shows only "Close". Typing one probe
   string via Input.insertText and dumping again is what revealed
   Cancel/Save. If a dump looks incomplete, ask "what state am I missing?".

5. Never trust a click that "didn't error" — verify the effect and READ BACK:
   after saving instructions, reopen the dialog and read textarea.value (this
   is how we caught that Close silently discards; the value read back empty).
   After a model pick, read the pill label. After a delete, check
   location.href changed. Every mutation needs its own read-back check.

6. Read the failure artifacts you already have. The tool's error messages
   include the visible candidate button labels (that is how the wrong-click on
   "Unpin 音声入力修正ガイド" was diagnosed — the "success" log line named the
   button it clicked). Also check `/tmp/super-whisper-toggle.log` and run with
   `-v`. When a click lands on the wrong thing, the fix is usually to narrow
   the candidate roots (composer/dialog only) or add the bad label to the
   exclusion list in the scorer, not to loosen the match.

7. Beware React. `element.value = 'x'` looks like it worked (the DOM shows it)
   but React state never updates and the UI discards it. Real input goes
   through CDP Input.insertText on a focused field. If typed text vanishes on
   save, this is why.

## WHEN THE UI HAS CHANGED

Run the loop above, find the control that MEANS the same thing, then update
the matching scorer or selector. FIRST place to look:
`src/browser/uiLabels.ts` — the central multilingual dictionary of every UI
label the tool matches (en/ja verified live; zh/ko/es/fr/de/pt/ru are
best-effort translations). A wrong or missing translation is fixed there, in
one place. Structural changes go in: dictation/send →
`src/browser/actions/voiceInput.ts`, model pill →
`src/browser/actions/modelSelection.ts` + `src/browser/constants.ts`, project
create/instructions/delete → `src/browser/actions/voiceProject.ts`, generic
selectors → `src/browser/constants.ts`. Re-run the failing step after each
patch. That loop — probe, patch, read back, retry — is exactly how this
package was built in the first place; you are not doing something unusual,
you are continuing its normal development process.
