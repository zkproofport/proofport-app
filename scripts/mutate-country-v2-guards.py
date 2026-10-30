#!/usr/bin/env python3
"""
Break each guard of Coinbase Country v2 on purpose, and check that a test
notices.

WHY THIS EXISTS. Coinbase Country v2 (circuits coinbase-country-attestation-v2*,
2026-10-30) binds revocation with a device statement that must name the
country of the transaction being proved; the app refuses, before the device
signs and the wallet is asked, every statement and request the circuit would
refuse. Each line below removes one of those refusals or moves one input, and
the named test must go red.

At every step it checks that (1) the substitution matched exactly once,
(2) the named case is reported FAILED (a `✕` line), not merely present in
the output, and (3) the file is restored byte-identical (sha256).

Prerequisite: node on PATH. NODE_OPTIONS is removed from the child
environment. Do not run it while Metro or another harness reads the files.

Usage:
    python3 scripts/mutate-country-v2-guards.py
    python3 scripts/mutate-country-v2-guards.py --list
    python3 scripts/mutate-country-v2-guards.py -k statement

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

KINDS = "src/appAttest/coinbaseStatementKinds.ts"
CD = "src/appAttest/clientData.ts"
REV = "src/appAttest/revocationStatement.ts"
STMT = "src/appAttest/coinbaseKycStatement.ts"
INPUTS = "src/utils/coinbaseAppAttestInputs.ts"
TX = "src/utils/attestCountryTx.ts"
HELPERS = "src/utils/circuitHelpers.ts"
SIGNAL = "src/utils/coinbaseSignal.ts"
DEEPLINK = "src/utils/deeplink.ts"
VARIANT = "src/utils/proofSignerVariant.ts"
VERIFY = "src/utils/proofVerification.ts"
SCREEN = "src/screens/proof/ProofGenerationScreen.tsx"
ACTION = "src/screens/proof/actionCircuits.ts"
IDS = "src/config/circuitIds.ts"

STATEMENT_TEST = "src/appAttest/__tests__/countryV2StatementBindsItsCountry.test.ts"
IOS_TEST = "src/appAttest/__tests__/noStatementForARevokedVerification.test.ts"
INPUTS_TEST = "src/utils/__tests__/countryV2InputsFollowTheCircuitAbi.test.ts"
EVERYWHERE_TEST = "src/__tests__/coinbaseCountryIsV2Everywhere.test.ts"
REQUEST_TEST = "src/utils/__tests__/proofRequestValidation.test.ts"
VERIFY_TEST = "src/utils/__tests__/proofVerification.test.ts"
KYC_TEST = "src/__tests__/coinbaseKycIsV2Everywhere.test.ts"


@dataclass(frozen=True)
class Mutation:
    name: str
    path: str
    old: str
    new: str
    guard: str
    expect_case: str


MUTATIONS = [
    Mutation("statement-country-accepts-lowercase", KINDS,
             "export const COUNTRY_CODE = /^[A-Z]{2}$/;", "export const COUNTRY_CODE = /^[A-Za-z]{2}$/;",
             STATEMENT_TEST, "refuses a lowercase country"),
    Mutation("statement-drops-the-country", CD,
             "    ...countryBytes,\n  ]);", "  ]);",
             STATEMENT_TEST, "then the country"),
    Mutation("statement-keeps-kyc-tag", CD,
             "ethers.utils.toUtf8Bytes(kind.circuit)))", "ethers.utils.toUtf8Bytes(CLIENT_DATA_CIRCUIT_ID)))",
             STATEMENT_TEST, "then the country"),
    Mutation("record-country-mismatch-signed", REV,
             "    if (country !== req.transactionCountry) {", "    if (false) {",
             STATEMENT_TEST, "refuses a record naming another country than the transaction"),
    Mutation("record-country-not-read", REV,
             "  if (kind.carriesCountry && !status.revoked) {\n    country = recordCountry(status);",
             "  if (kind.carriesCountry && !status.revoked) {\n    country = req.transactionCountry;",
             STATEMENT_TEST, "refuses a record naming another country than the transaction"),
    Mutation("record-schema-is-kyc", REV,
             "  if (status.schemaId.toLowerCase() !== kind.schemaUid) {",
             "  if (status.schemaId.toLowerCase() !== kind.schemaUid && false) {",
             STATEMENT_TEST, "refuses a KYC's schema record"),
    Mutation("lookup-forgets-data", REV,
             "revoked data}}',", "revoked}}',",
             STATEMENT_TEST, "asks for data and returns it"),
    Mutation("country-signal-is-kycs", SIGNAL,
             "['address', 'string', 'string'], [userAddress, scopeString, circuit]);",
             "['address', 'string', 'string'], [userAddress, scopeString, 'coinbase_attestation']);",
             STATEMENT_TEST, "signs the 227 bytes for no action"),
    Mutation("country-list-after-scope", INPUTS,
             "    ...(i.country ? [...i.country.country_list, i.country.country_list_length, i.country.is_included] : []),\n    ...i.scope,",
             "    ...i.scope,\n    ...(i.country ? [...i.country.country_list, i.country.country_list_length, i.country.is_included] : []),",
             INPUTS_TEST, "Android package: the builder puts every common parameter at its offset"),
    Mutation("inclusion-not-checked", INPUTS,
             "  if (c.isIncluded && !found) {", "  if (c.isIncluded && !found && false) {",
             INPUTS_TEST, "KR not in an inclusion list"),
    Mutation("list-of-eleven", INPUTS,
             "  if (c.countryList.length > COUNTRY_LIST_MAX) {", "  if (c.countryList.length > COUNTRY_LIST_MAX + 1) {",
             INPUTS_TEST, "11 countries"),
    Mutation("statement-country-not-compared", INPUTS,
             "    if (named !== request.country.transactionCountry) {", "    if (false) {",
             INPUTS_TEST, "for another country than the transaction"),
    Mutation("statement-tag-not-compared", INPUTS,
             "  if (statementTag !== ethers.utils.keccak256(ethers.utils.toUtf8Bytes(kind.circuit)).toLowerCase()) {",
             "  if (false) {",
             INPUTS_TEST, "a Coinbase KYC statement (225 bytes, KYC's tag) for a Country request"),
    Mutation("country-nullifier-signal-rule", HELPERS,
             "  coinbase_country_attestation: {tag: 'coinbase_country_attestation'},",
             "  coinbase_country_attestation: false,",
             KYC_TEST, "gives Coinbase Country v2 its own tag"),
    Mutation("tx-country-accepts-attestaccount", TX,
             "  if (selector !== ATTEST_COUNTRY_SELECTOR) {", "  if (selector !== ATTEST_COUNTRY_SELECTOR && selector !== '0x56feed5e') {",
             INPUTS_TEST, "refuses attestAccount (Coinbase KYC)"),
    Mutation("deeplink-country-without-scope", DEEPLINK,
             "        request.circuit === 'coinbase_country_attestation' ||\n        request.circuit === 'giwa_attestation' ||",
             "        request.circuit === 'giwa_attestation' ||",
             REQUEST_TEST, "country attestation with no scope is refused"),
    Mutation("deeplink-country-lowercase", DEEPLINK,
             "!/^[A-Z]{2}$/.test(c));", "!/^[A-Za-z]{2}$/.test(c));",
             REQUEST_TEST, "country attestation with a lowercase code is refused"),
    Mutation("screen-skips-list-check", SCREEN,
             "        if (refusal) {\n          addLog(`[Country] ${refusal.error}`);",
             "        if (refusal && false) {\n          addLog(`[Country] ${refusal.error}`);",
             EVERYWHERE_TEST, "checks the transaction's country against the list before the statement and the wallet"),
    Mutation("empty-verifier-proves", VARIANT,
             "    if (!byEnv[circuit as CircuitName]) {", "    if (false) {",
             EVERYWHERE_TEST, "an empty row refuses a proof before it is made"),
    Mutation("country-no-window", VERIFY,
             "  coinbase_country_attestation: {\n    input: 'attested_at',", "  coinbase_country_attestation: null && {\n    input: 'attested_at',",
             VERIFY_TEST, "every circuit has its window decided"),
    Mutation("action-picker-offers-country-to-kyc", ACTION,
             "isLaboratoryCircuit(id) === isLaboratoryCircuit(openedFor) && !CIRCUITS_WITH_OWN_INPUTS.includes(id),", "isLaboratoryCircuit(id) === isLaboratoryCircuit(openedFor),",
             EVERYWHERE_TEST, "opens after the country screen"),
    Mutation("country-action-none", IDS,
             "  ...CORE_CIRCUIT_ACTION_BINDING,\n});", "  ...CORE_CIRCUIT_ACTION_BINDING,\n  coinbase_country_attestation: 'none',\n});",
             EVERYWHERE_TEST, "is optional for Country"),
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
