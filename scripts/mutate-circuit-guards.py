#!/usr/bin/env python3
"""
Break each circuit-id guard on purpose and check that it notices.

WHY THIS EXISTS. `src/__tests__/theCircuitListComesFromTheSdk.test.ts` and
`src/__tests__/aProofRequestNamesItsCircuitOrIsRefused.test.ts` are guards, not
feature tests: they exist to fail when a circuit-id list drifts back apart. A
guard that cannot fail is worse than no guard, because it reports green over
the exact defect it was written for — which is how twenty-four separate lists
of seven strings survived in this app for as long as they did.

So each mutation below reintroduces a REAL defect that was found and fixed on
2026-09-04, and the run asserts the matching case goes red.

WHAT IT CHECKS AT EVERY STEP (all three, because each has been got wrong here
before — see the mutation-testing note in the user's project memory):

  1. the substitution ACTUALLY MATCHED — a replace that hits nothing leaves the
     file green and reads as "the guard does not bite"
  2. the test goes RED, and red for the named case rather than a syntax error
     that fails everything
  3. the file comes back BYTE-IDENTICAL — compared by sha256, not by eye

Usage:
    python3 scripts/mutate-circuit-guards.py            # all mutations
    python3 scripts/mutate-circuit-guards.py --list
    python3 scripts/mutate-circuit-guards.py -k display # substring filter

Exit code is 0 only when every mutation was applied, caught, and reverted.
"""

from __future__ import annotations

import argparse
import hashlib
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

APP = Path(__file__).resolve().parent.parent

SDK_GUARD = "src/__tests__/theCircuitListComesFromTheSdk.test.ts"
SCREEN_GUARD = "src/__tests__/aProofRequestNamesItsCircuitOrIsRefused.test.ts"


@dataclass(frozen=True)
class Mutation:
    name: str
    """The defect being reintroduced, in the words of the original bug."""
    defect: str
    path: str
    old: str
    new: str
    """Test file to run, and a substring of the case name that must fail."""
    guard: str
    expect_case: str


