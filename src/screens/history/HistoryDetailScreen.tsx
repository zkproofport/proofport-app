import React, {useEffect, useRef, useState} from 'react';
import {ActivityIndicator, Alert, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import Clipboard from '@react-native-clipboard/clipboard';
import {useTranslation} from 'react-i18next';
import {useRoute, useNavigation, type RouteProp} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {HistoryStackParamList} from '../../navigation/types';
import {useError} from '../../context';
import {ProofUiIcon} from '../../components/ProofUiIcon';
import {ActionReviewCard, ActionReviewDetails} from '../../components/ActionReviewCard';
import {formatReviewScalar, ReadonlyValue} from '../../components/ReadonlyValue';
import {canonicalCircuitId} from '../../config/circuitIds';
import {proofHistoryStore, type ProofHistoryItem} from '../../stores';
import {useProofUiColors} from '../../theme/proofUi';
import {formatHistoryDate} from '../../utils/historyPresentation';
import {getProofRequestPresentation} from '../../utils/proofRequestPresentation';
import {HistoryStatusBadge} from './HistoryStatusBadge';
import {useHistoryRecords} from './useHistoryRecords';

function savedReview(value: ProofHistoryItem['review']): ProofHistoryItem['review'] {
  if (!value || value.version !== 1 || !value.inputs || typeof value.inputs !== 'object' || Array.isArray(value.inputs)) return undefined;
  const prototype = Object.getPrototypeOf(value.inputs);
  return prototype === Object.prototype || prototype === null ? value : undefined;
}

function TechnicalValue({id, label, value, provided = false}: {id: string; label: string; value?: unknown; provided?: boolean}) {
  const {t} = useTranslation();
  const colors = useProofUiColors();
  const {showError} = useError();
  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [value]);
  const present = provided || (typeof value === 'string' && value.length > 0);
  const copyable = present && (value === null || ['string', 'boolean', 'number'].includes(typeof value));
  return <View style={[styles.technicalValue, {borderColor: colors.border}]}>
    <ReadonlyValue layout="stacked"
      label={label} value={present ? value : t('host.history.detail.notRecorded')} />
    {copyable && <TouchableOpacity testID={`history-copy-${id}`} accessibilityRole="button"
      accessibilityLabel={t('host.history.detail.copyValue', {label})}
      style={styles.copy} onPress={() => {
        try {Clipboard.setString(typeof value === 'string' ? value : String(value)); setCopied(true);}
        catch (error) {showError('E5001', error instanceof Error ? error.message : String(error));}
      }}>
      <ProofUiIcon name={copied ? 'check' : 'copy'} size={16} color={colors.blue} />
      <Text style={[styles.copyText, {color: colors.blue}]}>{t(copied ? 'host.history.detail.copied' : 'host.history.detail.copy')}</Text>
    </TouchableOpacity>}
  </View>;
}

