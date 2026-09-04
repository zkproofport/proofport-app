/**
 * The release must be able to ship the version already in the tree.
 *
 * Found 2026-08-29, preparing the first App Store submission on the corporate
 * account. App Store Connect was holding a 1.0.0 version record with no build
 * attached, while the git tags had already reached app-v1.5.2. Running the
 * release as it stood would have computed 1.6.0, written it into the Xcode
 * project, and uploaded a build that could not be attached to the 1.0.0 record
 * at all — a version string has to match.
 *
 * The obvious fix, "move the tags back", is not available: semantic-release
 * derives the next version from the tags and can never re-emit one that already
 * has a tag, and app-v1.0.0 exists. Keeping 1.0.0 that way would have meant
 * deleting all thirteen tags and their GitHub releases.
 *
 * HOW THIS IS SERVED NOW. The release used to carry a `skip_version` input that
 * turned its own calculator off. On 2026-09-05 the calculator moved out
 * entirely: `bump-version.yml` decides versions and tags them, and
 * `release-app.yml` only builds. Building a version the tags cannot produce is
 * then the ordinary case rather than a special one — run the release with no
 * tag and it builds the working tree, whose package.json holds whatever is
 * committed.
 *
 * These cases were rewritten with that move. They guard the same requirement
 * against the new shape, which is why the story above is kept: a future reader
 * needs to know why building an arbitrary version has to stay possible, not
 * only that it does.
 *
 * They read the workflows as text, because what they guard lives in the
 * agreement between two files — the exact shape no single-file test can see.
 *
 * This package runs jest, which takes no message argument on `expect`. Each
 * failure has to be readable from the test name alone.
 */
import fs from 'node:fs';
import path from 'node:path';

const repo = path.join(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(repo, rel), 'utf8');

const RELEASE_WORKFLOW = '.github/workflows/release-app.yml';
const BUMP_WORKFLOW = '.github/workflows/bump-version.yml';

describe('the release can ship a version that the tags cannot produce', () => {
  it('takes the tag to build as an input, and allows it to be empty', () => {
    // Empty is the whole mechanism: it builds the working tree rather than a
    // tagged commit, so a version the calculator could never emit still ships.
    const workflow = read(RELEASE_WORKFLOW);
    expect(workflow).toMatch(/tag:\s*\n\s*description:.*\n\s*type: string\s*\n\s*required: false/);
    expect(workflow).toMatch(/ref: \$\{\{ inputs\.tag \|\| github\.ref \}\}/);
  });

  it('does not calculate a version at all', () => {
    // The calculator living here is what made shipping an arbitrary version a
    // special case needing its own escape hatch. It belongs in the other file.
    const workflow = read(RELEASE_WORKFLOW);
    expect(workflow).not.toMatch(/semantic-release/);
    expect(workflow).not.toMatch(/skip_version/);
  });

  it('refuses to build when the checked-out code disagrees with itself', () => {
    // Without this the build would carry whatever numbers were left in the
    // files — a nameless build, which is the failure this whole file exists to
    // prevent, in its new form.
    const workflow = read(RELEASE_WORKFLOW);
    const checks = workflow.match(/name: The version being built[\s\S]*?exit 1/g) || [];
    expect(checks.length).toBe(2); // one per platform job
    for (const check of checks) {
      expect(check).toMatch(/require\('\.\/package\.json'\)\.version/);
      expect(check).toMatch(/versionName/);
    }
  });

  it('is never started by merging to main', () => {
    // Shipping is a decision. A tag is written for every release-worthy commit,
    // and if that tag started this workflow every merge would reach a store.
    const workflow = read(RELEASE_WORKFLOW);
    const triggers = workflow.slice(workflow.indexOf('\non:'), workflow.indexOf('\npermissions:'));
    expect(triggers).toMatch(/workflow_dispatch:/);
    expect(triggers).not.toMatch(/push:/);
  });
});

describe('the version bump is automatic and cannot loop', () => {
  it('runs on a push to main without being asked', () => {
    const workflow = read(BUMP_WORKFLOW);
    expect(workflow).toMatch(/push:\s*\n\s*branches:\s*\n\s*- main/);
  });

  it('ignores its own release commit', () => {
    /*
     * semantic-release pushes `chore(release): X.Y.Z` to main, which is another
     * push to main. Without this guard the workflow restarts itself forever.
     *
     * `[skip ci]` in that commit message cannot do the job: a git tag inherits
     * its annotation from the commit it points at, so the marker travels into
     * the tag — and the tag is what a person later builds. Matching the message
     * here affects this workflow only.
     */
    expect(read(BUMP_WORKFLOW)).toMatch(
      /!startsWith\(github\.event\.head_commit\.message, 'chore\(release\):'\)/,
    );
  });

  it('reads the tag back rather than trusting the push', () => {
    // semantic-release reports success from its own exit code. The tag is what
    // the next step of the release depends on, so its existence is asserted.
    const workflow = read(BUMP_WORKFLOW);
    expect(workflow).toMatch(/git rev-parse "\$TAG"/);
    expect(workflow).toMatch(/was not pushed/);
  });
});
