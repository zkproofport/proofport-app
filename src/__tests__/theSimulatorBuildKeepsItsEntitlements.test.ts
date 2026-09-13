/**
 * Manual code signing is for DEVICE builds. A simulator build has no profile.
 *
 * `fastlane match` is set up through `update_code_signing_settings(
 * use_automatic_signing: false, ...)`, which writes CODE_SIGN_STYLE,
 * CODE_SIGN_IDENTITY and PROVISIONING_PROFILE_SPECIFIER into EVERY build
 * configuration with no SDK condition. Device builds need exactly that.
 * Simulator builds have no provisioning profile, so the manual settings leave
 * them ad-hoc signed with NO entitlements — and `keychain-access-groups` never
 * reaches the binary.
 *
 * What that cost: Google Sign-In failed on the simulator with
 * `keychain error (code=-2)`, and the recovery path re-opened the sign-in
 * sheet, so a person completed the Google flow twice and still got an error.
 * TestFlight was unaffected, which is why it went unnoticed from 2026-08-22
 * until 2026-09-12 — and the app reported every sign-in failure as "cancelled",
 * so the message named nothing.
 *
 * Before that commit the project had `CODE_SIGN_IDENTITY[sdk=iphoneos*]` and
 * no manual style at all. The scoping is what this guards.
 */
import * as fs from 'fs';
import * as path from 'path';

const IOS = path.resolve(__dirname, '..', '..', 'ios');
const project = () =>
  fs.readFileSync(path.join(IOS, 'ProofportApp.xcodeproj', 'project.pbxproj'), 'utf8');
const fastfile = () => fs.readFileSync(path.join(IOS, 'fastlane', 'Fastfile'), 'utf8');

const DEVICE_ONLY_KEYS = [
  'CODE_SIGN_STYLE',
  'CODE_SIGN_IDENTITY',
  'PROVISIONING_PROFILE_SPECIFIER',
];

describe('the simulator build keeps its entitlements', () => {
  it.each(DEVICE_ONLY_KEYS)('%s is set for iphoneos only', key => {
    const src = project();
    // The unconditional form is `KEY = value;` at the start of a line, with no
    // [sdk=...] qualifier. Searched as plain text rather than a regex: the
    // first version of this check built the pattern in a template literal and
    // the escaping collapsed to "a backslash followed by s", which matches
    // nothing in a project file. It passed while the setting was wrong.
    const offending = src
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.startsWith(`${key} = `));
    expect(offending).toEqual([]);
  });

  it('still signs device builds with the match profiles', () => {
    const src = project();
    expect(src).toContain('"CODE_SIGN_STYLE[sdk=iphoneos*]" = Manual');
    expect(src).toContain('match Development com.masselabs.zkproofport');
  });

  it('declares the keychain group the sign-in SDK needs', () => {
    const entitlements = fs.readFileSync(
      path.join(IOS, 'ProofportApp', 'ProofportApp.entitlements'),
      'utf8',
    );
    expect(entitlements).toContain('keychain-access-groups');
  });

  it('puts the scoping back after every fastlane signing rewrite', () => {
    // fastlane rewrites the project on each run; without this the fix lasts
    // exactly until the next build and the simulator breaks again silently.
    const ff = fastfile();
    const rewrites = (ff.match(/update_code_signing_settings\(/g) ?? []).length;
    const restores = (ff.match(/scope_signing_to_device\(/g) ?? []).length;
    expect(rewrites).toBeGreaterThan(0);
    // One definition plus one call after each group of rewrites.
    expect(restores).toBeGreaterThanOrEqual(3);
    expect(ff).toContain('def scope_signing_to_device');
  });
});
