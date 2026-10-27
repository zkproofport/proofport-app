#!/usr/bin/env bash
# Copy the circuits repo's reference OIDC input builder into this repo, byte
# for byte, so the app's builder can be tested against it without a sibling
# checkout (CI checks out this repo alone).
#
#   scripts/sync-oidc-reference-builder.sh [circuits-ref]   (default: origin/main)
#
# Writes test-reference/circuits/oidc-inputs.ts and SOURCE (the circuits
# commit it came from, and the file's sha256). The test
# src/utils/__tests__/oidcDomainMatchesTheCircuitsBuilder.test.ts refuses a
# copy whose sha256 differs from SOURCE, so the reference is never edited here.
#
# Prerequisite: the circuits submodule checked out in the parent repository,
# with the ref fetched (git -C circuits fetch origin).
set -euo pipefail

REPO=$(git rev-parse --show-superproject-working-tree)
REPO=${REPO:-$(git rev-parse --show-toplevel)}
APP="$REPO/proofport-app"
CIRCUITS="$REPO/circuits"
REF=${1:-origin/main}
SRC_PATH=oidc-domain-attestation/scripts/oidc-inputs.ts
OUT_DIR="$APP/test-reference/circuits"

if [ ! -d "$CIRCUITS/.git" ] && [ ! -f "$CIRCUITS/.git" ]; then
  echo "error: no circuits checkout at $CIRCUITS" >&2
  exit 1
fi

COMMIT=$(git -C "$CIRCUITS" rev-parse --verify "$REF^{commit}")
mkdir -p "$OUT_DIR"
git -C "$CIRCUITS" show "$COMMIT:$SRC_PATH" > "$OUT_DIR/oidc-inputs.ts"

if ! grep -q 'export function buildInputs' "$OUT_DIR/oidc-inputs.ts"; then
  echo "error: $SRC_PATH at $COMMIT has no buildInputs export" >&2
  exit 1
fi

SHA=$(shasum -a 256 "$OUT_DIR/oidc-inputs.ts" | cut -d' ' -f1)
printf 'circuits %s\npath %s\nsha256 %s\n' "$COMMIT" "$SRC_PATH" "$SHA" > "$OUT_DIR/SOURCE"
echo "copied $SRC_PATH at $COMMIT (sha256 $SHA)"
