import React from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {useTranslation} from 'react-i18next';
import {useProofUiColors} from '../../theme/proofUi';
import {historyStatus, isHistoryStatus} from '../../utils/historyPresentation';
import {formatReviewScalar} from '../../components/ReadonlyValue';

/**
 * A record's status. History is plain text (historyRecordText.ts): a status
 * this build does not name -- a damaged or foreign record -- is shown as the
 * raw stored value, never thrown on.
 */
export function HistoryStatusBadge({status, verification = false}: {status: unknown; verification?: boolean}) {
  const {t} = useTranslation();
  const colors = useProofUiColors();
  if (!isHistoryStatus(status)) {
    const raw = status === undefined ? t('host.history.detail.notRecorded') : formatReviewScalar(status, t);
    return <View style={[styles.badge, {borderColor: colors.muted, backgroundColor: colors.inset}]}>
      <Text style={[styles.label, {color: colors.muted}]}>{raw}</Text>
    </View>;
  }
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
