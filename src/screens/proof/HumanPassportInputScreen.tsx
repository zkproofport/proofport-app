/**
 * The score threshold and the chain for an in-app Human Passport proof.
 *
 * A dApp names its threshold in the request (`minScore`); proving from the
 * Proof tab, the person chooses it here. The field starts at 20, the passing
 * score Human Passport itself writes into every score it attests, and is
 * checked with core's own conversion, so what continues is exactly what the
 * circuit will carry.
 *
 * The chain: a person records their score on the chain they choose, so they
 * choose it here too. With a wallet connected every chain is looked up and
 * each row says what it holds (a score, none, or a lookup that did not
 * finish); the chain holding the newest score is preselected. Nothing is
 * selected without a score behind it, and nothing continues without a chain.
 */
import React, {useEffect, useMemo, useState} from 'react';
import {Text, StyleSheet, SafeAreaView, ScrollView, TextInput, TouchableOpacity, View} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {useTranslation} from 'react-i18next';
import {Button, Card} from '../../components/ui';
import {useThemeColors} from '../../context';
import type {ProofStackParamList} from '../../navigation/types';
import {HUMAN_PASSPORT_CHAIN_IDS, humanPassportChain, humanPassportScoreUnits} from '../../config/circuitIds';
import {useWallet} from '../../hooks/useWallet';
import {surveyHumanPassportChains, type ChainScoreState} from '../../utils/humanPassport';

type NavigationProp = NativeStackNavigationProp<ProofStackParamList, 'HumanPassportInput'>;

/** Human Passport's own passing score, as attested (threshold 200000 = 20.0). */
const PASSPORT_PASSING_SCORE = '20';

