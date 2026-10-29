#!/usr/bin/env python3
"""
Break each OIDC nonce guard on purpose and check that a test notices.

WHY THIS EXISTS. Every ID token the app proves must carry the nonce derived
for its request (src/oidc/oidcNonce.ts): keccak256("zkproofport-oidc-v1" ||
keccak256(scope) || requestId). The guards are the derivation itself, the
refusal of a token without it, the screen routing every OIDC sign-in through
that refusal, both sign-in hooks sending the nonce, and both native modules
passing it to the provider. Each mutation removes one and asserts the named
test case goes red.

At every step it checks that (1) the substitution matched exactly once,
(2) the named case is reported FAILED (a `✕` line), not merely present in the
output, and (3) the file is restored byte-identical (sha256).

Prerequisite: node on PATH. NODE_OPTIONS is removed from the child
environment, because a shell that points it at a missing preload file makes
every node process exit before jest starts.

Usage:
    python3 scripts/mutate-oidc-nonce-guards.py
    python3 scripts/mutate-oidc-nonce-guards.py --list
    python3 scripts/mutate-oidc-nonce-guards.py -k screen

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

NONCE = "src/oidc/oidcNonce.ts"
SIGNIN = "src/oidc/oidcSignIn.ts"
GOOGLE = "src/oidc/googleIdToken.ts"
MS_HOOK = "src/hooks/useMicrosoftAuth.ts"
SCREEN = "src/screens/proof/ProofGenerationScreen.tsx"
KOTLIN = "android/app/src/main/java/com/masselabs/zkproofport/GoogleIdTokenModule.kt"
OBJC = "ios/ProofportApp/GoogleIdTokenModule.m"
NONCE_TEST = "src/oidc/__tests__/oidcNonce.test.ts"
SIGNIN_TEST = "src/oidc/__tests__/oidcSignIn.test.ts"
GOOGLE_TEST = "src/oidc/__tests__/googleIdToken.test.ts"
NATIVE_TEST = "src/oidc/__tests__/theNativeGoogleSignInCarriesTheNonce.test.ts"
HOOK_TEST = "src/hooks/__tests__/theSignInHooksSendTheNonce.test.ts"
RELAY_TEST = "src/screens/__tests__/everyRelayRequestGetsOneAnswer.test.ts"
AUTOSTART_TEST = "src/screens/__tests__/approvedProofAutoStart.test.ts"


@dataclass(frozen=True)
class Mutation:
    name: str
    path: str
    old: str
    new: str
    guard: str
    expect_case: str


MUTATIONS: list[Mutation] = [
    Mutation("domain-tag-changed", NONCE,
             "export const OIDC_NONCE_DOMAIN = 'zkproofport-oidc-v1';",
             "export const OIDC_NONCE_DOMAIN = 'zkproofport-oidc-v2';",
             NONCE_TEST, "matches the cast-computed vector (ASCII scope)"),
    Mutation("scope-hash-dropped", NONCE,
             "      ethers.utils.toUtf8Bytes(OIDC_NONCE_DOMAIN),\n      scopeHash,\n",
             "      ethers.utils.toUtf8Bytes(OIDC_NONCE_DOMAIN),\n",
             NONCE_TEST, "matches the cast-computed vector (Korean + emoji scope)"),
    Mutation("request-id-format-unchecked", NONCE,
             "  if (!isCanonicalRequestId(requestId)) {\n    throw",
             "  if (requestId === '__never__') {\n    throw",
             NONCE_TEST, "canonical lowercase UUID (uppercase)"),
    Mutation("scope-cap-removed", NONCE,
             "  if (bytes.length > OIDC_MAX_SCOPE_BYTES) {",
             "  if (bytes.length < 0) {",
             NONCE_TEST, "accepts scope at the byte cap and refuses one byte over"),
    Mutation("mismatched-nonce-accepted", NONCE,
             "  if (actual !== expected) {",
             "  if (actual === '__never__') {",
             NONCE_TEST, "refuses: another request"),
    Mutation("missing-nonce-not-named", NONCE,
             "  if (!Object.prototype.hasOwnProperty.call(payload, 'nonce')) {",
             "  if (payload === '__never__') {",
             NONCE_TEST, "refuses: no nonce claim"),
    Mutation("duplicate-nonce-accepted", NONCE,
             "  if (nonceKeys !== 1) {",
             "  if (nonceKeys === -1) {",
             NONCE_TEST, "refuses: nonce twice, right one last"),
    Mutation("bound-sign-in-skips-check", SIGNIN,
             "  const check = checkIdTokenNonce(signIn.token, nonce);",
             "  const check = {ok: true} as ReturnType<typeof checkIdTokenNonce>;",
             SIGNIN_TEST, "refuses a token with no nonce as E2012"),
    Mutation("relay-id-replaced-by-minted", SIGNIN,
             "    requestId = relayRequestId;",
             "    requestId = mint();",
             SIGNIN_TEST, "a dApp request binds to the relay request id"),
    Mutation("unknown-provider-becomes-google", SIGNIN,
             "  throw new Error(\n    `Unknown OIDC provider",
             "  return 'google';\n  throw new Error(\n    `Unknown OIDC provider",
             SIGNIN_TEST, 'refuses "Microsoft" instead of signing in with Google'),
    Mutation("screen-proves-unchecked-token", SCREEN,
             "        const signIn = await timer.step('sign-in', () => signInBound(async nonce => {",
             "        const signIn = await timer.step('sign-in', () => ((p: typeof promptSignIn, n: string) => p(n))(async nonce => {",
             RELAY_TEST, "OIDC token with no nonce -> E2012"),
    Mutation("standalone-request-id-reused", SCREEN,
             "proofRequest?.requestId, newStandaloneRequestId);",
             "proofRequest?.requestId, () => '00000000-0000-4000-8000-000000000000');",
             AUTOSTART_TEST, "mints a different request id"),
    Mutation("standalone-request-id-not-in-history", SCREEN,
             "          requestId: proofRequest ? proofRequest.requestId : oidcBinding?.requestId,",
             "          requestId: proofRequest?.requestId,",
             AUTOSTART_TEST, "records the minted request id of an in-app OIDC proof"),
    Mutation("microsoft-random-nonce-back", MS_HOOK,
             "          nonce,\n",
             "          nonce: Math.random().toString(36).substring(2),\n",
             HOOK_TEST, "puts the given nonce on the authorize request"),
    Mutation("google-nonce-not-sent", GOOGLE,
             "      nonce,\n      serverClientId: GOOGLE_WEB_CLIENT_ID,",
             "      nonce: 'x',\n      serverClientId: GOOGLE_WEB_CLIENT_ID,",
             GOOGLE_TEST, "sends the nonce with the WEB client id"),
    Mutation("android-set-nonce-removed", KOTLIN,
             "            .setNonce(nonce)\n",
             "",
             NATIVE_TEST, "asks Credential Manager for a Google ID token"),
    Mutation("ios-nonce-nil", OBJC,
             "                                       nonce:nonce\n",
             "                                       nonce:nil\n",
             NATIVE_TEST, "signs in with the caller nonce"),
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
