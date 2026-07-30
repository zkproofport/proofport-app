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
 * THE NSE TARGET ITSELF (creating a native Xcode target from a config plugin
 * would need a dedicated target plugin such as `@bacons/apple-targets`, which is
 * out of scope here) is registered by a checked-in, idempotent script instead:
 *
 *     ruby ios/scripts/add_nse_target.rb
 *
 * It creates the `OpenStoaNSE` app-extension target (bundle id
 * `com.zkproofport.app.OpenStoaNSE`), compiles every `ios/OpenStoaNSE/*.swift`,
 * points INFOPLIST_FILE / CODE_SIGN_ENTITLEMENTS at the committed files, and
 * embeds the .appex in the host's PlugIns folder. Re-run it after ANY native
 * regeneration that rewrites the pbxproj (including `expo prebuild`); re-running
 * it on an already-wired project is a no-op.
 *
 * WHERE THE KEY COMES FROM (no longer a manual step — do not re-add it as one):
 *   The mini-app mirrors the Topic Archive Key into this shared group itself, in
 *   `openstoa/packages/mobile/src/crypto/sharedKeychain.ts` (`mirrorTakWith`),
 *   called from `screens/chat/ChatRoomScreen.tsx`. It writes base64 of the raw
 *   32-byte TAK under `openstoa.tak.<topicId>.<takVersion>` with accessibility
 *   AFTER_FIRST_UNLOCK — a push can arrive while the device is locked, so the
 *   WhenUnlocked default would be unreadable exactly when the NSE needs it. That
 *   account format and encoding are what `OpenStoaNSE/TakKeychain.swift` reads;
 *   changing either side alone silently reduces every push to the placeholder.
 *
 *   The TAK is mirrored — NOT the MLS group state. Opening a live MLS message
 *   consumes a forward-secret ratchet key, which would desync the host app; the
 *   TAK is a stable symmetric key, so the NSE decrypting with it consumes
 *   nothing (design §13.6 — NSE never ratchets).
 *
 * REMAINING MANUAL STEP (distribution builds only):
 *   Provisioning for `com.zkproofport.app.OpenStoaNSE`. `ios/fastlane/Fastfile`
 *   already matches + signs both bundle ids, but the App ID must exist in the
 *   Apple Developer portal carrying the shared Keychain group, and the profile
 *   must have been generated into the match repo once (`match` runs readonly in
 *   CI and fails if it is absent). Simulator and local device builds are
 *   unaffected.
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
