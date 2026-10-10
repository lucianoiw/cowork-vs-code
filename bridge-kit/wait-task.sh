#!/bin/bash
# Cowork bridge: blocks until at least one task lands in <bridge-dir>/inbox,
# moves every pending task to working/, prints one NEW_TASK line per task and exits.
# If <bridge-dir>/stop exists, prints BRIDGE_STOP and exits without touching the inbox.
# Meant to run as a background command: no output and no model turns while waiting.
DIR="${1:-$(pwd)/.bridge}"
mkdir -p "$DIR/inbox" "$DIR/working" "$DIR/outbox" "$DIR/done"
while true; do
  if [ -f "$DIR/stop" ]; then
    echo "BRIDGE_STOP"
    exit 0
  fi
  tasks=$(ls -1 "$DIR/inbox" 2>/dev/null | grep '\.md$' | sort)
  if [ -n "$tasks" ]; then
    sleep 2  # let a batch finish landing
    for f in $(ls -1 "$DIR/inbox" 2>/dev/null | grep '\.md$' | sort); do
      mv "$DIR/inbox/$f" "$DIR/working/$f" && echo "NEW_TASK $f"
    done
    exit 0
  fi
  sleep 3
done
