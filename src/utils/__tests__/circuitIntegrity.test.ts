/**
 * A circuit file that did not arrive intact must not be kept.
 *
 * THE DEFECT. `circuitDownload.ts` checked `statusCode !== 200` and nothing
 * else. A connection that drops after the headers leaves a 200, a partial file
 * and no error — and the file then STAYED, because `allCircuitFilesExist` asks
 * only whether the path exists. Every later launch saw three files, skipped the
 * download, handed truncated bytes to the prover, and the person got a proof
 * failure with nothing on screen pointing at a half-downloaded file.
 *
 * The corruption was PERMANENT. Nothing in the app ever revisited that file.
 * `CIRCUIT_DATA_VERSION` does not help: it decides which bytes to want, not
 * whether they arrived, and a re-download that truncates lands in the same
 * state.
 *
 * EDGE-CASE MATRIX (CLAUDE.md) → coverage
 *   contract   → size matching Content-Length passes and says so ('length')
 *   contract   → a digest matching the manifest passes and says so ('sha256')
 *   boundary   → 0 bytes fails even when the server declared no length — the
 *                one corrupt state a size comparison cannot see
 *   boundary   → off by ONE byte fails; a tolerance would pass a truncation
 *   hostile    → a manifest digest that is not a digest (a git blob id, a URL,
 *                'null') never compares equal to anything
 *   hostile    → a manifest line appended for a name already present does not
 *                override the published digest
 *   failure    → hashing that fails on device falls back to length, it does not
 *                condemn a file that may be good
 *   integrity  → a manifest that exists and DISAGREES is a hard failure; the
 *                fallback must not swallow the one case that means something
 *   integrity  → 'none' is reported, never dressed up as a pass with a level
 *   累積       → the same bad file verified repeatedly is rejected every time,
 *                and a good one accepted every time: no latch, no memo that
 *                turns the second answer into a different answer
 */
import {
  isSha256Hex,
  parseSha256Manifest,
  verifyCircuitFile,
} from '../circuitIntegrity';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

