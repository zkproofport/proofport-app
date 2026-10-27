/**
 * Runs the minimum-version check (src/utils/forceUpdate.ts) at launch and on
 * every return to the foreground once the last good answer is older than the
 * TTL. A check that could not read the file leaves the cache stale, so the next
 * foreground tries again — nothing waits for the person to relaunch.
 *
 * The verdict is also kept at module level (`isUpdateRequired`) so the deep
 * link handler in App.tsx can refuse a proof request while the app is blocked.
 */
import {useEffect, useRef, useState} from 'react';
import {AppState, Platform, Settings} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import {
  MIN_VERSION_URL,
  checkMinimumVersion,
  isCacheStale,
  updatePlatformOf,
  type CachedRule,
  type ForceUpdateDeps,
  type MinVersionRule,
} from '../utils/forceUpdate';

export type ForceUpdateState =
  | {status: 'checking'}
  | {status: 'allowed'}
  | {status: 'blocked'; rule: MinVersionRule};

let blockedRule: MinVersionRule | null = null;

/** True while the running version is below the minimum. Read by App.tsx's deep link handler. */
export function isUpdateRequired(): boolean {
  return blockedRule !== null;
}

/**
 * __DEV__ ONLY: an iOS launch argument pointing the check at another file, for
 * seeing the blocking screen on a simulator without changing the real one:
 *
 *   xcrun simctl launch <udid> com.masselabs.zkproofport -ZKPMinVersionUrl http://127.0.0.1:8765/min-version.json
 *
 * Launch arguments land in NSUserDefaults, which `Settings` reads. A release
 * build never looks: `__DEV__` is false there and Metro strips the branch.
 */
export const DEV_MIN_VERSION_URL_ARG = 'ZKPMinVersionUrl';

function minVersionUrl(): string {
  if (__DEV__ && Platform.OS === 'ios') {
    const override = Settings.get(DEV_MIN_VERSION_URL_ARG);
    if (typeof override === 'string' && override !== '') {
      console.log(`[ForceUpdate] __DEV__ override: reading ${override} instead of ${MIN_VERSION_URL}`);
      return override;
    }
  }
  return MIN_VERSION_URL;
}

export function defaultForceUpdateDeps(): ForceUpdateDeps {
  return {
    fetch: (url, init) => fetch(url, init),
    storage: AsyncStorage,
    platform: updatePlatformOf(Platform.OS),
    // The NATIVE version only. `getVersion()` falls back to package.json,
    // which is the source tree's number, not the binary's.
    runningVersion: Application.nativeApplicationVersion,
    now: () => Date.now(),
    url: minVersionUrl(),
  };
}

export function useForceUpdate(makeDeps: () => ForceUpdateDeps = defaultForceUpdateDeps): ForceUpdateState {
  const [state, setState] = useState<ForceUpdateState>({status: 'checking'});
  const inFlight = useRef<Promise<void> | null>(null);
  const cached = useRef<CachedRule | null>(null);
  const makeDepsRef = useRef(makeDeps);

  useEffect(() => {
    let mounted = true;

    const run = (): Promise<void> => {
      // One check at a time: two foreground events in a row share it.
      if (inFlight.current) return inFlight.current;
      const attempt = (async () => {
        try {
          const outcome = await checkMinimumVersion(makeDepsRef.current());
          cached.current = outcome.cached;
          if (outcome.decision.kind === 'block') {
            blockedRule = outcome.decision.rule;
            if (mounted) setState({status: 'blocked', rule: outcome.decision.rule});
          } else {
            blockedRule = null;
            if (mounted) setState({status: 'allowed'});
          }
        } catch (error) {
          // Only an unknown platform reaches here (updatePlatformOf). The check
          // cannot run, and per the policy in forceUpdate.ts that allows.
          console.error('[ForceUpdate] Check could not run:', error);
          if (mounted) setState(prev => (prev.status === 'checking' ? {status: 'allowed'} : prev));
        } finally {
          inFlight.current = null;
        }
      })();
      inFlight.current = attempt;
      return attempt;
    };

    run();

    const subscription = AppState.addEventListener('change', next => {
      if (next !== 'active') return;
      if (!isCacheStale(cached.current, Date.now())) return;
      run();
    });
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, []);

  return state;
}
