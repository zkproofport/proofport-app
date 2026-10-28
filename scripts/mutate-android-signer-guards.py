#!/usr/bin/env python3
"""
Break each guard of the Android signer on purpose, and check that a test
notices.

WHY THIS EXISTS. Branch `android-signature` lets Android phones prove
Coinbase KYC v2 and the OIDC domain proof with Android key attestation:
  - src/utils/androidKeyAttestation.ts converts the chain exactly as circuits'
    chain.js does (low s, padding limits, the pinned root);
  - src/androidAttest/androidChainChecks.ts refuses before proving what the
    circuit refuses (not RKP, certificates not valid at the statement's time,
    software key, unlocked or unverified device, another signing certificate,
    an imported key);
  - src/androidAttest/androidSigner.ts signs, checks, converts and puts the
    statement signature in low form;
  - src/config/circuitArtifacts.ts picks each platform's files, and
    src/utils/circuitDownload.ts joins the split 2^21 .srs only after every
    digest matched.
Each mutation removes one guard and asserts the named test case goes red.

At every step it checks that (1) the substitution matched exactly once,
(2) the named case is reported FAILED (a `✕` line), not merely present in
the output, and (3) the file is restored byte-identical (sha256).

Prerequisite: node on PATH. NODE_OPTIONS is removed from the child
environment. Do not run it while Metro or another harness reads the files.

Usage:
    python3 scripts/mutate-android-signer-guards.py
    python3 scripts/mutate-android-signer-guards.py --list
    python3 scripts/mutate-android-signer-guards.py -k checks

Exit code is 0 only when every mutation was applied, caught, and reverted.
"""

from __future__ import annotations

import argparse
import hashlib
import os
import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

APP = Path(__file__).resolve().parent.parent

CONVERTER = "src/utils/androidKeyAttestation.ts"
CHECKS = "src/androidAttest/androidChainChecks.ts"
SIGNER = "src/androidAttest/androidSigner.ts"
OIDC_SIGNER = "src/oidc/oidcAppSigner.ts"
STATEMENT = "src/appAttest/coinbaseKycStatement.ts"
ARTIFACTS = "src/config/circuitArtifacts.ts"
DOWNLOAD = "src/utils/circuitDownload.ts"
OIDC = "src/utils/oidcDomain.ts"

CONVERTER_TEST = "src/utils/__tests__/androidChainMatchesTheCircuitsConverter.test.ts"
CHECKS_TEST = "src/androidAttest/__tests__/androidChainChecksRefuseWhatTheCircuitRefuses.test.ts"
SIGNER_TEST = "src/androidAttest/__tests__/theAndroidSignerSignsTheStatement.test.ts"
PHONES_TEST = "src/androidAttest/__tests__/androidPhonesProveCoinbaseAndOidc.test.ts"
ABI_TEST = "src/androidAttest/__tests__/theAndroidInputsFollowTheCircuitAbi.test.ts"
PLATFORM_TEST = "src/config/__tests__/eachPlatformReadsItsOwnCircuitFiles.test.ts"
SPLIT_TEST = "src/utils/__tests__/aSplitSrsIsJoinedOnlyWhenEveryDigestMatches.test.ts"
PLAY = "src/androidAttest/playIntegrity.ts"
VARIANT = "src/utils/proofSignerVariant.ts"
FACTORY_CHECK_TEST = "src/androidAttest/__tests__/aFactoryPhoneIsCheckedLikeTheCircuit.test.ts"
FACTORY_SIGN_TEST = "src/androidAttest/__tests__/aFactoryPhoneSignsWithAVerdict.test.ts"
FACTORY_CONVERTER_TEST = "src/utils/__tests__/androidFactoryChainMatchesTheCircuitsConverter.test.ts"


@dataclass(frozen=True)
class Mutation:
    name: str
    path: str
    old: str
    new: str
    guard: str
    expect_case: str


