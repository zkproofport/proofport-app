/**
 * Every build that reaches a store has the OpenStoa mini-app switched off.
 *
 * This was checked by eye and reported as verified. Eyes do not survive into
 * the next session, and the switch is invisible from the outside: an app with
 * the mini-app ON looks perfectly healthy, it just has a sixth tab and a whole
 * feature nobody meant to ship. Worse, the Play Data safety answers
 * (docs/app/play-data-safety-answers.md) say the app collects nothing on the
 * grounds that chat, photo picking and notifications are unreachable. Ship the
 * mini-app on and that declaration becomes a false statement to Google.
 *
 * The two platforms turn it off by different means, so both are checked:
 *
 *   iOS      the release lanes pass OPENSTOA_ENABLED=false on the build
 *            command, and Info.plist forwards it into the bundle.
 *   Android  each flavor sets an `openstoa_enabled` string resource, and the
 *            native module hands it to JS.
 *
 * The default when the value is absent is ON (`!== 'false'` in
 * src/config/features.ts), which is the right default for a developer running
 * from source and the dangerous one for a release. That asymmetry is exactly
 * why the release paths must state it rather than rely on a default.
 */
import fs from 'node:fs';
import path from 'node:path';

const repo = path.join(__dirname, '..', '..');
const read = (...p: string[]) => fs.readFileSync(path.join(repo, ...p), 'utf8');

const iosLanes = read('ios', 'fastlane', 'Fastfile');
const infoPlist = read('ios', 'ProofportApp', 'Info.plist');
const gradle = read('android', 'app', 'build.gradle');
const features = read('src', 'config', 'features.ts');

/** The body of one Android product flavor. */
function flavor(name: string): string {
  const start = gradle.indexOf(`        ${name} {`);
  if (start === -1) return '';
  return gradle.slice(start, gradle.indexOf('\n        }', start));
}

describe('the mini-app is off in everything that ships', () => {
  it('both iOS release lanes state it, rather than trusting a default', () => {
    // Two lanes build for a store — the TestFlight one and the App Store one.
    // One of them saying it is not enough.
    const stated = iosLanes.match(/OPENSTOA_ENABLED=false/g) ?? [];
    expect(stated.length).toBeGreaterThanOrEqual(2);
  });

  it('no iOS lane turns it on', () => {
    expect(iosLanes).not.toMatch(/OPENSTOA_ENABLED=true/);
  });

  it('the iOS bundle carries the value through', () => {
    // Passing it on the build command achieves nothing unless Info.plist
    // forwards it — the native module reads the bundle, not the command.
    expect(infoPlist).toContain('<key>OpenStoaEnabled</key>');
    expect(infoPlist).toMatch(/\$\(OPENSTOA_ENABLED\)/);
  });

  it('the Android flavors that ship have it off', () => {
    for (const name of ['production', 'staging']) {
      expect(flavor(name)).toMatch(/openstoa_enabled",\s*"false"/);
    }
  });

  it('only the development flavor has it on', () => {
    expect(flavor('development')).toMatch(/openstoa_enabled",\s*"true"/);
    // And the flavor lookup is not silently returning nothing: a typo in the
    // name above would make every check here pass against an empty string.
    expect(flavor('production').length).toBeGreaterThan(0);
    expect(flavor('development').length).toBeGreaterThan(0);
  });

  it('absent still means on, which is why the release paths must say it', () => {
    // If this ever flips to "absent means off", the checks above stop being
    // load-bearing and the comment at the top of this file becomes wrong.
    expect(features).toMatch(/!==\s*'false'/);
  });
});
