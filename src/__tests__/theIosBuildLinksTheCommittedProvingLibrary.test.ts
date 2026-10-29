/**
 * Every workflow that builds iOS links the proving library committed in this
 * repository, never a release asset, and checks it against the bindings first.
 *
 * 2026-10-30: the 1.4.5 TestFlight archive failed with undefined symbols for
 * the background prover (start_noir_proof / noir_proof_status /
 * take_noir_proof). The committed xcframework (Git LFS) had them; the
 * workflows checked out without LFS and unpacked mopro-binaries-v0.3.2
 * (2026-02-11) over it, so CI linked a February library behind every local
 * build's back.
 *
 * Replaces theBuildCanFindItsOwnRelease.test.ts, which held that release
 * download to naming `--repo` (2026-08-29: `gh` cannot find the repository
 * from the workspace root when the app is checked out into a subdirectory).
 * That rule still applies to any `gh` call that remains, below.
 *
 * jest takes no message argument on `expect`; each test name says the rule.
 */
import fs from 'node:fs';
import path from 'node:path';

const workflowDir = path.join(__dirname, '..', '..', '.github', 'workflows');
const raw = (file: string) => fs.readFileSync(path.join(workflowDir, file), 'utf8');
/** The workflow without its comment lines: a comment that mentions a step is not the step. */
const read = (file: string) => raw(file).replace(/^\s*#.*$/gm, '');
const workflows = fs.readdirSync(workflowDir).filter(f => f.endsWith('.yml'));
const iosBuilds = workflows.filter(f => /bundle exec pod install/.test(read(f)));

describe('iOS builds link the repository\'s proving library', () => {
  it('there is something to check: both iOS-building workflows', () => {
    expect(iosBuilds.sort()).toEqual(['build-ios.yml', 'release-app.yml']);
  });

  it('no workflow downloads the proving library from a release', () => {
    for (const f of workflows) {
      expect([f, /MoproFfiFramework\.xcframework\.tar\.gz|mopro-binaries-v/.test(read(f))]).toEqual([f, false]);
    }
  });

  it.each(iosBuilds)('%s pulls the xcframework from LFS, then checks it, before pod install', f => {
    const body = read(f);
    const pull = body.indexOf("git lfs pull --include 'mopro_bindings/MoproFfiFramework.xcframework/**'");
    const check = body.indexOf('scripts/check-mopro-ios-symbols.sh');
    const pods = body.indexOf('bundle exec pod install');
    expect(pull).toBeGreaterThan(-1);
    expect(check).toBeGreaterThan(pull);
    expect(pods).toBeGreaterThan(check);
  });

  it.each(iosBuilds)('%s caches the LFS objects by their ids', f => {
    expect(read(f)).toMatch(/path: proofport-app\/\.git\/lfs\s+key: mopro-lfs-\$\{\{ hashFiles\('mopro-lfs-ids\.txt'\) \}\}/);
  });

  it('the check script exists and is executable', () => {
    const script = path.join(__dirname, '..', '..', 'scripts', 'check-mopro-ios-symbols.sh');
    expect(fs.statSync(script).mode & 0o111).not.toBe(0);
  });
});

describe('a gh release download still names its repository', () => {
  const downloads = (body: string) =>
    [...body.matchAll(/gh release download[\s\S]*?(?=\n\s*\n|\n\s{0,10}[a-z-]+:|$)/g)].map(m => m[0]);
  it.each(workflows)('%s', f => {
    for (const call of downloads(read(f))) expect(call).toMatch(/--repo\s/);
  });
});