MUTATIONS: list[Mutation] = [
    Mutation(
        name="display-name-row-removed",
        defect="getCircuitDisplayName had no mdl_kr_* rows, so history screens "
        "showed the user the raw string 'mdl-kr-age'",
        path="src/utils/circuit.ts",
        old="  mdl_kr_age: 'Korea Mobile ID — Age',\n",
        new="",
        guard=SDK_GUARD,
        expect_case="display name that is not just its id echoed back",
    ),
    Mutation(
        name="icon-row-removed",
        defect="CIRCUIT_ICONS had no mdl_kr_* rows, so the cards fell through "
        "to the generic shield",
        path="src/utils/circuit.ts",
        old="  mdl_kr_region: 'credit-card',\n",
        new="",
        guard=SDK_GUARD,
        expect_case="every circuit has a real icon",
    ),
    Mutation(
        name="giwa-label-forked-again",
        defect="'GIWA KYC' on the completion screen vs 'GIWA KYC "
        "(Experimental)' everywhere else",
        path="src/screens/proof/ProofCompleteScreen.tsx",
        old="  const circuitName = getCircuitDisplayName(circuitId);",
        new="  const circuitName = canonical === 'giwa_attestation' ? 'GIWA KYC' "
        ": getCircuitDisplayName(circuitId);",
        guard=SDK_GUARD,
        expect_case="GIWA label exists exactly once",
    ),
    Mutation(
        name="mdl-title-shares-ownership-key",
        defect="THE HEADLINE DEFECT — mdl_kr_age rendered the OWNERSHIP title",
        path="src/screens/proof/ProofGenerationScreen.tsx",
        old="    title: 'host.proof.generation.mdlKrAgeTitle',",
        new="    title: 'host.proof.generation.mdlKrOwnershipTitle',",
        guard=SCREEN_GUARD,
        expect_case="name a DIFFERENT key per circuit",
    ),
    Mutation(
        name="sync-deployments-hand-written-list",
        defect="syncDeployments listed three circuits while six had a "
        "broadcast path, so mDL verifier addresses never refreshed",
        path="src/config/deployments.ts",
        old="  const circuits: ReadonlyArray<CircuitName> = CIRCUITS_WITH_BROADCAST;",
        new="  const circuits: ReadonlyArray<CircuitName> = ["
        "'coinbase_attestation', 'coinbase_country_attestation', "
        "'oidc_domain_attestation'];",
        guard=SDK_GUARD,
        expect_case="every circuit with a broadcast path is synced",
    ),
    Mutation(
        name="startup-prefetch-hand-written-list",
        defect="the startup prefetch omitted all three mdl_kr_* circuits",
        path="src/screens/LoadingScreen.tsx",
        old="const BASE_CIRCUITS: ReadonlyArray<string> = SUPPORTED_CIRCUIT_IDS;",
        new="const BASE_CIRCUITS: ReadonlyArray<string> = "
        "['coinbase_attestation', 'coinbase_country_attestation'];",
        guard=SDK_GUARD,
        expect_case="startup prefetches every circuit",
    ),
    Mutation(
        name="route-id-written-down-again",
        defect="a hyphenated route id keyed a second table, which is how every "
        "one of these defects started",
        path="src/screens/proof/ProofCompleteScreen.tsx",
        old="  const isGiwaCircuit = canonical === 'giwa_attestation';",
        new="  const isGiwaCircuit = canonical === 'giwa_attestation' || "
        "circuitId === 'giwa-kyc';",
        guard=SDK_GUARD,
        expect_case="only place a route id is written down",
    ),
    Mutation(
        name="id-built-by-concatenation",
        defect="MdlKrInputScreen assembled `mdl-kr-${variant}` — invisible to "
        "any check that looks for a literal",
        path="src/screens/proof/MdlKrInputScreen.tsx",
        old="    const circuitId = MDL_KR_CIRCUIT_NAMES[variant];",
        new="    const circuitId = `mdl-kr-${variant}`;",
        guard=SDK_GUARD,
        expect_case="builds a circuit id by concatenation",
    ),
    Mutation(
        name="prototype-key-resolves",
        defect="a deep link naming '__proto__' resolved to Object.prototype, a "
        "truthy value every caller downstream would use as a circuit id",
        path="src/config/circuitIds.ts",
        old="  if (!Object.prototype.hasOwnProperty.call(ROUTE_CIRCUIT_IDS, id)) {\n"
        "    return undefined;\n  }\n",
        new="",
        guard=SDK_GUARD,
        expect_case="nothing else resolves to a circuit",
    ),
    Mutation(
        name="sdk-root-import",
        defect="importing the package root drags socket.io-client and qrcode "
        "into a phone bundle for a relay client this app does not use",
        path="src/config/circuitIds.ts",
        old="} from '@zkproofport-app/sdk/circuits';",
        new="} from '@zkproofport-app/sdk';",
        guard=SDK_GUARD,
        expect_case="dependency-free subpath that is imported",
    ),
    Mutation(
        name="second-sdk-importer",
        defect="a second door into the SDK is where the drift starts again",
        path="src/utils/circuit.ts",
        old="import {canonicalCircuitId, type CircuitName} from '../config/circuitIds';",
        new="import {canonicalCircuitId, type CircuitName} from '../config/circuitIds';\n"
        "import {ALL_CIRCUIT_IDS as _unused} from '@zkproofport-app/sdk/circuits';",
        guard=SDK_GUARD,
        expect_case="exactly one module imports the SDK",
    ),
    Mutation(
        name="deeplink-validates-against-a-copy",
        defect="validateProofRequest carried its own seven-element array",
        path="src/utils/deeplink.ts",
        old="  if (!isCircuitId(request.circuit)) {",
        new="  if (!['coinbase_attestation', 'coinbase_country_attestation'].includes("
        "request.circuit)) {",
        guard=SDK_GUARD,
        expect_case="deep link is validated against the published list",
    ),
    Mutation(
        name="main-branch-circuits-listed-not-asked",
        defect="a four-way || chain of literal names decided which circuits are "
        "read from circuits@main",
        path="src/utils/circuitDownload.ts",
        old="    const baseUrl = PLANNED_CIRCUIT_IDS.includes(circuitName as CircuitName)",
        new="    const baseUrl = circuitName === 'giwa_attestation'",
        guard=SDK_GUARD,
        expect_case="circuits read from main are the planned ones",
    ),
    Mutation(
        name="fallback-verifier-row-removed",
        defect="a circuit with no verifier address ships and fails on-chain "
        "verification with an empty address",
        path="src/config/contracts.ts",
        old="    mdl_kr_region:    '0x435F0448F02F5Df9659D460181116BCaF37E518E',\n  },\n"
        "  production: {",
        new="  },\n  production: {",
        guard=SDK_GUARD,
        expect_case="FALLBACK_VERIFIERS.staging has a row",
    ),
    Mutation(
        name="circuit-unreachable-from-verify-tab",
        defect="a circuit on no network and not network-independent has a card "
        "that is never rendered",
        path="src/config/networks.ts",
        old="    circuits: ['mdl_kr_ownership', 'mdl_kr_age', 'mdl_kr_region'],",
        new="    circuits: ['mdl_kr_ownership', 'mdl_kr_age'],",
        guard=SDK_GUARD,
        expect_case="reachable from the Verify tab",
    ),
    Mutation(
        name="proof-request-modal-row-removed",
        defect="a request naming a circuit the modal has no row for shows the "
        "raw id to the person deciding whether to hand over a proof",
        path="src/components/ProofRequestModal.tsx",
        old="  mdl_kr_age: {",
        new="  mdl_kr_age_TYPO: {",
        guard=SDK_GUARD,
        expect_case="not typed by CircuitName still name every circuit",
    ),
    Mutation(
        name="sdk-version-unpinned",
        defect="a caret lets the id list — which decides what a deep link "
        "proves — move on an overnight resolve",
        path="package.json",
        old='"@zkproofport-app/sdk": "0.2.12"',
        new='"@zkproofport-app/sdk": "^0.2.12"',
        guard=SDK_GUARD,
        expect_case="dependency-free subpath that is imported",
    ),
    Mutation(
        name="default-circuit-restored",
        defect="THE ORIGINAL — a request naming no circuit produced a real "
        "Coinbase KYC proof of something nobody asked for",
        path="src/screens/proof/ProofGenerationScreen.tsx",
        old="  const circuitId = route.params?.circuitId ?? '';",
        new="  const circuitId = route.params?.circuitId || 'coinbase-kyc';",
        guard=SCREEN_GUARD,
        expect_case="has no default circuit",
    ),
    Mutation(
        name="screen-keeps-a-private-alias-table",
        defect="the screen's own spelling tables are what drifted from each "
        "other in the first place",
        path="src/screens/proof/ProofGenerationScreen.tsx",
        old="  const canonical = canonicalCircuitId(circuitId);",
        new="  const CIRCUIT_CONFIG: Record<string, string> = {};\n"
        "  const canonical = (CIRCUIT_CONFIG[circuitId] ?? circuitId) as CircuitName;",
        guard=SCREEN_GUARD,
        expect_case="resolves the id ONCE",
    ),
    Mutation(
        name="mdl-variant-on-a-non-mdl-circuit",
        defect="a variant on a circuit with no mdl flow sends it down the mDL "
        "path the moment anything keys off the variant",
        path="src/screens/proof/ProofGenerationScreen.tsx",
        old="  mdl_kr_region: 'region',\n};",
        new="  mdl_kr_region: 'region',\n  coinbase_attestation: 'ownership',\n};",
        guard=SCREEN_GUARD,
        expect_case="mDL variants agree with the flow table",
    ),
    Mutation(
        name="unrecognised-id-not-refused",
        defect="without the guard an unknown id falls through and generates "
        "whatever the last branch happens to be",
        path="src/screens/proof/ProofGenerationScreen.tsx",
        old="    if (!flow || !canonical) {",
        new="    if (false) {",
        guard=SCREEN_GUARD,
        expect_case="refuses an unrecognised id",
    ),
]


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run_guard(guard: str) -> tuple[int, str]:
    proc = subprocess.run(
        ["npx", "jest", "--ci", "--runInBand", guard],
        cwd=APP,
        capture_output=True,
        text=True,
    )
    return proc.returncode, proc.stdout + proc.stderr


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", action="store_true")
    ap.add_argument("-k", dest="filter", default="")
    args = ap.parse_args()

    chosen = [m for m in MUTATIONS if args.filter in m.name]
    if args.list:
        for m in chosen:
            print(f"{m.name:38s} {m.path}")
        return 0

    print(f"{len(chosen)} mutations\n")
    failures: list[str] = []

    for m in chosen:
        target = APP / m.path
        original_bytes = target.read_bytes()
        before = sha256(target)
        text = original_bytes.decode("utf-8")

        # (1) the substitution must actually match. A replace that hits nothing
        # leaves the file green and reads as "the guard does not bite".
        hits = text.count(m.old)
        if hits != 1:
            failures.append(f"{m.name}: anchor matched {hits} times, expected 1")
            print(f"  SKIP  {m.name}: anchor matched {hits} times")
            continue

        mutated = text.replace(m.old, m.new)
        assert mutated != text
        target.write_text(mutated, encoding="utf-8")

        try:
            code, out = run_guard(m.guard)
            caught = code != 0 and m.expect_case in out
            if caught:
                print(f"  RED   {m.name}")
            else:
                why = "guard stayed green" if code == 0 else "failed a DIFFERENT case"
                failures.append(f"{m.name}: {why}")
                print(f"  MISS  {m.name}: {why}")
        finally:
            # (3) byte-identical, compared by digest rather than by eye.
            target.write_bytes(original_bytes)
            after = sha256(target)
            if after != before:
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
