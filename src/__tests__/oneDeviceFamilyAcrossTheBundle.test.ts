/**
 * The app and everything embedded in it run on the same devices.
 *
 * The notification extension declared iPhone AND iPad while the app itself is
 * iPhone-only. An extension cannot run anywhere its host does not, so the extra
 * device family bought nothing — but it did make the project read as an iPad
 * app to anyone grepping for the setting, which is exactly what happened on
 * 2026-08-29: two lines of `"1,2"` in the project file led to a wrong
 * conclusion that iPad screenshots were blocking the App Store submission.
 * They were the extension's lines. The app resolves to `1`.
 *
 * Whether Apple's upload check rejects the mismatch was not established, so
 * that is not the claim here. The claim is narrower and certainly true: every
 * target in this project should name the same device family, and the file
 * should not be able to imply otherwise at a glance.
 *
 * This reads the project file as text rather than asking xcodebuild, because
 * `-showBuildSettings` takes minutes and this has to be cheap enough to run on
 * every commit.
 */
import fs from 'node:fs';
import path from 'node:path';

const PBXPROJ = 'ios/ProofportApp.xcodeproj/project.pbxproj';
const project = fs.readFileSync(path.join(__dirname, '..', '..', PBXPROJ), 'utf8');

/** Every device-family value in the file, quoted or bare, in file order. */
function declaredDeviceFamilies(): string[] {
  return [...project.matchAll(/TARGETED_DEVICE_FAMILY = "?([0-9,]+)"?;/g)].map((m) => m[1]);
}

describe('device family', () => {
  it('is declared somewhere, so this test cannot pass by finding nothing', () => {
    expect(declaredDeviceFamilies().length).toBeGreaterThan(0);
  });

  it('is iPhone-only in every target that declares it', () => {
    // "1" is iPhone. "2" is iPad, and adding it turns this into an iPad app,
    // which needs iPad screenshots and iPad layout work before it can ship.
    expect([...new Set(declaredDeviceFamilies())]).toEqual(['1']);
  });
});
