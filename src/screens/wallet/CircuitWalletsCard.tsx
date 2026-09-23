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
import {useTranslation} from 'react-i18next';
import React, {useCallback, useEffect, useMemo, useState} from 'react';
import {View, Text, StyleSheet, TouchableOpacity} from 'react-native';
import {ProofUiIcon} from '../../components/ProofUiIcon';
import {useProofUiColors} from '../../theme/proofUi';
import type {TFunction} from 'i18next';
import {useError} from '../../context';
import {useWallet} from '../../hooks/useWallet';
import {useSettings} from '../../hooks/useSettings';
import {getCircuitDisplayName} from '../../utils/circuit';
import {
  CIRCUIT_WALLET_TTL_MS,
  clearCircuitWallet,
  getCircuitWalletEntry,
  setCircuitWallet,
} from '../../stores';
import {
  walletGroupKey,
  WALLET_BINDING_ROWS,
  circuitsInWalletGroup,
} from '../../stores/circuitWalletStore';
import {DEV_ONLY_CIRCUIT_IDS, type CircuitName} from '../../config';

// Group representatives — one row per wallet-binding group. OIDC and Korea
/**
 * The circuits that actually read a bound wallet.
 *
 * Derived from the SDK's record of which circuits need a wallet signature,
 * because that is the same question: a circuit whose proof is built from a
 * wallet signature needs a wallet bound, and one whose is not would offer a
 * binding nothing ever reads. The Korea mDL flows and the OIDC domain proof
 * fall out on their own — they have wallet groups only so the gate can be a
 * no-op for them.
 *
 * This was two names typed out, `coinbase_attestation` and `giwa_attestation`,
 * so `arc_eligibility` and the country proof had no row here at all and no
 * wallet could be bound to them from this screen.
 */

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

function formatTtl(entry: Entry, t: TFunction): string {
  const left = Math.max(0, entry.savedAt + CIRCUIT_WALLET_TTL_MS - Date.now());
  if (entry.expired || left === 0) return t('host.wallet.home.expired');
  const days = Math.floor(left / (24 * 60 * 60 * 1000));
  const hours = Math.floor((left % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  if (days >= 1) return t('host.wallet.home.rememberDays', {days, hours});
  if (hours >= 1) return t('host.wallet.home.rememberHours', {hours});
  return t('host.wallet.home.rememberSoon');
}

function groupName(group: string): string {
  const names: Record<string, string> = {coinbase: 'Coinbase', giwa: 'GIWA'};
  if (!names[group]) throw new Error(`Unknown wallet group '${group}'.`);
  return names[group];
}

function rowStatus(entry: Entry | null, account: string | null): Status {
  if (!entry || entry.expired) return 'unbound';
  if (account && entry.address.toLowerCase() === account.toLowerCase()) {
    return 'connected';
  }
  return 'inactive';
}

export const CircuitWalletsCard: React.FC = () => {
  const colors = useProofUiColors();
  const {t} = useTranslation();
  const {account, connect, disconnect} = useWallet();
  const {showError} = useError();
  const {settings} = useSettings();
  const developerMode = settings?.developerMode ?? false;
  // GIWA is a dev-only / experimental network. Its wallet-binding row is
  // hidden unless Developer Mode is on, matching how the GIWA network is
  // gated everywhere else (circuit picker, LoadingScreen download list).
  const visibleCircuits = useMemo(
    () =>
      developerMode
        ? WALLET_BINDING_ROWS
        : WALLET_BINDING_ROWS.filter((c) => !DEV_ONLY_CIRCUIT_IDS.includes(c)),
    [developerMode],
  );
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
    for (const c of visibleCircuits) {
      next[c] = await getCircuitWalletEntry(walletGroupKey(c));
    }
    setEntries(next);
  }, [visibleCircuits]);

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
        showError('E4003', e instanceof Error ? e.message : String(e));
        setBusy(null);
        setPendingBindTarget(null);
      }
    },
    [account, connect, disconnect, setPendingBindTarget, showError],
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
            // Same reason as the global row: a console line is invisible, and
            // the person is left looking at a button that did nothing.
            showError('E4004', e instanceof Error ? e.message : String(e));
          }
        }
        await refresh();
      } finally {
        setBusy(null);
      }
    },
    [account, disconnect, refresh, showError],
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
        // Third place this was swallowed. A console line is invisible to the
        // person holding the phone, and the row just sits there.
        showError('E4004', e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    [account, disconnect, refresh, showError],
  );

  return (
    <View style={styles.section}>
      <View style={styles.heading}>
        <Text style={[styles.sectionTitle, {color: colors.text}]}>{t('host.wallet.circuitWallets')}</Text>
        <Text style={[styles.hint, {color: colors.secondary}]}>{t('host.wallet.circuitWalletsHint')}</Text>
      </View>
      {visibleCircuits.map(c => {
        const e = entries[c] ?? null;
        const status = rowStatus(e, account);
        const connected = status === 'connected';
        const group = walletGroupKey(c);
        const isBusy = busy === c;
        return <View key={c} testID={`wallet-binding-${group}`}
          style={[styles.card, {backgroundColor: colors.card, borderColor: colors.border}]}>
          <View style={styles.identity}>
            <View style={[styles.icon, {backgroundColor: colors.inset, borderColor: colors.border}]}>
              <ProofUiIcon name="shield" size={23} color={colors.blue} />
            </View>
            <Text style={[styles.groupName, {color: colors.text}]}>{groupName(group)}</Text>
            <StatusPill status={status} />
          </View>
          <Text style={[styles.circuits, {color: colors.secondary}]}>
            {circuitsInWalletGroup(c).map(getCircuitDisplayName).join(' · ')}
          </Text>
          {e ? <View style={[styles.savedAddress, {backgroundColor: colors.inset}]}>
            <Text selectable accessibilityLabel={e.address} style={[styles.address, {color: colors.text}]}>{e.address}</Text>
            <Text style={[styles.ttl, {color: colors.secondary}]}>{formatTtl(e, t)}</Text>
          </View> : <Text style={[styles.hint, {color: colors.secondary}]}>{t('host.wallet.notBoundHint')}</Text>}
          <View style={styles.actions}>
            {status === 'unbound' && <ActionButton testID={`wallet-bind-${group}`} variant="primary"
              label={isBusy ? t('host.wallet.connecting') : t('host.wallet.connect')}
              disabled={isBusy} onPress={() => handleConnect(c)} />}
            {status === 'inactive' && <ActionButton testID={`wallet-bind-${group}`} variant="primary"
              label={isBusy ? t('host.wallet.connecting') : t('host.wallet.reconnect')}
              disabled={isBusy} onPress={() => handleConnect(c)} />}
            {status === 'connected' && <ActionButton testID={`wallet-disconnect-${group}`} variant="secondary"
              label={t('host.wallet.disconnect')} disabled={isBusy} onPress={() => handleDisconnectOnly(c)} />}
            {status !== 'unbound' && <ActionButton testID={`wallet-clear-${group}`} variant="remove"
              label={t('host.wallet.clear')} disabled={isBusy} onPress={() => handleClear(c, connected)} />}
          </View>
        </View>;
      })}
      <View style={styles.footnote}>
        <ProofUiIcon name="info" size={16} color={colors.secondary} />
        <Text style={[styles.hint, styles.flex, {color: colors.secondary}]}>{t('host.wallet.home.connectionHint')}</Text>
      </View>
    </View>
  );
};

