/**
 * withOpenStoaNSE — Expo config plugin scaffold for the E2EE chat Phase 7 /
 * Phase B iOS Notification Service Extension (design §13.5).
 *
 * ⚠️ Phase 7 device: proofport-app is a BARE React Native project (it commits
 * `ios/` and `android/`), so this config plugin does NOT run automatically —
 * config plugins only apply during `expo prebuild`, which regenerates the native
 * projects and MUST NOT be run here (it would clobber the committed native
 * config). This file therefore documents the exact native wiring; do the steps
 * once, on a device build, then verify on a real device. Do NOT run
 * `expo prebuild`, `pod install`, or `xcodebuild` as part of the scaffold.
 *
 * What the NSE needs (remaining native steps — do in Xcode or a one-off script):
 *   1. Add a new "Notification Service Extension" target named `OpenStoaNSE`
 *      (bundle id `com.zkproofport.app.OpenStoaNSE`) to ProofportApp.xcodeproj.
 *      Its sources are the committed `ios/OpenStoaNSE/NotificationService.swift`
 *      + `ios/OpenStoaNSE/Info.plist`.
 *   2. Set the target's Code Signing Entitlements to
 *      `ios/OpenStoaNSE/OpenStoaNSE.entitlements` (already committed) — it
 *      declares the SHARED Keychain access group
 *      `$(AppIdentifierPrefix)com.zkproofport.app.openstoa`.
 *   3. Confirm the HOST app entitlements
 *      (`ios/ProofportApp/ProofportApp.entitlements`) list the SAME shared group
 *      (already appended). Both targets must share it for the NSE to read the
 *      app's E2EE keys.
 *   4. Provisioning profiles for BOTH the app and the NSE must include the shared
 *      Keychain group. Regenerate them in the Apple Developer portal / via
 *      fastlane match at device-build time.
 *   5. Make the mini-app's E2EE key writes target the shared group: pass the
 *      matching `keychainAccessGroup` to expo-secure-store when persisting MLS /
 *      TAK keys (openstoa `mls.state.<identity>.<topicId>`), so the NSE can read
 *      them read-only (design §13.6 — NSE never ratchets/persists).
 *   6. Enable the APNs "remote notification" background mode + push capability on
 *      the host target (adds `aps-environment` + `UIBackgroundModes`), and add
 *      `expo-notifications` (Phase 6 registerForPush wiring) so the device
 *      obtains a token.
 *
 * When/if proofport-app migrates to Expo prebuild (CNG), THIS plugin becomes the
 * automated form of steps 1-3 via `@config-plugins/ios-widget`-style mods or a
 * custom `withXcodeProject` mod. It is intentionally a no-op passthrough today so
 * that referencing it from app.json neither breaks the JS bundle nor mutates the
 * committed native project.
 */

const SHARED_KEYCHAIN_GROUP = 'com.zkproofport.app.openstoa';
const NSE_TARGET_NAME = 'OpenStoaNSE';
const NSE_BUNDLE_ID = 'com.zkproofport.app.OpenStoaNSE';

/**
 * @param {object} config Expo config
 * @returns {object} unchanged config (documented no-op in the bare workflow)
 */
function withOpenStoaNSE(config) {
  // Intentionally a passthrough in the bare workflow — see the file header for
  // the manual native steps this would automate under Expo prebuild.
  return config;
}

module.exports = withOpenStoaNSE;
module.exports.SHARED_KEYCHAIN_GROUP = SHARED_KEYCHAIN_GROUP;
module.exports.NSE_TARGET_NAME = NSE_TARGET_NAME;
module.exports.NSE_BUNDLE_ID = NSE_BUNDLE_ID;
