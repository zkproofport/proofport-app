import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {useTranslation} from 'react-i18next';
import {useProofUiColors} from '../../theme/proofUi';
import {historyStatus} from '../../utils/historyPresentation';

export function HistoryStatusBadge({status, verification = false}: {status: string; verification?: boolean}) {
  const {t} = useTranslation();
  const colors = useProofUiColors();
  const presentation = historyStatus(status);
  const tones = {blue: colors.blue, gold: colors.gold, green: colors.green, red: colors.red};
  let label = t(presentation.labelKey);
  if (verification && status === 'generated') label = t('host.history.detail.verificationGenerated');
  if (verification && status === 'pending') label = t('host.history.detail.verificationPending');
  if (verification && status === 'failed') label = t('host.history.states.verified_failed');
  return <View style={[styles.badge, {borderColor: tones[presentation.tone], backgroundColor: colors.inset}]}>
    <Text style={[styles.label, {color: tones[presentation.tone]}]}>{label}</Text>
  </View>;
}
const styles = StyleSheet.create({
  badge: {alignSelf: 'flex-start', borderRadius: 14, borderWidth: 1, paddingHorizontal: 9, paddingVertical: 4},
  label: {fontSize: 11, lineHeight: 16, fontWeight: '600', flexShrink: 1},
});
