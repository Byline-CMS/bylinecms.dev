#!/usr/bin/env bash
#
# publish-packages.sh — publish the @byline/* lockstep set to npm under passkey 2FA.
#
# Why this exists: `pnpm publish` / `changeset publish` cannot publish under
# passkey-only 2FA — pnpm's OTP pre-check accepts only a typed numeric code and
# dead-ends at ERR_PNPM_OTP_NON_INTERACTIVE. Plain `npm publish` honours the
# bypass token in ~/.npmrc silently. But plain npm does NOT rewrite pnpm's
# `workspace:*` deps — so we `pnpm pack` first (which rewrites them into real
# versions) and `npm publish <tarball>` the result.
#
# This script is meant to run AFTER the release commit (`chore(release): X.Y.Z`)
# is made and pushed — i.e. between Step 6 and the umbrella release of /release.
# It builds, packs, publishes, and pushes per-package tags. It is idempotent:
# packages already live at the current version are skipped, and existing tags
# are not recreated — so re-running after a partial failure just finishes the job.
#
# Usage:
#   ./publish-packages.sh            # build, publish, tag, push (prompts before publishing)
#   ./publish-packages.sh --dry-run  # pack + verify only; no publish, no tags, no push
#   ./publish-packages.sh --no-build # skip the turbo build (use existing dist/)
#   ./publish-packages.sh --yes      # skip the confirmation prompt
#
set -euo pipefail

# ---- options --------------------------------------------------------------
DRY_RUN=0
DO_BUILD=1
ASSUME_YES=0
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --no-build) DO_BUILD=0 ;;
    --yes|-y) ASSUME_YES=1 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

# ---- colours --------------------------------------------------------------
if [ -t 1 ]; then
  BOLD=$'\033[1m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RED=$'\033[31m'; DIM=$'\033[2m'; RESET=$'\033[0m'
else
  BOLD=""; GREEN=""; YELLOW=""; RED=""; DIM=""; RESET=""
fi
info()  { echo "${BOLD}$*${RESET}"; }
ok()    { echo "${GREEN}$*${RESET}"; }
warn()  { echo "${YELLOW}$*${RESET}"; }
die()   { echo "${RED}error: $*${RESET}" >&2; exit 1; }

# ---- locate repo ----------------------------------------------------------
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

command -v node >/dev/null || die "node not found on PATH"
command -v npm  >/dev/null || die "npm not found on PATH"
command -v pnpm >/dev/null || die "pnpm not found on PATH"

# Sweep any pack tarballs on exit (normal, error, or interrupt) so a failed
# publish never leaves a stray *.tgz behind in a package dir.
cleanup_tarballs() {
  find "$REPO_ROOT/packages" -maxdepth 2 -name '*.tgz' -delete 2>/dev/null || true
}
trap cleanup_tarballs EXIT INT TERM

# ---- version (lockstep — read from @byline/core) --------------------------
VERSION="$(node -e "console.log(require('./packages/core/package.json').version)")"
[ -n "$VERSION" ] || die "could not read version from packages/core/package.json"

# ---- package list: fixed[0] from changeset config -------------------------
# Map each @byline/* name in the fixed group to its packages/<dir>.
mapfile -t PKG_LINES < <(node - <<'NODE'
const fs = require('fs')
const path = require('path')
const cfg = JSON.parse(fs.readFileSync('.changeset/config.json', 'utf8'))
const fixed = (cfg.fixed && cfg.fixed[0]) || []
// Build name -> dir map by scanning packages/*/package.json
const root = 'packages'
const map = {}
for (const d of fs.readdirSync(root)) {
  const pj = path.join(root, d, 'package.json')
  if (!fs.existsSync(pj)) continue
  const p = JSON.parse(fs.readFileSync(pj, 'utf8'))
  if (p.name) map[p.name] = d
}
for (const name of fixed) {
  const dir = map[name]
  if (!dir) { console.error('MISSING_DIR ' + name); process.exit(3) }
  console.log(name + '\t' + dir)
}
NODE
)
[ "${#PKG_LINES[@]}" -gt 0 ] || die "no packages found in .changeset/config.json fixed[0]"

# ---- preflight reporting --------------------------------------------------
ANCHOR="$(git rev-parse HEAD)"
ANCHOR_SHORT="$(git rev-parse --short HEAD)"
HEAD_SUBJECT="$(git log -1 --pretty=%s)"

info "Byline lockstep publish"
echo "  repo:    $REPO_ROOT"
echo "  version: ${BOLD}${VERSION}${RESET}"
echo "  anchor:  ${ANCHOR_SHORT}  ${DIM}${HEAD_SUBJECT}${RESET}"
echo "  packages: ${#PKG_LINES[@]}  (from .changeset/config.json fixed[0])"
[ "$DRY_RUN" -eq 1 ] && warn "  mode:    DRY RUN (no publish / no tags / no push)"
echo

# Soft check: HEAD should be the release commit.
case "$HEAD_SUBJECT" in
  "chore(release): $VERSION") : ;;
  *) warn "HEAD subject is not 'chore(release): $VERSION' — make sure you're on the release commit before tagging." ;;
esac

# Warn if the working tree is dirty (e.g. a corepack packageManager bump).
if [ -n "$(git status --porcelain)" ]; then
  warn "Working tree is not clean:"
  git status --short
  warn "Tags will point at $ANCHOR_SHORT regardless. Stash/revert unrelated changes (e.g. a pnpm packageManager bump) before the umbrella sync."
  echo
fi

# ---- determine work: what's already published -----------------------------
TO_PUBLISH=()   # "name\tdir"
ALREADY=()      # name
for line in "${PKG_LINES[@]}"; do
  name="${line%%$'\t'*}"
  published="$(npm view "${name}@${VERSION}" version 2>/dev/null || true)"
  if [ "$published" = "$VERSION" ]; then
    ALREADY+=("$name")
  else
    TO_PUBLISH+=("$line")
  fi
done

if [ "${#ALREADY[@]}" -gt 0 ]; then
  echo "${DIM}Already published at ${VERSION} (skipping):${RESET}"
  for n in "${ALREADY[@]}"; do echo "  ${DIM}- $n${RESET}"; done
  echo
fi

if [ "${#TO_PUBLISH[@]}" -eq 0 ]; then
  ok "All ${#PKG_LINES[@]} packages already published at ${VERSION}."
else
  info "To publish (${#TO_PUBLISH[@]}):"
  for line in "${TO_PUBLISH[@]}"; do echo "  - ${line%%$'\t'*}"; done
  echo
fi

# ---- confirm --------------------------------------------------------------
if [ "$DRY_RUN" -eq 0 ] && [ "${#TO_PUBLISH[@]}" -gt 0 ] && [ "$ASSUME_YES" -eq 0 ]; then
  read -r -p "Publish ${#TO_PUBLISH[@]} package(s) at ${VERSION} to npm? This is not reversible. [y/N] " reply
  case "$reply" in [yY]|[yY][eE][sS]) : ;; *) die "aborted by user" ;; esac
  echo
