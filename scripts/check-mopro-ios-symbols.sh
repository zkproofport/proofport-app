#!/usr/bin/env bash
# Every function the generated bindings call must exist in BOTH slices of
# mopro_bindings/MoproFfiFramework.xcframework.
#
# Why: on 2026-10-30 a TestFlight archive failed with "Undefined symbols":
# _uniffi_proofport_fn_func_start_noir_proof / noir_proof_status /
# take_noir_proof. The framework committed here (Git LFS) had them; the
# workflow never used it. It checked out without LFS and unpacked an old
# release asset (mopro-binaries-v0.3.2) over the directory, so CI linked a
# library older than the bindings while every local build linked the
# repository's. The link step is the first place that shows, twenty minutes
# into an archive. This check says it in seconds, before pod install.
#
# It also refuses an LFS pointer file (a checkout that skipped `git lfs pull`)
# by name, instead of letting the linker call it a malformed archive.
#
# Usage: scripts/check-mopro-ios-symbols.sh [path/to/MoproFfiFramework.xcframework]
#        (defaults to the repository's own; run from anywhere in the repo)
# Needs: nm (Xcode command line tools).
set -euo pipefail

REPO=$(git rev-parse --show-toplevel)
BINDINGS="$REPO/mopro_bindings"
XCF="${1:-$BINDINGS/MoproFfiFramework.xcframework}"
HEADER="$BINDINGS/cpp/generated/proofport.hpp"

[ -f "$HEADER" ] || { echo "ERROR: no generated bindings at $HEADER" >&2; exit 1; }
required=$(grep -oE 'uniffi_proofport_(fn|checksum)_[a-z0-9_]+' "$HEADER" | sort -u)
count=$(printf '%s\n' "$required" | grep -c . || true)
[ "$count" -gt 0 ] || { echo "ERROR: found no uniffi_proofport_* functions in $HEADER" >&2; exit 1; }

status=0
for slice in ios-arm64 ios-arm64-simulator; do
  lib="$XCF/$slice/libproofport.a"
  if [ ! -s "$lib" ]; then
    echo "ERROR: $slice: $lib is missing" >&2; status=1; continue
  fi
  if head -c 40 "$lib" | grep -q 'version https://git-lfs'; then
    echo "ERROR: $slice: $lib is a Git LFS pointer, not the library. Run: git lfs pull --include 'mopro_bindings/MoproFfiFramework.xcframework/**'" >&2
    status=1; continue
  fi
  # nm exits non-zero for archive members with no external symbols; what
  # counts is whether the required ones are listed, checked below.
  defined=$({ nm -gU "$lib" 2>/dev/null || true; } | awk 'NF {print $NF}' | sed 's/^_//' | sort -u)
  missing=$(comm -23 <(printf '%s\n' "$required") <(printf '%s\n' "$defined"))
  if [ -n "$missing" ]; then
    echo "ERROR: $slice: the library lacks functions the bindings call:" >&2
    printf '  %s\n' $missing >&2
    status=1
  else
    echo "$slice: all $count binding functions present ($(shasum -a 256 "$lib" | cut -c1-12))"
  fi
done
exit $status
