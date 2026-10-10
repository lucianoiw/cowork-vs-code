#!/bin/bash
# Installs the /bridge skill for Claude Code in the user scope.
set -e
SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/.claude/skills/bridge"
mkdir -p "$DEST"
cp "$SRC/SKILL.md" "$SRC/wait-task.sh" "$DEST/"
chmod +x "$DEST/wait-task.sh"
echo "Installed /bridge skill at $DEST"
