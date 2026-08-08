/**
 * Build-time feature flags, supplied by the BUILD, not by editing this file.
 *
 * These used to be constants here, so shipping an Android build without the
 * mini-app meant editing source, building, and remembering to put the value
 * back. Forgetting that last step silently changed the next build of the other
 * platform — the two ship independently and want different answers.
 *
 * They now travel the same road as `APP_ENV`:
 *   Android  flavor `resValue` → string resource → AppEnvModule → here
 *   iOS      build setting → Info.plist → AppEnvModule → here
 */
import {NativeModules} from 'react-native';

/**
 * When true (the default), the embedded OpenStoa mini-app is available:
 *   - the 4th bottom tab is the OpenStoa tab
 *   - proof History lives under the "More" menu
 *
 * When false, OpenStoa is fully removed:
 *   - the 4th bottom tab is the History (proof log) tab, as it was originally
 *   - the History row is removed from "More" (it is now a top-level tab)
 *
 * A missing or unrecognised value means ENABLED — the behaviour every build had
 * before this became configurable. A build that forgets to set it keeps the
 * feature rather than quietly dropping it.
 */
export const OPENSTOA_ENABLED: boolean =
  String(NativeModules.AppEnv?.OPENSTOA_ENABLED ?? '').toLowerCase() !== 'false';