export const HumanPassportInputScreen: React.FC = () => {
  const {colors: themeColors} = useThemeColors();
  const navigation = useNavigation<NavigationProp>();
  const {t} = useTranslation();
  const [text, setText] = useState(PASSPORT_PASSING_SCORE);
  const {account} = useWallet();
  const [chainId, setChainId] = useState<number | null>(null);
  const [states, setStates] = useState<Record<number, ChainScoreState> | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!account) {
      setStates(null);
      return;
    }
    let cancelled = false;
    setChecking(true);
    surveyHumanPassportChains(account, Math.floor(Date.now() / 1000), line => console.log(line))
      .then(found => {
        if (cancelled) return;
        setStates(Object.fromEntries(found.map(st => [st.chainId, st])));
        const newest = found
          .filter((st): st is Extract<ChainScoreState, {state: 'found'}> => st.state === 'found')
          .sort((a, b) => b.expirationTime - a.expirationTime)[0];
        if (newest) setChainId(current => (current === null ? newest.chainId : current));
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [account]);

  const rowStatus = (id: number): string => {
    if (!account) return t('host.proof.humanPassport.chainConnectWallet');
    if (checking || !states) return t('host.proof.humanPassport.chainChecking');
    const st = states[id];
    if (st.state === 'found') return t('host.proof.humanPassport.chainFound', {score: st.score / 1e4});
    if (st.state === 'none') return t('host.proof.humanPassport.chainNone');
    return t('host.proof.humanPassport.chainUnchecked');
  };

  const minScore = useMemo(() => {
    const trimmed = text.trim();
    if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
    const value = Number(trimmed);
    try {
      humanPassportScoreUnits(value);
      return value;
    } catch {
      return null;
    }
  }, [text]);

  // Human Passport binds an optional EIP-712 action, as Coinbase KYC v2 does:
  // the threshold goes on to the action screen, whose "prove only" button
  // skips the action.
  const handleContinue = () => {
    if (minScore === null || chainId === null) return;
    navigation.navigate('ActionInput', {
      circuit: 'human_passport_score',
      passportInputs: {minScore, chainId},
    });
  };

  return (
    <SafeAreaView style={{flex: 1, backgroundColor: themeColors.background.primary}}>
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.contentContainer} keyboardShouldPersistTaps="handled">
        <Card style={styles.card}>
          <Text style={{fontSize: 11, fontWeight: '600', color: themeColors.info[400], letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8}}>
            {t('host.proof.humanPassport.heroLabel')}
          </Text>
          <Text style={{fontSize: 24, fontWeight: '700', color: themeColors.text.primary, letterSpacing: -0.5, marginBottom: 8}}>
            {t('host.proof.humanPassport.heroTitle')}
          </Text>
          <Text style={{fontSize: 15, color: themeColors.text.secondary, lineHeight: 22}}>
            {t('host.proof.humanPassport.heroDescription')}
          </Text>
        </Card>

        <Card style={styles.card}>
          <Text style={{fontSize: 11, fontWeight: '600', color: themeColors.text.tertiary, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8}}>
            {t('host.proof.humanPassport.thresholdLabel')}
          </Text>
          <TextInput
            testID="human-passport-threshold"
            value={text}
            onChangeText={setText}
            keyboardType="decimal-pad"
            returnKeyType="done"
            onSubmitEditing={handleContinue}
            style={[styles.input, {color: themeColors.text.primary, borderColor: themeColors.border.primary, backgroundColor: themeColors.background.secondary}]}
          />
          <Text style={{fontSize: 13, color: minScore === null ? themeColors.warning[400] : themeColors.text.tertiary, marginTop: 8, lineHeight: 18}}>
            {minScore === null
              ? t('host.proof.humanPassport.thresholdInvalid')
              : t('host.proof.humanPassport.summary', {score: minScore})}
          </Text>
        </Card>

        <Card style={styles.card}>
          <Text style={{fontSize: 11, fontWeight: '600', color: themeColors.text.tertiary, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 4}}>
            {t('host.proof.humanPassport.chainLabel')}
          </Text>
          <Text style={{fontSize: 13, color: themeColors.text.tertiary, marginBottom: 8, lineHeight: 18}}>
            {t('host.proof.humanPassport.chainHint')}
          </Text>
          {HUMAN_PASSPORT_CHAIN_IDS.map(id => {
            const selected = chainId === id;
            const found = states?.[id]?.state === 'found';
            return (
              <TouchableOpacity
                key={id}
                testID={`chain-row-${id}`}
                accessibilityRole="radio"
                accessibilityState={{selected}}
                onPress={() => setChainId(id)}
                style={[styles.chainRow, {borderColor: selected ? themeColors.info[400] : themeColors.border.primary}]}>
                <View style={{flex: 1}}>
                  <Text style={{fontSize: 15, fontWeight: '600', color: themeColors.text.primary}}>{humanPassportChain(id).name}</Text>
                  <Text style={{fontSize: 13, marginTop: 2, color: found ? themeColors.success[400] : themeColors.text.tertiary}}>{rowStatus(id)}</Text>
                </View>
                <Text style={{fontSize: 18, color: selected ? themeColors.info[400] : themeColors.text.tertiary}}>{selected ? '●' : '○'}</Text>
              </TouchableOpacity>
            );
          })}
          {chainId === null ? (
            <Text style={{fontSize: 13, color: themeColors.warning[400], marginTop: 4}}>{t('host.proof.humanPassport.chainRequired')}</Text>
          ) : null}
        </Card>

        <Button
          title={t('host.proof.humanPassport.continueButton')}
          onPress={handleContinue}
          disabled={minScore === null || chainId === null}
          size="large"
          style={styles.continueButton}
        />
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  scrollView: {flex: 1},
  contentContainer: {paddingHorizontal: 16, paddingTop: 16, paddingBottom: 32},
  card: {marginBottom: 16},
  input: {fontSize: 20, fontWeight: '600', borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10},
  continueButton: {marginBottom: 16},
  chainRow: {flexDirection: 'row', alignItems: 'center', minHeight: 52, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, marginTop: 8},
});