MUTATIONS: list[Mutation] = [
    # --- the converter (mirror of chain.js) ---
    Mutation("converter-keeps-high-s", CONVERTER,
             "    leaf_sig: lowS(L.sigDer, 32, N_P256, 'Leaf'),",
             "    leaf_sig: lowS(L.sigDer, 32, N_P256 * 4n, 'Leaf'),",
             CONVERTER_TEST, "a chain with every signature's s in its other form gives the same inputs as the original"),
    Mutation("converter-any-root", CONVERTER,
             "  if (root && !bytesEqual(certKey(root, 'P-384', 'The root certificate'), rootKey)) {",
             "  if (root && false) {",
             CONVERTER_TEST, "root-is-ca2-not-ca1 -> E2015"),
    Mutation("converter-no-tbs-limit", CONVERTER,
             "  if (tbs.length > max) malformed(",
             "  if (tbs.length > max * 10) malformed(",
             CONVERTER_TEST, "leaf-tbs-over-1024 -> E2016"),
    Mutation("converter-accepts-rsa", CONVERTER,
             "  if (algs.signature.startsWith(OID_RSA_FAMILY_PREFIX) || algs.key.startsWith(OID_RSA_FAMILY_PREFIX)) {",
             "  if (false) {",
             CONVERTER_TEST, "sony-xperia10iii-sdk33-factory -> E2015"),
    # --- the checks the circuit would otherwise make after proving ---
    Mutation("checks-skip-provisioning", CHECKS,
             "  if (!att.fields.extensions.has(OID_PROVISIONING_INFO)) {",
             "  if (false) {",
             CHECKS_TEST, "refuses an attestation key without the provisioning-information extension (not RKP)"),
    Mutation("checks-skip-expiry", CHECKS,
             "    if (opts.now > notAfter) {",
             "    if (false) {",
             CHECKS_TEST, "one second after notAfter -> E2015"),
    Mutation("checks-skip-not-before", CHECKS,
             "    if (opts.now < notBefore) {",
             "    if (false) {",
             CHECKS_TEST, "one second before notBefore -> E2015"),
    Mutation("checks-skip-security-level", CHECKS,
             "    if (att.level !== SECURITY_LEVEL.trustedEnvironment && att.level !== SECURITY_LEVEL.strongBox) {",
             "    if (false) {",
             CHECKS_TEST, "refuses a software key (attestation and KeyMint level 0) (E2015)"),
    Mutation("checks-skip-level-match", CHECKS,
             "    if (km.level !== att.level) {",
             "    if (false) {",
             CHECKS_TEST, "refuses KeyMint level differing from the attestation level (E2015)"),
    Mutation("checks-skip-locked", CHECKS,
             "  if (buf[locked.contentStart] === 0) unavailable(",
             "  if (false) unavailable(",
             CHECKS_TEST, "refuses an unlocked bootloader (E2015)"),
    Mutation("checks-skip-boot-state", CHECKS,
             "  if (buf[state.contentStart] !== 0) unavailable(",
             "  if (false) unavailable(",
             CHECKS_TEST, "refuses boot state SelfSigned (E2015)"),
    Mutation("checks-skip-origin", CHECKS,
             "    if (!generated) unavailable(",
             "    if (false) unavailable(",
             CHECKS_TEST, "refuses an imported key (origin 2) (E2015)"),
    Mutation("checks-skip-package", CHECKS,
             "  if (names[0] !== app.packageName) unavailable(",
             "  if (false) unavailable(",
             CHECKS_TEST, "is refused for ZKProofport: the key belongs to another app (E2015)"),
    Mutation("checks-skip-signing-digest", CHECKS,
             "  if (digests[0] !== app.signingCertSha256.toLowerCase()) {",
             "  if (false) {",
             CHECKS_TEST, "is refused for the right package signed with another certificate"),
    # --- the signer ---
    Mutation("signer-keeps-high-s", SIGNER,
             "    return ecdsaDerToLowS(signature, 32, N_P256);",
             "    return ecdsaDerToLowS(signature, 32, N_P256 * 4n);",
             SIGNER_TEST, "returns the circuit inputs, statement_sig in low form (device s high: true)"),
    Mutation("signer-skips-chain-checks", SIGNER,
             "  const summary = requireAcceptableAndroidChain(chain, {now: opts.now, app, rootKey});",
             "  const summary = {securityLevel: 'TrustedEnvironment', attestationVersion: 0};",
             SIGNER_TEST, "refuses, before converting anything, a chain made for another app"),
    Mutation("oidc-android-skips-live-check", OIDC_SIGNER,
             "    requireLiveModulus(live, provider, modulus, clock());\n    const statement = providerKeyStatement(provider, now, modulus);\n    // The key signs",
             "    const statement = providerKeyStatement(provider, now, modulus);\n    // The key signs",
             PHONES_TEST, "refuses a modulus the live list does not hold, signing nothing"),
    Mutation("coinbase-android-signs-other-bytes", STATEMENT,
             "  const signer = await signStatementOnAndroid(clientData, {now: attestedAt",
             "  const signer = await signStatementOnAndroid(clientData.slice(1), {now: attestedAt",
             PHONES_TEST, "signs the 225-byte clientData with the Android key, at attested_at, and never asks App Attest"),
    Mutation("oidc-flatten-any-signer", OIDC,
             "  } else if (signer?.signer_kind === SIGNER_KIND_APP) {",
             "  } else if (signer !== null) {",
             ABI_TEST, "refuses signer inputs that are neither kind, naming them"),
    # --- per-platform files and the split .srs ---
    Mutation("artifacts-unknown-variant-falls-through", ARTIFACTS,
             "  if (!Object.prototype.hasOwnProperty.call(row, variant)) {",
             "  if (false) {",
             PLATFORM_TEST, "an unknown platform or variant throws, naming it"),
    Mutation("artifacts-any-android-ref", ARTIFACTS,
             "  if (source.variant !== 'app_attest' && !/^[0-9a-f]{40}$/.test(source.ref)) {",
             "  if (false) {",
             PLATFORM_TEST, "refuses a branch name or a short sha on an android row, naming the constant"),
    Mutation("split-unhashed-part-joined", DOWNLOAD,
             "      if (verdict.level !== 'sha256') throw new Error(`${partName} could not be hashed",
             "      if (false) throw new Error(`${partName} could not be hashed",
             SPLIT_TEST, "a part the phone cannot hash is refused, and nothing is left behind"),
    Mutation("split-joined-digest-unchecked", DOWNLOAD,
             "    if (!verdict.ok) throw new Error(`Joined ${circuitName}.srs failed verification",
             "    if (false) throw new Error(`Joined ${circuitName}.srs failed verification",
             SPLIT_TEST, "a joined file whose sha256 does not match is refused, and nothing is left behind"),
    Mutation("split-leaves-files-on-failure", DOWNLOAD,
             "    await removeAll();\n    throw e;",
             "    throw e;",
             SPLIT_TEST, "a part whose sha256 does not match is refused, and nothing is left behind"),
    Mutation("split-reads-whole-parts", DOWNLOAD,
             "        const length = Math.min(SRS_JOIN_CHUNK_BYTES, size - pos);",
             "        const length = size - pos;",
             SPLIT_TEST, "is fetched part by part, joined in bounded chunks, and checked whole"),
    # --- factory-provisioned phones: chain kind, Play Integrity, the callback ---
    Mutation("classify-any-4-certificate-chain", CONVERTER,
             "    if (rsaModulusOf(last, 'The root certificate') === roots.rsaRootModulusHex.toLowerCase()) return 'android_factory';",
             "    return 'android_factory';",
             FACTORY_CONVERTER_TEST, "refuses an RKP chain without its root (4 certificates) (E2015)"),
    Mutation("factory-converter-any-root", CONVERTER,
             "  if (root && rsaModulusOf(root, 'The root certificate') !== rootModulusHex.toLowerCase()) {",
             "  if (root && false) {",
             FACTORY_CONVERTER_TEST, "sony-under-ca1 (E2015)"),
    Mutation("factory-skips-chain-checks", SIGNER,
             "  const summary = requireAcceptableFactoryChain(chain, {app, rootModulusHex: rsaRootModulusHex});",
             "  const summary = {securityLevel: 'TrustedEnvironment', attestationVersion: 0};",
             FACTORY_SIGN_TEST, "refuses an unlocked phone before asking for a verdict"),
    Mutation("kind-change-accepted", SIGNER,
             "  if (known !== null && known !== kind) {",
             "  if (false) {",
             FACTORY_SIGN_TEST, "a change of kind since the files were chosen is refused"),
    Mutation("nonce-other-order", PLAY,
             "  return ethers.utils.arrayify(ethers.utils.sha256(Uint8Array.from([...h, ...statementSig])));",
             "  return ethers.utils.arrayify(ethers.utils.sha256(Uint8Array.from([...statementSig, ...h])));",
             FACTORY_CHECK_TEST, "is android.js playIntegrityNonce"),
    Mutation("verdict-any-header", PLAY,
             "  if (jws.protectedHeader !== JWS_HEADER_B64) {",
             "  if (false) {",
             FACTORY_CHECK_TEST, "refuses another protected header (E2016)"),
    Mutation("verdict-keeps-high-s", PLAY,
             "  if (s > N_P256 / 2n) s = N_P256 - s;\n",
             "",
             FACTORY_CHECK_TEST, "good: the circuit's inputs, s lowered"),
    Mutation("verdict-skips-recognition", PLAY,
             "  if (app.appRecognitionVerdict !== 'PLAY_RECOGNIZED') {",
             "  if (false) {",
             FACTORY_CHECK_TEST, "unrecognizedApp -> E2017"),
    Mutation("verdict-skips-device-integrity", PLAY,
             "  if (!verdicts.includes('MEETS_DEVICE_INTEGRITY') && !verdicts.includes('MEETS_STRONG_INTEGRITY')) {",
             "  if (false) {",
             FACTORY_CHECK_TEST, "basicIntegrityOnly -> E2017"),
    Mutation("verdict-accepts-literal-pad", PLAY,
             "  const escapedPad = request.nonce === `${want}=` && rawJson.includes(`\"${want}${ESCAPED_PAD}\"`);",
             "  const escapedPad = request.nonce === `${want}=`;",
             FACTORY_CHECK_TEST, "literalPaddedNonce -> E2016"),
    Mutation("relay-not-configured-as-device-error", PLAY,
             "    if (res.status === 429 || res.status >= 500 || reason === 'not_configured') {",
             "    if (res.status === 429) {",
             FACTORY_CHECK_TEST, "HTTP 503 not_configured -> E3008, naming it"),
    Mutation("callback-variant-defaults-to-standard", VARIANT,
             "  throw new Error(`The ${circuit} proof does not say which package made it",
             "  return 'standard';\n  throw new Error(`The ${circuit} proof does not say which package made it",
             FACTORY_SIGN_TEST, "a per-signer proof that does not say is an error"),
]


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run_guard(guard: str) -> tuple[int, str]:
    env = {k: v for k, v in os.environ.items() if k != "NODE_OPTIONS"}
    proc = subprocess.run(
        ["npx", "jest", "--ci", "--runInBand", guard],
        cwd=APP,
        capture_output=True,
        text=True,
        env=env,
    )
    return proc.returncode, proc.stdout + proc.stderr


