/**
 * The next build number is asked of TestFlight, not read out of the repository.
 *
 * Apple rejects a build whose number has been used before, and the numbers in
 * this repository do not track what has been uploaded: on 2026-08-30 the
 * project said 1, Info.plist said 2, and TestFlight held build 3. Any scheme
 * that counted from a checked-in value would have produced a duplicate on the
 * next upload — a twenty-nine minute build, then a rejection that names only
 * the collision and not the cause.
 *
 * So the lane asks TestFlight for the highest build it has and adds one. The
 * repository's own numbers are then free to be stale, which they are and which
 * is fine. That is worth pinning precisely BECAUSE the stale values look like
 * bugs: someone tidying them up would not break anything, and someone "fixing"
 * the lane to use them would break every release after the first.
 */
import fs from 'node:fs';
import path from 'node:path';

const lanes = fs.readFileSync(
  path.join(__dirname, '..', '..', 'ios', 'fastlane', 'Fastfile'),
  'utf8',
);

/** The `increment_build_number(...)` call, brackets balanced. */
function incrementCall(): string {
  const start = lanes.indexOf('increment_build_number(');
  if (start === -1) return '';
  let depth = 0;
  let i = start + 'increment_build_number'.length;
  for (; i < lanes.length; i++) {
    if (lanes[i] === '(') depth++;
    else if (lanes[i] === ')' && --depth === 0) break;
  }
  return lanes.slice(start, i + 1);
}

describe('the build number cannot collide with one already uploaded', () => {
  it('there is a build-number call to inspect at all', () => {
    // Without this, every check below passes against an empty string.
    expect(incrementCall().length).toBeGreaterThan(0);
  });

  it('it asks TestFlight for the highest build and adds one', () => {
    expect(incrementCall()).toMatch(/latest_testflight_build_number\([^)]*\)\s*\+\s*1/);
  });

  it('an explicit build number can still be forced from the environment', () => {
    // Re-uploading a specific number is a real need when a run half-fails.
    // It must come first, so the override actually overrides.
    const call = incrementCall();
    expect(call).toMatch(/ENV\['BUILD_NUMBER'\]\s*\|\|/);
  });

  it('nothing feeds the project or plist value in as the source', () => {
    // `get_build_number` / `get_version_number` read the checked-in values,
    // which are stale by design here.
    const call = incrementCall();
    expect(call).not.toMatch(/get_build_number/);
    expect(call).not.toMatch(/get_info_plist_value/);
  });
});
