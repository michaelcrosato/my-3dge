#!/usr/bin/env bash
# .claude/hooks/session-start.sh: the SessionStart hook (PLAN.md §8.10, WP 0.10), carried from my-3d2dge's and ported:
# the platform comes from scripts/setup.sh, and the session opens on the sources and the open escalations.
#
# On a new or resumed session ("source": "startup" or "resume" in the JSON on stdin):
#   1. bash scripts/setup.sh, its output in out/hooks/session-start.log: Node 24 (.nvmrc) when the container lacks
#      it (nothing is installed when it is active), the read-only source checkouts, npm ci (node_modules/.cache/,
#      the lint and format caches, is kept across it);
#   2. appends to $CLAUDE_ENV_FILE, each line once: Node 24's PATH first (login shells put the container's
#      /opt/node22 first, and Claude Code sources this file after them), MY3D2DGE_SRC and SHARDFALL_SRC;
#   3. node x src, node x esc list --open, and node x deps --update --dry-run (network; 60 s at most).
# After /clear or a compaction it skips setup.sh and x deps, and repeats the rest.
#
# Prints at most 20 lines, which Claude Code adds to the session's context, and always exits 0: a network error or a
# failed step is reported, never fatal. $CLAUDE_PROJECT_DIR names the project (default: this repository), so tests
# run it against a fixture project (tests/unit/hooks/session-start.test.ts).

set -uo pipefail

input=""
[ -t 0 ] || input="$(cat 2>/dev/null || true)"
kind="$(printf '%s' "$input" | sed -n 's/.*"source"[[:space:]]*:[[:space:]]*"\([a-z]*\)".*/\1/p' | head -n 1)"
project="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
cd "$project" 2>/dev/null || {
  echo "session-start: no project at $project"
  exit 0
}

lines=()
say() { lines+=("$*"); }
# Keeps the first $1 non-empty lines of $2.
keep() {
  local max="$1" n=0 line
  while IFS= read -r line; do
    [ -n "$line" ] || continue
    n=$((n + 1))
    [ "$n" -le "$max" ] && say "$line"
  done <<<"$2"
}
# Appends one line to $CLAUDE_ENV_FILE, unless it is unset or already holds the line.
append_env() {
  [ -n "${CLAUDE_ENV_FILE:-}" ] || return 0
  touch "$CLAUDE_ENV_FILE" 2>/dev/null || return 0
  grep -qxF -- "$1" "$CLAUDE_ENV_FILE" || printf '%s\n' "$1" >>"$CLAUDE_ENV_FILE"
}
# Runs a command for at most $1 seconds.
limit() {
  local seconds="$1"
  shift
  if command -v timeout >/dev/null 2>&1; then timeout "$seconds" "$@"; else "$@"; fi
}
# node x <args>, at most $1 seconds, without the report line.
x() {
  local seconds="$1"
  shift
  limit "$seconds" node x "$@" 2>&1 | grep -v '^report: '
}

full=1
[ "$kind" = clear ] || [ "$kind" = compact ] && full=0

# 1. The platform.
if [ "$full" = 1 ]; then
  log=out/hooks/session-start.log
  kept=out/hooks/kept-cache
  mkdir -p out/hooks
  # npm ci empties node_modules: the ESLint and Prettier caches in node_modules/.cache/ wait aside, as in x ci.
  rm -rf "$kept"
  [ -d node_modules/.cache ] && mv node_modules/.cache "$kept"
  if limit 900 bash scripts/setup.sh >"$log" 2>&1; then status=ok; else status="FAIL (exit $?)"; fi
  if [ -d "$kept" ] && [ -d node_modules ]; then
    rm -rf node_modules/.cache
    mv "$kept" node_modules/.cache
  fi
  say "session-start: scripts/setup.sh $status (log: $log)"
  keep 4 "$(grep -E '^setup: (warning|error|offline|installed|keeping)' "$log")"
fi

# 2. Later shells: Node 24 first, and the sources.
want="$(tr -d ' \t\r\nv' <.nvmrc 2>/dev/null)"
node24=""
if [ "$(node --version 2>/dev/null)" = "v$want" ]; then
  node24="$(dirname "$(readlink -f "$(command -v node)")")"
elif [ -x "$HOME/.cache/my3dge/node-v$want-linux-x64/bin/node" ]; then
  node24="$HOME/.cache/my3dge/node-v$want-linux-x64/bin"
fi
if [ -n "$node24" ]; then
  export PATH="$node24:$PATH"
  append_env "export PATH=\"$node24:\$PATH\""
fi
src="$(x 60 src)"
# setup.sh appends the source lines; x src's resolution is the same, so these only repeat them if setup.sh stopped.
while IFS= read -r line; do
  if [[ "$line" =~ ^([A-Z0-9_]+_SRC)=(/[^[:space:]]+) ]]; then
    append_env "export ${BASH_REMATCH[1]}=\"${BASH_REMATCH[2]}\""
  fi
done <<<"$src"
if [ -z "${CLAUDE_ENV_FILE:-}" ]; then
  say "session-start: CLAUDE_ENV_FILE is unset: later shells need the export lines of $project/out/hooks/session-start.log"
elif [ -n "$node24" ]; then
  say "session-start: \$CLAUDE_ENV_FILE puts Node $want first on PATH and sets MY3D2DGE_SRC and SHARDFALL_SRC"
else
  say "session-start: Node $want is unavailable (offline?): later shells keep Node $(node --version 2>/dev/null)"
fi

# 3. Where things stand.
keep 3 "$src"
keep 8 "$(x 30 esc list --open)"
[ "$full" = 1 ] && keep 3 "$(x 60 deps --update --dry-run)"

printf '%s\n' "${lines[@]:0:20}"
exit 0
