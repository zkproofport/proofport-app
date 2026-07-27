/**
 * withOpenStoaNSE — Expo config plugin for the E2EE chat push wiring (design §13 /
 * §13.5): the iOS Notification Service Extension (Phase B ciphertext decrypt) and
 * the SHARED Keychain access group the NSE needs to read the app's E2EE keys.
 *
 * WHAT THIS PLUGIN DOES AUTOMATICALLY (on `expo prebuild -p ios`):
 *   - Appends the SHARED Keychain access group
 *     `$(AppIdentifierPrefix)com.zkproofport.app.openstoa` to the HOST app
 *     entitlements. Prebuild regenerates `ios/ProofportApp/ProofportApp.entitlements`
 *     from scratch, so without this mod the manually-committed shared group would
 *     be LOST on every prebuild and the NSE could no longer read the E2EE keys.
 *
 * WHAT IS HANDLED ELSEWHERE:
 *   - `remote-notification` in `UIBackgroundModes` + the expo-notifications runtime
 *     are added by the `expo-notifications` plugin in app.json
 *     (`enableBackgroundRemoteNotifications: true`).
 *   - `aps-environment` (APNs entitlement) is added by enabling the "Push
 *     Notifications" capability at device-build time (it is environment-specific —
 *     `development` for debug, `production` for TestFlight/App Store — and is best
 *     driven by the Xcode capability / EAS credentials rather than hardcoded here).
 *
 * REMAINING MANUAL NATIVE STEPS (device build — auto-creating a native Xcode
 * target from a config plugin needs a dedicated target plugin such as
 * `@bacons/apple-targets`; that is out of scope here, so the NSE TARGET itself is
 * still registered by hand once):
 *   1. Add a "Notification Service Extension" target named `OpenStoaNSE`
 *      (bundle id `com.zkproofport.app.OpenStoaNSE`) to ProofportApp.xcodeproj.
 *      Its sources are the committed `ios/OpenStoaNSE/NotificationService.swift`
 *      + `ios/OpenStoaNSE/Info.plist`.
 *   2. Set the target's Code Signing Entitlements to
 *      `ios/OpenStoaNSE/OpenStoaNSE.entitlements` (already committed) — it declares
 *      the SAME shared Keychain access group this plugin appends to the host.
 *   3. Enable the "Push Notifications" capability on the host target (adds
 *      `aps-environment`) and regenerate provisioning profiles (host + NSE) so both
 *      include the shared Keychain group and APNs entitlement.
 *   4. Point the mini-app's E2EE key writes at the shared group (pass the matching
 *      `keychainAccessGroup` to expo-secure-store when persisting MLS / TAK keys)
 *      so the NSE can read them read-only (design §13.6 — NSE never ratchets).
 *
 * SAFETY: config plugins run ONLY during `expo prebuild` / `expo config`, never in
 * the Metro/JS bundle or a plain `react-native run-ios`. So this mod cannot affect
 * the current bare-workflow build; it only takes effect when the user opts into
 * prebuild (the documented device path).
 */

const { withEntitlementsPlist } = require('@expo/config-plugins');

const SHARED_KEYCHAIN_GROUP = 'com.zkproofport.app.openstoa';
const NSE_TARGET_NAME = 'OpenStoaNSE';
const NSE_BUNDLE_ID = 'com.zkproofport.app.OpenStoaNSE';

/**
 * Ensure the shared Keychain access group survives prebuild by appending it to the
 * host app's `keychain-access-groups` entitlement (idempotent — never duplicates).
 * @param {object} config Expo config
 * @returns {object} config with the entitlement mod queued
 */
function withSharedKeychainGroup(config) {
  return withEntitlementsPlist(config, (cfg) => {
    const KEY = 'keychain-access-groups';
    const existing = Array.isArray(cfg.modResults[KEY]) ? cfg.modResults[KEY] : [];
    const entry = `$(AppIdentifierPrefix)${SHARED_KEYCHAIN_GROUP}`;
    cfg.modResults[KEY] = existing.includes(entry) ? existing : [...existing, entry];
    return cfg;
  });
}

/**
 * @param {object} config Expo config
 * @returns {object} config
 */
function withOpenStoaNSE(config) {
  return withSharedKeychainGroup(config);
}

module.exports = withOpenStoaNSE;
module.exports.SHARED_KEYCHAIN_GROUP = SHARED_KEYCHAIN_GROUP;
module.exports.NSE_TARGET_NAME = NSE_TARGET_NAME;
module.exports.NSE_BUNDLE_ID = NSE_BUNDLE_ID;
