#!/usr/bin/env python3
"""
Break each "one answer per relay request" guard on purpose and check that a
test notices.

WHY THIS EXISTS. zkproofport/proofport-app#2: the proof screen marked History
failed on nine paths and told the relay on two, so most failures left the dApp
waiting for its five-minute timeout. The fix routes every answer through
`src/utils/relayAnswer.ts` (once per requestId) and every failure path through
`failAttempt` / `cancelAttempt` in ProofGenerationScreen.tsx. Each mutation
below removes one of those pieces and asserts the named test case goes red.

At every step it checks that (1) the substitution matched exactly once,
(2) the named case is reported FAILED (a `✕` line), not merely present in the
output, and (3) the file is restored byte-identical (sha256).

Prerequisite: node on PATH. NODE_OPTIONS is removed from the child
environment, because a shell that points it at a missing preload file makes
every node process exit before jest starts.

Usage:
    python3 scripts/mutate-relay-answer-guards.py
    python3 scripts/mutate-relay-answer-guards.py --list
    python3 scripts/mutate-relay-answer-guards.py -k retry

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

RESPONDER = "src/utils/relayAnswer.ts"
SCREEN = "src/screens/proof/ProofGenerationScreen.tsx"
RESPONDER_TEST = "src/utils/__tests__/relayAnswer.test.ts"
SCREEN_TEST = "src/screens/__tests__/everyRelayRequestGetsOneAnswer.test.ts"
APP_TEST = "src/__tests__/proofRequestReviewLifecycle.test.ts"


@dataclass(frozen=True)
class Mutation:
    name: str
    path: str
    old: str
    new: str
    guard: str
    expect_case: str


MUTATIONS: list[Mutation] = [
    Mutation(
        name="once-only-guard-removed",
        path=RESPONDER,
        old="  if (first !== undefined) {",
        new="  if (first === '__never__') {",
        guard=RESPONDER_TEST,
        expect_case="sends the first answer and nothing for the second and third",
    ),
    Mutation(
        name="claim-not-taken-before-post",
        path=RESPONDER,
        old="  answered.set(id, answer.status);\n",
        new="",
        guard=RESPONDER_TEST,
        expect_case="claims the request before the POST resolves",
    ),
    Mutation(
        name="relay-timeout-not-told",
        path=RESPONDER,
        old="      if (result.timedOut) {",
        new="      if (result.status === 0) {",
        guard=RESPONDER_TEST,
        expect_case="shows E1003 once",
    ),
    Mutation(
        name="untrusted-callback-answered",
        path=RESPONDER,
        old="  if (!trust.trusted) {\n    console.log(`[RelayAnswer] Not answering",
        new="  if (trust.trusted === undefined) {\n    console.log(`[RelayAnswer] Not answering",
        guard=RESPONDER_TEST,
        expect_case="does not POST to an untrusted host",
    ),
    Mutation(
        name="no-attestation-not-answered",
        path=SCREEN,
        old="        failAttempt({code: 'E2005', error: msg});",
        new="        setErrorMessage(msg);",
        guard=SCREEN_TEST,
        expect_case="no attestation -> E2005",
    ),
    Mutation(
        name="hook-step-error-not-answered",
        path=SCREEN,
        old="    failAttempt({code: errStep.code ?? errorCodeForStep(flow, errStep.id), error: detail});",
        new="    setErrorMessage(detail);",
        guard=SCREEN_TEST,
        expect_case="step proof -> E2001",
    ),
    Mutation(
        name="outer-catch-not-answered",
        path=SCREEN,
        old="      failAttempt({code: error instanceof AppAttestError ? error.code : 'E2001', error: msg});\n    } finally {",
        new="      setErrorMessage(msg);\n    } finally {",
        guard=SCREEN_TEST,
        expect_case="a thrown error (outer catch) -> E2001",
    ),
    Mutation(
        name="attempt-guard-removed",
        path=SCREEN,
        old="      if (attemptEndedRef.current) return;\n      attemptEndedRef.current = true;\n      // What the person was shown, so the kept log ends with it.",
        new="      attemptEndedRef.current = true;\n      // What the person was shown, so the kept log ends with it.",
        guard=SCREEN_TEST,
        expect_case="AND throwing in one attempt answers once",
    ),
    Mutation(
        name="wallet-rejection-sent-as-error",
        path=SCREEN,
        old="    if (rejectedInWallet(detail)) {",
        new="    if (detail === '__never__') {",
        guard=SCREEN_TEST,
        expect_case="a rejection in the wallet answers cancelled",
    ),
    Mutation(
        name="leaving-not-answered",
        path=SCREEN,
        old="    sendCancelledRef.current(request, 'The user left the proof screen before the proof was finished.')\n      .catch(console.error);\n",
        new="",
        guard=SCREEN_TEST,
        expect_case="leaving before an answer sends one cancelled",
    ),
    Mutation(
        name="retry-after-answer-allowed",
        path=SCREEN,
        old="    if (proofRequest && isRelayRequestAnswered(proofRequest.requestId)) {",
        new="    if (proofRequest && proofRequest.requestId === '__never__') {",
        guard=SCREEN_TEST,
        expect_case="Retry after the answer starts nothing",
    ),
    Mutation(
        name="replaced-review-not-answered",
        path="App.tsx",
        old="    if (replaced && replaced.requestId !== request.requestId) {",
        new="    if (replaced && replaced.requestId === '__never__') {",
        guard=APP_TEST,
        expect_case="a newer request replacing a waiting review",
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
