import React, {useEffect, useRef, useState} from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import {useTranslation} from 'react-i18next';
import {ProofUiIcon} from '../../components/ProofUiIcon';
import {useProofUiColors} from '../../theme/proofUi';

export interface WalletSessionCardProps {
  walletName: string;
  address: string;
  network: string;
  isActive: boolean;
  onDisconnect: () => void;
}

export function WalletSessionCard({walletName, address, network, isActive, onDisconnect}: WalletSessionCardProps) {
  const colors = useProofUiColors();
  const {t} = useTranslation();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {if (timer.current) clearTimeout(timer.current);}, []);
  useEffect(() => {setCopied(false);}, [address]);
  const copy = () => {
    Clipboard.setString(address);
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  };
  return <View testID="wallet-session" style={[styles.card, {backgroundColor: colors.card, borderColor: colors.border}]}>
    <View style={styles.identity}>
      <View style={[styles.icon, {backgroundColor: colors.inset, borderColor: colors.border}]}>
        <ProofUiIcon name="wallet" color={colors.blue} size={26} />
      </View>
      <View style={styles.flex}>
        <Text style={[styles.eyebrow, {color: colors.secondary}]}>{t('host.wallet.home.currentWallet')}</Text>
        <Text style={[styles.name, {color: colors.text}]}>{walletName}</Text>
      </View>
      <View style={[styles.status, {backgroundColor: colors.inset}]}>
        <View style={[styles.dot, {backgroundColor: isActive ? '#2CBF91' : colors.muted}]} />
        <Text style={[styles.statusText, {color: colors.text}]}>{t(isActive ? 'host.wallet.connected' : 'host.wallet.notConnected')}</Text>
      </View>
    </View>
    <View style={[styles.divider, {backgroundColor: colors.border}]} />
    <TouchableOpacity testID="wallet-copy-address" accessibilityRole="button"
      accessibilityLabel={`${t('host.wallet.tapToCopy')}: ${address}`} disabled={!address}
      onPress={copy} style={styles.row}>
      <Text style={[styles.label, {color: colors.secondary}]}>{t('host.wallet.address')}</Text>
      <Text style={[styles.address, {color: colors.text}]}>
        {copied ? t('host.wallet.copied') : address || t('host.wallet.home.loadingAddress')}
      </Text>
      <ProofUiIcon name={copied ? 'check' : 'copy'} size={19} color={colors.blue} />
    </TouchableOpacity>
    <View style={styles.row}>
      <Text style={[styles.label, {color: colors.secondary}]}>{t('host.wallet.network')}</Text>
      <Text style={[styles.network, {color: colors.blue}]}>{network}</Text>
    </View>
    <TouchableOpacity testID="wallet-disconnect" accessibilityRole="button" onPress={onDisconnect}
      style={[styles.disconnect, {borderTopColor: colors.border}]}>
      <Text style={[styles.disconnectLabel, {color: colors.secondary}]}>{t('host.wallet.home.disconnectSession')}</Text>
    </TouchableOpacity>
  </View>;
}

const styles = StyleSheet.create({
  card: {borderWidth: 1, borderRadius: 16, paddingHorizontal: 16, paddingTop: 18},
  identity: {flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap'},
  icon: {height: 46, width: 46, borderRadius: 13, borderWidth: 1, alignItems: 'center', justifyContent: 'center'},
  flex: {flex: 1, minWidth: 100},
  eyebrow: {fontSize: 12, lineHeight: 18},
  name: {fontSize: 18, lineHeight: 25, fontWeight: '600'},
  status: {flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 5, paddingHorizontal: 8, borderRadius: 7},
  dot: {width: 6, height: 6, borderRadius: 3},
  statusText: {fontSize: 11, fontWeight: '600'},
  divider: {height: StyleSheet.hairlineWidth, marginTop: 18, marginBottom: 4},
  row: {flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 48, paddingVertical: 10},
  label: {fontSize: 13, minWidth: 56},
  address: {flex: 1, fontSize: 12, lineHeight: 19, textAlign: 'right', fontVariant: ['tabular-nums']},
  network: {flex: 1, textAlign: 'right', fontSize: 13, lineHeight: 20, fontWeight: '600'},
  disconnect: {minHeight: 46, justifyContent: 'center', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, marginTop: 6},
  disconnectLabel: {fontSize: 13, fontWeight: '500'},
});
