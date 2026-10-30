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

Branch `oidc-signature` (circuits fix list item 12) adds the provider-key
statement: the live key list (src/oidc/providerKeyStatement.ts), the App
Attest signer (src/oidc/oidcAppSigner.ts, src/appAttest/appSignerInputs.ts),
the hook's ABI check and the pinned circuits commit; their mutations follow
the OIDC v2 ones.

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
PKEY = "src/oidc/providerKeyStatement.ts"
SIGNER = "src/oidc/oidcAppSigner.ts"
APP_SIGNER = "src/appAttest/appSignerInputs.ts"
ARTIFACTS = "src/config/circuitArtifacts.ts"
PKEY_TEST = "src/oidc/__tests__/theProviderKeyStatementIsTheCircuits.test.ts"
SIGNER_TEST = "src/oidc/__tests__/theAppSignsOnlyALiveProviderKey.test.ts"


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
    # "verifier-record-from-main", "missing-tag-is-quiet",
    # "sync-swallows-missing-tag" and "cache-key-without-ref" were removed on
    # branch country-v2 (2026-10-30): Coinbase Country v2 now reads a pinned
    # ref and a configured address like Coinbase KYC v2 and OIDC, so no
    # circuit reads a verifier record at CIRCUITS_RELEASE_TAG and these lines
    # of deployments.ts run for nothing. Restore them (their cases were in
    # circuitSourceIsNeverGuessed.test.ts at proofport-app b294f36) when a
    # circuit's record is read at the tag again.
    Mutation("unknown-env-not-refused", DEPLOY,
             "  if (!config) {\n    throw new Error(`Unknown environment",
             "  if (config === null) {\n    throw new Error(`Unknown environment",
             SOURCE_TEST, "an unknown environment is an error, not production or main"),
    Mutation("launch-hides-missing-tag", LAUNCH,
             "      deps.showError('E3007', error.message);",
             "",
             LAUNCH_TEST, "shows E3007 with the tag when the pinned release is missing"),
    # "download-404-does-not-name-tag" (the release-tag branch of
    # httpFailureReason) was removed with the four above: no circuit file is
    # read at CIRCUITS_RELEASE_TAG since Coinbase Country v2 either.
    Mutation("download-keeps-error-body", DOWNLOAD,
             "    await RNFS.unlink(destPath).catch(() => {});\n    const reason = httpFailureReason(",
             "    const reason = httpFailureReason(",
             LAUNCH_TEST, "a 404 for Coinbase KYC v2 names its pinned pre-release tag"),
    Mutation("v1-oidc-verifier-back", CONTRACTS,
             "    oidc_domain_attestation: '0xeA5933ABc598401c89F63B3f13AE56A7E78984e8',\n    giwa_attestation",
             "    oidc_domain_attestation: '0x003334A7C2ff15ee9ee845Ab88e152A2A3694167',\n    giwa_attestation",
             CORE_TEST, "development and staging name the provider-key-statement verifier, never an older OIDC contract"),
    # OIDC is no longer held to core's table (not in core 0.3.0); held to its
    # own deploy instead (circuits 7e5c72d).
    Mutation("oidc-row-drifts-from-its-deploy", CONTRACTS,
             "    oidc_domain_attestation: '0xeA5933ABc598401c89F63B3f13AE56A7E78984e8',\n    giwa_attestation",
             "    oidc_domain_attestation: '0xeA5933ABc598401c89F63B3f13AE56A7E78984e9',\n    giwa_attestation",
             CORE_TEST, "development and staging name the provider-key-statement verifier"),
    Mutation("app-oidc-layout-not-core", OIDC,
             "export const OIDC_PUBLIC_INPUT_COUNT = 214;",
             "export const OIDC_PUBLIC_INPUT_COUNT = 148;",
             CORE_TEST, "core counts the same 214 public inputs the app proves"),
    Mutation("empty-oidc-verifier-unnamed", VERIFY,
             "`[OnChain] ERROR: Verifier address is empty for ${circuit} - check",
             "`[OnChain] ERROR: Verifier address is empty - check",
             VERIFY_TEST, "an OIDC proof with an empty verifier address names the circuit"),
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
             "provider: providerStr, nonce: binding.nonce, providerKeySigner},",
             "provider: providerStr, nonce: '', providerKeySigner},",
             RELAY_TEST, "OIDC asks the provider for the nonce of THIS request and proves its token"),

    # --- provider-key statement ---
    Mutation("statement-time-little-endian", PKEY,
             "  for (let i = 0; i < 8; i++) s[49 + i] = Number((t >> BigInt(8 * (7 - i))) & 0xffn);",
             "  for (let i = 0; i < 8; i++) s[49 + i] = Number((t >> BigInt(8 * i)) & 0xffn);",
             PKEY_TEST, "match provider_key.nr the_statement_layout byte for byte"),
    Mutation("statement-wrong-tag", PKEY,
             "  s.set(ethers.utils.arrayify(OIDC_CIRCUIT_TAG), 16);",
             "  s.set(ethers.utils.arrayify(ethers.utils.keccak256(ethers.utils.toUtf8Bytes('coinbase_attestation'))), 16);",
             REF_TEST, "Google, 40-hex kid like a real token (dot 102)"),
    Mutation("modulus-top-bit-unchecked", PKEY,
             "  if (out.length !== RSA_MODULUS_BYTES || (out[0] & 0x80) === 0) {",
             "  if (out.length !== RSA_MODULUS_BYTES) {",
             PKEY_TEST, "refuses a 256 bytes with the top bit clear modulus (E2008)"),
    Mutation("key-list-cached", PKEY,
             "      cache: 'no-store',",
             "      cache: 'default' as 'no-store',",
             PKEY_TEST, "bypassing caches, every time it is asked for"),
    Mutation("empty-key-list-accepted", PKEY,
             "  if (!Array.isArray(keys) || keys.length === 0) {",
             "  if (!Array.isArray(keys)) {",
             PKEY_TEST, "fails closed with E3002 on an empty key list"),
    Mutation("unlisted-modulus-vouched", PKEY,
             "  if (!listed) refuse(",
             "  if (listed === null) refuse(",
             SIGNER_TEST, "refuses a modulus the live list does not hold with E2008, and makes no assertion"),
    Mutation("any-list-accepted", PKEY,
             "  if (!fetchedLists.has(live)) refuse(",
             "  if (live === null) refuse(",
             SIGNER_TEST, "refuses a list the app did not fetch with E2008, and makes no assertion"),
    Mutation("other-providers-list-accepted", PKEY,
             "  if (live.provider !== provider) refuse(",
             "  if (live === null) refuse(",
             SIGNER_TEST, "refuses a list fetched for the other provider with E2008"),
    Mutation("stale-list-accepted", PKEY,
             "  if (!(age >= 0 && age <= LIVE_KEYS_MAX_AGE_SECONDS)) {",
             "  if (age < -1e12) {",
             PKEY_TEST, "refuses a list older than the limit (E2008)"),
    Mutation("signer-skips-live-check", SIGNER,
             "    requireLiveModulus(live, provider, modulus, clock());\n    const statement = providerKeyStatement(provider, now, modulus);\n    // assertClientData",
             "    const statement = providerKeyStatement(provider, now, modulus);\n    // assertClientData",
             SIGNER_TEST, "refuses a modulus the live list does not hold with E2008, and makes no assertion"),
    Mutation("signer-signs-other-bytes", SIGNER,
             "    const signed = await assertClientData(deps, statement);",
             "    const signed = await assertClientData(deps, statement.slice(1));",
             SIGNER_TEST, "asks App Attest for exactly SHA256(statement)"),
    Mutation("signer-accepts-development-key", SIGNER,
             "  requireProductionCredential(key.credential, PROOF);\n",
             "",
             SIGNER_TEST, "refuses a development (sandbox) key with E2014, and signs nothing"),
    Mutation("signer-accepts-high-s", APP_SIGNER,
             "  if (assertion.signature.length === 64 && BigInt(ethers.utils.hexlify(assertion.signature.slice(32))) > N_P256_HALF) {",
             "  if (assertion.signature.length === -1) {",
             SIGNER_TEST, "refuse a raw high-s signature, a development key and another intermediate with E2014"),
    Mutation("builder-any-exponent", OIDC,
             "  if (jwk.e !== 'AQAB') {",
             "  if (jwk.e === '__never__') {",
             REFUSE_TEST, "is never signed for a key with another exponent than 65537 (E2008)"),
    Mutation("builder-never-signs", OIDC,
             "  const signer = await timed('device: sign provider-key statement', () => params.signProviderKey({provider: providerId, now, modulus, live}));\n",
             "",
             REF_TEST, "Google, 40-hex kid like a real token (dot 102)"),
    Mutation("signer-inputs-reordered", OIDC,
             "    bytes(signer.statement_sig);\n    bytes(signer.credential_tbs);",
             "    bytes(signer.credential_tbs);\n    bytes(signer.statement_sig);",
             REF_TEST, "Google, 40-hex kid like a real token (dot 102)"),
    Mutation("hook-proves-pre-signer-files", HOOK,
             "        requireOidcAbi(await timer.step('circuit ABI check', () => circuitAbiParameterNames(CIRCUIT_NAME)), signerVariant);\n",
             "",
             HOOK_TEST, "refuses the 214-input circuit from before the provider-key statement by its ABI"),
    Mutation("hook-drops-step-code", HOOK,
             "          error instanceof AppAttestError || error instanceof OidcProviderKeyError ? error.code : undefined;",
             "          undefined;",
             HOOK_TEST, "passes a development key to the screen with its own code"),
    Mutation("screen-ignores-step-code", SCREEN,
             "      code: errStep.code ?? errorCodeForStep(flow, errStep.id),",
             "      code: errorCodeForStep(flow, errStep.id),",
             RELAY_TEST, "an OIDC step failing with its own code E2014 answers that code"),
    Mutation("screen-signs-in-without-app-attest", SCREEN,
             "        const providerKeySigner: ProviderKeySigner = await timer.step('device signer ready', () => prepareOidcAppSigner(addLog));",
             "        const providerKeySigner: ProviderKeySigner = await timer.step('device signer ready', () => prepareOidcAppSigner(addLog)).catch(() => (async () => { throw new Error('x'); }) as never);",
             RELAY_TEST, "OIDC on an Android phone or build the circuit does not accept -> E2015 before any sign-in"),
    Mutation("oidc-data-version-not-bumped", CONTRACTS,
             "  oidc_domain_attestation: 6,",
             "  oidc_domain_attestation: 5,",
             SOURCE_TEST, "OIDC is at v6, the provider-key-statement circuit, in both tables"),
    Mutation("oidc-files-from-a-branch", ARTIFACTS,
             "export const OIDC_SIGNATURE_CIRCUITS_REF = '5081cfda1ed00cfe9ec0aa20180338dc45f10670';",
             "export const OIDC_SIGNATURE_CIRCUITS_REF = 'oidc-signature';",
             SOURCE_TEST, "is a full commit SHA, not a branch"),
    Mutation("oidc-verifier-from-broadcast", CONTRACTS,
             "  oidc_domain_attestation: null,\n",
             "  oidc_domain_attestation: (chainId) => `DeployOidcDomainAttestation.s.sol/${chainId}/run-latest.json`,\n",
             SOURCE_TEST, "reads OIDC (provider-key statement) from its configured address"),
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
