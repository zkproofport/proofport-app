/**
 * useCircuitWalletGate
 *
 * Single source of truth for the "which wallet does this circuit use right
 * now?" question. Encodes the truth-table the team agreed on:
 *
 *  P = post-picker (the user just chose a wallet in the system picker)
 *  C = the circuit has a fresh (unexpired) cache entry
 *  W = a wallet is currently connected
 *  M = the connected wallet matches the cached wallet
 *
 *  P  C  W  M  → Action
 *  -  -  -  -    -----------------------------------------------------------
 *  1  *  1  *    Proceed. No confirm. If C && !M, drop stale cache.
 *  1  *  0  -    Picker cancelled → user-visible note, no proof.
 *  0  0  0  -    Open picker, set P=1, exit (auto-retry on connect).
 *  0  0  1  -    Confirm "Use this wallet?". Yes→proceed. No→clear+picker.
 *  0  1  0  -    Reconnect prompt → picker for cached address.
 *  0  1  1  0    Disconnect → reconnect prompt for cached address.
 *  0  1  1  1    Confirm "Use the remembered wallet?". Yes→proceed.
 *                                                       No→clear+picker.
 *
 * On attestation-lookup failure (caller's responsibility) → clearCache +
 * disconnect + picker (P=1).
 */
import {useCallback, useRef, useState, useEffect} from 'react';
import {
  getCircuitWalletEntry,
  setCircuitWallet,
  clearCircuitWallet,
} from '../stores';
import type {CircuitName} from '../config';

export interface CircuitWalletGate {
  /**
   * Resolve a wallet to use for this proof attempt.
   * Returns:
   *  - {address}      : caller should proceed with proof generation using this address.
   *  - 'pending'      : a picker/reconnect is in-flight; do NOT proceed.
   *                     The auto-retry effect will re-invoke runGate() when the
   *                     user finishes interacting with the wallet picker.
   *  - 'cancelled'    : user cancelled; do NOT proceed.
   */
  runGate: (
    circuit: CircuitName,
    circuitDisplayName: string,
  ) => Promise<{address: string} | 'pending' | 'cancelled'>;

  /** Mark a successful proof: persist the binding so next attempt skips the picker. */
  recordSuccess: (circuit: CircuitName, address: string) => Promise<void>;

  /** Mark a failed attestation lookup: drop binding, kick off a new picker. */
  recordLookupFailure: (circuit: CircuitName) => Promise<void>;
}

interface Args {
  account: string | null;
  connectWallet: () => Promise<void>;
  disconnectWallet: () => Promise<void>;
  /** When non-null, the user is expected to reconnect to this exact address. */
  onPending: () => void;
  log: (msg: string) => void;
  /**
   * Called whenever the gate finishes any picker-triggering branch. Caller is
   * expected to subscribe to the wallet `account` and call `runGate` again
   * when a new wallet connects.
   */
}

export function useCircuitWalletGate(args: Args): CircuitWalletGate & {
  /** When the consumer detects that a new wallet has connected, call this to
   *  reset the post-picker latch. */
  consumePostPickerLatch: () => boolean;
  isPostPicker: boolean;
} {
  const {account, connectWallet, disconnectWallet, log} = args;
  const postPickerRef = useRef(false);
  const [postPickerVisible, setPostPickerVisible] = useState(false);

  const setPostPicker = useCallback((on: boolean) => {
    postPickerRef.current = on;
    setPostPickerVisible(on);
  }, []);

  const consumePostPickerLatch = useCallback((): boolean => {
    const prev = postPickerRef.current;
    setPostPicker(false);
    return prev;
  }, [setPostPicker]);

  const runGate = useCallback(
    async (
      circuit: CircuitName,
      displayName: string,
    ): Promise<{address: string} | 'pending' | 'cancelled'> => {
      const cached = await getCircuitWalletEntry(circuit);
      if (cached?.expired) {
        log(`[Gate] Cache for ${circuit} expired, clearing.`);
        await clearCircuitWallet(circuit);
      }
      const C = cached && !cached.expired ? cached : null;
      const W = account;
      const M = !!(C && W && W.toLowerCase() === C.address.toLowerCase());
      const P = consumePostPickerLatch();

      // --- P=1: post-picker auto-retry → no confirm. -----------------------
      if (P) {
        if (W) {
          if (C && !M) {
            log(`[Gate] Post-picker chose different wallet — dropping stale cache.`);
            await clearCircuitWallet(circuit);
          }
          log(`[Gate] Post-picker proceed with ${W} for ${circuit}.`);
          return {address: W};
        }
        log('[Gate] Post-picker but no wallet — picker cancelled.');
        return 'cancelled';
      }

      // --- P=0, C=0, W=0: open picker. -------------------------------------
      if (!C && !W) {
        log(`[Gate] No binding for ${circuit} and no wallet — opening picker.`);
        setPostPicker(true);
        try {
          await connectWallet();
        } catch (e) {
          log(`[Gate] connect error: ${e instanceof Error ? e.message : e}`);
        }
        return 'pending';
      }

      // --- P=0, C=0, W=1: first-bind. Proceed without confirmation. -------
      if (!C && W) {
        log(`[Gate] First bind for ${circuit} → using connected wallet ${W}.`);
        return {address: W};
      }

      // --- P=0, C=1, W=0: reconnect required. ------------------------------
      if (C && !W) {
        log(`[Gate] Cached wallet ${C.address} for ${circuit} not connected — opening picker.`);
        setPostPicker(true);
        try {
          await connectWallet();
        } catch {}
        return 'pending';
      }

      // --- P=0, C=1, W=1, M=0: mismatch → silent reconnect prompt. ---------
      if (C && W && !M) {
        log(`[Gate] Connected ${W} ≠ cached ${C.address} → disconnect + picker.`);
        try {
          await disconnectWallet();
        } catch {}
        setPostPicker(true);
        try {
          await connectWallet();
        } catch {}
        return 'pending';
      }

      // --- P=0, C=1, W=1, M=1: cached + matches → proceed silently. -------
      if (C && W && M) {
        log(`[Gate] Cached wallet ${C.address} matches connected for ${circuit} → proceed.`);
        return {address: W};
      }

      log('[Gate] Unreachable state.');
      return 'cancelled';
    },
    [account, connectWallet, disconnectWallet, log, consumePostPickerLatch, setPostPicker],
  );

  const recordSuccess = useCallback(
    async (circuit: CircuitName, address: string) => {
      await setCircuitWallet(circuit, address);
      log(`[Gate] Cached ${address} for ${circuit}.`);
    },
    [log],
  );

  const recordLookupFailure = useCallback(
    async (circuit: CircuitName) => {
      log(`[Gate] Lookup failed for ${circuit} — clearing cache + opening picker.`);
      await clearCircuitWallet(circuit);
      try {
        await disconnectWallet();
      } catch {}
      setPostPicker(true);
      try {
        await connectWallet();
      } catch {}
    },
    [log, disconnectWallet, connectWallet, setPostPicker],
  );

  // Silence unused-var lints if the consumer never inspects this flag.
  useEffect(() => {
    void postPickerVisible;
  }, [postPickerVisible]);

  return {
    runGate,
    recordSuccess,
    recordLookupFailure,
    consumePostPickerLatch,
    isPostPicker: postPickerVisible,
  };
}
