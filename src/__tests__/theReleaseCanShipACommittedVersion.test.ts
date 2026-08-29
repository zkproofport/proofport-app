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
 * So the release grew an input that skips the calculation instead. These tests
 * read the workflow as text, because the defect they guard lives in the
 * agreement between the input, the two version steps, and the job outputs — the
 * exact shape no single-file test can see.
 *
 * This package runs jest, which takes no message argument on `expect`. Each
 * failure has to be readable from the test name alone.
 */
import fs from 'node:fs';
import path from 'node:path';

const repo = path.join(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(repo, rel), 'utf8');

const RELEASE_WORKFLOW = '.github/workflows/release-app.yml';

/** The block of one named step, up to the next step at the same indent. */
const step = (name: string) => {
  const body = read(RELEASE_WORKFLOW);
  const start = body.indexOf(`- name: ${name}`);
  expect(start).toBeGreaterThan(-1);
  const next = body.indexOf('\n      - name:', start + 1);
  return body.slice(start, next === -1 ? undefined : next);
};

describe('the release can ship a version that the tags cannot produce', () => {
  it('offers the skip as a workflow input, off unless asked for', () => {
    const workflow = read(RELEASE_WORKFLOW);
    expect(workflow).toMatch(/skip_version:\s*\n\s*description:.*\n\s*type: boolean\s*\n\s*default: false/);
  });

  it('takes the version from package.json when the skip is on', () => {
    const pinned = step('Use the committed version');
    expect(pinned).toMatch(/if: inputs\.skip_version == true/);
    expect(pinned).toMatch(/require\('\.\/package\.json'\)\.version/);
    expect(pinned).toMatch(/new_release_published=true/);
  });

  it('refuses to ship an empty version rather than building a nameless one', () => {
    // Without this the step would export an empty string, the platform jobs
    // would run, and the build would carry whatever version was left behind.
    expect(step('Use the committed version')).toMatch(/if \[ -z "\$VERSION" \][\s\S]*exit 1/);
  });

  it('never runs the calculator and the skip in the same run', () => {
    expect(step('Run semantic-release')).toMatch(/if: inputs\.skip_version == false/);
    expect(step('Use the committed version')).toMatch(/if: inputs\.skip_version == true/);
  });

  it('the platform jobs read whichever of the two steps actually ran', () => {
    /*
     * The gate on the build jobs is new_release_published. If the outputs kept
     * reading only the calculator step, turning the skip on would leave both
     * outputs empty, the gate would be false, and the run would go green having
     * built nothing — the failure mode this whole file exists to prevent.
     */
    // Scoped to the job's own `outputs:` block on purpose. Searching the whole
    // file passes on the run summary further down, which prints the same two
    // expressions — so a broken job output would still look fine. Caught by
    // mutation: breaking the output alone left this test green.
    const workflow = read(RELEASE_WORKFLOW);
    const start = workflow.indexOf('    outputs:');
    expect(start).toBeGreaterThan(-1);
    const outputs = workflow.slice(start, workflow.indexOf('    steps:', start));
    for (const key of ['new_release_version', 'new_release_published']) {
      expect(outputs).toMatch(
        new RegExp(`steps\\.pinned\\.outputs\\.${key} \\|\\| steps\\.semantic\\.outputs\\.${key}`),
      );
    }
  });
});
