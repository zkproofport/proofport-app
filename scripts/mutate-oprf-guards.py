#!/usr/bin/env python3
"""
Break each OPRF guard in the app on purpose and check that a test notices.

The OPRF nullifier (src/oprf/) is only as good as the checks around it: the
key hash pinned per environment, the nodes' Chaum-Pedersen proof, the name
rules the nodes apply, the refusal of production (no network, no key), the
request's own domain on the review screen and at the proof screen. Each
mutation below removes one of those and asserts the named test case goes red.

Guards that live in `@zkproofport-app/core` are not mutated here. Since the
app imports the OPRF client from the installed core (0.4.0-beta.9), the key
hash comparison in `finalizeOprf`, the DLog challenge comparison, the subgroup
check on the nodes' points and the name rules (length, Cc, Cf) are core's
code inside node_modules; breaking them here would test a file the app does
not own, and they are mutation-tested in proofport-app-sdk where they are
written. The app still holds them to the shared vectors
(src/oprf/__tests__/theInstalledCoreMatchesTheSharedOprfVectors.test.ts).
Every guard below is app code.

At every step it checks that (1) the substitution matched exactly once,
(2) the named case is reported FAILED (a `✕` line), not merely present in the
output, and (3) the file is restored byte-identical (sha256).

Usage:
    python3 scripts/mutate-oprf-guards.py
    python3 scripts/mutate-oprf-guards.py --list
    python3 scripts/mutate-oprf-guards.py -k dlog

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

CONFIG = "src/oprf/config.ts"
NAMES = "src/oprf/requestNames.ts"
TRANSPORT = "src/oprf/transport.ts"
FLOW = "src/oprf/flow.ts"
SCREEN = "src/screens/proof/ProofGenerationScreen.tsx"
MODAL = "src/components/ProofRequestModal.tsx"
DEVICE = "src/oprf/device.ts"

T_CORE = "src/oprf/__tests__/theInstalledCoreMatchesTheSharedOprfVectors.test.ts"
T_RULES = "src/oprf/__tests__/oprfNamesConfigAndRequestProofAreRefusedByName.test.ts"
T_FLOW = "src/oprf/__tests__/theOprfFlowIsCheckedAtEveryStep.test.ts"
T_SCREEN = "src/screens/__tests__/everyRelayRequestGetsOneAnswer.test.ts"
T_MODAL = "src/components/__tests__/theOprfNamesAreShownBesideTheRequester.test.ts"
T_DEVICE = "src/oprf/__tests__/theDeviceBindingRefusesWhatItCannotProve.test.ts"


@dataclass(frozen=True)
class Mutation:
    name: str
    path: str
    old: str
    new: str
    guard: str
    expect_case: str


MUTATIONS: list[Mutation] = [
    # The app's environment -> core's environment, which picks the pinned row.
    Mutation(
        name="staging-looks-up-core-production",
        path=CONFIG,
        old="  staging: 'staging',\n  production: 'production',\n});",
        new="  staging: 'production',\n  production: 'production',\n});",
        guard=T_CORE,
        expect_case="the app's pinned key hash is that key's hash",
    ),
    # The transport's own checks before it returns: the combined DLog proof, one key.
    Mutation(
        name="dlog-not-checked-after-combining",
        path=TRANSPORT,
        old="    if (!verifyOprfDlogEquality({publicKey, blindedQuery: args.blindedQuery, blindedResponse: challenge.c, e, s})) {",
        new="    if (false) {",
        guard=T_FLOW,
        expect_case="a bad proof share is refused by the transport as bad-proof",
    ),
    Mutation(
        name="inconsistent-keys-accepted",
        path=TRANSPORT,
        old="    if (!chosen.every(c => c.resp.publicKey.x === publicKey.x && c.resp.publicKey.y === publicKey.y)) {",
        new="    if (false) {",
        guard=T_FLOW,
        expect_case="nodes naming different keys are refused as inconsistent-keys",
    ),
    # Names: the app's refusal of a missing name, and the screen calling the check.
    Mutation(
        name="missing-domain-filled-in",
        path=NAMES,
        old="  if (value === undefined || value === null) {\n    throw new OprfNameRefusedError(field, 'missing', `The request has no ${field}.`);\n  }",
        new="  if (value === undefined || value === null) {\n    return IN_APP_OPRF_DOMAIN;\n  }",
        guard=T_RULES,
        expect_case="refuses a domain that is absent",
    ),
    Mutation(
        name="screen-skips-the-name-check",
        path=SCREEN,
        old="        return oprfNamesFor(proofRequest ? {inputs: proofRequest.inputs} : null, scope).domainName;",
        new="        return String((proofRequest?.inputs as {oprfDomain?: unknown} | undefined)?.oprfDomain ?? 'zkproofport.app');",
        guard=T_SCREEN,
        expect_case="with an unusable OPRF name",
    ),
    # Production: no network, no key.
    Mutation(
        name="production-uses-the-test-network",
        path=CONFIG,
        old="  staging: OPRF_TEST_NETWORK,\n  production: null,",
        new="  staging: OPRF_TEST_NETWORK,\n  production: OPRF_TEST_NETWORK,",
        guard=T_RULES,
        expect_case="production has no network and no key",
    ),
    Mutation(
        name="production-looks-up-core-staging",
        path=CONFIG,
        old="  staging: 'staging',\n  production: 'production',\n});",
        new="  staging: 'staging',\n  production: 'staging',\n});",
        guard=T_RULES,
        expect_case="production has no network and no key",
    ),
    Mutation(
        name="production-refusal-not-e3011",
        path=CONFIG,
        old="  if (OPRF_KEY_HASHES[coreEnv] === null) {",
        new="  if (false) {",
        guard=T_RULES,
        expect_case="production has no network and no key",
    ),
    Mutation(
        name="hook-precheck-skips-production",
        path=DEVICE,
        old="  oprfNetworkFor(getEnvironment());\n  pinnedOprfKeyHash(getEnvironment(), circuit);",
        new="  void circuit;",
        guard=T_DEVICE,
        expect_case="production is refused for every wallet credential circuit",
    ),
    # Deadline: a request whose signature lapsed is not sent.
    Mutation(
        name="lapsed-request-sent",
        path=FLOW,
        old="    if (left < OPRF_MIN_REMAINING_SECONDS) {",
        new="    if (left < -1e9) {",
        guard=T_FLOW,
        expect_case="a request whose deadline lapsed while proving is not sent",
    ),
    # The review screen shows the domain and the scope.
    Mutation(
        name="review-hides-the-domain",
        path=MODAL,
        old="<Text style={secondary}>{t('host.proofRequest.review.oprfDomain')}  </Text>{formatReviewScalar(oprfInputs?.oprfDomain, t)}",
        new="<Text style={secondary}>{t('host.proofRequest.review.oprfDomain')}  </Text>",
        guard=T_MODAL,
        expect_case="shows both, labelled, in en",
    ),
    Mutation(
        name="review-hides-the-scope-row",
        path=MODAL,
        old="                    <Text testID=\"request-oprf-scope\"",
        new="                    <Text testID=\"request-oprf-scope-hidden\"",
        guard=T_MODAL,
        expect_case="shows both, labelled, in ko",
    ),
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
            print(f"{m.name:34s} {m.path}")
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
