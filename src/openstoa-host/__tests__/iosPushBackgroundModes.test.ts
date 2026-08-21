/**
 * CONTRACT test for the iOS push Info.plist keys.
 *
 * This exists because the key it pins was missing for months and nothing could
 * tell: `ios/ProofportApp/Info.plist` had no `UIBackgroundModes` at all, so iOS
 * never woke the app for the `aps.content-available = 1` the OpenStoa server
 * sets on every chat push (openstoa/src/lib/pushProvider.ts). The reason it was
 * missing is the reason it will go missing again — app.json configures
 * `expo-notifications` with `enableBackgroundRemoteNotifications: true`, which
 * LOOKS like it covers this, but that plugin only runs under `expo prebuild`,
 * and this is a bare project with a committed `ios/` that never prebuilds. Any
 * regeneration, merge, or "clean up the plist" pass can drop the key silently.
 *
 * It asserts on the SOURCE plist, not on a build artefact: a build artefact is
 * absent on a fresh checkout and stale everywhere else, so a test against one
 * would pass while shipping the bug.
 *
 * Edge-case matrix rows:
 *   contract  — `remote-notification` present in the host, and the app.json
 *               declaration that fools readers is still there to be explained
 *   boundary  — key absent, key present but an EMPTY array, and key present
 *               with other modes but not this one, all fail
 *   integrity — the plist parses as real XML plist (a hand-edit that corrupts
 *               it fails here rather than at `xcodebuild` time)
 *   N/A       — hostile input, UTF-8, large input, authz, race: this is a
 *               static repo file with no runtime input surface
 */
import fs from 'fs';
import path from 'path';
// @expo/plist is what the expo tooling itself parses plists with, so the test
// agrees with the build about what the file means. A real parse (not a regex)
// is what makes the "valid XML" row above meaningful.
const plist = require('@expo/plist').default as { parse(xml: string): unknown };

const IOS_DIR = path.resolve(__dirname, '../../../ios');
const HOST_PLIST = path.join(IOS_DIR, 'ProofportApp/Info.plist');
const NSE_PLIST = path.join(IOS_DIR, 'OpenStoaNSE/Info.plist');
const APP_JSON = path.resolve(__dirname, '../../../app.json');

function readPlist(file: string): Record<string, unknown> {
  const raw = fs.readFileSync(file, 'utf8');
  const parsed = plist.parse(raw);
  expect(typeof parsed).toBe('object');
  return parsed as Record<string, unknown>;
}

describe('ios/ProofportApp/Info.plist — background push', () => {
  it('SOURCE plist declares UIBackgroundModes with remote-notification', () => {
    const parsed = readPlist(HOST_PLIST);
    const modes = parsed.UIBackgroundModes;
    // Spelled out so the failure message says what to do, not just "expected
    // undefined to be an array".
    expect(Array.isArray(modes)).toBe(true);
    expect(modes as string[]).toContain('remote-notification');
  });

  it('boundary: an empty or unrelated UIBackgroundModes array does NOT satisfy it', () => {
    // Pins the assertion itself: membership, never mere presence of the key.
    const check = (modes: unknown) =>
      Array.isArray(modes) && (modes as string[]).includes('remote-notification');
    expect(check(undefined)).toBe(false);
    expect(check([])).toBe(false);
    expect(check(['audio', 'fetch'])).toBe(false);
    expect(check(['remote-notification'])).toBe(true);
  });

  it('the key lives in the file xcodebuild copies, not a generated artefact', () => {
    // If someone "fixes" this by editing ios/build/**, the source is untouched
    // and a clean build ships without it — so assert on the tracked path.
    expect(fs.existsSync(HOST_PLIST)).toBe(true);
    expect(HOST_PLIST).toContain(path.join('ios', 'ProofportApp', 'Info.plist'));
    expect(HOST_PLIST).not.toContain(`${path.sep}build${path.sep}`);
    expect(fs.readFileSync(HOST_PLIST, 'utf8')).toContain('remote-notification');
  });

  it('the NSE needs NO counterpart — UIBackgroundModes is a host-app-only key', () => {
    // A UNNotificationServiceExtension is woken by `aps.mutable-content = 1`.
    // Copying the key into the appex does nothing and invites the wrong mental
    // model, so its ABSENCE is part of the contract.
    const parsed = readPlist(NSE_PLIST);
    expect(parsed.UIBackgroundModes).toBeUndefined();
    expect((parsed.NSExtension as Record<string, unknown>).NSExtensionPointIdentifier).toBe(
      'com.apple.usernotifications.service',
    );
  });

  it('app.json still declares the plugin that CANNOT deliver this key', () => {
    // Not a redundant assertion: if this ever stops being true, the comment in
    // Info.plist explaining why the key is hand-maintained is stale, and the
    // next reader may "clean up" the duplicate. Fail loudly and re-read both.
    const appJson = JSON.parse(fs.readFileSync(APP_JSON, 'utf8')) as {
      expo: { plugins: unknown[] };
    };
    const entry = appJson.expo.plugins.find(
      (p) => Array.isArray(p) && p[0] === 'expo-notifications',
    ) as [string, { enableBackgroundRemoteNotifications?: boolean }] | undefined;
    expect(entry).toBeDefined();
    expect(entry?.[1]?.enableBackgroundRemoteNotifications).toBe(true);
  });
});
