#!/bin/bash
# .claude/hooks/block-force-push.sh — PreToolUse hook, matched to Bash
#
# The orchestrate workflow manages git pushes autonomously (see .claude/commands/orchestrate.md
# step 6). This blocks the two git operations that autonomy should never need: rewriting remote
# history and deleting a remote branch. If either is genuinely intended, do it by hand outside
# Claude Code.

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)

if [ -z "$COMMAND" ] && command -v python3 >/dev/null 2>&1; then
  COMMAND=$(echo "$INPUT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('tool_input',{}).get('command',''))" 2>/dev/null)
fi

if [ -z "$COMMAND" ]; then
  exit 0
fi

if echo "$COMMAND" | grep -qE 'git[[:space:]]+push[^|&;]*(--force-with-lease|--force|[[:space:]]-f([[:space:]]|$))'; then
  echo "BLOCKED: force-push detected in '$COMMAND'. The autonomous workflow should never need to rewrite remote history — if this is genuinely intentional, run it by hand outside Claude Code." >&2
  exit 2
fi

if echo "$COMMAND" | grep -qE 'git[[:space:]]+push[^|&;]*(--delete|-d[[:space:]]|[[:space:]]:[A-Za-z0-9_./-]+)'; then
  echo "BLOCKED: this looks like a remote branch deletion in '$COMMAND'. Do this by hand if it's genuinely intended." >&2
  exit 2
fi

exit 0
