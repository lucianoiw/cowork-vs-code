#!/bin/bash
[ -f "${CLAUDE_PROJECT_DIR:-$(pwd)}/.bridge/disabled" ] && exit 0
# Stop hook: waits for a task from Cowork in .bridge/inbox and tells Claude Code to run it.
DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}/.bridge"
MAX_WAIT=3300   # seconds (hook timeout is 3600)
waited=0
while [ $waited -lt $MAX_WAIT ]; do
  task=$(ls -1 "$DIR/inbox" 2>/dev/null | grep '\.md$' | sort | head -n 1)
  if [ -n "$task" ]; then
    mv "$DIR/inbox/$task" "$DIR/working/$task"
    printf '{"decision":"block","reason":"New task from Cowork. Read .bridge/working/%s and execute it. When finished, write a concise report (what changed, files touched, test results, open issues) to .bridge/outbox/%s, then move .bridge/working/%s to .bridge/done/%s."}\n' "$task" "$task" "$task" "$task"
    exit 0
  fi
  sleep 3
  waited=$((waited + 3))
done
exit 0
