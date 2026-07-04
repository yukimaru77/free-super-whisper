#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
WHISPER_DIR="$(pwd)"

# ------------------------------------------------------------------------------
# super-whisper installer — deterministic version.
#
# Every step below is exactly what was done by hand on a working setup
# (macOS, 2026-07-04). If any step fails, or the tool later breaks because
# ChatGPT's web UI changed, hand AI-SETUP-GUIDE.md to an AI coding agent
# (Claude Code / Codex / opencode) — it contains the full field notes and the
# probe-and-patch method used to build this package.
# ------------------------------------------------------------------------------

HOTKEY="${SUPER_WHISPER_HOTKEY:-ctrl - z}"
FEEDBACK_HOTKEY="${SUPER_WHISPER_FEEDBACK_HOTKEY:-ctrl + shift - z}"
TOGGLE_SCRIPT="$HOME/.local/bin/super-whisper-toggle"
FEEDBACK_SCRIPT="$HOME/.local/bin/super-whisper-feedback"
SKHDRC="$HOME/.skhdrc"
PROFILE_DIR="${SUPER_WHISPER_BROWSER_PROFILE_DIR:-$HOME/.super-whisper/browser-profile}"

step() { CURRENT_STEP="$1"; printf '\n\033[1m== %s ==\033[0m\n' "$1"; }

CURRENT_STEP="startup"

# On failure: report precisely; the caller (a human, or the AI agent launched
# by ./install.sh) decides how to recover. AI-SETUP-GUIDE.md has the playbook.
fail() {
  printf '\nERROR at step [%s]: %s\n' "$CURRENT_STEP" "$1" >&2
  printf 'Fix hint: %s\n' "$2" >&2
  printf 'Repair playbook: AI-SETUP-GUIDE.md (give it to an AI coding agent).\n' >&2
  exit 1
}

step "1/5 Prerequisites"
[ "$(uname)" = "Darwin" ] || fail "macOS only" "the paste-back uses lsappinfo/open/System Events, which only exist on macOS"

command -v node >/dev/null 2>&1 || fail "Node.js not found" "brew install node (need >= 20)"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 20 ] || fail "Node.js $NODE_MAJOR is too old" "need Node >= 20; brew upgrade node"

[ -d "/Applications/Google Chrome.app" ] || [ -d "$HOME/Applications/Google Chrome.app" ] \
  || fail "Google Chrome not found" "install it from https://google.com/chrome (the tool drives Chrome over the DevTools protocol)"

command -v skhd >/dev/null 2>&1 || fail "skhd not found" "brew install koekeishiya/formulae/skhd (provides the global hotkey)"

if command -v pnpm >/dev/null 2>&1; then PKG=pnpm; else PKG=npm; fi
echo "node $(node --version), $PKG, Chrome, skhd — OK"

step "2/5 Install dependencies and verify the CLI"
"$PKG" install
npx tsc --noEmit || fail "TypeScript check failed" "the source should compile untouched; did the download get corrupted?"
node --no-deprecation --import tsx bin/super-whisper.ts voice status >/dev/null \
  || fail "CLI smoke test failed" "run: node --no-deprecation --import tsx bin/super-whisper.ts voice status -v"
echo "dependencies installed, tsc clean, CLI runs — OK"

step "3/5 ChatGPT sign-in (one-time, private Chrome profile)"
if [ -d "$PROFILE_DIR/Default" ]; then
  echo "browser profile already exists at $PROFILE_DIR — skipping."
  echo "(to re-sign-in later: node --no-deprecation --import tsx bin/super-whisper.ts login)"
else
  echo "A Chrome window will open on ChatGPT's login page."
  echo ">>> Sign in to ChatGPT in that window. This script waits until you're done. <<<"
  node --no-deprecation --import tsx bin/super-whisper.ts login \
    || fail "login did not complete" "re-run ./install.sh, or run the login command manually and sign in within 10 minutes"
fi

