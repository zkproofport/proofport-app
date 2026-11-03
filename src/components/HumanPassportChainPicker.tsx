/**
 * The Human Passport chain picker: one row per chain Human Passport offers,
 * each saying what the wallet holds there (a score, none, or a lookup that did
 * not finish). A person records their score on the chain they choose, so only
 * they can say where it is: every row can be chosen, and nothing continues
 * until one is. Used by the in-app threshold screen and by the proof screen
 * for a dApp request.
 *
 * With `minScoreUnits` (a dApp's threshold), a score below it says so.
 */
import React from 'react';
import {Text, StyleSheet, TouchableOpacity, View} from 'react-native';
import {useTranslation} from 'react-i18next';
import {Card} from './ui';
import {useThemeColors} from '../context';
import {HUMAN_PASSPORT_CHAIN_IDS, humanPassportChain} from '../config/circuitIds';
import type {ChainScoreState} from '../utils/humanPassport';

export interface HumanPassportChainPickerProps {
  /** The wallet the rows describe; null before one is connected. */
  account: string | null;
  /** Each chain's state, keyed by chain id; null while the lookup runs. */
  states: Readonly<Record<number, ChainScoreState>> | null;
  chainId: number | null;
  onSelect: (chainId: number) => void;
  minScoreUnits?: number;
}

export const HumanPassportChainPicker: React.FC<HumanPassportChainPickerProps> = ({
  account, states, chainId, onSelect, minScoreUnits,
}) => {
  const {colors: themeColors} = useThemeColors();
  const {t} = useTranslation();

  const rowStatus = (id: number): string => {
    if (!account) return t('host.proof.humanPassport.chainConnectWallet');
    if (!states) return t('host.proof.humanPassport.chainChecking');
    const st = states[id];
    if (!st) throw new Error(`No lookup state for Human Passport chain ${id}. Known: ${Object.keys(states).join(', ')}.`);
    if (st.state === 'found') {
      return minScoreUnits !== undefined && st.score < minScoreUnits
        ? t('host.proof.humanPassport.chainFoundBelow', {score: st.score / 1e4, min: minScoreUnits / 1e4})
        : t('host.proof.humanPassport.chainFound', {score: st.score / 1e4});
    }
    if (st.state === 'none') return t('host.proof.humanPassport.chainNone');
    return t('host.proof.humanPassport.chainUnchecked');
  };

  return (
    <Card style={styles.card}>
      <Text style={{fontSize: 11, fontWeight: '600', color: themeColors.text.tertiary, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4}}>
        {t('host.proof.humanPassport.chainLabel')}
      </Text>
      <Text style={{fontSize: 13, color: themeColors.text.tertiary, marginBottom: 8, lineHeight: 18}}>
        {t('host.proof.humanPassport.chainHint')}
      </Text>
      {HUMAN_PASSPORT_CHAIN_IDS.map(id => {
        const selected = chainId === id;
        const st = states?.[id];
        const meets = st?.state === 'found' && (minScoreUnits === undefined || st.score >= minScoreUnits);
        return (
          <TouchableOpacity
            key={id}
            testID={`chain-row-${id}`}
            accessibilityRole="radio"
            accessibilityState={{selected}}
            onPress={() => onSelect(id)}
            style={[styles.chainRow, {borderColor: selected ? themeColors.info[400] : themeColors.border.primary}]}>
            <View style={{flex: 1}}>
              <Text style={{fontSize: 15, fontWeight: '600', color: themeColors.text.primary}}>{humanPassportChain(id).name}</Text>
              <Text style={{fontSize: 13, marginTop: 2, color: meets ? themeColors.success[400] : themeColors.text.tertiary}}>{rowStatus(id)}</Text>
            </View>
            <Text style={{fontSize: 18, color: selected ? themeColors.info[400] : themeColors.text.tertiary}}>{selected ? '●' : '○'}</Text>
          </TouchableOpacity>
        );
      })}
      {chainId === null ? (
        <Text style={{fontSize: 13, color: themeColors.warning[400], marginTop: 4}}>{t('host.proof.humanPassport.chainRequired')}</Text>
      ) : null}
    </Card>
  );
};

const styles = StyleSheet.create({
  card: {marginBottom: 16},
  chainRow: {flexDirection: 'row', alignItems: 'center', minHeight: 52, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, marginTop: 8},
});
