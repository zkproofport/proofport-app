/**
 * Which OpenStoa origin this build talks to.
 *
 * Lifted out of `OpenStoaRootScreen` because a SECOND caller appeared that runs
 * before that screen ever mounts: the tab bar refreshes the unread badge at
 * launch, and a badge whose job is to say "there is something in there" cannot
 * wait for someone to open the thing. Two copies of this resolution would be
 * two ways to point at different servers, and the symptom — a badge counting a
 * different environment's rooms — would be baffling.
 */
import { Platform } from 'react-native';
import { getEnvironment } from '../config';

// Mirror the host's 3-way environment split so the mini-app and the host
// always point at the same backend tier:
//   development → LOCAL community (docker on the dev machine) so in-app chat
//                 exercises the code currently being developed. iOS simulator
//                 reaches the host via localhost; the Android emulator reaches
//                 it via the special 10.0.2.2 alias. (A physical device would
//                 need the host LAN IP instead.)
//   staging     → staging community
//   production  → canonical openstoa.xyz
export function resolveOpenStoaBaseUrl(): string {
  const env = getEnvironment();
  // A Metro-connected debug build (__DEV__) ALWAYS targets the LOCAL community
  // backend so in-app chat / key-recovery exercises the code under development —
  // even on a physical device, where getEnvironment() reports 'production'. We
  // derive the dev machine's address from Metro's bundle URL: on a physical
  // device that host is the Mac's LAN IP (127.0.0.1 would be the phone itself);
  // the Android emulator uses the 10.0.2.2 alias; the iOS simulator is 127.0.0.1.
  if (__DEV__) {
    /*
     * ASK METRO WHERE IT IS, on both platforms.
     *
     * Android used to return the `10.0.2.2` emulator alias unconditionally,
     * two lines under a comment saying a physical device needs the Mac's LAN
     * IP. On a phone that alias means nothing, so a debug build on real
     * hardware could not reach the local backend at all — every request failed
     * and the only way to exercise chat against local code was an emulator.
     *
     * Metro already knows the answer: the bundle it served came from a URL, and
     * that URL's host is reachable from whatever downloaded it. Reading it
     * covers the phone, the emulator and the simulator with one rule instead of
     * three guesses.
     *
     * RN 0.81 New Architecture (bridgeless): `NativeModules.SourceCode` is
     * unreliable/undefined, so this uses `getDevServer()` (TurboModule-backed).
     */
    let host: string | null = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const getDevServer = require('react-native/Libraries/Core/Devtools/getDevServer').default;
      const url: string | undefined = getDevServer?.()?.url;
      const m = url ? url.match(/^https?:\/\/([^:/]+)/) : null;
      if (m && m[1]) host = m[1];
    } catch {
      // No dev server to ask — fall through to the per-platform default.
    }

    /*
     * KEEP WHATEVER METRO SAID, loopback included.
     *
     * Rewriting loopback to `10.0.2.2` was a second guess on top of the first,
     * and it broke the case it was meant to help: a phone attached over USB
     * with `adb reverse tcp:8081` sees Metro at `localhost`, and the backend
     * reversed the same way is at `localhost:3200` — the alias is meaningless
     * there and the requests went nowhere.
     *
     * The rewrite was not needed for the emulator either. An emulator reaches
     * Metro THROUGH the alias, so `getDevServer()` already reports
     * `10.0.2.2:8081` and this returns `10.0.2.2:3200` on its own.
     *
     * So there is one rule and no guessing: whatever host served the bundle is
     * the host that serves the backend. The per-platform default below applies
     * only when there is no dev server to ask.
     */
    if (!host) {
      host = Platform.OS === 'android' ? '10.0.2.2' : '127.0.0.1';
    }
    return `http://${host}:3200`;
  }
  if (env === 'production') return 'https://www.openstoa.xyz';
  if (env === 'staging') return 'https://stg-community.zkproofport.app';
  return Platform.OS === 'android' ? 'http://10.0.2.2:3200' : 'http://127.0.0.1:3200';
}
