/**
 * In the shipping build, the camera is the only permission prompt a person
 * can reach.
 *
 * Info.plist declares five purpose strings, and on 2026-08-30 that list was
 * misread as the list of prompts users see. It is not. Photo library and
 * notifications are requested only by the OpenStoa mini-app, which ships
 * switched off; location is never requested at all, and its string exists
 * because two dependencies link CoreLocation (see
 * everySensitiveApiHasItsReason.test.ts). Reading the declarations and
 * reporting them as behaviour produced a false alarm — that the Korean store
 * listing was lying when it said no other device permissions are needed.
 *
 * That listing sentence is only true while this stays true. So pin it: nothing
 * in the host app asks for photos or notifications. The mini-app bridge under
 * src/openstoa-host/ is allowed to, because it only runs when the mini-app is
 * turned on.
 *
 * If this test goes red, the store copy needs rewriting in the same change.
 */
import fs from 'node:fs';
import path from 'node:path';

const src = path.join(__dirname, '..');
/** The mini-app bridge. Off in release builds, so its prompts are unreachable. */
const MINI_APP_BRIDGE = path.join(src, 'openstoa-host');

/** Every source file in the host app, excluding tests and the mini-app bridge. */
function hostAppFiles(dir: string, found: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === '__mocks__') continue;
      if (full === MINI_APP_BRIDGE) continue;
      hostAppFiles(full, found);
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

/** What each call would make iOS put on screen. */
const PROMPTS = [
  ['requestMediaLibraryPermissionsAsync', 'the photo library prompt'],
  ['launchImageLibraryAsync', 'the photo library prompt'],
  ['requestPermissionsAsync', 'the notification prompt'],
  ['requestAuthorization', 'the notification prompt'],
] as const;

const files = hostAppFiles(src);

describe('the host app raises no permission prompt but the camera', () => {
  it('finds host-app source to read in the first place', () => {
    // A path typo would empty the list and turn every check below green.
    expect(files.length).toBeGreaterThan(50);
  });

  it.each(PROMPTS)('no host-app file calls %s, which would raise %s', (call) => {
    const callers = files.filter((f) => fs.readFileSync(f, 'utf8').includes(call));
    expect(callers.map((f) => path.relative(src, f))).toEqual([]);
  });

  it('the mini-app bridge is where those calls actually live', () => {
    // Proves the exclusion above is carrying real weight rather than
    // excluding an empty directory.
    const bridge = fs
      .readdirSync(MINI_APP_BRIDGE)
      .filter((n) => /\.tsx?$/.test(n) && !/\.test\.tsx?$/.test(n))
      .map((n) => fs.readFileSync(path.join(MINI_APP_BRIDGE, n), 'utf8'))
      .join('\n');
    expect(bridge).toContain('requestPermissionsAsync');
  });
});
