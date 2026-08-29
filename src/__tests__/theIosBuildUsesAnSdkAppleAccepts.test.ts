/**
 * The iOS jobs must run on a macOS image new enough for Apple to accept the upload.
 *
 * The first release to reach the upload step, on 2026-08-29, built for seventeen
 * minutes, archived, signed, and was then refused by Apple's validation:
 *
 *     Validation failed (409) SDK version issue. This app was built with the
 *     iOS 18.5 SDK. All iOS and iPadOS apps must be built with the iOS 26 SDK or
 *     later, included in Xcode 26 or later, in order to be uploaded to App Store
 *     Connect or submitted for distribution.
 *
 * `macos-15` ships Xcode 16, which is that iOS 18.5 SDK. Nothing in the build
 * log before the upload looks wrong, which is what makes this expensive to
 * diagnose — a full build's worth of time is spent before the refusal.
 *
 * Apple raises this floor roughly once a year, so this test does not pin one
 * image name forever; it fails on the images known to be too old and forces a
 * decision when a new floor arrives.
 *
 * This package runs jest, which takes no message argument on `expect`. Each
 * failure has to be readable from the test name alone.
 */
import fs from 'node:fs';
import path from 'node:path';

const workflowDir = path.join(__dirname, '..', '..', '.github', 'workflows');
const read = (file: string) => fs.readFileSync(path.join(workflowDir, file), 'utf8');
const workflows = fs.readdirSync(workflowDir).filter((f) => f.endsWith('.yml'));

/** Images whose Xcode is older than the SDK floor Apple enforces today. */
const TOO_OLD = ['macos-13', 'macos-14', 'macos-15'];

const macRunners = (body: string) =>
  [...body.matchAll(/^\s*runs-on:\s*(macos[\w.-]*)\s*$/gm)].map((m) => m[1]);

describe('the iOS build targets an SDK Apple still accepts', () => {
  const macJobs = workflows.filter((f) => macRunners(read(f)).length > 0);

  it('there is something to check', () => {
    expect(macJobs.length).toBeGreaterThan(0);
  });

  it.each(macJobs)('%s runs on no image older than the current floor', (file) => {
    for (const runner of macRunners(read(file))) {
      // `-large`, `-xlarge` and `-intel` suffixes carry the same Xcode.
      const base = runner.replace(/-(large|xlarge|intel)$/, '');
      expect(TOO_OLD).not.toContain(base);
    }
  });

  it.each(macJobs)('%s says which image it wants, never macos-latest', (file) => {
    /*
     * `macos-latest` moves under you: the image behind it changes when GitHub
     * promotes a new one, so a release could start using a different Xcode with
     * no commit to point at. Name the image and change it deliberately.
     */
    expect(macRunners(read(file))).not.toContain('macos-latest');
  });
});