fi

# ---- build ----------------------------------------------------------------
if [ "$DO_BUILD" -eq 1 ] && { [ "${#TO_PUBLISH[@]}" -gt 0 ] || [ "$DRY_RUN" -eq 1 ]; }; then
  info "Building packages…"
  pnpm turbo run build --filter="./packages/*"
  echo
fi

# ---- pack + publish -------------------------------------------------------
TAGS_TO_PUSH=()

# Ensure per-package tag exists locally (created at the anchor). Collects for push.
ensure_tag() {
  local name="$1" tag="$1@${VERSION}"
  if git rev-parse -q --verify "refs/tags/${tag}" >/dev/null 2>&1; then
    local at; at="$(git rev-list -n1 "${tag}")"
    if [ "$at" != "$ANCHOR" ]; then
      warn "tag ${tag} exists but points at ${at:0:8}, not ${ANCHOR_SHORT} — leaving as-is"
    fi
  else
    git tag "${tag}" "${ANCHOR}"
    echo "  tagged ${tag}"
  fi
  TAGS_TO_PUSH+=("${tag}")
}

for line in "${TO_PUBLISH[@]}"; do
  name="${line%%$'\t'*}"
  dir="${line#*$'\t'}"
  echo "${BOLD}── ${name} ──${RESET}"
  (
    cd "packages/${dir}"
    rm -f ./*.tgz
    pnpm pack >/dev/null 2>&1 || { echo "${RED}pnpm pack failed${RESET}"; exit 1; }
    tgz="$(ls -t ./*.tgz 2>/dev/null | head -1)"
    [ -n "$tgz" ] || { echo "${RED}no tarball produced${RESET}"; exit 1; }
    # Guard: no unrewritten workspace: deps may ship.
    if tar -xzO -f "$tgz" package/package.json | grep -q '"workspace:'; then
      echo "${RED}WORKSPACE LEAK in $tgz — refusing to publish${RESET}"; exit 1
    fi
    if [ "$DRY_RUN" -eq 1 ]; then
      echo "  ${DIM}dry-run: packed $(basename "$tgz"), verified clean (not publishing)${RESET}"
    else
      npm publish "$tgz" --access public
    fi
    rm -f ./*.tgz
  ) || die "failed on ${name} — fix and re-run (already-published packages will be skipped)"

  [ "$DRY_RUN" -eq 0 ] && ensure_tag "$name"
  echo
done

# Also ensure tags for packages that were already published (idempotent top-up),
# so a resumed run still completes the tag set.
if [ "$DRY_RUN" -eq 0 ]; then
  for n in "${ALREADY[@]}"; do ensure_tag "$n"; done
fi

# ---- push tags ------------------------------------------------------------
if [ "$DRY_RUN" -eq 0 ] && [ "${#TAGS_TO_PUSH[@]}" -gt 0 ]; then
  echo
  info "Pushing ${#TAGS_TO_PUSH[@]} per-package tag(s)…"
  git push origin "${TAGS_TO_PUSH[@]}"
  echo
fi

# ---- done -----------------------------------------------------------------
if [ "$DRY_RUN" -eq 1 ]; then
  ok "Dry run complete — all tarballs packed and verified clean. Nothing published."
else
  ok "Done: ${#PKG_LINES[@]} packages live at ${VERSION}, per-package tags pushed."
  echo
  info "Next — hand back to Claude for the umbrella release:"
  echo "  • create + push the umbrella tag  v${VERSION}"
  echo "  • fast-forward main to ${ANCHOR_SHORT} (if not already) and push"
  echo "  • create the GitHub release  v${VERSION}  with the cycle notes"
  echo
  echo "  ${DIM}(or finish /release at Step 9 onward)${RESET}"
fi
