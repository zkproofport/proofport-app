import React from 'react';
import {useTranslation} from 'react-i18next';
import {ScrollView, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {useProofUiColors} from '../theme/proofUi';
import {ProofUiIcon} from './ProofUiIcon';
import {formatReviewScalar, ReadonlyValue} from './ReadonlyValue';

function actionFields(action: unknown): Record<string, unknown> | undefined {
  return typeof action === 'object' && action !== null && !Array.isArray(action)
    ? action as Record<string, unknown> : undefined;
}

export const ActionReviewCard: React.FC<{action: unknown; onOpen: () => void}> = ({action, onOpen}) => {
  const {t} = useTranslation();
  const colors = useProofUiColors();
  return (
    <TouchableOpacity testID="request-action" accessibilityRole="button"
      accessibilityLabel={t('host.proofRequest.review.actionTitle')}
      onPress={onOpen} style={[styles.summary, {backgroundColor: colors.inset, borderColor: colors.border}]}>
      <View style={styles.summaryBody}>
        <Text style={[styles.eyebrow, {color: colors.secondary}]}>{t('host.proofRequest.review.actionTitle')}</Text>
        <Text style={[styles.primaryType, {color: colors.text}]}>{formatReviewScalar(actionFields(action)?.primaryType, t)}</Text>
      </View>
      <ProofUiIcon name="chevron-right" size={20} color={colors.muted} />
    </TouchableOpacity>
  );
};

/** Shares the review modal's native presentation so back closes details only. */
export const ActionReviewDetails: React.FC<{action: unknown; onClose: () => void}> = ({action, onClose}) => {
  const {t} = useTranslation();
  const colors = useProofUiColors();
  const fields = actionFields(action);
  const message = fields && actionFields(fields.message);
  const extra = fields ? Object.entries(fields).filter(([key]) => !['primaryType', 'domain', 'message', 'types'].includes(key)) : [];
  return (
    <View testID="action-review-details" style={styles.detailScreen}>
      <View style={styles.header}>
        <TouchableOpacity testID="action-review-back" accessibilityRole="button"
          accessibilityLabel={t('host.proofRequest.review.back')} onPress={onClose} style={styles.back}>
          <ProofUiIcon name="arrow-left" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.title, {color: colors.text}]}>{t('host.proofRequest.review.actionMessage')}</Text>
      </View>
      <ScrollView contentContainerStyle={styles.detailContent}>
        <View style={[styles.detailCard, {backgroundColor: colors.card, borderColor: colors.border}]}>
          {fields ? <>
            <ReadonlyValue label={t('host.proofRequest.review.primaryType')} value={fields.primaryType} />
            {message && Object.keys(message).length > 0
              ? Object.entries(message).map(([key, value]) => <ReadonlyValue key={key} label={key} value={value} showScalarType={false}
                initiallyExpanded={!Array.isArray(value) || value.length <= 4} />)
              : <ReadonlyValue label="message" value={fields.message} />}
            <ReadonlyValue label="domain" value={fields.domain} initiallyExpanded={false} />
            <ReadonlyValue label="types" value={fields.types} initiallyExpanded={false} />
            {extra.map(([key, value]) => <ReadonlyValue key={key} label={key} value={value} initiallyExpanded={false} />)}
          </> : <ReadonlyValue value={action} />}
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  summary: {flexDirection: 'row', alignItems: 'center', gap: 16, padding: 16, borderRadius: 10, borderWidth: 1},
  summaryBody: {flex: 1, gap: 7},
  eyebrow: {fontSize: 13, lineHeight: 18},
  primaryType: {fontSize: 16, lineHeight: 23, fontWeight: '600'},
  detailScreen: {flex: 1},
  header: {flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8},
  back: {width: 40, height: 44, justifyContent: 'center'},
  title: {fontSize: 19, lineHeight: 27, fontWeight: '700'},
  detailContent: {paddingHorizontal: 20, paddingTop: 14, paddingBottom: 32},
  detailCard: {paddingHorizontal: 18, paddingVertical: 8, borderRadius: 14, borderWidth: 1},
});
