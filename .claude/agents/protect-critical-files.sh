#!/bin/bash
# .claude/hooks/protect-critical-files.sh
#
# PreToolUse hook matched to Edit|Write. Blocks edits to the handful of files CLAUDE.md
# calls "absolute no-touch-adjacent zones" — regardless of which agent (or which orchestrator
# prompt) is attempting the edit. Prose rules in CLAUDE.md / AGENTS.md are followed well most
# of the time, but these five files are exactly the ones where "mostly followed" isn't good
# enough, per CLAUDE.md's own Rule 3 amplification.
#
# This is a deliberately short list. It is NOT a per-agent path allowlist — that would be
# brittle, since e.g. every agent legitimately needs to *read* schema.ts. This only blocks
# WRITES to the small set of files where a well-intentioned edit becomes a security incident.
#
# To make an intentional change to one of these files, edit it by hand outside Claude Code,
# or comment out its line below for the duration of one task and restore it afterward.

INPUT=$(cat)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)

# Fallback if jq isn't installed: try python3 instead.
if [ -z "$FILE_PATH" ] && command -v python3 >/dev/null 2>&1; then
  FILE_PATH=$(echo "$INPUT" | python3 -c "import json,sys; print(json.load(sys.stdin).get('tool_input',{}).get('file_path',''))" 2>/dev/null)
fi

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

PROTECTED_PATTERNS=(
  "src/lib/platform/db/rls-policies.sql"
  "src/lib/platform/auth/encryption.ts"
  "src/lib/ai/models/router.ts"
  "src/lib/financial/calculations/"
  "src/lib/platform/db/migrations/"
)

for pattern in "${PROTECTED_PATTERNS[@]}"; do
  if [[ "$FILE_PATH" == *"$pattern"* ]]; then
    echo "BLOCKED: $FILE_PATH matches a CLAUDE.md no-touch-adjacent zone ('$pattern')." >&2
    echo "If this task genuinely requires the change, tell the person directly and ask them to" >&2
    echo "make the edit by hand, or to temporarily remove this pattern from" >&2
    echo ".claude/hooks/protect-critical-files.sh." >&2
    exit 2
  fi
done

exit 0