describe('verifyCircuitFile', () => {
  it('CONTRACT: a file whose size matches Content-Length passes as length-verified', () => {
    expect(verifyCircuitFile({ size: 1024, declaredLength: 1024 })).toEqual({
      ok: true,
      level: 'length',
    });
  });

  it('CONTRACT: a digest matching the manifest passes as sha256-verified', () => {
    expect(
      verifyCircuitFile({ size: 10, declaredLength: 10, digest: A, expectedDigest: A }),
    ).toEqual({ ok: true, level: 'sha256' });
  });

  it('BOUNDARY: zero bytes fails even when the server declared no length', () => {
    /*
     * The state a size comparison cannot reach. A chunked response reports no
     * Content-Length, so without this the empty file would be "nothing to
     * compare against" and would be kept.
     */
    const v = verifyCircuitFile({ size: 0, declaredLength: null });
    expect(v.ok).toBe(false);
    expect(v).toMatchObject({ reason: 'empty' });
  });

  it('BOUNDARY: one byte short fails', () => {
    // No tolerance. A "close enough" margin passes exactly the truncation this
    // file exists to catch.
    const v = verifyCircuitFile({ size: 1023, declaredLength: 1024 });
    expect(v).toMatchObject({ ok: false, reason: 'truncated' });
    expect((v as { detail: string }).detail).toContain('1023');
  });

  it('BOUNDARY: one byte long fails too', () => {
    // A file LARGER than declared is not a happy accident — it is a body that
    // is not the body the server described.
    expect(verifyCircuitFile({ size: 1025, declaredLength: 1024 })).toMatchObject({
      ok: false,
      reason: 'truncated',
    });
  });

  it('INTEGRITY: a manifest that exists and disagrees is a hard failure', () => {
    /*
     * The case the fallback must not swallow. If a mismatch quietly fell
     * through to the length check, a body that a proxy rewrote — same length,
     * different bytes — would pass, and the manifest would be decoration.
     */
    const v = verifyCircuitFile({
      size: 10,
      declaredLength: 10,
      digest: A,
      expectedDigest: B,
    });
    expect(v).toMatchObject({ ok: false, reason: 'digest-mismatch' });
    expect((v as { detail: string }).detail).toContain(B);
  });

  it('FAILURE: hashing that failed on device falls back to length, not to rejection', () => {
    // Hashing a 100MB srs can run out of memory. That says nothing about the
    // file, so condemning it would brick the app on the smallest phones.
    expect(
      verifyCircuitFile({ size: 10, declaredLength: 10, digest: null, expectedDigest: A }),
    ).toEqual({ ok: true, level: 'length' });
  });

  it('HOSTILE: a manifest entry that is not a digest never compares equal', () => {
    /*
     * A git blob id, a URL and the string 'null' are all things a manifest can
     * end up containing. Compared as plain strings, two identically wrong
     * values would match each other and report `sha256` — a verification that
     * verifies nothing while claiming the strongest level.
     */
    for (const junk of ['not-a-digest', 'null', 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391', '']) {
      expect(isSha256Hex(junk)).toBe(false);
      const v = verifyCircuitFile({
        size: 10,
        declaredLength: 10,
        digest: junk,
        expectedDigest: junk,
      });
      expect(v).toEqual({ ok: true, level: 'length' });
    }
  });

  it('INTEGRITY: with nothing to compare against it says so rather than claiming a level', () => {
    // "We could not check" must never render as "it is fine". The caller logs
    // this level, so a run of `none` in the field is visible.
    expect(verifyCircuitFile({ size: 10, declaredLength: 0 })).toEqual({
      ok: true,
      level: 'none',
    });
    expect(verifyCircuitFile({ size: 10 })).toEqual({ ok: true, level: 'none' });
  });

  it('HOSTILE: a NaN size is treated as empty rather than passing every check', () => {
    expect(verifyCircuitFile({ size: NaN, declaredLength: 10 })).toMatchObject({
      ok: false,
      reason: 'empty',
    });
  });

  it('ACCUMULATING: the same file verified ten times gives the same answer every time', () => {
    /*
     * THE AXIS. A memo, a latch or a "we already checked this path" cache would
     * pass every case above and then wave the second attempt through — which on
     * a phone is a retry that keeps a file the first attempt rejected.
     */
    const bad = { size: 1023, declaredLength: 1024 };
    const good = { size: 1024, declaredLength: 1024 };

    const badRuns = Array.from({ length: 10 }, () => verifyCircuitFile(bad).ok);
    const goodRuns = Array.from({ length: 10 }, () => verifyCircuitFile(good).ok);

    expect(badRuns).toEqual(Array(10).fill(false));
    expect(goodRuns).toEqual(Array(10).fill(true));
  });
});

describe('parseSha256Manifest', () => {
  it('CONTRACT: reads what sha256sum writes, in both its formats', () => {
    const text = `${A}  circuit.json\n${B} *circuit.srs\n`;
    expect(parseSha256Manifest(text)).toEqual({
      'circuit.json': A,
      'circuit.srs': B,
    });
  });

  it('CONTRACT: uppercase digests are normalised', () => {
    expect(parseSha256Manifest(`${A.toUpperCase()}  x.json`)).toEqual({ 'x.json': A });
  });

  it('HOSTILE: an appended duplicate does not override the published digest', () => {
    /*
     * First wins. Taking the last would let one appended line silently replace
     * a digest — the shape somebody tampering with the file would reach for,
     * and also what a careless `>>` does.
     */
    expect(parseSha256Manifest(`${A}  x.json\n${B}  x.json`)).toEqual({ 'x.json': A });
  });

  it('BOUNDARY: comments, blanks and unparseable lines are skipped, not fatal', () => {
    // A manifest that grows a header one day must not stop every download that
    // day.
    const text = `# generated by scripts/checksums.sh\n\n${A}  x.json\ngarbage line\n`;
    expect(parseSha256Manifest(text)).toEqual({ 'x.json': A });
  });

  it('HOSTILE: a short or long hex string is not accepted as a digest', () => {
    expect(parseSha256Manifest(`${'a'.repeat(63)}  x.json`)).toEqual({});
    expect(parseSha256Manifest(`${'a'.repeat(65)}  x.json`)).toEqual({});
  });

  it('BOUNDARY: an empty or non-string manifest is an empty map, not a throw', () => {
    expect(parseSha256Manifest('')).toEqual({});
    expect(parseSha256Manifest(undefined as unknown as string)).toEqual({});
  });

  it('ACCUMULATING: names with spaces survive — the digest ends at the first gap', () => {
    expect(parseSha256Manifest(`${A}  my circuit.json`)).toEqual({ 'my circuit.json': A });
  });
});
