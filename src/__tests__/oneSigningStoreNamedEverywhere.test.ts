/**
 * The Matchfile and both iOS workflows must name the same signing repository.
 *
 * The first App Store release reached the signing step and died with:
 *
 *     [!] Invalid password passed via 'MATCH_PASSWORD'
 *
 * The password was fine. The repositories disagreed. `ios/fastlane/Matchfile`
 * pointed at `masselabs/ios-certificates`, where match had stored the corporate
 * certificates and all four profiles on 2026-08-22. The workflows overrode that
 * with `zkproofport/ios-certificates` — a repository shared with other projects,
 * still holding the old personal account's certificate and a profile for the
 * retired bundle id `com.zkproofport.app`, untouched since 2026-02-11. The
 * password could not open files it was never meant for, and even decrypted
 * there was nothing there to sign `com.masselabs.zkproofport` with.
 *
 * It cost four failed release runs to find, because a wrong repository and a
 * wrong password produce the same message.
 *
 * The material now lives in one place named after this app, moved byte for byte
 * so nothing was regenerated or revoked. This test exists so the three
 * references cannot drift apart again — that drift is invisible until a release
 * is attempted, which is rare enough that nobody notices for months.
 *
 * This package runs jest, which takes no message argument on `expect`. Each
 * failure has to be readable from the test name alone.
 */
import fs from 'node:fs';
import path from 'node:path';

const repo = path.join(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(repo, rel), 'utf8');

const MATCHFILE = 'ios/fastlane/Matchfile';
const WORKFLOWS = ['.github/workflows/release-app.yml', '.github/workflows/build-ios.yml'];

/** `owner/name` of every certificate repository a file points at. */
const stores = (body: string) =>
  [...body.matchAll(/github\.com\/([\w.-]+\/[\w.-]+?)\.git/g)]
    .map((m) => m[1])
    .filter((name) => /cert/i.test(name));

describe('signing material has exactly one home', () => {
  it('the Matchfile names one repository', () => {
    expect(stores(read(MATCHFILE))).toHaveLength(1);
  });

  it.each(WORKFLOWS)('%s names one repository', (file) => {
    expect(stores(read(file))).toHaveLength(1);
  });

  it('all three name the same one', () => {
    const named = new Set([MATCHFILE, ...WORKFLOWS].flatMap((f) => stores(read(f))));
    expect([...named]).toEqual(['zkproofport/proofport-app-certificates']);
  });

  it('no url still points at either shared repository', () => {
    // Both are real repositories that other work depends on; neither was
    // modified. Pointing at them again would resurrect the same failure.
    //
    // Checked against the extracted urls, not the raw text: the Matchfile names
    // both of them in the comment that explains why it stopped using them, and a
    // blunt text search reads that history as a live reference.
    for (const file of [MATCHFILE, ...WORKFLOWS]) {
      expect(stores(read(file))).not.toContain('zkproofport/ios-certificates');
      expect(stores(read(file))).not.toContain('masselabs/ios-certificates');
    }
  });
});
