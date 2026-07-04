#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

# ------------------------------------------------------------------------------
# super-whisper installer (entry point)
#
# 1. You pick the two hotkeys (validated against skhd syntax, with warnings
#    for combos that clash with common shortcuts).
# 2. You pick an AI coding agent (claude / codex / opencode) — it runs the
#    deterministic ./install-core.sh and, if anything fails, reads
#    AI-SETUP-GUIDE.md and finishes the setup on its own. No agent? Choose
#    "n" and install-core.sh runs directly.
# ------------------------------------------------------------------------------

echo "super-whisper — push-to-talk dictation, cleaned up by ChatGPT, pasted back where you were typing."
echo

# --- Step A: hotkeys ----------------------------------------------------------

# skhd syntax: modifiers joined by " + ", then " - ", then one key.
# e.g. "ctrl - z", "ctrl + shift - z", "ctrl + alt - v", "fn - f13"
valid_hotkey() {
  printf '%s' "$1" | grep -Eq \
    '^(ctrl|alt|cmd|shift|fn|hyper|meh)( \+ (ctrl|alt|cmd|shift|fn|hyper|meh))* - ([a-z0-9]|f[0-9]{1,2}|space|tab|return|escape|delete|home|end|pageup|pagedown|left|right|up|down)$'
}

# NB: prints to stderr — ask_hotkey's result is captured via $( ), so stdout
# must carry only the hotkey string itself.
warn_if_common() {
  case "$1" in
    "cmd - q"|"cmd - w"|"cmd - c"|"cmd - v"|"cmd - x"|"cmd - a"|"cmd - s"|"cmd - t"|"cmd - z"|"cmd - space"|"ctrl - c"|"ctrl - d")
      echo "  ⚠ '$1' is heavily used by macOS/apps and will be captured GLOBALLY. Pick it only if you are sure." >&2 ;;
    "ctrl - z")
      echo "  note: 'ctrl - z' suspends processes in terminals; as a global hotkey the terminal will no longer see it." >&2 ;;
  esac
}

ask_hotkey() {
  local label="$1" default="$2" input=""
  while true; do
    read -r -p "$label [default: $default]: " input
    input="${input:-$default}"
    if valid_hotkey "$input"; then
      warn_if_common "$input"
      printf '%s' "$input"
      return
    fi
    echo "  Invalid skhd syntax. Format: modifiers joined by ' + ', then ' - key'." >&2
    echo "  Examples: 'ctrl - z'   'ctrl + shift - z'   'ctrl + alt - v'   'fn - f13'" >&2
  done
}

echo "Choose your hotkeys (skhd syntax; press Enter to accept the default)."
HOTKEY="$(ask_hotkey "Dictation hotkey" "ctrl - z")"
echo
while true; do
  FEEDBACK_HOTKEY="$(ask_hotkey "Dictionary-feedback hotkey" "ctrl + shift - z")"
  [ "$FEEDBACK_HOTKEY" != "$HOTKEY" ] && break
  echo "  The two hotkeys must be different." >&2
done
echo
echo "  dictation:  $HOTKEY"
echo "  dictionary: $FEEDBACK_HOTKEY"
export SUPER_WHISPER_HOTKEY="$HOTKEY"
export SUPER_WHISPER_FEEDBACK_HOTKEY="$FEEDBACK_HOTKEY"

# --- Step B: agent ------------------------------------------------------------

echo
echo "Which AI coding agent should run the setup (and fix anything that breaks)?"
echo "  1) claude    (Claude Code)"
echo "  2) codex     (OpenAI Codex CLI)"
echo "  3) opencode  (opencode CLI)"
echo "  n) none — just run the deterministic script myself"
AGENT="${1:-}"
if [ -z "$AGENT" ]; then
  read -r -p "Choose [1-3/n]: " choice
  case "$choice" in
    1|claude) AGENT="claude" ;;
    2|codex) AGENT="codex" ;;
    3|opencode) AGENT="opencode" ;;
    n|N|none|"") AGENT="none" ;;
    *) echo "Unknown choice: $choice" >&2; exit 1 ;;
  esac
fi

if [ "$AGENT" = "none" ]; then
  exec ./install-core.sh
fi

command -v "$AGENT" >/dev/null 2>&1 \
  || { echo "'$AGENT' is not installed or not on PATH. Install it first, or re-run and choose 'n'." >&2; exit 1; }

PROMPT="Set up super-whisper on this machine. Work in this directory. Talk to the user in THEIR language (if they write Japanese, answer in Japanese).

1. Run: SUPER_WHISPER_HOTKEY='$HOTKEY' SUPER_WHISPER_FEEDBACK_HOTKEY='$FEEDBACK_HOTKEY' ./install-core.sh
2. If it fails at any step — or anything is broken afterwards — read AI-SETUP-GUIDE.md and keep going until the setup is COMPLETE: the end-to-end test (press the hotkey, user speaks, press again, cleaned text lands in the clipboard and is pasted back) must pass.
3. The macOS permission prompts (microphone for Chrome, Accessibility for skhd and node) must be clicked by the user — guide them through it, and remember: never toggle skhd's Accessibility checkbox while skhd is running (stop it first), as documented in the guide."

echo
echo "Launching $AGENT..."
case "$AGENT" in
  claude)   exec claude "$PROMPT" ;;
  codex)    exec codex "$PROMPT" ;;
  opencode) exec opencode run "$PROMPT" ;;
esac
