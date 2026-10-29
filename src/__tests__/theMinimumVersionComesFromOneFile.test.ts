/**
 * Contract for the force-update check: the app reads exactly one URL, that URL
 * is the published copy of the file in this repository, and the file in this
 * repository is one the app accepts — without blocking the version it ships in.
 *
 * If the path, branch or repository changes, every installed app keeps reading
 * the old address, so a change here is a change for every version in the field.
 */
import * as fs from 'fs';
import * as path from 'path';
import {MIN_VERSION_URL, checkMinimumVersion, parseMinVersionFile, parseVersion, compareVersions, type Version} from '../utils/forceUpdate';

const APP_ROOT = path.resolve(__dirname, '..', '..');
const FILE = path.join(APP_ROOT, 'app-config', 'min-version.json');

describe('the minimum-version file', () => {
  it('is read from exactly this address', () => {
    expect(MIN_VERSION_URL).toBe(
      'https://raw.githubusercontent.com/zkproofport/proofport-app/main/app-config/min-version.json',
    );
  });

  it('names a file that exists in this repository at that path', () => {
    expect(MIN_VERSION_URL.endsWith('/main/app-config/min-version.json')).toBe(true);
    expect(fs.existsSync(FILE)).toBe(true);
  });

  it('calls fetch with that address and nothing else', async () => {
    const fetch = jest.fn(async () => ({ok: true, status: 200, text: async () => fs.readFileSync(FILE, 'utf8')}));
    await checkMinimumVersion({
      fetch,
      storage: {getItem: async () => null, setItem: async () => undefined},
      platform: 'ios',
      runningVersion: '1.4.0',
      now: () => 0,
      url: MIN_VERSION_URL,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((fetch.mock.calls[0] as unknown[])[0]).toBe(MIN_VERSION_URL);
  });

  it.each(['ios', 'android'] as const)('is valid for %s and does not block the version in package.json', platform => {
    const result = parseMinVersionFile(fs.readFileSync(FILE, 'utf8'), platform);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const shipping = parseVersion(JSON.parse(fs.readFileSync(path.join(APP_ROOT, 'package.json'), 'utf8')).version) as Version;
    const minimum = parseVersion(result.rule.minimum) as Version;
    expect(compareVersions(shipping, minimum)).toBeGreaterThanOrEqual(0);
  });

  // The running app compares its NATIVE version (expo-application
  // nativeApplicationVersion), not package.json, so the native numbers are
  // the ones a minimum must not exceed.
  it('does not block the native version this tree builds (iOS MARKETING_VERSION, Android versionName)', () => {
    const json = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    const pbxproj = fs.readFileSync(path.join(APP_ROOT, 'ios', 'ProofportApp.xcodeproj', 'project.pbxproj'), 'utf8');
    const gradle = fs.readFileSync(path.join(APP_ROOT, 'android', 'app', 'build.gradle'), 'utf8');
    const ios = [...pbxproj.matchAll(/MARKETING_VERSION = ([^;]+);/g)].map(m => m[1].trim());
    const android = [...gradle.matchAll(/versionName "([^"]+)"/g)].map(m => m[1]);
    expect(ios.length).toBeGreaterThan(0);
    expect(android.length).toBeGreaterThan(0);
    for (const [platform, versions] of [['ios', ios], ['android', android]] as const) {
      const minimum = parseVersion(json[platform].minimum) as Version;
      for (const v of versions) {
        const native = parseVersion(v);
        expect(native).not.toBeNull();
        expect(compareVersions(native as Version, minimum)).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('carries a message in both languages', () => {
    const json = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    expect(typeof json.message.ko).toBe('string');
    expect(typeof json.message.en).toBe('string');
    expect(json.message.ko).not.toBe(json.message.en);
  });

  it('is only overridden behind __DEV__, on iOS', () => {
    const hook = fs.readFileSync(path.join(APP_ROOT, 'src', 'hooks', 'useForceUpdate.ts'), 'utf8');
    expect(hook).toMatch(/if \(__DEV__ && Platform\.OS === 'ios'\) \{/);
    // The only other place the URL is chosen.
    expect(hook.match(/return MIN_VERSION_URL;/g)).toHaveLength(1);
  });
});
