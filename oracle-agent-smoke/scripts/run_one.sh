#!/usr/bin/env bash
set -u

name="${1:?name required}"
root="/Users/nonaka/tasks/oracle-setup/oracle-agent-smoke"
prompt="$root/prompts/$name.md"
log="$root/logs/$name.log"
final="$root/logs/$name.final.txt"

mkdir -p "$root/logs"
exec > >(tee -a "$log") 2>&1

echo "=== AGENT_SMOKE_START $name $(date '+%Y-%m-%dT%H:%M:%S%z') ==="
echo "root=$root"
echo "prompt=$prompt"
echo "log=$log"
echo "oracle=$(command -v oracle)"
oracle --version || true

if [[ ! -f "$prompt" ]]; then
  echo "Missing prompt: $prompt"
  echo "=== AGENT_SMOKE_EXIT $name code=2 $(date -Is) ==="
  exit 2
fi

cd "$root" || exit 2

case "$name" in
  codex-*)
    codex exec \
      -C "$root" \
      --skip-git-repo-check \
      --dangerously-bypass-approvals-and-sandbox \
      --output-last-message "$final" \
      - < "$prompt"
    code=$?
    ;;
  claude-*)
    claude -p \
      --permission-mode bypassPermissions \
      --output-format text \
      --add-dir "$root" \
      -- \
      "$(cat "$prompt")"
    code=$?
    ;;
  opencode-*)
    opencode run \
      --dir "$root" \
      --model "${OPENCODE_SMOKE_MODEL:-opencode/big-pickle}" \
      --dangerously-skip-permissions \
      --title "$name" \
      "$(cat "$prompt")"
    code=$?
    ;;
  *)
    echo "Unknown smoke name: $name"
    code=2
    ;;
esac

echo "=== AGENT_SMOKE_EXIT $name code=$code $(date '+%Y-%m-%dT%H:%M:%S%z') ==="
exit "$code"
