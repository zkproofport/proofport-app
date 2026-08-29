/**
 * The Play store listing has a lane that actually uploads it.
 *
 * The build-and-ship lane skips metadata on purpose — shipping a build must not
 * silently rewrite the store page. The cost of that correct decision was that
 * the listing had NO way up at all: the text sat in android/fastlane/metadata/
 * and nothing ever read it. That is the same shape as the release workflow that
 * built an AAB and had no path to Play (see playUploadNamesTheRealPackage),
 * and it fails the same way — quietly, with everything green.
 *
 * So this pins both halves: shipping still leaves the listing alone, and the
 * listing still has a lane of its own that names a metadata folder that exists.
 */
import fs from 'node:fs';
import path from 'node:path';

const repo = path.join(__dirname, '..', '..');
const fastfile = fs.readFileSync(path.join(repo, 'android', 'fastlane', 'Fastfile'), 'utf8');

/**
 * The body of one lane, from its declaration to the next one.
 *
 * The name is matched to its END, not as a prefix. A plain `indexOf` found
 * `store_listing` inside `store_listing_disabled`, so renaming the lane out of
 * existence left every check below green — the guard was reporting on a lane
 * that no longer answered to that name.
 */
function lane(name: string): string {
  const decl = new RegExp(`^\\s*lane :${name}\\b`, 'm');
  const m = decl.exec(fastfile);
  if (!m) return '';
  const start = m.index;
  const next = fastfile.indexOf('  lane :', start + m[0].length);
  return fastfile.slice(start, next === -1 ? undefined : next);
}

const metadataDir = path.join(repo, 'android', 'fastlane', 'metadata', 'android');

describe('the Play listing can be uploaded, and shipping a build does not touch it', () => {
  it('has a lane whose job is the listing', () => {
    expect(lane('store_listing')).not.toBe('');
  });

  it('that lane does NOT skip metadata', () => {
    expect(lane('store_listing')).toMatch(/skip_upload_metadata:\s*false/);
  });

  it('that lane uploads no build, so it can never cut a release', () => {
    expect(lane('store_listing')).toMatch(/skip_upload_aab:\s*true/);
    expect(lane('store_listing')).toMatch(/skip_upload_apk:\s*true/);
  });

  it('the build-and-ship lane still leaves the listing alone', () => {
    const beta = lane('beta');
    expect(beta).not.toBe('');
    expect(beta).not.toMatch(/skip_upload_metadata:\s*false/);
  });

  it('the metadata folder the lane names is really there, with text in it', () => {
    // A lane pointing at a folder that does not exist uploads nothing and says
    // little about why.
    expect(lane('store_listing')).toContain('./fastlane/metadata/android');
    const locales = fs.readdirSync(metadataDir).filter((n) => !n.startsWith('.'));
    expect(locales.length).toBeGreaterThan(0);
    for (const locale of locales) {
      const full = path.join(metadataDir, locale, 'full_description.txt');
      expect(fs.readFileSync(full, 'utf8').trim().length).toBeGreaterThan(0);
    }
  });

  it('refuses out loud when no Play credential is set', () => {
    // The build lane may warn and carry on — building without publishing is a
    // real thing to want. Uploading only the listing is not: if it cannot
    // upload, it did nothing at all, and must say so as a failure.
    expect(lane('store_listing')).toMatch(/UI\.user_error!/);
  });
});
