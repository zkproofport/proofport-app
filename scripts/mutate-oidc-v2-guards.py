#!/usr/bin/env python3
"""
Break each guard of the exact circuits tag and of the OIDC v2 input builder
on purpose, and check that a test notices.

WHY THIS EXISTS. Two things changed together on branch `oidc-v2`:
  - a production build reads circuits and verifier records from exactly
    CIRCUITS_RELEASE_TAG (src/config/contracts.ts), never the newest release,
    and a missing tag is an error naming it (E3007 at launch, E3005 on
    download);
  - the OIDC builder (src/utils/oidcDomain.ts) produces v2 inputs identical
    to the circuits reference builder and refuses what the circuit refuses.
Each mutation removes one guard and asserts the named test case goes red.

At every step it checks that (1) the substitution matched exactly once,
(2) the named case is reported FAILED (a `\u2715` line), not merely present in
the output, and (3) the file is restored byte-identical (sha256).

Prerequisite: node on PATH. NODE_OPTIONS is removed from the child
environment, because a shell that points it at a missing preload file makes
every node process exit before jest starts.

Usage:
    python3 scripts/mutate-oidc-v2-guards.py
    python3 scripts/mutate-oidc-v2-guards.py --list
    python3 scripts/mutate-oidc-v2-guards.py -k nonce

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

CONTRACTS = "src/config/contracts.ts"
DEPLOY = "src/config/deployments.ts"
DOWNLOAD = "src/utils/circuitDownload.ts"
LAUNCH = "src/utils/launchDeploymentSync.ts"
VERIFY = "src/utils/proofVerification.ts"
OIDC = "src/utils/oidcDomain.ts"
HOOK = "src/hooks/useOidcDomain.ts"
SCREEN = "src/screens/proof/ProofGenerationScreen.tsx"
SOURCE_TEST = "src/config/__tests__/circuitSourceIsNeverGuessed.test.ts"
CORE_TEST = "src/config/__tests__/verifierAddressesComeFromCore.test.ts"
LAUNCH_TEST = "src/utils/__tests__/aMissingCircuitsReleaseIsShownAtLaunch.test.ts"
VERIFY_TEST = "src/utils/__tests__/proofVerification.test.ts"
REF_TEST = "src/utils/__tests__/oidcDomainMatchesTheCircuitsBuilder.test.ts"
REFUSE_TEST = "src/utils/__tests__/oidcDomainRefusesWhatTheCircuitRefuses.test.ts"
HOOK_TEST = "src/hooks/__tests__/theOidcHookProvesV2Inputs.test.ts"
RELAY_TEST = "src/screens/__tests__/everyRelayRequestGetsOneAnswer.test.ts"


@dataclass(frozen=True)
class Mutation:
    name: str
    path: str
    old: str
    new: str
    guard: str
    expect_case: str


MUTATIONS: list[Mutation] = [
    # --- exact circuits tag ---
    Mutation("production-follows-main", CONTRACTS,
             "    circuitsSource: {type: 'release', tag: CIRCUITS_RELEASE_TAG},",
             "    circuitsSource: {type: 'branch', branch: CIRCUITS_BRANCH},",
             SOURCE_TEST, "production names that tag; development and staging name main"),
    Mutation("verifier-record-from-main", DEPLOY,
             "  return `${GITHUB_RAW(circuitsRef(circuit, env))}/broadcast/${pathFn(chainId)}`;",
             "  return `${GITHUB_RAW(CIRCUITS_BRANCH)}/broadcast/${pathFn(chainId)}`;",
             SOURCE_TEST, "production reads the coinbase_attestation verifier record from the same tag"),
    Mutation("missing-tag-is-quiet", DEPLOY,
             "  if (response.status === 404 && isReleaseRef(env, ref)) {",
             "  if (response.status === -1 && isReleaseRef(env, ref)) {",
             SOURCE_TEST, "a 404 at the tag is an error naming the tag and the file"),
    Mutation("sync-swallows-missing-tag", DEPLOY,
             "  if (missing.length > 0) {",
             "  if (missing.length < 0) {",
             SOURCE_TEST, "a sync tries every circuit, caches the ones that answer"),
    Mutation("cache-key-without-ref", DEPLOY,
             "  return `${CACHE_PREFIX}/${env}/${circuit}@${circuitsRef(circuit, env)}`;",
             "  return `${CACHE_PREFIX}/${env}/${circuit}`;",
             SOURCE_TEST, "a verifier cached under another tag, or under the old unkeyed key, is not used"),
    Mutation("unknown-env-not-refused", DEPLOY,
             "  if (!config) {\n    throw new Error(`Unknown environment",
             "  if (config === null) {\n    throw new Error(`Unknown environment",
             SOURCE_TEST, "an unknown environment is an error, not production or main"),
    Mutation("launch-hides-missing-tag", LAUNCH,
             "      deps.showError('E3007', error.message);",
             "",
             LAUNCH_TEST, "shows E3007 with the tag when the pinned release is missing"),
    Mutation("download-404-does-not-name-tag", DOWNLOAD,
             "      result.statusCode === 404 && pinned",
             "      result.statusCode === -1 && pinned",
             LAUNCH_TEST, "a 404 in production names the tag, and the error body is deleted"),
    Mutation("download-keeps-error-body", DOWNLOAD,
             "    await RNFS.unlink(destPath).catch(() => {});\n    // A 404 at a pinned",
             "    // A 404 at a pinned",
             LAUNCH_TEST, "a 404 in production names the tag, and the error body is deleted"),
    Mutation("oidc-cache-version-not-bumped", CONTRACTS,
             "  oidc_domain_attestation: 5,",
             "  oidc_domain_attestation: 4,",
             SOURCE_TEST, "OIDC is at v5, the v2 circuit (214 public inputs)"),
    Mutation("v1-oidc-verifier-back", CONTRACTS,
             "export const OIDC_V2_VERIFIER_BASE_SEPOLIA = '';",
             "export const OIDC_V2_VERIFIER_BASE_SEPOLIA = '0x5D9ECe4F0276D12693F79659760a68011EFeF485';",
             CORE_TEST, "development and staging read OIDC_V2_VERIFIER_BASE_SEPOLIA, never the v1 contract"),
    Mutation("empty-oidc-verifier-unnamed", VERIFY,
             "'[OnChain] No OIDC v2 verifier is configured for this build yet (OIDC_V2_VERIFIER_BASE_SEPOLIA in",
             "'[OnChain] No OIDC v2 verifier is configured for this build yet (in",
             VERIFY_TEST, "an OIDC proof with no v2 verifier yet names the constant to fill"),
    # --- OIDC v2 builder ---
    Mutation("partial-cap-2047", OIDC,
             "export const OIDC_MAX_PARTIAL_DATA_LENGTH = 2048;",
             "export const OIDC_MAX_PARTIAL_DATA_LENGTH = 2047;",
             REF_TEST, "builds the same vector at exactly 2048 bytes"),
    Mutation("sha-cut-at-zero", OIDC,
             "  const cut = Math.floor(dot / 64) * 64;",
             "  const cut = 0;",
             REF_TEST, "Google, dot 64 -> offset 1"),
    Mutation("decode-offset-off-by-one", OIDC,
             "  const base64DecodeOffset = dot + 1 - cut;",
             "  const base64DecodeOffset = dot - cut;",
             REF_TEST, "Google, synthetic header (dot 60)"),
    Mutation("aud-hash-of-other-bytes", OIDC,
             "  const audHash = keccak256Bytes(new TextEncoder().encode(aud));",
             "  const audHash = keccak256Bytes(new TextEncoder().encode(aud + ' '));",
             REFUSE_TEST, "hashes the aud string itself"),
    Mutation("aud-length-in-characters", OIDC,
             "  if (utf8Length(aud) > OIDC_MAX_AUD_LENGTH) {",
             "  if (aud.length > OIDC_MAX_AUD_LENGTH) {",
             REFUSE_TEST, "counts UTF-8 bytes, not characters"),
    Mutation("aud-array-accepted", OIDC,
             "  if (typeof aud !== 'string' || aud.length === 0) {",
             "  if (aud === undefined) {",
             REFUSE_TEST, "refuses aud an array"),
    Mutation("google-iss-unchecked", OIDC,
             "  } else if (typeof iss !== 'string' || !GOOGLE_ISSUERS.has(iss)) {",
             "  } else if (typeof iss !== 'string') {",
             REFUSE_TEST, "Google refuses a foreign issuer"),
    Mutation("microsoft-iss-loose", OIDC,
             "    if (typeof iss !== 'string' || !MICROSOFT_V2_ISSUER.test(iss)) {",
             "    if (typeof iss !== 'string' || !iss.startsWith('https://login.microsoftonline.com/')) {",
             REFUSE_TEST, "Microsoft refuses an uppercase tenant"),
    Mutation("expiry-off-by-one", OIDC,
             "  if (clockSeconds >= exp) {",
             "  if (clockSeconds > exp) {",
             REFUSE_TEST, "refuses an expired token (clock == exp)"),
    Mutation("clock-skew-unbounded", OIDC,
             "  if (iat - clockSeconds <= OIDC_MAX_CLOCK_BEHIND_SECONDS) return iat;",
             "  return iat;",
             REFUSE_TEST, "refuses a clock 301s behind"),
    Mutation("integer-claim-text-unchecked", OIDC,
             " || !raw || Number(raw[1]) !== value) {",
             ") {",
             REFUSE_TEST, "refuses exp in exponent form"),
    Mutation("token-nonce-not-compared", OIDC,
             "  if (payload.nonce !== params.nonce) {",
             "  if (payload.nonce === '__never__') {",
             REFUSE_TEST, "refuses a token carrying another request's nonce"),
    Mutation("nonce-binding-zeroed", OIDC,
             "    nonce_binding: Array.from(nonceBinding),",
             "    nonce_binding: new Array(32).fill(0),",
             REF_TEST, "Google, 40-hex kid like a real token (dot 102)"),
    Mutation("nonce-mode-zero", OIDC,
             "    nonce_mode: OIDC_NONCE_MODE_BOUND,",
             "    nonce_mode: 0,",
             REFUSE_TEST, "binds the request nonce: nonce_mode 1 and its 32 bytes"),
    Mutation("now-not-flattened", OIDC,
             "  flat.push(inputs.now);\n",
             "",
             REF_TEST, "flattens to 214 public values then the private ones"),
    Mutation("email-verified-truthy", OIDC,
             "    if (payload.email_verified !== true) {",
             "    if (!payload.email_verified) {",
             REFUSE_TEST, 'refuses email_verified as the string "true"'),
    Mutation("email-length-unchecked", OIDC,
             "  if (utf8Length(email) > OIDC_MAX_EMAIL_LENGTH) {",
             "  if (utf8Length(email) < 0) {",
             REFUSE_TEST, "accepts a 128-byte email and refuses 129"),
    Mutation("domain-mismatch-accepted", OIDC,
             "  if (domain !== emailDomain) {",
             "  if (domain === '__never__') {",
             REFUSE_TEST, "refuses a requested domain that is not the email domain"),
    Mutation("hook-sends-another-nonce", HOOK,
             "          nonce: inputs.nonce,",
             "          nonce: '0'.repeat(64),",
             HOOK_TEST, "binds the request nonce and a `now` inside iat..exp"),
    Mutation("hook-clock-zero", HOOK,
             "          clockSeconds: Math.floor(Date.now() / 1000),",
             "          clockSeconds: 0,",
             HOOK_TEST, "binds the request nonce and a `now` inside iat..exp"),
    Mutation("hook-proves-v1-files", HOOK,
             "        if (circuitPublicInputs !== OIDC_PUBLIC_INPUT_COUNT) {",
             "        if (circuitPublicInputs === -1) {",
             HOOK_TEST, "refuses a v1 circuit file set (148 public inputs)"),
    Mutation("screen-drops-nonce", SCREEN,
             "provider: providerStr, nonce: binding.nonce},",
             "provider: providerStr, nonce: ''},",
             RELAY_TEST, "OIDC asks the provider for the nonce of THIS request and proves its token"),
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
