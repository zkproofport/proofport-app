/**
 * Read-only view of the per-circuit wallet cache.
 *
 * Bindings are recorded automatically on first proof generation and expire
 * after a TTL (see circuitWalletStore). The user can clear an entry here to
 * force re-binding on the next proof attempt for that circuit.
 */
import React, {useEffect, useState, useCallback} from 'react';
import {View, Text, StyleSheet, TouchableOpacity} from 'react-native';
import {Card} from '../../components/ui';
import {useThemeColors} from '../../context';
import {getCircuitDisplayName} from '../../utils/circuit';
import {
  getCircuitWalletEntry,
  clearCircuitWallet,
  CIRCUIT_WALLET_TTL_MS,
} from '../../stores';
import type {CircuitName} from '../../config';

// OIDC is wallet-less (proof comes from Google/Microsoft sign-in) — it
// doesn't belong in the per-circuit wallet cache.
const CIRCUITS: CircuitName[] = [
  'coinbase_attestation',
  'coinbase_country_attestation',
  'giwa_attestation',
];

interface Entry {
  address: string;
  savedAt: number;
  expired: boolean;
}

function formatRemaining(entry: Entry): string {
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

export const CircuitWalletsCard: React.FC = () => {
  const {colors: themeColors} = useThemeColors();
  const [entries, setEntries] = useState<Record<string, Entry | null>>({});

  const refresh = useCallback(async () => {
    const next: Record<string, Entry | null> = {};
    for (const c of CIRCUITS) {
      next[c] = await getCircuitWalletEntry(c);
    }
    setEntries(next);
  }, []);

  useEffect(() => {
    refresh().catch(console.error);
  }, [refresh]);

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
        Each circuit remembers the wallet you last used. Clear an entry to be
        prompted for a different wallet on the next proof.
      </Text>
      {CIRCUITS.map((c) => {
        const e = entries[c];
        return (
          <View key={c} style={styles.row}>
            <View style={{flex: 1}}>
              <Text style={[styles.label, {color: themeColors.text.primary}]}>
                {getCircuitDisplayName(c)}
              </Text>
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
                    {formatRemaining(e)}
                  </Text>
                </>
              ) : (
                <Text style={{fontSize: 12, color: themeColors.text.tertiary, marginTop: 4}}>
                  not bound — will use connected wallet on first proof
                </Text>
              )}
            </View>
            {e && (
              <TouchableOpacity
                onPress={async () => {
                  await clearCircuitWallet(c);
                  await refresh();
                }}
                style={styles.btnGhost}>
                <Text style={styles.btnGhostText}>Clear</Text>
              </TouchableOpacity>
            )}
          </View>
        );
      })}
    </Card>
  );
};

const styles = StyleSheet.create({
  card: {marginBottom: 24},
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 12,
  },
  label: {fontSize: 14, fontWeight: '600'},
  mono: {
    fontFamily: 'monospace',
    fontSize: 12,
    marginTop: 4,
  },
  btnGhost: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#EF4444',
  },
  btnGhostText: {color: '#EF4444', fontSize: 13, fontWeight: '600'},
});
