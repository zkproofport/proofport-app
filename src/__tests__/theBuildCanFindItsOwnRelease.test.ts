/**
 * Every workflow that downloads the prebuilt proving library must name the
 * repository it is downloading from.
 *
 * Failed 2026-08-29 on the first App Store release run, at the very first step
 * that needed it:
 *
 *     failed to run git: fatal: not a git repository
 *
 * The cause is a shape, not a typo. These workflows check the app out into a
 * `proofport-app` subdirectory so the OpenStoa mini-app source can sit beside
 * it. `run:` steps still start at the workspace root, which is now an ordinary
 * empty directory — so the GitHub CLI, which works out the repository by asking
 * git where it is, has nothing to ask. It exits 1 before making any request,
 * and the token, the tag and the asset were all fine.
 *
 * All four downloads had it: both platforms of the release workflow and both
 * staging beta workflows. Nothing caught it because the release path had not
 * run since the subdirectory checkout was introduced.
 *
 * This package runs jest, which takes no message argument on `expect`. Each
 * failure has to be readable from the test name alone.
 */
import fs from 'node:fs';
import path from 'node:path';

const repo = path.join(__dirname, '..', '..');
const workflowDir = path.join(repo, '.github', 'workflows');
const read = (file: string) => fs.readFileSync(path.join(workflowDir, file), 'utf8');

const workflows = fs.readdirSync(workflowDir).filter((f) => f.endsWith('.yml'));

/** Every `gh release download ...` invocation, with its continuation lines. */
const downloads = (body: string) =>
  [...body.matchAll(/gh release download[\s\S]*?(?=\n\s*\n|\n\s{0,10}[a-z-]+:|$)/g)].map((m) => m[0]);

describe('a build that checks out into a subdirectory still finds its release', () => {
  const withDownloads = workflows.filter((f) => downloads(read(f)).length > 0);

  it('there is something to check', () => {
    // A rename or a move must not turn this file into a silent no-op.
    expect(withDownloads.length).toBeGreaterThan(0);
  });

  it.each(withDownloads)('%s names the repository on every download', (file) => {
    for (const call of downloads(read(file))) {
      expect(call).toMatch(/--repo\s/);
    }
  });

  it.each(withDownloads)('%s checks out into a subdirectory, which is why', (file) => {
    // If a workflow ever stops using a subdirectory the flag is merely
    // redundant, not wrong — but the pairing is the reason this file exists, so
    // record it. A failure here means the assumption changed, not that the
    // build is broken.
    expect(read(file)).toMatch(/path: proofport-app\s*$/m);
  });
});
