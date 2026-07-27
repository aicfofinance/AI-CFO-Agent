#!/bin/bash
# .claude/hooks/require-clean-handoff.sh — Stop hook
#
# The orchestrate command's own instructions say "always update TASK_QUEUE.md and PROGRESS.md
# before ending your turn" — this hook is the enforcement, in case a long autonomous run ever
# skips that step under context pressure. It refuses to let the turn end if:
#   1. There are uncommitted changes still on the working tree, or
#   2. This session made commits, but none of them touched TASK_QUEUE.md or PROGRESS.md.
#
# Exit 2 on Stop means "don't stop — here's why," and Claude sees the stderr message and keeps
# going. This is a safety net, not the primary mechanism — the command's own step 7 should
# normally satisfy this before it ever fires.

if ! git rev-parse --git-dir > /dev/null 2>&1; then
  exit 0  # no repo yet (e.g. before Step 1.0's scaffold) — nothing to enforce
fi

# .claude/.session-start-sha is excluded from the dirty-tree check below via pathspec, but it
# should also be in .gitignore so `git add -A` in the orchestrate workflow doesn't churn it into
# every commit.

DIRTY=$(git status --porcelain -- . ':!.claude/.session-start-sha' 2>/dev/null)
if [ -n "$DIRTY" ]; then
  echo "Uncommitted changes are still on the working tree. Commit and push before ending this turn, per the orchestrate workflow's step 6." >&2
  exit 2
fi

START_SHA_FILE=".claude/.session-start-sha"
if [ -f "$START_SHA_FILE" ]; then
  START_SHA=$(cat "$START_SHA_FILE")
  CURRENT_SHA=$(git rev-parse HEAD 2>/dev/null)
  if [ "$START_SHA" != "no-commits-yet" ] && [ "$START_SHA" != "$CURRENT_SHA" ]; then
    CHANGED=$(git diff --name-only "$START_SHA" "$CURRENT_SHA" 2>/dev/null)
    if ! echo "$CHANGED" | grep -q "TASK_QUEUE.md" || ! echo "$CHANGED" | grep -q "PROGRESS.md"; then
      echo "This session committed code, but TASK_QUEUE.md and/or PROGRESS.md weren't part of any commit made this session. Update both to reflect what actually happened, then commit and push again, before ending — the next session depends on these being current." >&2
      exit 2
    fi
  fi
fi

exit 0