function StatusPill({status}: {status: Status}) {
  const {t} = useTranslation();
  const colors = useProofUiColors();
  const statuses: Record<Status, {color: string; label: string}> = {
    connected: {color: '#2CBF91', label: 'host.wallet.connected'},
    inactive: {color: colors.gold, label: 'host.wallet.home.saved'},
    unbound: {color: colors.secondary, label: 'host.wallet.notBound'},
  };
  const value = statuses[status];
  if (!value) throw new Error(`Unknown wallet status '${status}'.`);
  return <View style={[styles.status, {backgroundColor: colors.inset}]}>
    <View style={[styles.dot, {backgroundColor: value.color}]} />
    <Text style={[styles.statusLabel, {color: value.color}]}>{t(value.label)}</Text>
  </View>;
}

function ActionButton({label, variant, disabled, onPress, testID}: {
  label: string; variant: 'primary' | 'secondary' | 'remove'; disabled?: boolean;
  onPress: () => void; testID: string;
}) {
  const colors = useProofUiColors();
  const variants = {
    primary: {backgroundColor: colors.blue, borderColor: colors.blue, color: '#FFFFFF'},
    secondary: {backgroundColor: colors.inset, borderColor: colors.border, color: colors.text},
    remove: {backgroundColor: colors.card, borderColor: colors.border, color: colors.secondary},
  };
  const style = variants[variant];
  if (!style) throw new Error(`Unknown wallet action style '${variant}'.`);
  return <TouchableOpacity testID={testID} accessibilityRole="button" accessibilityState={{disabled: !!disabled}}
    onPress={onPress} disabled={disabled}
    style={[styles.button, {backgroundColor: style.backgroundColor, borderColor: style.borderColor, opacity: disabled ? 0.5 : 1}]}>
    <Text style={[styles.buttonLabel, {color: style.color}]}>{label}</Text>
  </TouchableOpacity>;
}

const styles = StyleSheet.create({
  section: {gap: 12},
  heading: {gap: 6, marginBottom: 2},
  sectionTitle: {fontSize: 16, fontWeight: '600', lineHeight: 23},
  hint: {fontSize: 12, lineHeight: 19},
  card: {borderWidth: 1, borderRadius: 16, padding: 16, gap: 12},
  identity: {flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap'},
  icon: {width: 38, height: 38, borderRadius: 11, borderWidth: 1, justifyContent: 'center', alignItems: 'center'},
  groupName: {flex: 1, minWidth: 80, fontSize: 17, fontWeight: '600', lineHeight: 24},
  circuits: {fontSize: 12, lineHeight: 19},
  savedAddress: {padding: 12, borderRadius: 9, gap: 4},
  address: {fontSize: 14, lineHeight: 21, fontVariant: ['tabular-nums']},
  ttl: {fontSize: 11, lineHeight: 17},
  actions: {flexDirection: 'row', flexWrap: 'wrap', gap: 10},
  button: {flex: 1, minWidth: 110, minHeight: 44, padding: 10, borderWidth: 1, borderRadius: 9, alignItems: 'center', justifyContent: 'center'},
  buttonLabel: {fontSize: 13, lineHeight: 20, fontWeight: '600', textAlign: 'center'},
  status: {flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 7},
  statusLabel: {fontSize: 11, fontWeight: '600'},
  dot: {width: 5, height: 5, borderRadius: 3},
  footnote: {flexDirection: 'row', gap: 8, alignItems: 'flex-start', paddingHorizontal: 2, marginTop: 2},
  flex: {flex: 1},
});
