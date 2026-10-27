#!/bin/bash
# Cowork bridge: rings the doorbell through another Claude account, for a Code
# session logged into an account that cannot run the doorbell's scheduled task.
# Run from the project root. Reads the id from .bridge/doorbell and the config
# dir of the account that owns Cowork from .bridge/ring-config-dir.
# Exit 0: fired. Exit 1: failed. Exit 3: no ring-config-dir (ring the normal way).
DIR="$(pwd)/.bridge"

if [ ! -f "$DIR/ring-config-dir" ]; then
  echo "no ring-config-dir"
  exit 3
fi

if [ ! -f "$DIR/doorbell" ]; then
  echo "ring.sh: $DIR/doorbell not found" >&2
  exit 1
fi
ID=$(head -n 1 "$DIR/doorbell" | tr -d '[:space:]')
case "$ID" in
  trig_?*) ;;
  *) echo "ring.sh: $DIR/doorbell does not hold a trig_... id" >&2; exit 1 ;;
esac

CONFIG_DIR=$(head -n 1 "$DIR/ring-config-dir" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')
case "$CONFIG_DIR" in
  "~") CONFIG_DIR="$HOME" ;;
  "~/"*) CONFIG_DIR="$HOME/${CONFIG_DIR#\~/}" ;;
  /*) ;;
  *) echo "ring.sh: $DIR/ring-config-dir must hold an absolute path or one starting with ~" >&2; exit 1 ;;
esac

PROMPT="Fire the scheduled task $ID with no text, using your remote trigger tool. Do nothing else. Reply with exactly FIRED on success or FAILED: <reason> otherwise."

TIMEOUT=()
if command -v timeout >/dev/null 2>&1; then
  TIMEOUT=(timeout 120)
elif command -v gtimeout >/dev/null 2>&1; then
  TIMEOUT=(gtimeout 120)
fi

# Drop the calling session's vars (nested-session guard, tokens that would beat
# CLAUDE_CONFIG_DIR) and run from $HOME so no project CLAUDE.md or settings load.
REPLY=$(cd "$HOME" && env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN -u CLAUDE_CODE_OAUTH_TOKEN CLAUDE_CONFIG_DIR="$CONFIG_DIR" "${TIMEOUT[@]}" claude -p --model haiku "$PROMPT")
echo "$REPLY"
case "$REPLY" in
  *FAILED*) exit 1 ;;
  *FIRED*) exit 0 ;;
  *) exit 1 ;;
esac