const HistoryDetailScreen: React.FC = () => {
  const {t, i18n} = useTranslation();
  const colors = useProofUiColors();
  const {showError} = useError();
  const route = useRoute<RouteProp<HistoryStackParamList, 'HistoryDetail'>>();
  const navigation = useNavigation<NativeStackNavigationProp<HistoryStackParamList>>();
  const {proofId} = route.params;
  const {items, loading, failed, refresh} = useHistoryRecords();
  const proof = items.find(item => item.id === proofId);
  const [technicalOpen, setTechnicalOpen] = useState(false);
  const [actionOpen, setActionOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);
  const deleteInFlight = useRef(false);
  const alive = useRef(true);
  useEffect(() => {alive.current = true; return () => {alive.current = false;};}, []);
  useEffect(() => {setTechnicalOpen(false); setActionOpen(false); setDeleteFailed(false);}, [proofId]);
  const goBack = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('HistoryMain');
  };
  const deleteRecord = () => {
    if (deleteInFlight.current) return;
    Alert.alert(t('host.history.detail.deleteRecordTitle'), t('host.history.detail.deleteRecordMessage'), [
      {text: t('common.cancel'), style: 'cancel'},
      {text: t('common.delete'), style: 'destructive', onPress: async () => {
        if (deleteInFlight.current) return;
        deleteInFlight.current = true;
        setDeleting(true); setDeleteFailed(false);
        try {await proofHistoryStore.remove(proofId); if (alive.current) goBack();}
        catch (error) {
          if (alive.current) {
            setDeleteFailed(true);
            showError('E5001', error instanceof Error ? error.message : String(error));
          }
        } finally {deleteInFlight.current = false; if (alive.current) setDeleting(false);}
      }},
    ]);
  };

  let content: React.ReactNode;
  if (loading) {
    content = <View style={styles.state}>
      <ActivityIndicator size="large" color={colors.blue} />
      <Text style={[styles.stateBody, {color: colors.secondary}]}>{t('host.history.detail.loadingText')}</Text>
    </View>;
  } else if (failed) {
    content = <View testID="history-load-error" style={styles.state}>
      <ProofUiIcon name="info" size={32} color={colors.gold} />
      <Text style={[styles.stateBody, {color: colors.text}]}>{t('host.history.home.errorText')}</Text>
      <TouchableOpacity testID="history-retry" accessibilityRole="button" onPress={refresh}
        style={[styles.primaryButton, {backgroundColor: colors.blue}]}>
        <Text style={styles.primaryText}>{t('host.history.home.retry')}</Text>
      </TouchableOpacity>
    </View>;
  } else if (!proof) {
    content = <View testID="history-record-missing" style={styles.state}>
      <ProofUiIcon name="document" size={34} color={colors.muted} />
      <Text style={[styles.stateTitle, {color: colors.text}]}>{t('host.history.detail.missingTitle')}</Text>
      <Text style={[styles.stateBody, {color: colors.secondary}]}>{t('host.history.detail.missingText')}</Text>
      <TouchableOpacity testID="history-back" accessibilityRole="button" onPress={goBack}
        style={[styles.primaryButton, {backgroundColor: colors.blue}]}>
        <Text style={styles.primaryText}>{t('host.history.detail.backToHistory')}</Text>
      </TouchableOpacity>
    </View>;
  } else {
    const circuit = canonicalCircuitId(proof.circuitId);
    if (!circuit) throw new Error(`Unknown history circuit '${proof.circuitId}'.`);
    const review = savedReview(proof.review);
    const presentation = getProofRequestPresentation({circuit, inputs: review?.inputs ?? {}}, t);
    const requester = proof.dappName ? formatReviewScalar(proof.dappName, t)
      : t(proof.source === 'deeplink' ? 'host.history.home.unknownRequester' : 'host.history.home.manual');
    const hasAction = review !== undefined && Object.prototype.hasOwnProperty.call(review, 'action');
    // The generation failure writer marks both channels failed before a proof exists.
    const verificationNotCompleted = proof.overallStatus === 'failed' && !proof.proofHash;
    content = <>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={[styles.heroIcon, {backgroundColor: colors.inset}]}>
            <ProofUiIcon name={presentation.icon} size={30} color={colors.blue} />
          </View>
          <View style={styles.heroBody}>
            <Text style={[styles.title, {color: colors.text}]}>{presentation.title}</Text>
            <Text style={[styles.date, {color: colors.secondary}]}>{formatHistoryDate(proof.timestamp, i18n.language)}</Text>
          </View>
        </View>
        <HistoryStatusBadge status={proof.overallStatus} />

        <View testID="history-requester" style={[styles.card, {backgroundColor: colors.card, borderColor: colors.border}]}>
          <Text style={[styles.sectionLabel, {color: colors.secondary}]}>{t('host.history.detail.requester')}</Text>
          <Text selectable style={[styles.requester, {color: colors.text}]}>{requester}</Text>
        </View>

        <View testID="history-conditions" style={[styles.card, {backgroundColor: colors.card, borderColor: colors.border}]}>
          <Text style={[styles.sectionTitle, {color: colors.text}]}>{t('host.history.detail.conditions')}</Text>
          {review ? <>
            {presentation.conditions.map((condition, index) => <ReadonlyValue key={`${condition.label}-${index}`}
              label={condition.label} value={condition.value} showScalarType={false} />)}
            {hasAction ? <ActionReviewCard action={review.action} onOpen={() => setActionOpen(true)} />
              : <Text style={[styles.note, {color: colors.secondary}]}>{t('host.history.detail.noAction')}</Text>}
          </> : <Text style={[styles.note, {color: colors.secondary}]}>{t('host.history.detail.notSaved')}</Text>}
        </View>

        <View style={[styles.card, {backgroundColor: colors.card, borderColor: colors.border}]}>
          <Text style={[styles.sectionTitle, {color: colors.text}]}>{t('host.history.detail.verificationStatus')}</Text>
          <Text style={[styles.note, {color: colors.secondary}]}>{t('host.history.detail.verificationNote')}</Text>
          <View testID="history-offchain" style={[styles.statusRow, {borderColor: colors.border}]}>
            <Text style={[styles.statusLabel, {color: colors.secondary}]}>{t('host.history.detail.offChain')}</Text>
            <HistoryStatusBadge status={verificationNotCompleted ? 'pending' : proof.offChainStatus} verification />
          </View>
          <View testID="history-onchain" style={[styles.statusRow, {borderColor: colors.border}]}>
            <Text style={[styles.statusLabel, {color: colors.secondary}]}>{t('host.history.detail.onChain')}</Text>
            <HistoryStatusBadge status={verificationNotCompleted ? 'pending' : proof.onChainStatus} verification />
          </View>
        </View>

        <View style={[styles.technicalCard, {backgroundColor: colors.card, borderColor: colors.border}]}>
          <TouchableOpacity testID="history-technical-toggle" accessibilityRole="button" accessibilityState={{expanded: technicalOpen}}
            onPress={() => setTechnicalOpen(open => !open)} style={styles.technicalHeader}>
            <View style={styles.heroBody}>
              <Text style={[styles.sectionTitle, {color: colors.text}]}>{t('host.history.detail.technical')}</Text>
              <Text style={[styles.note, {color: colors.muted}]}>{t('host.history.detail.technicalHint')}</Text>
            </View>
            <ProofUiIcon name={technicalOpen ? 'chevron-down' : 'chevron-right'} size={19} color={colors.muted} />
          </TouchableOpacity>
          {technicalOpen && <View testID="history-technical-details" style={styles.technicalBody}>
            <TechnicalValue id="network" label={t('host.history.detail.network')} value={proof.network} />
            <TechnicalValue id="wallet" label={t('host.history.detail.walletAddress')} value={proof.walletAddress} />
            <TechnicalValue id="verifier" label={t('host.history.detail.verifierContract')} value={proof.verifierAddress} />
            <TechnicalValue id="proof-hash" label={t('host.history.detail.proofHash')} value={proof.proofHash} />
            <TechnicalValue id="request-id" label={t('host.history.detail.requestId')} value={proof.requestId} />
            <TechnicalValue id="circuit" label={t('host.history.detail.circuitId')} value={proof.circuitId} />
            {review && Object.prototype.hasOwnProperty.call(review.inputs, 'scope') &&
              <TechnicalValue id="scope" label={t('host.history.detail.scope')} value={review.inputs.scope} provided />}
            {review && Object.prototype.hasOwnProperty.call(review.inputs, 'scopeString') &&
              <TechnicalValue id="scope-string" label={t('host.history.detail.scopeString')} value={review.inputs.scopeString} provided />}
          </View>}
        </View>
        {deleteFailed && <Text testID="history-delete-error" accessibilityLiveRegion="polite"
          style={[styles.note, {color: colors.red}]}>{t('host.history.detail.deleteFailed')}</Text>}
        <TouchableOpacity testID="history-delete" accessibilityRole="button" disabled={deleting}
          accessibilityState={{disabled: deleting}} onPress={deleteRecord} style={styles.deleteButton}>
          <ProofUiIcon name="trash" size={17} color={colors.red} />
          <Text style={[styles.deleteText, {color: colors.red}]}>{t(deleting ? 'host.history.detail.deleting' : 'host.history.detail.deleteRecord')}</Text>
        </TouchableOpacity>
      </ScrollView>
      {actionOpen && hasAction && <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setActionOpen(false)}>
        <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={[styles.screen, {backgroundColor: colors.background}]}>
          <ActionReviewDetails action={review!.action} onClose={() => setActionOpen(false)} />
        </SafeAreaView>
      </Modal>}
    </>;
  }
  return <SafeAreaView edges={['left', 'right', 'bottom']} style={[styles.screen, {backgroundColor: colors.background}]}>{content}</SafeAreaView>;
};
const styles = StyleSheet.create({
  screen: {flex: 1},
  content: {paddingHorizontal: 20, paddingTop: 18, paddingBottom: 28, gap: 18},
  hero: {flexDirection: 'row', alignItems: 'center', gap: 14},
  heroIcon: {width: 56, height: 56, borderRadius: 15, justifyContent: 'center', alignItems: 'center'},
  heroBody: {flex: 1, minWidth: 0},
  title: {fontSize: 23, lineHeight: 31, fontWeight: '700'},
  date: {fontSize: 12, lineHeight: 18, marginTop: 4},
  card: {padding: 17, borderWidth: 1, borderRadius: 14, gap: 8},
  sectionLabel: {fontSize: 12, lineHeight: 18},
  sectionTitle: {fontSize: 15, lineHeight: 22, fontWeight: '600'},
  requester: {fontSize: 17, lineHeight: 25, fontWeight: '600'},
  note: {fontSize: 13, lineHeight: 20},
  statusRow: {flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 14, paddingTop: 13, marginTop: 5, borderTopWidth: StyleSheet.hairlineWidth, flexWrap: 'wrap'},
  statusLabel: {fontSize: 13, lineHeight: 20, flexShrink: 1},
  technicalCard: {borderWidth: 1, borderRadius: 14},
  technicalHeader: {padding: 17, flexDirection: 'row', alignItems: 'center', gap: 12},
  technicalBody: {paddingHorizontal: 17, paddingBottom: 6},
  technicalValue: {paddingVertical: 9, borderTopWidth: StyleSheet.hairlineWidth},
  copy: {alignSelf: 'flex-start', flexDirection: 'row', gap: 7, alignItems: 'center', minHeight: 40},
  copyText: {fontSize: 12, fontWeight: '600'},
  deleteButton: {flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', minHeight: 44},
  deleteText: {fontSize: 13, fontWeight: '500'},
  state: {flex: 1, padding: 28, alignItems: 'center', justifyContent: 'center', gap: 16},
  stateTitle: {fontSize: 21, lineHeight: 29, fontWeight: '700', textAlign: 'center'},
  stateBody: {fontSize: 14, lineHeight: 22, textAlign: 'center'},
  primaryButton: {minHeight: 44, paddingHorizontal: 20, borderRadius: 10, justifyContent: 'center'},
  primaryText: {fontSize: 14, fontWeight: '600', color: '#FFFFFF'},
});
export default HistoryDetailScreen;
