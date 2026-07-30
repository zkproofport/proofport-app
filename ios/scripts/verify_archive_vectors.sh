#!/usr/bin/env bash
#
# Cross-implementation known-answer test for the OpenStoa NSE archive decryptor.
#
# Compiles the extension's platform-independent sources on macOS and checks them
# against `archive_vectors.json`, which is sealed by the TypeScript
# `sealArchive` (openstoa/src/lib/mls/takClient.ts). A green Xcode build only
# proves the extension compiles — this proves the two implementations agree on
# the key schedule, which is the part that silently breaks.
#
# Regenerate the vectors after any change to takClient.ts:
#   cd openstoa && npx tsx scripts/gen-archive-vectors.ts \
#     > ../proofport-app/ios/scripts/archive_vectors.json
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NSE_DIR="$SCRIPT_DIR/../OpenStoaNSE"
OUT="$(mktemp -d)/verify-archive-vectors"
trap 'rm -rf "$(dirname "$OUT")"' EXIT

# NotificationService.swift is excluded: UNNotificationServiceExtension is
# iOS-only, so it cannot link on macOS. Everything it delegates to (the crypto,
# the payload parsing, the Keychain account key, the preview truncation) lives in
# the three files below and IS covered here.
swiftc -O \
  "$NSE_DIR/ArchiveDecryptor.swift" \
  "$NSE_DIR/PushPayload.swift" \
  "$NSE_DIR/TakKeychain.swift" \
  "$SCRIPT_DIR/VerifyArchiveVectors.swift" \
  -o "$OUT"

"$OUT"