step "4/5 Hotkeys ($HOTKEY = dictate, $FEEDBACK_HOTKEY = teach corrections; via skhd)"
mkdir -p "$HOME/.local/bin"
cat > "$TOGGLE_SCRIPT" <<EOF
#!/bin/bash
set -euo pipefail
cd "$WHISPER_DIR"
exec /usr/bin/env node --no-deprecation --import tsx bin/super-whisper.ts voice toggle >> /tmp/super-whisper-toggle.log 2>&1
EOF
chmod +x "$TOGGLE_SCRIPT"
cat > "$FEEDBACK_SCRIPT" <<EOF
#!/bin/bash
set -euo pipefail
cd "$WHISPER_DIR"
exec /usr/bin/env node --no-deprecation --import tsx bin/super-whisper.ts voice toggle --feedback >> /tmp/super-whisper-toggle.log 2>&1
EOF
chmod +x "$FEEDBACK_SCRIPT"
echo "wrote $TOGGLE_SCRIPT and $FEEDBACK_SCRIPT"

touch "$SKHDRC"
if grep -q "super-whisper-toggle" "$SKHDRC"; then
  echo "~/.skhdrc already has an super-whisper-toggle binding — leaving it as is."
else
  printf '%s\n' "$HOTKEY : \$HOME/.local/bin/super-whisper-toggle &" >> "$SKHDRC"
  echo "appended to ~/.skhdrc: $HOTKEY -> super-whisper-toggle"
fi
if grep -q "super-whisper-feedback" "$SKHDRC"; then
  echo "~/.skhdrc already has an super-whisper-feedback binding — leaving it as is."
else
  printf '%s\n' "$FEEDBACK_HOTKEY : \$HOME/.local/bin/super-whisper-feedback &" >> "$SKHDRC"
  echo "appended to ~/.skhdrc: $FEEDBACK_HOTKEY -> super-whisper-feedback"
fi
echo "(different keys? re-run with e.g.: SUPER_WHISPER_HOTKEY='ctrl - alt - v' SUPER_WHISPER_FEEDBACK_HOTKEY='ctrl + alt - c' ./install.sh)"

skhd --restart-service >/dev/null 2>&1 || brew services restart skhd >/dev/null 2>&1 \
  || fail "could not (re)start skhd" "run 'skhd --start-service' manually; check 'brew services list'"
sleep 1
pgrep -x skhd >/dev/null || fail "skhd is not running after restart" "run 'skhd --start-service'; macOS may ask you to allow skhd under Privacy & Security"
echo "skhd running — OK"

step "5/5 One-time macOS permission clicks (cannot be automated)"
cat <<'EONOTE'
  1. Microphone — the FIRST time you dictate, macOS asks
     "Google Chrome would like to access the microphone" → Allow.
  2. Accessibility — the paste-back sends Cmd+V via System Events. Allow
     *skhd* under System Settings → Privacy & Security → Accessibility,
     then run `skhd --restart-service` — the grant only takes effect after
     the running skhd process restarts. (If pasting fails with error 1002,
     this is why. The text is still on the clipboard.)
     Don't want auto-paste? Add --no-paste to ~/.local/bin/super-whisper-toggle.

     !! WARNING: never toggle skhd's Accessibility checkbox OFF while skhd
     is running — its keyboard event tap can wedge and freeze ALL keyboard
     and mouse input system-wide (only a forced power-off recovers).
     Always `skhd --stop-service` FIRST, change the permission, then
     `skhd --start-service`.

Setup complete. Try it:
  - click into any text field, press the dictate hotkey, speak a sentence,
    press it again → the cleaned-up text is pasted where you were.
  - teach corrections by voice: press the feedback hotkey, say e.g.
    "「オラクル」は英語の oracle にして", press it again → the pair is
    extracted in the background and added to your personal dictionary
    (a macOS notification confirms it). Future dictations apply it.
  - first run auto-creates the "Transcript Normalizer" and
    "Whisper Dictionary" ChatGPT projects.
  - debugging: tail -f /tmp/super-whisper-toggle.log
    and /tmp/super-whisper-feedback.log
  - broken after a ChatGPT UI change? → AI-SETUP-GUIDE.md
EONOTE
