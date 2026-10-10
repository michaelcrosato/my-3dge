#!/usr/bin/env bash
# scripts/setup.sh: the development platform (PLAN.md §6.10, WP 0.1). Idempotent: run it as often as you like.
#
#   bash scripts/setup.sh
#
# 1. Node. When the active `node` is not the version in .nvmrc, it downloads the official Linux x64 build from
#    nodejs.org, checks it against SHASUMS256.txt, unpacks it under ~/.cache/my3dge/ (once), puts it first on PATH
#    for the rest of this script, and appends that PATH to $CLAUDE_ENV_FILE when the variable is set, so later
#    Claude Code shells use it. Offline, it says so and keeps the active Node (everything also runs on Node 22;
#    Node goldens are recorded on 24).
# 2. The read-only source checkouts. $MY3D2DGE_SRC (my-3d2dge@e37e4ee) and $SHARDFALL_SRC (shardfall@fa2dab6) are
#    resolved in this order: the environment variable; else an existing local clone, cloned with
#    `git clone --shared` into .cache/src-3d2dge or .cache/src-shardfall; else a clone from GitHub. Either clone is
#    then detached at the pinned commit. The resolved paths are printed, and appended to $CLAUDE_ENV_FILE when set.
# 3. `npm ci`.
#
# Exit status: 0 when the dependencies are installed (an offline Node download or an unreachable source only warns);
# 1 when `npm ci` fails.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

say() { printf 'setup: %s\n' "$*"; }

# Appends one line to $CLAUDE_ENV_FILE, unless the variable is unset or the line is already there.
append_env_line() {
  local line="$1"
  [ -n "${CLAUDE_ENV_FILE:-}" ] || return 0
  touch "$CLAUDE_ENV_FILE"
  grep -qxF -- "$line" "$CLAUDE_ENV_FILE" || printf '%s\n' "$line" >>"$CLAUDE_ENV_FILE"
}

# ---------------------------------------------------------------------------------------------------------------------
# 1. Node
# ---------------------------------------------------------------------------------------------------------------------

want_version="$(tr -d ' \t\r\nv' <.nvmrc)"
active_version="$(node --version 2>/dev/null | tr -d 'v' || true)"
cache_dir="$HOME/.cache/my3dge"
node_name="node-v${want_version}-linux-x64"
node_dir="$cache_dir/$node_name"

# Downloads the official build, checks it against SHASUMS256.txt and moves it into $node_dir. Runs in a subshell so
# its temporary directory is always removed. Exits non-zero, having installed nothing, when offline or on a mismatch.
install_node() (
  base="https://nodejs.org/dist/v${want_version}"
  if command -v xz >/dev/null 2>&1; then tarball="${node_name}.tar.xz"; else tarball="${node_name}.tar.gz"; fi
  mkdir -p "$cache_dir"
  work="$(mktemp -d "$cache_dir/.download.XXXXXX")"
  trap 'rm -rf "$work"' EXIT
  curl_opts=(--fail --silent --show-error --location --retry 2 --connect-timeout 15)
  if ! curl "${curl_opts[@]}" -o "$work/SHASUMS256.txt" "$base/SHASUMS256.txt" ||
    ! curl "${curl_opts[@]}" -o "$work/$tarball" "$base/$tarball"; then
    say "offline: could not download Node ${want_version} from nodejs.org"
    exit 1
  fi
  awk -v f="$tarball" '$2 == f' "$work/SHASUMS256.txt" >"$work/expected.txt"
  if [ ! -s "$work/expected.txt" ] || ! (cd "$work" && sha256sum --check --status expected.txt); then
    say "error: ${tarball} does not match nodejs.org's SHASUMS256.txt; nothing was installed"
    exit 1
  fi
  mkdir "$work/unpacked"
  if ! tar -xf "$work/$tarball" -C "$work/unpacked" || [ ! -x "$work/unpacked/$node_name/bin/node" ]; then
    say "error: could not unpack ${tarball}; nothing was installed"
    exit 1
  fi
  rm -rf "$node_dir"
  mv "$work/unpacked/$node_name" "$node_dir"
  say "installed Node ${want_version} (SHA-256 checked) in $node_dir"
)

if [ "$active_version" = "$want_version" ]; then
  say "Node ${want_version} is active ($(command -v node)); nothing to install"
