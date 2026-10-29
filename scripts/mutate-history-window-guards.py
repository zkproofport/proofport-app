#!/usr/bin/env python3
"""
Break each guard of the History re-verify window and of the topic proof's
signerVariant on purpose, and check that a test notices.

WHY THIS EXISTS. @zkproofport-app/core 0.4.0-beta.1 refuses a Coinbase KYC
proof whose attested_at is over 15 minutes old (the same window as an OIDC
proof's `now`) before it asks the contract. src/utils/proofVerification.ts
asks core's pinned contract directly for a History proof past that window
(REQUEST_WINDOWS), still comparing the signer root and the build's address,
and gives core the proof's signerVariant so an Android proof is checked on
its own package's contract. src/openstoa-host/topicProofRelay.ts hands the
OpenStoa mini-app the proof's signerVariant, refusing an unknown one.

At every step it checks that (1) the substitution matched exactly once,
(2) the named case is reported FAILED (a `✕` line), not merely present in
the output, and (3) the file is restored byte-identical (sha256).

Prerequisite: node on PATH. NODE_OPTIONS is removed from the child
environment. Do not run it while Metro or another harness reads the files.

Usage:
    python3 scripts/mutate-history-window-guards.py
    python3 scripts/mutate-history-window-guards.py --list
    python3 scripts/mutate-history-window-guards.py -k coinbase

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

VERIFY = "src/utils/proofVerification.ts"
VERIFY_TEST = "src/utils/__tests__/proofVerification.test.ts"
RELAY = "src/openstoa-host/topicProofRelay.ts"
RELAY_TEST = "src/openstoa-host/__tests__/topicProofRelay.test.ts"
IDS = "src/config/circuitIds.ts"
V2_TEST = "src/__tests__/coinbaseKycIsV2Everywhere.test.ts"
APP_ROOT_TSX = "App.tsx"
LIFECYCLE_TEST = "src/__tests__/proofRequestReviewLifecycle.test.ts"
SCREEN = "src/screens/proof/ProofGenerationScreen.tsx"
SCREEN_TEST = "src/screens/__tests__/everyRelayRequestGetsOneAnswer.test.ts"
STORE = "src/stores/generationScreenStore.ts"


@dataclass(frozen=True)
class Mutation:
    name: str
    path: str
    old: str
    new: str
    guard: str
    expect_case: str


MUTATIONS = [
    Mutation("coinbase-has-no-window", VERIFY,
             """  coinbase_attestation: {
    input: 'attested_at',""",
             """  coinbase_attestation: null && {
    input: 'attested_at',""",
             VERIFY_TEST, "coinbase_attestation: is asked of core's pinned contract directly"),
    Mutation("window-reads-oidc-index-for-coinbase", VERIFY,
             "    index: COINBASE_ATTESTATION_PUBLIC_INPUT_LAYOUT.ATTESTED_AT,",
             "    index: OIDC_DOMAIN_ATTESTATION_PUBLIC_INPUT_LAYOUT.NOW,",
             VERIFY_TEST, "the age is read by each circuit's own time input"),
    Mutation("window-boundary-inclusive", VERIFY,
             "age > window.maxAgeSeconds",
             "age >= window.maxAgeSeconds",
             VERIFY_TEST, "900s old: goes to the core"),
    Mutation("root-not-checked-when-bypassing", VERIFY,
             "      if (window.stillChecked) {",
             "      if (false && window.stillChecked) {",
             VERIFY_TEST, "an old Coinbase proof still has its signer root compared"),
    Mutation("bypass-ignores-the-claimed-address", VERIFY,
             "      if (pinned.address.toLowerCase() !== claimed.verifierAddress.toLowerCase()) {",
             "      if (false) {",
             VERIFY_TEST, "coinbase_attestation: a build naming another contract is refused"),
    Mutation("bypass-uses-the-standard-contract-on-android", VERIFY,
             "      const pinned = getPinnedVariantVerifier(circuit, signerVariant, claimed.chainId);",
             "      const pinned = getPinnedVariantVerifier(circuit, 'standard', claimed.chainId);",
             VERIFY_TEST, "android coinbase_attestation: the package's own pinned contract, asked directly"),
    Mutation("unknown-circuit-has-no-window", VERIFY,
             "  if (!Object.prototype.hasOwnProperty.call(REQUEST_WINDOWS, circuit)) {",
             "  if (!Object.prototype.hasOwnProperty.call(REQUEST_WINDOWS, circuit)) return null;\n  if (false) {",
             VERIFY_TEST, 'an unknown circuit "arc_eligibility" is an error'),
    Mutation("android-variant-not-given-to-core", VERIFY,
             "  return verifyProofOnChain(circuit, parsedProof, provider, {chainId: claimed.chainId}, claimed, {signerVariant});",
             "  return verifyProofOnChain(circuit, parsedProof, provider, {chainId: claimed.chainId}, claimed);",
             VERIFY_TEST, "with the real core, a fresh android Coinbase proof passes every check"),
    Mutation("android-names-the-address-again", VERIFY,
             "  return verifyProofOnChain(circuit, parsedProof, provider, {chainId: claimed.chainId}, claimed, {signerVariant});",
             "  return verifyProofOnChain(circuit, parsedProof, provider, {address: claimed.verifierAddress, chainId: claimed.chainId, abi: VERIFIER_ABI}, claimed);",
             VERIFY_TEST, "with the real core, a fresh android_factory Coinbase proof passes every check"),
    Mutation("action-binding-overridden-to-none", IDS,
             "export const CIRCUIT_ACTION_BINDING: Readonly<Record<CircuitName, CircuitActionBinding>> = CORE_CIRCUIT_ACTION_BINDING;",
             "export const CIRCUIT_ACTION_BINDING: Readonly<Record<CircuitName, CircuitActionBinding>> = Object.freeze({...CORE_CIRCUIT_ACTION_BINDING, coinbase_attestation: 'none'});",
             V2_TEST, "is optional for coinbase_attestation"),
    Mutation("topic-proof-drops-the-variant", RELAY,
             "      return {proof: data.proof, publicInputs: data.publicInputs, ...signerVariantOf(data)};",
             "      return {proof: data.proof, publicInputs: data.publicInputs};",
             RELAY_TEST, "android coinbase_attestation is returned with the proof"),
    Mutation("topic-proof-passes-any-variant", RELAY,
             "  if (typeof v !== 'string' || !SIGNER_VARIANTS.includes(v)) {",
             "  if (false) {",
             RELAY_TEST, '"ios" is refused (E1002)'),
    Mutation("topic-proof-variant-case-folded", RELAY,
             "  if (typeof v !== 'string' || !SIGNER_VARIANTS.includes(v)) {",
             "  if (typeof v !== 'string' || !SIGNER_VARIANTS.includes(v.trim().toLowerCase())) {",
             RELAY_TEST, '"ANDROID" is refused (E1002)'),
    Mutation("topic-proof-fills-in-standard", RELAY,
             "  if (!Object.prototype.hasOwnProperty.call(data, 'signerVariant') || data.signerVariant === undefined) return {};",
             "  if (!Object.prototype.hasOwnProperty.call(data, 'signerVariant') || data.signerVariant === undefined) return {signerVariant: 'standard'};",
             RELAY_TEST, "absent stays absent"),
    # --- a new request's review is not held under an ended attempt ---
    Mutation("review-held-under-any-proof-screen", APP_ROOT_TSX,
             """    if (!pendingRequestRef.current || generationNavigationPending.current ||
        generationHoldsReview(navigationRef.current?.getRootState())) return;""",
             """    if (!pendingRequestRef.current || generationNavigationPending.current ||
        hasGenerationScreen(navigationRef.current?.getRootState())) return;""",
             LIFECYCLE_TEST, "opens the review at once (selected tab ProofTab)"),
    Mutation("accept-refused-under-any-proof-screen", APP_ROOT_TSX,
             """    if (generationNavigationPending.current ||
        generationHoldsReview(navigationRef.current?.getRootState())) return false;""",
             """    if (generationNavigationPending.current ||
        hasGenerationScreen(navigationRef.current?.getRootState())) return false;""",
             LIFECYCLE_TEST, "opens the review at once (selected tab WalletTab)"),
    Mutation("held-review-not-reopened-when-attempt-ends", APP_ROOT_TSX,
             "  useEffect(() => onGenerationScreenIdle(() => showPendingReview()), [showPendingReview]);",
             "",
             LIFECYCLE_TEST, "a review held while the attempt ran opens the moment the attempt ends"),
    Mutation("ended-attempt-not-reported-idle", SCREEN,
             "    markGenerationScreenIdle();\n  }, []);",
             "  }, []);",
             SCREEN_TEST, "idle once the attempt fails (a thrown error)"),
    Mutation("started-attempt-not-reported-busy", SCREEN,
             "    proofStartedAt.current = Date.now();\n    markGenerationScreenBusy();",
             "    proofStartedAt.current = Date.now();",
             SCREEN_TEST, "pressing generate makes it busy"),
    Mutation("old-screen-release-overwrites-new", STORE,
             "  if (owner !== screen) return;\n",
             "",
             LIFECYCLE_TEST, "an old screen unmounting after its replacement mounted"),
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
