/**
 * Is the circuit file on disk the file the server meant to send?
 *
 * WHY THIS EXISTS. `circuitDownload.ts` checked `statusCode !== 200` and
 * nothing else. A connection that drops after the headers leaves a 200, a
 * partial file, and no error — and the file then STAYS, because
 * `allCircuitFilesExist` asks only whether the path exists. Every later launch
 * sees three files, skips the download, hands the truncated bytes to the
 * prover, and the person gets a proof failure with nothing on screen that
 * points at a half-downloaded file. The corruption is permanent: there is no
 * path in the app that ever tries that file again.
 *
 * `CIRCUIT_DATA_VERSION` does not help. It decides WHICH bytes to want, not
 * whether the bytes arrived — a bumped version re-downloads, and a re-download
 * that truncates is the same state again.
 *
 * WHAT COUNTS AS VERIFIED, strongest first:
 *
 *   sha256   the file's digest matches a manifest published beside it. This is
 *            the real check: it catches truncation, a proxy that rewrote the
 *            body, and a tag that moved.
 *   length   the file's size matches the `Content-Length` the server declared.
 *            Catches truncation, which is the failure that actually happens,
 *            and needs no new infrastructure.
 *   none     neither was available. NOT an error and NOT silence — the caller
 *            is told, so "we could not check" never renders as "it is fine".
 *
 * A manifest that is missing is not treated as a pass or a fail: releases cut
 * before the manifest existed are still installable, and every release after it
 * is checked properly. A manifest that is PRESENT and disagrees is a hard
 * failure — that is the case where something is actually wrong.
 *
 * PURE. Every I/O the check needs arrives as an argument, so the whole decision
 * table is exercised without a device, a network or a filesystem. The bug this
 * replaces survived precisely because the only way to see it was to lose a
 * connection at the right moment.
 */

export type VerificationLevel = 'sha256' | 'length' | 'none';

export interface IntegrityInput {
  /** Bytes actually on disk. */
  size: number;
  /** `Content-Length`, when the server declared one. */
  declaredLength?: number | null;
  /** Lower-case hex sha256 of the file, when it was computed. */
  digest?: string | null;
  /** The expected digest from the manifest, when one was published. */
  expectedDigest?: string | null;
}

export type IntegrityVerdict =
  | { ok: true; level: VerificationLevel }
  | { ok: false; reason: IntegrityFailure; detail: string };

export type IntegrityFailure =
  /** Zero bytes, or a negative/absent size. */
  | 'empty'
  /** Fewer (or more) bytes than the server said it was sending. */
  | 'truncated'
  /** A manifest exists for this file and the digest does not match it. */
  | 'digest-mismatch';

/**
 * Hex, 64 characters, nothing else. A manifest line that is a git blob id, a
 * URL, or the word `null` must not be compared as though it were a digest —
 * `'abc' === 'abc'` would pass two identically wrong values.
 */
export function isSha256Hex(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
}

/**
 * The verdict. Never throws: a caller that is deciding whether to delete a file
 * must not be handed an exception instead of a decision.
 */
export function verifyCircuitFile(input: IntegrityInput): IntegrityVerdict {
  const size = Number.isFinite(input.size) ? input.size : 0;

  /*
   * Emptiness first, and separately from truncation. A zero-byte file is wrong
   * under every rule — including when the server declared no length at all, the
   * case a size comparison cannot reach.
   */
  if (size <= 0) {
    return { ok: false, reason: 'empty', detail: `${size} bytes on disk` };
  }

  /*
   * The digest, when BOTH sides of the comparison are real digests. A manifest
   * entry that is malformed is a broken manifest, not a corrupt circuit, and
   * failing the download for it would take the app down over a typo in a text
   * file — so it falls through to the length check rather than failing closed.
   */
  const expected = input.expectedDigest;
  if (isSha256Hex(expected)) {
    const actual = input.digest;
    if (isSha256Hex(actual)) {
      if (actual !== expected) {
        return {
          ok: false,
          reason: 'digest-mismatch',
          detail: `expected ${expected}, got ${actual}`,
        };
      }
      return { ok: true, level: 'sha256' };
    }
    /*
     * A manifest we could use and a digest we could not compute. Hashing can
     * fail on a device (out of memory on a 100MB srs); that is a reason to fall
     * back to length, not a reason to declare the file bad.
     */
  }

  const declared = input.declaredLength;
  if (typeof declared === 'number' && Number.isFinite(declared) && declared > 0) {
    if (size !== declared) {
      return {
        ok: false,
        reason: 'truncated',
        detail: `${size} bytes on disk, server declared ${declared}`,
      };
    }
    return { ok: true, level: 'length' };
  }

  // Non-empty, and nothing to compare it against.
  return { ok: true, level: 'none' };
}

/**
 * Parse a manifest of `<sha256>  <filename>` lines — the format `sha256sum`
 * writes, so the file that publishes it can be produced and checked with the
 * tool everybody already has.
 *
 * Tolerant by design: unknown lines, comments and blanks are skipped rather
 * than rejected. A manifest that gains a header one day must not stop every
 * download that day.
 */
export function parseSha256Manifest(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof text !== 'string') return out;

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    // `sha256sum` writes two spaces, `sha256sum --binary` a space and a star.
    const m = /^([0-9a-fA-F]{64})\s+\*?(.+)$/.exec(line);
    if (!m) continue;
    const digest = m[1].toLowerCase();
    const name = m[2].trim();
    if (!name) continue;
    /*
     * FIRST WINS. A manifest with the same name twice is ambiguous, and taking
     * the last would let an appended line silently override a published digest
     * — which is the shape an attacker would reach for.
     */
    if (!(name in out)) out[name] = digest;
  }
  return out;
}
