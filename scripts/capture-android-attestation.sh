#!/bin/bash
# Capture a REAL Android key attestation chain and Play Integrity verdict from
# a connected phone, with the app's own native code (AndroidKeyAttestationCore
# through the debug-only AttestationProbeReceiver).
#
#   scripts/capture-android-attestation.sh <adb serial> <statement file> <out dir>
#
# Needs a DEBUG build of the app installed (src/debug holds the receiver; a
# debug build is signed with the debug key, so its key description names the
# debug certificate, and Play recognizes it as UNRECOGNIZED_VERSION -- the
# circuits refuse it for both reasons). Writes to <out dir>:
#   attest.json     {chain: [base64 DER, leaf first], signature: base64 DER, strongBox}
#   integrity.json  {token}: the encrypted JWE
#   verdict.json    {protectedHeader, payload, signature, verdict}: decrypted
#                   with the Play decryption key from Secret Manager
#                   (play-integrity-decryption-key, read into the environment
#                   only, never printed) and checked with the verification key
# Output files contain a device-specific attestation chain: keep them out of
# public repositories unless reviewed (the RKP/batch certificate CN is a
# per-key or per-batch id, no user data).
set -eu
[ $# -eq 3 ] || { echo "usage: $0 <adb serial> <statement file> <out dir>" >&2; exit 1; }
SERIAL="$1"; STATEMENT="$2"; OUT="$3"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG=com.masselabs.zkproofport
RECEIVER="$PKG/.AttestationProbeReceiver"
unset NODE_OPTIONS
mkdir -p "$OUT"

pull() { # name -> waits for files/attestation-probe/<name>.json or .error
  local name="$1" i
  for i in $(seq 1 120); do
    if adb -s "$SERIAL" shell "run-as $PKG test -f files/attestation-probe/$name.json" 2>/dev/null; then
      adb -s "$SERIAL" shell "run-as $PKG cat files/attestation-probe/$name.json" > "$OUT/$name.json"
      return 0
    fi
    if adb -s "$SERIAL" shell "run-as $PKG test -f files/attestation-probe/$name.error" 2>/dev/null; then
      echo "$name failed on the phone: $(adb -s "$SERIAL" shell "run-as $PKG cat files/attestation-probe/$name.error")" >&2
      return 1
    fi
    sleep 1
  done
  echo "$name: no result after 120 s" >&2
  return 1
}

STATEMENT_B64=$(base64 < "$STATEMENT" | tr -d '\n')
adb -s "$SERIAL" shell am broadcast -n "$RECEIVER" --es action attest --es statement "$STATEMENT_B64" > /dev/null
pull attest
echo "attestation chain: $(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(len(d["chain"]), "certificates, StrongBox" if d["strongBox"] else "certificates, TEE")' "$OUT/attest.json")"

NONCE=$(node "$HERE/capture-android-attestation.js" nonce "$OUT/attest.json" "$STATEMENT")
adb -s "$SERIAL" shell am broadcast -n "$RECEIVER" --es action integrity --es nonce "$NONCE" > /dev/null
pull integrity

PLAY_INTEGRITY_DECRYPTION_KEY=$(gcloud secrets versions access latest --secret=play-integrity-decryption-key --project=masselabs-zkproofport)
PLAY_INTEGRITY_VERIFICATION_KEY=$(gcloud secrets versions access latest --secret=play-integrity-verification-key --project=masselabs-zkproofport)
export PLAY_INTEGRITY_DECRYPTION_KEY PLAY_INTEGRITY_VERIFICATION_KEY
node "$HERE/capture-android-attestation.js" decrypt "$OUT/integrity.json" "$OUT/verdict.json"
unset PLAY_INTEGRITY_DECRYPTION_KEY
