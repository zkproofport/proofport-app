/**
 * Per-circuit wallet bindings UI.
 *
 * Each row represents one wallet-binding group (coinbase, giwa) and shows:
 *   - status pill: Connected (binding matches global session) / Inactive
 *     (binding exists but session is different or absent) / Not bound
 *   - bound address + TTL when bound
 *   - actions:
 *       Connected → [Disconnect, Clear]:
 *           Disconnect = drop the active global session only (binding
 *                        stays → row flips to Inactive)
 *           Clear      = unbind AND drop the global session (full reset
 *                        for this circuit)
 *       Inactive  → [Reconnect, Clear]:
 *           Reconnect  = reopen picker to rebind this group
 *           Clear      = unbind only (global session belongs to a
 *                        different circuit, leave it)
 *       Not bound → [Connect]          : open picker and bind this group
 *
 * "Connect" / "Reconnect" disconnects the current global session (so the
 * wallet picker — not the account sheet — appears in AppKit), then opens
 * the picker. When the new wallet connects (`account` becomes set while
 * `pendingBindTarget` is non-null), the binding is written immediately —
 * binding happens at connect time, NOT at proof-success time.
 */
import React, {useCallback, useEffect, useState} from 'react';
import {View, Text, StyleSheet, TouchableOpacity} from 'react-native';
import {Card} from '../../components/ui';
import {useThemeColors} from '../../context';
import {usePrivyWallet} from '../../hooks/usePrivyWallet';
import {getCircuitDisplayName} from '../../utils/circuit';
import {
  CIRCUIT_WALLET_TTL_MS,
  clearCircuitWallet,
  getCircuitWalletEntry,
  setCircuitWallet,
} from '../../stores';
import {walletGroupKey} from '../../stores/circuitWalletStore';
import type {CircuitName} from '../../config';

// Group representatives — one row per wallet-binding group. OIDC is wallet-
// less and is intentionally absent.
const CIRCUITS: CircuitName[] = [
  'coinbase_attestation',
  'giwa_attestation',
];

// Module-level latch for the "I'm about to bind this circuit on the next
// wallet pick" state. We keep this OUTSIDE component state because the
// wallet picker flow goes account=set → disconnect → account=null →
// picker → account=set, and the parent (WalletMainScreen) switches
// between WalletConnectedScreen and WalletNoConnectionScreen during that
// transition — which unmounts and remounts this card and would erase any
// React state. A module-level variable survives the unmount and lets the
// remounted card's effect commit the binding when `account` returns.
let _pendingBindTarget: CircuitName | null = null;

type Status = 'connected' | 'inactive' | 'unbound';

interface Entry {
  address: string;
  savedAt: number;
  expired: boolean;
}