elif [ "$(uname -s)" != "Linux" ] || [ "$(uname -m)" != "x86_64" ]; then
  say "not the development platform (Linux x64); keeping the active Node ${active_version:-none}"
else
  if [ "$("$node_dir/bin/node" --version 2>/dev/null || true)" = "v${want_version}" ]; then
    say "Node ${want_version} is already in $node_dir"
  else
    install_node || true
  fi
  if [ -x "$node_dir/bin/node" ]; then
    export PATH="$node_dir/bin:$PATH"
    path_line="export PATH=\"$node_dir/bin:\$PATH\""
    append_env_line "$path_line"
    say "Node ${want_version} is first on PATH for this script; for another shell: $path_line"
  else
    say "keeping the active Node ${active_version:-none}: everything runs on it, but Node goldens are recorded on ${want_version}"
  fi
fi

# ---------------------------------------------------------------------------------------------------------------------
# 2. The read-only source checkouts
# ---------------------------------------------------------------------------------------------------------------------

# resolve_source VAR DEST COMMIT LOCAL_CLONE URL
#   VAR          the environment variable that may already name a checkout (used as it is: it is read-only)
#   DEST         the clone under the repository used otherwise
#   COMMIT       the pinned commit (full SHA)
#   LOCAL_CLONE  an existing clone to share objects with (the Claude Code cloud image's)
#   URL          the GitHub repository, the last resort
# Prints the resolved path and appends `export VAR=<path>` to $CLAUDE_ENV_FILE. Problems only warn.
resolve_source() {
  local var="$1" dest="$2" commit="$3" local_clone="$4" url="$5" path head
  if [ -n "${!var:-}" ]; then
    path="${!var}"
  else
    path="$repo_root/$dest"
    if [ ! -d "$path/.git" ]; then
      rm -rf "$path"
      mkdir -p "$(dirname "$path")"
      if [ -d "$local_clone/.git" ]; then
        git clone --quiet --shared "$local_clone" "$path" || say "warning: could not clone ${local_clone}"
      else
        git clone --quiet "$url" "$path" 2>/dev/null || say "warning: cannot reach ${url}"
      fi
      if [ ! -d "$path/.git" ]; then
        rm -rf "$path"
        say "warning: ${var} is unresolved; the session must include ${url#https://github.com/} (PLAN.md §11.5)"
        return 0
      fi
    fi
    if ! git -C "$path" cat-file -e "${commit}^{commit}" 2>/dev/null; then
      git -C "$path" fetch --quiet "$url" "$commit" 2>/dev/null ||
        say "warning: ${commit:0:7} is missing from ${path}, and ${url} cannot be reached"
    fi
    if [ "$(git -C "$path" rev-parse HEAD 2>/dev/null || true)" != "$commit" ]; then
      git -C "$path" checkout --quiet --detach "$commit" || say "warning: could not check out ${commit:0:7} in ${path}"
    fi
  fi
  head="$(git -C "$path" rev-parse HEAD 2>/dev/null || true)"
  if [ "$head" = "$commit" ]; then
    say "${var}=${path} (at ${commit:0:7})"
  else
    say "warning: ${var}=${path} is at '${head:0:7}', not the pinned ${commit:0:7}; it is read-only, so fix it by hand"
  fi
  append_env_line "export ${var}=\"${path}\""
}

resolve_source MY3D2DGE_SRC .cache/src-3d2dge e37e4eedcd23326f3734188b9574a4aa635fcbd3 \
  /home/user/michaelcrosato/my-3d2dge https://github.com/michaelcrosato/my-3d2dge
GIT_LFS_SKIP_SMUDGE=1 resolve_source SHARDFALL_SRC .cache/src-shardfall fa2dab6cdf97092f8866c6aa6a3faa5f7cd1246a \
  /home/user/michaelcrosato/shardfall https://github.com/michaelcrosato/shardfall

# ---------------------------------------------------------------------------------------------------------------------
# 3. The dependencies
# ---------------------------------------------------------------------------------------------------------------------

say "npm ci on Node $(node --version), npm $(npm --version)"
if ! npm ci --no-audit --no-fund; then
  say "error: npm ci failed (offline, it succeeds only when npm's cache holds every package in the lockfile)"
  exit 1
fi
say "done"
