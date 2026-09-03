#!/bin/bash
# Retire the release tags left over from the previous Apple account.
#
# WHY
#
# On 2026-08-21 commit b655326 ("move to Masse Labs, reset to 1.0.0") reset the
# version in package.json, android/app/build.gradle and the Xcode project. The
# git tags were not reset with it, so thirteen `app-v*` tags from March 2026 —
# up to app-v1.5.2 — survived the account move.
#
# .releaserc.json sets tagFormat "app-v${version}", so semantic-release derives
# the next version from the highest of those tags. Every release run since has
# been computing from 1.5.2 while the stores sit at 1.0.0. On 2026-09-04 a
# production run duly emitted 1.6.0, committed the bump and cut a tag before it
# was cancelled; nothing reached a store, but the mine was real and would have
# gone off on any release.
#
# WHAT THIS DOES
#
# Two halves, and both are needed.
#
# 1. Renames every `app-v*` tag to `legacy-app-v*` — history and the commits
#    they point at are preserved, they just leave semantic-release's view.
#
# 2. Plants `app-v1.0.0` on the commit that actually shipped 1.0.0 under this
#    account (092fd1d, the head of the 2026-08-30 release run that put
#    versionCode 39 on Play and build 4 on TestFlight).
#
# The second half is the point. Retiring the old tags alone leaves no `app-v*`
# at all, so semantic-release reports "no previous release" and emits 1.0.0
# again — a version that is already on both stores and cannot be re-shipped.
# With the baseline planted, the next release continues from what is really out
# there: 1.0.1 for fixes, 1.1.0 for features, computed from the commits since.
#
# This is a one-time migration. It is a script rather than a shell session so
# the reasoning and the exact commands survive; running it twice is harmless.

set -euo pipefail

cd "$(dirname "$0")/.."

OLD_PREFIX="app-v"
NEW_PREFIX="legacy-app-v"
DRY_RUN=${DRY_RUN:-0}

# The baseline: what is genuinely released under the Masse Labs account.
# 092fd1d is the head of the 2026-08-30 release run — the one that put
# versionCode 39 on Play internal/alpha and build 4 on TestFlight, both at 1.0.0.
BASELINE_TAG="app-v1.0.0"
BASELINE_SHA="092fd1d246442396bd8188a5675e22613098f933"

git fetch --tags --prune origin >/dev/null 2>&1 || true

# macOS ships bash 3.2, which has no `mapfile` — read the list into a plain
# newline-separated variable instead. Same reason the mopro build script avoids
# associative arrays.
tags=$(git tag --list "${OLD_PREFIX}*" --sort=v:refname)

plant_baseline() {
  if git rev-parse -q --verify "refs/tags/${BASELINE_TAG}" >/dev/null; then
    echo "Baseline ${BASELINE_TAG} already present."
    return
  fi
  if ! git rev-parse -q --verify "${BASELINE_SHA}^{commit}" >/dev/null; then
    echo "ERROR: baseline commit ${BASELINE_SHA} not found — fetch first." >&2
    exit 1
  fi
  git tag "${BASELINE_TAG}" "${BASELINE_SHA}"
  git push -q origin "refs/tags/${BASELINE_TAG}"
  echo "Planted ${BASELINE_TAG} on ${BASELINE_SHA:0:7} (the shipped 1.0.0)."
}

if [ -z "$tags" ]; then
  echo "No ${OLD_PREFIX}* tags left to retire."
  if [ "$DRY_RUN" = "1" ]; then
    echo "DRY_RUN=1 — would plant ${BASELINE_TAG} on ${BASELINE_SHA:0:7} if absent."
    exit 0
  fi
  plant_baseline
  exit 0
fi

count=$(printf '%s\n' "$tags" | grep -c .)
echo "Retiring $count tag(s) from the previous account:"
printf '%s\n' "$tags" | while IFS= read -r t; do
  [ -n "$t" ] || continue
  printf '  %-16s %s  ->  %s\n' \
    "$t" "$(git log -1 --format=%ad --date=short "$t")" "${NEW_PREFIX}${t#$OLD_PREFIX}"
done

if [ "$DRY_RUN" = "1" ]; then
  echo
  echo "DRY_RUN=1 — nothing changed."
  exit 0
fi

echo
for t in $tags; do
  [ -n "$t" ] || continue
  new="${NEW_PREFIX}${t#$OLD_PREFIX}"
  # Point the new name at the same commit, then drop the old name locally and
  # on the remote. -f so a re-run over a partially applied state converges.
  git tag -f "$new" "$t" >/dev/null
  git push -q origin "refs/tags/$new"
  git push -q origin ":refs/tags/$t"
  git tag -d "$t" >/dev/null
  echo "  retired $t -> $new"
done

echo
remaining=$(git tag --list "${OLD_PREFIX}*" | wc -l | tr -d ' ')
[ "$remaining" -eq 0 ] || { echo "ERROR: some old tags survived" >&2; exit 1; }

plant_baseline

echo
echo "Done. The only ${OLD_PREFIX}* tag is now ${BASELINE_TAG}, on the commit that"
echo "actually shipped, so semantic-release continues from what is on the stores:"
echo "a fix: commit gives 1.0.1, a feat: commit gives 1.1.0. Verify with"
echo "  npx semantic-release --dry-run --no-ci"
echo "and confirm the store side with"
echo "  python3 ../scripts/play-api.py tracks"