function formatTtl(entry: Entry): string {
  if (entry.expired) return 'expired — will rebind';
  const left = entry.savedAt + CIRCUIT_WALLET_TTL_MS - Date.now();
  const days = Math.floor(left / (24 * 60 * 60 * 1000));
  const hours = Math.floor((left % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  if (days >= 1) return `${days}d ${hours}h left`;
  return `${hours}h left`;
}

function short(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function rowStatus(entry: Entry | null, account: string | null): Status {
  if (!entry || entry.expired) return 'unbound';
  if (account && entry.address.toLowerCase() === account.toLowerCase()) {
    return 'connected';
  }
  return 'inactive';
}

export const CircuitWalletsCard: React.FC = () => {
  const {colors: themeColors} = useThemeColors();
  const {account, connect, disconnect} = usePrivyWallet();
  const [entries, setEntries] = useState<Record<string, Entry | null>>({});
  // Seed from the module-level latch so a remounted instance after
  // disconnect/picker→reconnect can still commit the pending binding.
  const [pendingBindTarget, setPendingBindTargetState] =
    useState<CircuitName | null>(_pendingBindTarget);
  const [busy, setBusy] = useState<CircuitName | null>(_pendingBindTarget);

  const setPendingBindTarget = useCallback((target: CircuitName | null) => {
    _pendingBindTarget = target;
    setPendingBindTargetState(target);
  }, []);

  const refresh = useCallback(async () => {
    const next: Record<string, Entry | null> = {};
    for (const c of CIRCUITS) {
      next[c] = await getCircuitWalletEntry(walletGroupKey(c));
    }
    setEntries(next);
  }, []);

  useEffect(() => {
    refresh().catch(console.error);
  }, [refresh]);

  // Bind on connect: when a Connect/Reconnect tap leaves us with a pending
  // bind target and the wallet picker returns a connected account, commit
  // the binding immediately and refresh. We read the latch from the module-
  // level variable rather than the React state so a freshly-remounted
  // instance (after the disconnect → picker → reconnect transition unmounts
  // the card via WalletMainScreen's screen swap) still commits the binding.
  useEffect(() => {
    const target = _pendingBindTarget;
    if (!target || !account) return;
    let cancelled = false;
    (async () => {
      await setCircuitWallet(walletGroupKey(target), account);
      if (cancelled) return;
      setPendingBindTarget(null);
      setBusy(null);
      await refresh();
    })().catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [account, pendingBindTarget, refresh, setPendingBindTarget]);

  const handleConnect = useCallback(
    async (circuit: CircuitName) => {
      setBusy(circuit);
      try {
        if (account) {
          // Drop the current session so AppKit shows the wallet picker
          // (not the account-management sheet) and the user can choose
          // which wallet to bind to this circuit.
          await disconnect();
        }
        setPendingBindTarget(circuit);
        await connect();
        // The post-picker bind happens in the effect above; leave busy on
        // until either the bind completes or the user dismisses the picker
        // (in which case the user can re-tap and we'll overwrite busy).
      } catch (e) {
        console.error('[CircuitWallets] connect error:', e);
        setBusy(null);
        setPendingBindTarget(null);
      }
    },
    [account, connect, disconnect],
  );

  const handleClear = useCallback(
    async (circuit: CircuitName, alsoDisconnectGlobal: boolean) => {
      setBusy(circuit);
      try {
        await clearCircuitWallet(walletGroupKey(circuit));
        if (alsoDisconnectGlobal && account) {
          // Connected row: clearing unbinds AND drops the active session
          // (a "true" disconnect from the user's perspective). For Inactive
          // rows we only unbind, since the global session belongs to a
          // different circuit/wallet.
          try {
            await disconnect();
          } catch (e) {
            console.error('[CircuitWallets] disconnect error:', e);
          }
        }
        await refresh();
      } finally {
        setBusy(null);
      }
    },
    [account, disconnect, refresh],
  );

  // Disconnect-only (Connected row): drop the global session but keep the
  // circuit binding. The row flips to Inactive afterwards.
  const handleDisconnectOnly = useCallback(
    async (circuit: CircuitName) => {
      if (!account) return;
      setBusy(circuit);
      try {
        await disconnect();
        await refresh();
      } catch (e) {
        console.error('[CircuitWallets] disconnect-only error:', e);
      } finally {
        setBusy(null);
      }
    },
    [account, disconnect, refresh],
  );

  return (
    <Card style={styles.card}>
      <Text
        style={{
          fontSize: 12,
          fontWeight: '600',
          color: themeColors.text.secondary,
          letterSpacing: 0.5,
          textTransform: 'uppercase',
          marginBottom: 8,
        }}>
        Circuit wallets
      </Text>
      <Text style={{fontSize: 13, color: themeColors.text.secondary, marginBottom: 16}}>
        Each circuit binds to its own wallet at connect time. Tap Connect to
        link a wallet to a circuit; Clear unbinds. A wallet shows as Connected
        only while it is the currently active session.
      </Text>
      {CIRCUITS.map((c) => {
        const e = entries[c] ?? null;
        const status = rowStatus(e, account);
        const isBusy = busy === c;
        return (
          <View key={c} style={styles.row}>
            <View style={{flex: 1, paddingRight: 12}}>
              <View style={{flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4}}>
                <Text style={[styles.label, {color: themeColors.text.primary}]}>
                  {getCircuitDisplayName(c)}
                </Text>
                <StatusPill status={status} />
              </View>
              {e ? (
                <>
                  <Text style={[styles.mono, {color: themeColors.text.secondary}]}>
                    {short(e.address)}
                  </Text>
                  <Text
                    style={{
                      fontSize: 11,
                      color: e.expired ? '#EF4444' : themeColors.text.tertiary,
                      marginTop: 2,
                    }}>
                    {formatTtl(e)}
                  </Text>
                </>
              ) : (
                <Text style={{fontSize: 12, color: themeColors.text.tertiary, marginTop: 2}}>
                  not bound — tap Connect to link a wallet
                </Text>
              )}
            </View>

            <View style={{gap: 8, alignItems: 'flex-end'}}>
              {status === 'unbound' && (
                <ActionButton
                  variant="primary"
                  label={isBusy ? 'Connecting…' : 'Connect'}
                  disabled={isBusy}
                  onPress={() => handleConnect(c)}
                />
              )}
              {status === 'inactive' && (
                <>
                  <ActionButton
                    variant="primary"
                    label={isBusy ? 'Connecting…' : 'Reconnect'}
                    disabled={isBusy}
                    onPress={() => handleConnect(c)}
                  />
                  <ActionButton
                    variant="ghost-red"
                    label="Clear"
                    disabled={isBusy}
                    onPress={() => handleClear(c, false)}
                  />
                </>
              )}
              {status === 'connected' && (
                <>
                  <ActionButton
                    variant="primary"
                    label="Disconnect"
                    disabled={isBusy}
                    onPress={() => handleDisconnectOnly(c)}
                  />
                  <ActionButton
                    variant="ghost-red"
                    label="Clear"
                    disabled={isBusy}
                    onPress={() => handleClear(c, true)}
                  />
                </>
              )}
            </View>
          </View>
        );
      })}
    </Card>
  );
};

const StatusPill: React.FC<{status: Status}> = ({status}) => {
  const style =
    status === 'connected'
      ? {bg: 'rgba(34, 197, 94, 0.16)', fg: '#22C55E', text: 'Connected'}
      : status === 'inactive'
      ? {bg: 'rgba(234, 179, 8, 0.16)', fg: '#EAB308', text: 'Inactive'}
      : {bg: 'rgba(148, 163, 184, 0.16)', fg: '#94A3B8', text: 'Not bound'};
  return (
    <View style={{paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, backgroundColor: style.bg}}>
      <Text style={{fontSize: 10, fontWeight: '700', color: style.fg, letterSpacing: 0.5, textTransform: 'uppercase'}}>
        {style.text}
      </Text>
    </View>
  );
};

const ActionButton: React.FC<{
  label: string;
  variant: 'primary' | 'ghost-red';
  disabled?: boolean;
  onPress: () => void;
}> = ({label, variant, disabled, onPress}) => {
  const styleByVariant =
    variant === 'primary'
      ? {borderColor: '#3B82F6', bg: 'rgba(59, 130, 246, 0.12)', fg: '#3B82F6'}
      : {borderColor: '#EF4444', bg: 'transparent', fg: '#EF4444'};
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      style={{
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 6,
        borderWidth: 1,
        borderColor: styleByVariant.borderColor,
        backgroundColor: styleByVariant.bg,
        opacity: disabled ? 0.5 : 1,
        minWidth: 96,
        alignItems: 'center',
      }}>
      <Text style={{color: styleByVariant.fg, fontSize: 13, fontWeight: '600'}}>
        {label}
      </Text>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  card: {marginBottom: 24},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.05)',
  },
  label: {fontSize: 14, fontWeight: '600'},
  mono: {
    fontFamily: 'monospace',
    fontSize: 12,
  },
});
