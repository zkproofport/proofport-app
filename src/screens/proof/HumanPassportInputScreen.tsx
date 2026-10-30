/**
 * The score threshold for an in-app Human Passport proof.
 *
 * A dApp names its threshold in the request (`minScore`); proving from the
 * Proof tab, the person chooses it here. The field starts at 20, the passing
 * score Human Passport itself writes into every score it attests, and is
 * checked with core's own conversion, so what continues is exactly what the
 * circuit will carry.
 */
import React, {useMemo, useState} from 'react';
import {Text, StyleSheet, SafeAreaView, ScrollView, TextInput} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {useTranslation} from 'react-i18next';
import {Button, Card} from '../../components/ui';
import {useThemeColors} from '../../context';
import type {ProofStackParamList} from '../../navigation/types';
import {humanPassportScoreUnits} from '../../config/circuitIds';

type NavigationProp = NativeStackNavigationProp<ProofStackParamList, 'HumanPassportInput'>;

/** Human Passport's own passing score, as attested (threshold 200000 = 20.0). */
const PASSPORT_PASSING_SCORE = '20';

export const HumanPassportInputScreen: React.FC = () => {
  const {colors: themeColors} = useThemeColors();
  const navigation = useNavigation<NavigationProp>();
  const {t} = useTranslation();
  const [text, setText] = useState(PASSPORT_PASSING_SCORE);

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
    if (minScore === null) return;
    navigation.navigate('ActionInput', {
      circuit: 'human_passport_score',
      passportInputs: {minScore},
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

        <Button
          title={t('host.proof.humanPassport.continueButton')}
          onPress={handleContinue}
          disabled={minScore === null}
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
});
