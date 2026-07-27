#!/bin/bash
# .claude/hooks/session-context.sh — SessionStart hook
#
# Surfaces the live TASK_QUEUE.md / PROGRESS.md state as context automatically, so every
# session starts already oriented — nobody has to open with "read TASK_QUEUE.md and tell me
# what's current." Also records the starting commit SHA so the Stop hook
# (require-clean-handoff.sh) can tell whether this session committed code without updating the
# tracking files.
#
# Plain stdout is enough here: SessionStart forwards stdout to Claude as context directly, no
# JSON wrapper needed.

if [ -f TASK_QUEUE.md ]; then
  echo "=== TASK_QUEUE.md (current state) ==="
  head -c 6000 TASK_QUEUE.md
  echo ""
fi

if [ -f PROGRESS.md ]; then
  echo "=== PROGRESS.md (current state) ==="
  head -c 3000 PROGRESS.md
  echo ""
fi

if git rev-parse --git-dir > /dev/null 2>&1; then
  mkdir -p .claude
  git rev-parse HEAD > .claude/.session-start-sha 2>/dev/null || echo "no-commits-yet" > .claude/.session-start-sha
fi

exit 0
