/**
 * The Play store listing has something that actually uploads it.
 *
 * The build-and-ship lane skips metadata on purpose — shipping a build must not
 * silently rewrite the store page. The cost of that correct decision was that
 * the listing had NO way up at all: the text sat in android/fastlane/metadata/
 * and nothing ever read it. That is the same shape as the release workflow that
 * built an AAB and had no path to Play (see playUploadNamesTheRealPackage),
 * and it fails the same way — quietly, with everything green.
 *
 * The first attempt used a fastlane `supply` lane. That could not work here:
 * supply looks up a TRACK RELEASE before it will write any listing, and this
 * app has never had a build uploaded, so it dies on a release that does not
 * exist. The upload now talks to the Play edits API directly
 * (android/play/upload-listing.py): open an edit, PUT each language's listing,
 * commit — or validate and throw the edit away for a dry run. No track and no
 * release are touched at any point.
 *
 * So this pins both halves: shipping still leaves the listing alone, and the
 * listing still has an upload of its own that names a metadata folder that
 * exists and can never cut a release.
 */
import fs from 'node:fs';
import path from 'node:path';

const repo = path.join(__dirname, '..', '..');
const fastfile = fs.readFileSync(path.join(repo, 'android', 'fastlane', 'Fastfile'), 'utf8');

const UPLOADER = path.join(repo, 'android', 'play', 'upload-listing.py');
const uploader = fs.readFileSync(UPLOADER, 'utf8');
const workflow = fs.readFileSync(
  path.join(repo, '.github', 'workflows', 'upload-store-listing.yml'),
  'utf8',
);

/** The body of one fastlane lane, matched to the END of its name. */
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
  it('the uploader exists and the workflow runs it', () => {
    expect(uploader.length).toBeGreaterThan(0);
    expect(workflow).toContain('upload-listing.py');
  });

  it('it writes listings and nothing else', () => {
    // A PUT to `listings/{language}` inside an edit. Anything reaching for
    // tracks, releases, bundles or apks would be able to ship something.
    expect(uploader).toMatch(/listings\/\{language\}|listings\/'|listings\/\$/);
    for (const forbidden of ['/bundles', '/apks', '/tracks', 'versionCode']) {
      expect(uploader).not.toContain(forbidden);
    }
  });

  it('a dry run validates and throws the edit away instead of committing', () => {
    expect(uploader).toContain(':validate');
    expect(uploader).toMatch(/DRY_RUN/);
  });

  it('the build-and-ship lane still leaves the listing alone', () => {
    const beta = lane('beta');
    expect(beta).not.toBe('');
    expect(beta).not.toMatch(/skip_upload_metadata:\s*false/);
  });

  it('the metadata folder is really there, with text in it', () => {
    // A folder that does not exist uploads nothing and says little about why.
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
    expect(uploader).toMatch(/def die|sys\.exit/);
  });
});
