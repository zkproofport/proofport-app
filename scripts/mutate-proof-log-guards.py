#!/usr/bin/env python3
"""
Break each proof-log guard on purpose and check that a test notices.

WHY THIS EXISTS. With Developer Mode AND live logs on, a proof attempt's log
is kept in its History record and can be copied (src/utils/proofLog.ts). The
guards are: the two switches gate capture and the live panel, decided from
the settings read at the start of the attempt; History shows a kept log only
in Developer Mode; every stored or copied log is scrubbed of tokens,
signatures and keys BEFORE it is capped; the per-record and total caps; and
the store's serialized writes. Each mutation removes one and asserts the
named test case goes red.

At every step it checks that (1) the substitution matched exactly once,
(2) the named case is reported FAILED (a `✕` line), not merely present in the
output, and (3) the file is restored byte-identical (sha256).

Prerequisite: node on PATH. NODE_OPTIONS is removed from the child
environment, because a shell that points it at a missing preload file makes
every node process exit before jest starts. Do not run it while an iOS build
or a Metro-served app is reading these files.

Usage:
    python3 scripts/mutate-proof-log-guards.py
    python3 scripts/mutate-proof-log-guards.py --list
    python3 scripts/mutate-proof-log-guards.py -k scrub

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

LOG = "src/utils/proofLog.ts"
STORE = "src/stores/proofHistoryStore.ts"
SCREEN = "src/screens/proof/ProofGenerationScreen.tsx"
COMPLETE = "src/screens/proof/ProofCompleteScreen.tsx"
PANEL = "src/components/ui/organisms/LiveLogsPanel.tsx"
LOG_TEST = "src/utils/__tests__/proofLogKeepsNoSecrets.test.ts"
STORE_TEST = "src/stores/__tests__/historyStoreKeepsProofLogs.test.ts"
SCREEN_TEST = "src/screens/__tests__/proofLogFollowsTheSwitches.test.ts"
COPY_TEST = "src/screens/__tests__/theProofLogCanBeCopied.test.ts"


@dataclass(frozen=True)
class Mutation:
    name: str
    path: str
    old: str
    new: str
    guard: str
    expect_case: str


GATE = "settings.developerMode === true && settings.showLiveLogs === true"
NEVER = "/(?!)/g"

MUTATIONS: list[Mutation] = [
    # --- gating -----------------------------------------------------------
    Mutation("gate-ignores-live-logs", LOG, GATE, "settings.developerMode === true",
             SCREEN_TEST, "Developer Mode on, live logs off"),
    Mutation("gate-ignores-developer-mode", LOG, GATE, "settings.showLiveLogs === true",
             SCREEN_TEST, "Developer Mode off, live logs left on"),
    Mutation("gate-loosely-truthy", LOG, GATE, "!!settings.developerMode && !!settings.showLiveLogs",
             SCREEN_TEST, 'a damaged "true" string'),
    Mutation("screen-keeps-log-always", SCREEN,
             "keepLogRef.current = proofLogEnabled(currentSettings);",
             "keepLogRef.current = true;",
             SCREEN_TEST, "Developer Mode off, live logs left on"),
    Mutation("screen-reads-stale-settings", SCREEN,
             "keepLogRef.current = proofLogEnabled(currentSettings);",
             "keepLogRef.current = proofLogEnabled(settings);",
             SCREEN_TEST, "the settings read when the attempt starts decide"),
    Mutation("live-panel-ungated", SCREEN,
             "{proofLogEnabled(settings) && (",
             "{settings && (",
             SCREEN_TEST, "Developer Mode off, live logs left on"),
    Mutation("failure-keeps-no-log", SCREEN,
             "      onChainStatus: 'failed',\n      ...attemptLog(),\n",
             "      onChainStatus: 'failed',\n",
             SCREEN_TEST, "a failed attempt keeps its log up to the failure"),
    Mutation("completion-not-given-log", SCREEN,
             "proofLog: kept.log,",
             "proofLog: undefined,",
             SCREEN_TEST, "a finished proof hands the same log"),
    Mutation("claims-line-dropped", SCREEN,
             "          if ('token' in result) addLog(describeIdTokenClaims(result.token));\n",
             "",
             SCREEN_TEST, "a token refused for the wrong nonce (E2012) still logs"),
    Mutation("history-shows-without-dev-mode", LOG,
             "return isObject(settings) && settings.developerMode === true;",
             "return isObject(settings);",
             COPY_TEST, "Developer Mode off hides a kept log"),
    Mutation("complete-offers-copy-without-log", COMPLETE,
             "{generationLog !== null && (",
             "{true && (",
             COPY_TEST, "no log (logs were off)"),
    Mutation("complete-verification-not-kept", COMPLETE,
             "          offChainStatus: result ? 'verified' : 'failed',\n"
             "          overallStatus: result ? 'verified' : 'verified_failed',\n"
             "          ...attemptLog(),\n",
             "          offChainStatus: result ? 'verified' : 'failed',\n"
             "          overallStatus: result ? 'verified' : 'verified_failed',\n",
             COPY_TEST, "verification lines are added"),
    # --- scrubbing ----------------------------------------------------------
    Mutation("jwt-kept", LOG,
             "    if (looksLikeJoseHeader(token.slice(0, token.indexOf('.')))) {",
             "    if (false && looksLikeJoseHeader(token.slice(0, token.indexOf('.')))) {",
             LOG_TEST, "a JWT in running text"),
    Mutation("jwt-lookalike-hides-token", LOG,
             "      JWT_CANDIDATE.lastIndex = start + 1;",
             "      JWT_CANDIDATE.lastIndex = start + token.length;",
             LOG_TEST, "a JWT after a look-alike"),
    Mutation("jwt-header-unchecked", LOG,
             "/^\\s*\\{\\s*\"/.test(decodeBase64UrlBytes(segment, 16))",
             "true",
             LOG_TEST, "eyewitness.example.co"),
    Mutation("url-code-kept", LOG,
             "([?&#])(code|id_token|",
             "([?&#])(id_token|",
             LOG_TEST, "an OAuth code in a URL"),
    Mutation("bearer-kept", LOG,
             "out = out.replace(BEARER,",
             f"out = out.replace({NEVER},",
             LOG_TEST, "a bearer token"),
    Mutation("labelled-secrets-kept", LOG,
             "  out = scrubLabelled(out);\n",
             "",
             LOG_TEST, "a private key"),
    Mutation("received-label-dropped", LOG,
             "(?:\\\\s+received)?",
             "",
             LOG_TEST, "a partial signature after"),
    Mutation("label-takes-short-values", LOG,
             "if (inner.length < 8 ||",
             "if (inner.length < 0 ||",
             LOG_TEST, "[Inputs] Signature: ✓"),
    Mutation("signature-hex-kept", LOG,
             "out = out.replace(SIGNATURE_HEX,",
             f"out = out.replace({NEVER},",
             LOG_TEST, "an unlabelled 65-byte signature"),
    Mutation("app-attest-key-kept", LOG,
             "out = out.replace(APP_ATTEST_KEY,",
             f"out = out.replace({NEVER},",
             LOG_TEST, "an App Attest key id (sentence)"),
    Mutation("opaque-blob-kept", LOG,
             "const mixed = (s: string) => /[A-Z]/.test(s) && /[a-z]/.test(s) && /[0-9]/.test(s);",
             "const mixed = (s: string) => false;",
             LOG_TEST, "an unlabelled attestation object"),
    Mutation("opaque-blob-overreach", LOG,
             "const mixed = (s: string) => /[A-Z]/.test(s) && /[a-z]/.test(s) && /[0-9]/.test(s);",
             "const mixed = (s: string) => s.length > 0;",
             LOG_TEST, "hex abcdef0123"),
    Mutation("cut-before-scrub", LOG,
             "return capLogText(scrubLogText(lines.join('\\n')));",
             "return scrubLogText(capLogText(lines.join('\\n')));",
             LOG_TEST, "scrubs BEFORE cutting"),
    Mutation("stored-log-not-rescrubbed", LOG,
             "  if (typeof log !== 'string' || log.trim() === '') return null;\n  return capLogText(scrubLogText(log));",
             "  if (typeof log !== 'string' || log.trim() === '') return null;\n  return capLogText(log);",
             COPY_TEST, "a raw token stored by an older build"),
    Mutation("live-panel-copies-raw", PANEL,
             "const logText = scrubLogText(filteredLogs.map(stripTimestamp).join('\\n'));",
             "const logText = filteredLogs.map(stripTimestamp).join('\\n');",
             COPY_TEST, "copies the live log scrubbed"),
    Mutation("store-keeps-raw-log", STORE,
             "return {...rest, log: capLogText(scrubLogText(log))};",
             "return {...rest, log};",
             STORE_TEST, "stores a log scrubbed"),
    # --- caps, plain text, storage -------------------------------------------
    Mutation("per-record-cap-off", LOG,
             "  if (text.length <= limit) return text;",
             "  return text;",
             LOG_TEST, "characters are cut to the limit"),
    Mutation("head-not-kept", LOG,
             "  let headEnd = Math.max(0, Math.min(head, limit));",
             "  let headEnd = 0;",
             LOG_TEST, "characters are cut to the limit"),
    Mutation("head-cut-splits-emoji", LOG,
             "  if (headEnd > 0 && isHigh(text.charCodeAt(headEnd - 1))) headEnd -= 1;\n",
             "",
             LOG_TEST, "never splits an emoji"),
    Mutation("tail-cut-splits-emoji", LOG,
             "  if (tailStart < text.length && isLow(text.charCodeAt(tailStart))) tailStart += 1;\n",
             "",
             LOG_TEST, "never splits an emoji"),
    Mutation("non-string-log-read", LOG,
             "  if (typeof log !== 'string' || log.trim() === '') return null;\n  return capLogText(scrubLogText(log));",
             "  if (log == null || log === '') return null;\n  return capLogText(scrubLogText(String(log)));",
             LOG_TEST, "a number is no log"),
    Mutation("total-cap-off", STORE,
             "? fitLogBudget(items, id) : items;",
             "? items : items;",
             STORE_TEST, "keeps the total of all logs under the budget"),
    Mutation("written-record-not-first", LOG,
             "  const keepIndex = items.findIndex(item => isObject(item) && item.id === keepId);",
             "  const keepIndex = -1;",
             LOG_TEST, "the record being written keeps its log"),
    Mutation("writes-not-serialized", STORE,
             "  const result = pendingWrite.then(operation);",
             "  const result = operation();",
             STORE_TEST, "two writers at once lose neither write"),
    Mutation("export-carries-logs", STORE,
             "return JSON.stringify(withoutLogs, null, 2);",
             "return JSON.stringify(items, null, 2);",
             STORE_TEST, "the history export leaves every log out"),
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
