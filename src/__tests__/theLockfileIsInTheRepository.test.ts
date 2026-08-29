/**
 * The lockfile has to be in the repository, or nothing can install from it.
 *
 * `package-lock.json` was gitignored — one line in a generic Node template
 * block, next to `npm-debug.log`. The cost stayed invisible for a long time:
 *
 *   - `npm ci` cannot run without a lockfile, so the test workflow, which calls
 *     it, had been failing on every push. Nobody was reading those runs.
 *   - the build workflows used `npm install` instead, which re-resolves every
 *     caret range, so each build compiled whatever had been published since the
 *     last one. That is how the first App Store release died: a newer
 *     react-native-screens spells a native command argument
 *     `React.ComponentRef<>`, which this react-native's codegen rejects.
 *   - the node_modules cache key hashes the lockfile, so it was hashing a file
 *     that did not exist.
 *
 * Committing it fixes all three. This test exists because the ignore rule is one
 * line and would come back unnoticed.
 *
 * This package runs jest, which takes no message argument on `expect`. Each
 * failure has to be readable from the test name alone.
 */
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

const repo = path.join(__dirname, '..', '..');

describe('the dependency set is recorded where CI can read it', () => {
  it('the lockfile exists', () => {
    expect(fs.existsSync(path.join(repo, 'package-lock.json'))).toBe(true);
  });

  it('git is tracking it', () => {
    const tracked = execFileSync('git', ['ls-files', 'package-lock.json'], {
      cwd: repo,
      encoding: 'utf8',
    }).trim();
    expect(tracked).toBe('package-lock.json');
  });

  it('no ignore rule hides it', () => {
    // `git check-ignore` exits 1 when the path is NOT ignored, which is what we
    // want — so a zero exit, meaning some rule matched, is the failure.
    let ignoredBy = '';
    try {
      ignoredBy = execFileSync('git', ['check-ignore', '-v', 'package-lock.json'], {
        cwd: repo,
        encoding: 'utf8',
      });
    } catch {
      ignoredBy = '';
    }
    expect(ignoredBy).toBe('');
  });

  it('records the mini-app packages as siblings, not as absolute paths', () => {
    // The three OpenStoa packages are linked with `file:../openstoa/...`. An
    // absolute path would be one developer's laptop baked into every build.
    const lock = fs.readFileSync(path.join(repo, 'package-lock.json'), 'utf8');
    expect(lock).toMatch(/"file:\.\.\/openstoa\/packages\/mobile"/);
    expect(lock).not.toMatch(/"file:\//);
  });
});
