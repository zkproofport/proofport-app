/**
 * Every workflow must install the dependency set the lockfile records.
 *
 * The first App Store release failed at `pod install` on 2026-08-29 with:
 *
 *     [Codegen] Error: The first argument of method showColumn must be of
 *     type React.ElementRef<>
 *
 * Nobody had touched that code. The build workflows ran `npm install`, which
 * ignores package-lock.json and re-resolves every caret range, so each run
 * compiled whatever had been published since the last one. A newer
 * react-native-screens declares that native command's first argument as
 * `React.ComponentRef<>` — React 19's new name for `ElementRef` — and this
 * react-native's codegen only accepts the old spelling. The version the
 * lockfile pins builds fine; the one the release picked up does not, and it
 * declares `react-native: "*"`, so nothing stopped it.
 *
 * The give-away was that tests stayed green throughout: the test workflow was
 * already using `npm ci`. Only the build path was free-running.
 *
 * The `npm install --no-save` that fetches the release tooling is a different
 * thing and stays — it installs a tool, not the app.
 *
 * This package runs jest, which takes no message argument on `expect`. Each
 * failure has to be readable from the test name alone.
 */
import fs from 'node:fs';
import path from 'node:path';

const workflowDir = path.join(__dirname, '..', '..', '.github', 'workflows');
const workflows = fs.readdirSync(workflowDir).filter((f) => f.endsWith('.yml'));
const read = (file: string) => fs.readFileSync(path.join(workflowDir, file), 'utf8');

/** Lines that install the app's own dependencies, tool installs excluded. */
const appInstalls = (body: string) =>
  body
    .split('\n')
    .filter((line) => /npm (ci|install)\b/.test(line))
    .filter((line) => !line.trim().startsWith('#'))
    .filter((line) => !line.includes('--no-save'));

describe('a build compiles the dependencies that were tested', () => {
  const installers = workflows.filter((f) => appInstalls(read(f)).length > 0);

  it('there is something to check', () => {
    expect(installers.length).toBeGreaterThan(0);
  });

  it.each(installers)('%s installs from the lockfile', (file) => {
    for (const line of appInstalls(read(file))) {
      expect(line).toMatch(/npm ci\b/);
    }
  });

  it.each(installers)('%s never re-resolves the ranges', (file) => {
    for (const line of appInstalls(read(file))) {
      expect(line).not.toMatch(/npm install\b/);
    }
  });
});