def failed_case(out: str, case: str) -> bool:
    return any("✕" in line and case in line for line in out.splitlines())


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", action="store_true")
    ap.add_argument("-k", dest="filter", default="")
    args = ap.parse_args()

    chosen = [m for m in MUTATIONS if args.filter in m.name]
    if args.list:
        for m in chosen:
            print(f"{m.name:40s} {m.path}")
        return 0

    print(f"{len(chosen)} mutations\n")
    failures: list[str] = []

    for m in chosen:
        target = APP / m.path
        original_bytes = target.read_bytes()
        before = sha256(target)
        text = original_bytes.decode("utf-8")

        hits = text.count(m.old)
        if hits != 1:
            failures.append(f"{m.name}: anchor matched {hits} times, expected 1")
            print(f"  SKIP  {m.name}: anchor matched {hits} times")
            continue

        target.write_text(text.replace(m.old, m.new), encoding="utf-8")
        try:
            code, out = run_guard(m.guard)
            if code != 0 and failed_case(out, m.expect_case):
                red = len([l for l in out.splitlines() if "✕" in l])
                print(f"  RED   {m.name}  ({red} case(s) failed)")
            else:
                why = "guard stayed green" if code == 0 else "failed, but not the named case"
                failures.append(f"{m.name}: {why}")
                print(f"  MISS  {m.name}: {why}")
                for line in out.splitlines():
                    if re.search(r"✕|Tests:", line):
                        print(f"        {line.strip()}")
        finally:
            target.write_bytes(original_bytes)
            if sha256(target) != before:
                failures.append(f"{m.name}: restore left {m.path} changed")
                print(f"  DIRTY {m.name}: {m.path} not restored")

    print()
    if failures:
        print(f"{len(failures)} problem(s):")
        for f in failures:
            print(f"  - {f}")
        return 1
    print(f"all {len(chosen)} mutations were caught, and every file restored")
    return 0


if __name__ == "__main__":
    sys.exit(main())
