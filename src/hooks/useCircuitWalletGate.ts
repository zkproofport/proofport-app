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
 *  1  *  1  *    Bind W to circuit + proceed. If C && !M, drop stale cache.
 *  1  *  0  -    Picker cancelled → user-visible note, no proof.
 *  0  0  0  -    Open picker, set P=1, exit (auto-retry on connect).
 *  0  0  1  -    Drop session + open picker (P=1). Forces fresh pick.
 *  0  1  0  -    Reconnect prompt → picker for cached address.
 *  0  1  1  0    Disconnect → reconnect prompt for cached address.
 *  0  1  1  1    Cached + matches → proceed silently.
 *
 * Binding semantics (IMPORTANT):
 *   Binding is committed at *connect* time (the P=1 branch), NOT at proof-
 *   success time. As soon as the user picks a wallet, that wallet is
 *   recorded as the binding for the circuit group. On attestation-lookup
 *   failure the caller invokes `recordLookupFailure`, which clears the
 *   binding and re-opens the picker.
 */
import {useCallback, useRef, useState, useEffect} from 'react';
import {
  getCircuitWalletEntry,
  setCircuitWallet,
  clearCircuitWallet,
} from '../stores';
import {walletGroupKey} from '../stores/circuitWalletStore';
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

  /** Mark a failed attestation lookup: drop binding, kick off a new picker.
   *  `address` is the wallet that just failed — passing it lets the gate
   *  short-circuit an auto-retry if the user re-picks the same wallet
   *  (otherwise the search would loop forever for users with only one
   *  wallet that lacks the attestation). */
  recordLookupFailure: (circuit: CircuitName, address: string | null) => Promise<void>;

  /** True if `address` already failed an attestation lookup for `circuit`
   *  during this session. Callers use it to skip a no-op auto-retry. */
  wasFailedAddress: (circuit: CircuitName, address: string) => boolean;
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
  // Addresses that already failed an attestation lookup for a given
  // circuit in this session. Used to break the auto-retry loop when the
  // user only owns a single wallet that lacks the attestation — without
  // this they'd keep re-picking the same wallet and the search would
  // re-run forever.
  const failedByCircuitRef = useRef<Map<CircuitName, Set<string>>>(new Map());

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
      // Binding is keyed by wallet group, so circuits proven with the same
      // wallet (e.g. Coinbase KYC + Country) share one binding.
      const key = walletGroupKey(circuit);
      const cached = await getCircuitWalletEntry(key);
      if (cached?.expired) {
        log(`[Gate] Cache for ${circuit} expired, clearing.`);
        await clearCircuitWallet(key);
      }
      const C = cached && !cached.expired ? cached : null;
      const W = account;
      const M = !!(C && W && W.toLowerCase() === C.address.toLowerCase());
      const P = consumePostPickerLatch();

      // --- P=1: post-picker auto-retry → no confirm. -----------------------
      if (P) {
        if (W) {
          const failed = failedByCircuitRef.current.get(key);
          if (failed && failed.has(W.toLowerCase())) {
            log(
              `[Gate] Post-picker re-selected ${W} which already failed lookup for ${circuit} — not retrying.`,
            );
            return 'cancelled';
          }
          if (C && !M) {
            log(`[Gate] Post-picker chose different wallet — dropping stale cache.`);
            await clearCircuitWallet(key);
          }
          // Bind on connect: persist the chosen wallet now so the binding
          // reflects the user's current intent regardless of whether the
          // subsequent attestation lookup succeeds or fails.
          await setCircuitWallet(key, W);
          log(`[Gate] Post-picker bound ${W} to ${circuit}; proceed.`);
          return {address: W};
        }
        log('[Gate] Post-picker but no wallet — picker cancelled.');
        return 'cancelled';
      }

      // --- P=0, C=0: no binding for this group. Open a fresh picker. If a
      // wallet from another group is connected, drop that session first so
      // the wallet picker (not the account sheet) shows. Never inherit it.
      if (!C) {
        if (W) {
          log(`[Gate] No binding for ${circuit}; dropping ${W} before picker.`);
          try {
            await disconnectWallet();
          } catch {}
        } else {
          log(`[Gate] No binding for ${circuit} and no wallet — opening picker.`);
        }
        setPostPicker(true);
        try {
          await connectWallet();
        } catch (e) {
          log(`[Gate] connect error: ${e instanceof Error ? e.message : e}`);
        }
        return 'pending';
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

  const recordLookupFailure = useCallback(
    async (circuit: CircuitName, address: string | null) => {
      log(
        `[Gate] Lookup failed for ${circuit}${
          address ? ` (${address})` : ''
        } — keeping binding; opening picker so user can pick a different wallet.`,
      );
      const key = walletGroupKey(circuit);
      if (address) {
        let set = failedByCircuitRef.current.get(key);
        if (!set) {
          set = new Set();
          failedByCircuitRef.current.set(key, set);
        }
        set.add(address.toLowerCase());
      }
      // IMPORTANT: do NOT clear the circuit binding here. The user-stated
      // rule is "binding happens at connect time". A failed attestation
      // lookup means "this wallet has no attestation for this circuit yet",
      // not "the user no longer wants this wallet bound". If they want to
      // unbind, they tap Clear in the Wallet tab. We still open the picker
      // so they can pick a different wallet on this attempt.
      setPostPicker(true);
      try {
        await disconnectWallet();
      } catch {}
      try {
        await connectWallet();
      } catch {}
    },
    [log, disconnectWallet, connectWallet, setPostPicker],
  );

  const wasFailedAddress = useCallback(
    (circuit: CircuitName, address: string): boolean => {
      const set = failedByCircuitRef.current.get(walletGroupKey(circuit));
      return !!set && set.has(address.toLowerCase());
    },
    [],
  );

  // Silence unused-var lints if the consumer never inspects this flag.
  useEffect(() => {
    void postPickerVisible;
  }, [postPickerVisible]);

  return {
    runGate,
    recordLookupFailure,
    wasFailedAddress,
    consumePostPickerLatch,
    isPostPicker: postPickerVisible,
  };
}
