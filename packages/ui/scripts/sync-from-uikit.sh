#!/usr/bin/env bash
#
# Sync foundational UI surface from @infonomic/uikit into @byline/ui.
#
# @infonomic/uikit is the upstream source of truth for foundational
# components, icons, hooks, loaders, styles, utils, and widgets. This
# script overwrites the synced subtree wholesale — edit upstream first,
# then re-run this script. Anything Byline-specific lives outside the
# synced dirs (admin/, dnd/, fields/, forms/, services/, react.ts).
#
# Usage:
#   pnpm sync:uikit
#   UIKIT_PATH=/abs/path/to/uikit/packages/uikit pnpm sync:uikit
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Default upstream location: a sibling checkout of the uikit repo
# three directories above the bylinecms.dev repo root.
DEFAULT_UIKIT_PATH="$PKG_ROOT/../../../../../uikit/packages/uikit"
UIKIT_PATH_INPUT="${UIKIT_PATH:-$DEFAULT_UIKIT_PATH}"

if [[ ! -d "$UIKIT_PATH_INPUT/src" ]]; then
  echo "error: upstream uikit not found at $UIKIT_PATH_INPUT/src" >&2
  echo "       set UIKIT_PATH to the @infonomic/uikit package root." >&2
  exit 1
fi

UIKIT_PATH="$(cd "$UIKIT_PATH_INPUT" && pwd)"
UIKIT_SRC="$UIKIT_PATH/src"
DST_SRC="$PKG_ROOT/src"

if ! command -v rsync >/dev/null 2>&1; then
  echo "error: rsync is required but was not found on PATH" >&2
  exit 1
fi

# Capture upstream git state for the manifest. The SHA lets reviewers
# pin a sync to a specific upstream commit; "dirty" warns when local
# upstream edits aren't reflected in any commit yet.
UPSTREAM_SHA=""
UPSTREAM_DIRTY="false"
if git -C "$UIKIT_PATH" rev-parse --git-dir >/dev/null 2>&1; then
  UPSTREAM_SHA="$(git -C "$UIKIT_PATH" rev-parse HEAD)"
  if [[ -n "$(git -C "$UIKIT_PATH" status --porcelain)" ]]; then
    UPSTREAM_DIRTY="true"
    echo "warning: upstream working tree is dirty — manifest SHA may not match copied content" >&2
  fi
else
  echo "warning: upstream is not a git repo — no SHA recorded" >&2
fi

# Subtrees mirrored from upstream src/. Astro entrypoints (astro.ts,
# astro.js, astro.config.mjs) and the theme/ tree are intentionally
# omitted — Byline doesn't ship those today.
SYNCED_DIRS=(components icons hooks lib loaders styles utils widgets)

echo "syncing from: $UIKIT_PATH"
echo "         to: $DST_SRC"
echo

for dir in "${SYNCED_DIRS[@]}"; do
  src="$UIKIT_SRC/$dir/"
  dst="$DST_SRC/$dir/"
  if [[ ! -d "$src" ]]; then
    echo "  skip   $dir/ (not present upstream)"
    continue
  fi
  mkdir -p "$dst"
  echo "  sync   $dir/"
  rsync -a --delete --delete-excluded \
    --exclude='*.astro' \
    --exclude='*.stories.tsx' \
    --exclude='*.stories.ts' \
    --exclude='*.stories.jsx' \
    --exclude='*.stories.js' \
    --exclude='__tests__/' \
    --exclude='*.test.ts' \
    --exclude='*.test.tsx' \
    "$src" "$dst"
done

# Rename CSS @layer declarations from `infonomic-*` to `byline-*`.
# Two patterns to cover:
#   1. Cascade list — the six top-level layer names (base, functional,
#      utilities, theme, typography, components) only ever appear as
#      layer identifiers, so a word-boundary rename is safe anywhere
#      they occur, including continuation lines and code comments.
#   2. Wrapper form — `@layer infonomic-X { ... }` becomes
#      `@layer byline-X { ... }`. Scoped to `@layer` so paired
#      `:global(.infonomic-X)` class selectors are left untouched.
echo "  rename @layer infonomic-* → byline-* in synced .css"
find "$DST_SRC" -type f -name '*.css' -print0 | while IFS= read -r -d '' f; do
  perl -pi -e '
    s/\binfonomic-(base|functional|utilities|theme|typography|components)\b/byline-$1/g;
    s/(\@layer\s+)infonomic-([a-zA-Z0-9_-]+)/$1byline-$2/g;
  ' "$f"
done

# Mirror upstream's barrel as src/uikit.ts. Byline's src/react.ts
# re-exports from this file plus the Byline-specific surface, so the
# synced barrel never collides with admin/fields/forms exports.
echo "  sync   react.ts → uikit.ts"
{
  echo "// ---------------------------------------------------------------------"
  echo "// Synced from @infonomic/uikit (src/react.ts). Do not edit by hand."
  echo "// To change anything here, edit upstream and re-run pnpm sync:uikit."
  echo "// ---------------------------------------------------------------------"
  echo
  cat "$UIKIT_SRC/react.ts"
} > "$DST_SRC/uikit.ts"

# Manifest sits next to the synced files so reviewers see the SHA bump
# in the same diff as the content change.
MANIFEST="$DST_SRC/.uikit-sync.json"
TS="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
DIRS_JSON="$(printf '"%s",' "${SYNCED_DIRS[@]}" | sed 's/,$//')"
cat > "$MANIFEST" <<EOF
{
  "upstream": "@infonomic/uikit",
  "upstreamPath": "$UIKIT_PATH",
  "upstreamSha": "$UPSTREAM_SHA",
  "upstreamDirty": $UPSTREAM_DIRTY,
  "syncedAt": "$TS",
  "syncedDirs": [$DIRS_JSON],
  "syncedFiles": ["uikit.ts"]
}
EOF

echo
echo "manifest: $MANIFEST"
if [[ -n "$UPSTREAM_SHA" ]]; then
  short_sha="${UPSTREAM_SHA:0:12}"
  if [[ "$UPSTREAM_DIRTY" == "true" ]]; then
    echo "  upstream sha: $short_sha (dirty)"
  else
    echo "  upstream sha: $short_sha"
  fi
fi
echo
echo "next:"
echo "  - review the diff:    git -C \"$PKG_ROOT\" diff src"
echo "  - typecheck:          pnpm typecheck"
echo "  - lint:               pnpm lint"
