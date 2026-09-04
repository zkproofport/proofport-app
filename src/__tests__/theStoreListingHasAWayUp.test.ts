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
 *
 * Screenshots joined the same path later. They are the reason the listing could
 * not be published at all: Play will not publish a listing with fewer than two
 * phone screenshots, and the only shots in the repo were iPhone-sized
 * (1320x2868), which Play rejects outright — its rule is that the long side may
 * not exceed twice the short side, and 2868 is more than 2640. So the checks
 * below cover the FILES as well as the uploader: a set of shots that Play would
 * refuse is a listing that cannot go live, and that must fail here rather than
 * in the console.
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

/** Width and height straight out of a PNG's IHDR — no image library needed. */
function pngSize(file: string): { width: number; height: number } {
  const head = fs.readFileSync(file).subarray(0, 24);
  expect(head.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
}

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

  it('images go up as media into the same edit, not as listing fields', () => {
    // A screenshot is not a field of the Listing resource. It is a separate
    // media upload, on a different URL prefix, into the SAME edit — which is
    // what makes text and images commit together or be discarded together.
    expect(uploader).toContain('upload/androidpublisher/v3/applications');
    // Under `listings`, not an `images` collection. This line asked for the
    // `images/...` form and passed while the uploader was sending screenshots
    // to a path Google does not serve — a guard agreeing with the bug it was
    // meant to catch. The path is pinned properly, for both callers, in
    // thePlayPathsAreTheOnesGoogleDocuments.
    expect(uploader).toMatch(/listings\/\{language\}\/\{image_type\}/);
    expect(uploader).toContain('phoneScreenshots');
  });

  it('the contact details are written, and by something that is called', () => {
    // A helper that exists and is never called is the shape of tonight's other
    // faults: declared, plausible, and doing nothing. Both halves are checked.
    expect(uploader).toMatch(/def send_contact\(/);
    expect(uploader).toMatch(/^\s+send_contact\(token/m);
    expect(uploader).toContain('support@masselabs.com');
  });

  it('no phone number is sent, because Play publishes it', () => {
    // Not required by Play, and whose number appears on a public store page is
    // not a decision this script makes.
    expect(uploader).not.toContain('contactPhone');
  });

  it('the details are merged, never replaced', () => {
    // A PUT would replace the whole details resource, blanking the one field
    // that must survive — the store's default language.
    const fn = uploader.slice(uploader.indexOf('def send_contact('));
    const body = fn.slice(0, fn.indexOf('\ndef ', 1));
    expect(body).toMatch(/'PATCH'/);
    expect(body).not.toMatch(/'PUT'/);
  });

  it('a type is cleared before it is written, so a rerun cannot double it', () => {
    // Play APPENDS on upload. Without the delete, running this twice leaves
    // eight screenshots in a four-screenshot listing, and the store page is
    // wrong in a way no error ever mentions.
    expect(uploader).toMatch(/call\(token, 'DELETE', target\)/);
  });

  it('a language with no images/ folder is left alone rather than emptied', () => {
    // Absence must mean "not managed here". If it meant "delete", adding the
    // first language folder would wipe every other language's screenshots.
    expect(uploader).toMatch(/if language in images:/);
  });

  it('every language has screenshots Play will actually accept', () => {
    const locales = fs.readdirSync(metadataDir).filter((n) => !n.startsWith('.'));
    for (const locale of locales) {
      const dir = path.join(metadataDir, locale, 'images', 'phoneScreenshots');
      expect(fs.existsSync(dir)).toBe(true);
      const shots = fs.readdirSync(dir).filter((n) => /\.(png|jpe?g)$/i.test(n)).sort();

      // Play refuses to publish a listing with fewer than two phone
      // screenshots. Four is what earns a promotional placement.
      expect(shots.length).toBeGreaterThanOrEqual(2);

      const sizes = shots.map((name) => pngSize(path.join(dir, name)));
      for (const [i, { width, height }] of sizes.entries()) {
        const short = Math.min(width, height);
        const long = Math.max(width, height);
        // Play's stated limits, in its own terms: each side within 320..3840,
        // and the long side no more than twice the short one. That last rule is
        // the one the iPhone shots broke.
        expect(short).toBeGreaterThanOrEqual(320);
        expect(long).toBeLessThanOrEqual(3840);
        expect(long).toBeLessThanOrEqual(short * 2);
        // Portrait 9:16 exactly. Google names 9:16 (or 16:9) as the shape a
        // screenshot must have to be eligible for promotional placement, so
        // drifting to a taller phone ratio is a decision, not an accident.
        expect(`${locale}/${shots[i]} ${width}x${height}`)
          .toBe(`${locale}/${shots[i]} ${width}x${Math.round((width * 16) / 9)}`);
      }
      // One size for the whole carousel — a mixed set is letterboxed by Play.
      expect(new Set(sizes.map((s) => `${s.width}x${s.height}`)).size).toBe(1);
    }
  });

  it('the build-and-ship lane leaves the screenshots alone too', () => {
    // Now that image files sit in the metadata folder, shipping a build could
    // rewrite the store page's pictures as well as its text. Every supply call
    // in the lane has to keep both skips on.
    //
    // This used to count skip lines and require one per supply call, which was
    // the only way to say it while the three credential branches each spelled
    // their options out. They now share one options hash, so the skips appear
    // once and cover all three — a stronger guarantee that the old count read
    // as a failure. What has to be checked instead is that no supply call gets
    // its options from anywhere else.
    const beta = lane('beta');
    const supplies = beta.match(/supply\(/g) || [];
    expect(supplies.length).toBeGreaterThan(0);
    expect(beta).toMatch(/skip_upload_images:\s*true/);
    expect(beta).toMatch(/skip_upload_screenshots:\s*true/);
    // A fourth branch that builds its own options, skips and all forgotten,
    // is what this catches.
    expect((beta.match(/supply\(\s*upload\b/g) || []).length).toBe(supplies.length);
  });

  it('refuses out loud when no Play credential is set', () => {
    // The build lane may warn and carry on — building without publishing is a
    // real thing to want. Uploading only the listing is not: if it cannot
    // upload, it did nothing at all, and must say so as a failure.
    expect(uploader).toMatch(/def die|sys\.exit/);
  });
});
