/**
 * useAppStateReset - Auto-reset app state when returning from background after timeout
 *
 * When the app has been in background for longer than STALE_THRESHOLD_MS,
 * all pending proof requests and transient state are cleared to prevent
 * stale requests from being processed with outdated callback URLs.
 */

import {useEffect, useRef, useCallback} from 'react';
import {AppState, AppStateStatus} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// 10 minutes in milliseconds - requests older than this are considered stale
const STALE_THRESHOLD_MS = 10 * 60 * 1000;

// AsyncStorage key for tracking background timestamp
const BACKGROUND_TIMESTAMP_KEY = '@zkproofport:app:backgroundTimestamp';

interface UseAppStateResetOptions {
  /** Callback when app state should be reset due to stale timeout */
  onReset: () => void;
  /** Optional custom threshold in milliseconds (default: 5 minutes) */
  thresholdMs?: number;
}

export function useAppStateReset({
  onReset,
  thresholdMs = STALE_THRESHOLD_MS,
}: UseAppStateResetOptions) {
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  const handleAppStateChange = useCallback(
    async (nextAppState: AppStateStatus) => {
      const previousState = appStateRef.current;

      // App going to background - save timestamp
      if (
        previousState === 'active' &&
        (nextAppState === 'background' || nextAppState === 'inactive')
      ) {
        const now = Date.now();
        console.log('[AppStateReset] App going to background, saving timestamp:', now);
        await AsyncStorage.setItem(BACKGROUND_TIMESTAMP_KEY, now.toString());
      }

      // App coming to foreground - check if stale
      if (
        (previousState === 'background' || previousState === 'inactive') &&
        nextAppState === 'active'
      ) {
        console.log('[AppStateReset] App coming to foreground, checking staleness...');

        try {
          const savedTimestamp = await AsyncStorage.getItem(BACKGROUND_TIMESTAMP_KEY);
          if (savedTimestamp) {
            const backgroundTime = parseInt(savedTimestamp, 10);
            const now = Date.now();
            const elapsedMs = now - backgroundTime;

            console.log(
              `[AppStateReset] Was in background for ${Math.round(elapsedMs / 1000)}s (threshold: ${Math.round(thresholdMs / 1000)}s)`,
            );

            if (elapsedMs > thresholdMs) {
              console.log('[AppStateReset] State is stale, triggering reset...');
              onReset();
            }

            // Clear the timestamp after checking
            await AsyncStorage.removeItem(BACKGROUND_TIMESTAMP_KEY);
          }
        } catch (error) {
          console.error('[AppStateReset] Error checking background timestamp:', error);
        }
      }

      appStateRef.current = nextAppState;
    },
    [onReset, thresholdMs],
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', handleAppStateChange);

    return () => {
      subscription.remove();
    };
  }, [handleAppStateChange]);
}

export default useAppStateReset;
