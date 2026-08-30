#!/usr/bin/env bash
#
# Fetch the prebuilt proving libraries this app links against.
#
# WHY THIS FILE EXISTS. The download lived only inside the CI workflows, so a
# fresh machine had no documented way to get these — and the fallback is
# rebuilding mopro from source, which produces a 2.5 GB static archive. Worse,
# having the recipe in one place and not the other is exactly how the two drifted:
# the Android build switched to a 15 MB shared object on 2026-06-01, the packaged
# binaries were never refreshed, and every CI Android build failed for four
# months looking for a file the archive did not contain. One script, used by
# both, is the fix.
#
#   ./scripts/fetch-mopro.sh            # whatever this platform needs
#   ./scripts/fetch-mopro.sh android    # just Android
#   ./scripts/fetch-mopro.sh ios        # just iOS
#
# Needs the GitHub CLI, signed in with read access to this repository.
set -euo pipefail

# The two tags are deliberately different. iOS still uses the original v0.3.2
# framework; Android needs the shared object published later. Bumping one does
# not imply bumping the other.
IOS_TAG='mopro-binaries-v0.3.2'
ANDROID_TAG='mopro-binaries-v0.3.2-so'

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WHAT="${1:-all}"

have_gh() {
  command -v gh > /dev/null || {
    echo "This needs the GitHub CLI. Install it, then run 'gh auth login'." >&2
    exit 1
  }
}

fetch_android() {
  local dest="$ROOT/mopro_bindings/android/src/main/jniLibs"
  local lib="$dest/arm64-v8a/libproofport.so"
  if [ -f "$lib" ]; then
    echo "Android: already here ($(du -h "$lib" | cut -f1))"
    return
  fi
  have_gh
  echo "Android: fetching $ANDROID_TAG"
  gh release download "$ANDROID_TAG" \
    --repo zkproofport/proofport-app \
    --pattern 'android-jniLibs-arm64-v8a.tar.gz' \
    --dir /tmp --clobber
  mkdir -p "$dest"
  tar xzf /tmp/android-jniLibs-arm64-v8a.tar.gz -C "$dest"
  rm -f /tmp/android-jniLibs-arm64-v8a.tar.gz
  # Say what arrived rather than that a command exited 0 — the archive having
  # held the wrong file is the whole reason this script exists.
  [ -f "$lib" ] || { echo "Android: the archive did not contain $lib" >&2; exit 1; }
  file "$lib" | grep -q 'shared object' \
    || { echo "Android: $lib is not a shared object" >&2; exit 1; }
  echo "Android: ready ($(du -h "$lib" | cut -f1))"
}

fetch_ios() {
  local dest="$ROOT/mopro_bindings"
  if [ -d "$dest/MoproFfiFramework.xcframework" ]; then
    echo "iOS: already here"
    return
  fi
  have_gh
  echo "iOS: fetching $IOS_TAG"
  gh release download "$IOS_TAG" \
    --repo zkproofport/proofport-app \
    --pattern 'MoproFfiFramework.xcframework.tar.gz' \
    --dir /tmp --clobber
  mkdir -p "$dest"
  tar xzf /tmp/MoproFfiFramework.xcframework.tar.gz -C "$dest"
  rm -f /tmp/MoproFfiFramework.xcframework.tar.gz
  [ -d "$dest/MoproFfiFramework.xcframework" ] \
    || { echo "iOS: the archive did not contain the framework" >&2; exit 1; }
  echo "iOS: ready"
}

case "$WHAT" in
  android) fetch_android ;;
  ios)     fetch_ios ;;
  all)     fetch_android; fetch_ios ;;
  *)       echo "Usage: $0 [android|ios|all]" >&2; exit 1 ;;
esac
