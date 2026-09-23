import React, {useEffect, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {Modal, View, Text, StyleSheet, TouchableOpacity, ScrollView, Image} from 'react-native';
import {SafeAreaProvider, SafeAreaView} from 'react-native-safe-area-context';
import {normalizeReturnScheme, type ProofRequest} from '../utils/deeplink';
import {isCircuitId} from '../config/circuitIds';
import {useProofUiColors} from '../theme/proofUi';
import {deliveryHost, reviewBlockReason} from '../utils/requestReview';
import {getProofRequestPresentation} from '../utils/proofRequestPresentation';
import {formatReviewScalar, ReadonlyValue} from './ReadonlyValue';
import {ProofUiIcon} from './ProofUiIcon';
import {ActionReviewCard, ActionReviewDetails} from './ActionReviewCard';

interface ProofRequestModalProps {
  visible: boolean;
  request: ProofRequest | null;
  onAccept: (reviewedRequest: ProofRequest) => boolean;
  onReject: () => void;
  onDismiss?: () => void;
}

export const ProofRequestModal: React.FC<ProofRequestModalProps> = ({
  visible, request: incomingRequest, onAccept, onReject, onDismiss,
}) => {
  // Keep the native host and its last content mounted while iOS dismisses it.
  // Removing it at visible=false loses the dismissal acknowledgement.
  const closingRequest = useRef<ProofRequest | null>(null);
  if (visible && incomingRequest) closingRequest.current = incomingRequest;
  const request = visible ? incomingRequest : closingRequest.current;
  const {t} = useTranslation();
  const colors = useProofUiColors();
  const [now, setNow] = useState(Date.now);
  const [handledRequest, setHandledRequest] = useState<ProofRequest | null>(null);
  const [detailsFor, setDetailsFor] = useState<ProofRequest | null>(null);
  const [actionFor, setActionFor] = useState<ProofRequest | null>(null);
  const actionOpen = actionFor !== null && actionFor === request;
  const handled = useRef(new WeakSet<ProofRequest>());
  // An event retained from the previous review may never approve its successor.
  const current = useRef({request, visible, actionOpen});
  current.current = {request: incomingRequest, visible, actionOpen};

  useEffect(() => {
    setNow(Date.now());
    if (!visible || request?.expiresAt === undefined) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [visible, request]);

  if (!request) return null;

  const presentation = isCircuitId(request.circuit) ? getProofRequestPresentation(request, t) : undefined;
  const blocked = reviewBlockReason(request, now);
  const finished = handledRequest === request;
  const detailsExpanded = detailsFor === request;
  const returnTarget = normalizeReturnScheme(request.returnScheme);
  const inputs = request.inputs as {action?: unknown};
  const action = inputs?.action;
  const primary = {color: colors.text};
  const secondary = {color: colors.secondary};
  const inset = [styles.inset, {backgroundColor: colors.inset, borderColor: colors.border}];
  const requesterName = typeof request.dappName === 'string' && request.dappName
    ? formatReviewScalar(request.dappName, t) : t('host.proofRequest.unknownSite');

  function canHandle() {
    return current.current.visible && current.current.request === request && !handled.current.has(request!);
  }
  function accept() {
    if (!canHandle() || current.current.actionOpen || reviewBlockReason(request!)) {
      setNow(Date.now());
      return;
    }
    // The parent revalidates against its pending request and current clock.
    // A refused start must leave cancellation and a valid retry available.
    if (onAccept(request!) !== true) {
      setNow(Date.now());
      return;
    }
    handled.current.add(request!);
    setHandledRequest(request);
  }
  function reject() {
    if (!canHandle()) return;
    handled.current.add(request!);
    setHandledRequest(request);
    onReject();
  }

  function closeAction() {
    if (current.current.request === request) {
      current.current.actionOpen = false;
      setActionFor(null);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent={false}
      onDismiss={() => {closingRequest.current = null; onDismiss?.();}}
      presentationStyle="fullScreen" onRequestClose={actionOpen ? closeAction : reject}>
      <SafeAreaProvider>
      <SafeAreaView style={[styles.screen, {backgroundColor: colors.background}]}>
        {actionOpen ? <ActionReviewDetails action={action} onClose={closeAction} /> : <>
          <View style={styles.header}>
            <TouchableOpacity testID="request-back" accessibilityRole="button"
              accessibilityLabel={t('host.proofRequest.review.back')} onPress={reject}
              disabled={finished} style={styles.back}>
              <ProofUiIcon name="arrow-left" size={24} color={colors.text} />
            </TouchableOpacity>
            <Text style={[styles.headerTitle, primary]}>{t('host.proofRequest.review.title')}</Text>
          </View>
          <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
            <View testID="request-card" style={[styles.card, {backgroundColor: colors.card, borderColor: colors.border}]}>
              <View style={styles.identity}>
                {typeof request.dappIcon === 'string' && request.dappIcon
                  ? <Image source={{uri: request.dappIcon}} style={styles.dappIcon} accessibilityLabel={requesterName} />
                  : <View style={[styles.dappIcon, styles.initialTile, {backgroundColor: colors.inset, borderColor: colors.border}]}>
                    <Text style={[styles.initial, primary]}>{Array.from(requesterName)[0]}</Text>
                  </View>}
                <View style={styles.requesterBody}>
                  <Text selectable style={[styles.requester, secondary]}>{requesterName}</Text>
                  {request.dappName !== undefined && typeof request.dappName !== 'string'
                    && <ReadonlyValue label="dappName" value={request.dappName} />}
                  <Text lineBreakStrategyIOS="hangul-word" style={[styles.requestTitle, primary]}>{presentation?.title ?? t('host.proofRequest.review.unsupported')}</Text>
                  {request.message !== undefined && (typeof request.message === 'string'
                    ? <Text selectable style={[styles.message, secondary]}>{formatReviewScalar(request.message, t)}</Text>
                    : <ReadonlyValue label="message" value={request.message} />)}
                </View>
              </View>

              <View style={inset}>
                <Text style={[styles.eyebrow, secondary]}>{t('host.proofRequest.review.proofCondition')}</Text>
                <View style={styles.conditionBody}>
                  <View style={styles.conditionIcon}><ProofUiIcon name={presentation?.icon ?? 'info'} size={24} color={colors.secondary} /></View>
                  <View style={styles.conditionValues}>
                    {presentation ? presentation.conditions.map(({label, value}, index) => (
                      <ReadonlyValue key={`${index}-${label}`} label={label || undefined} value={value}
                        layout="stacked" />
                    )) : <ReadonlyValue value={request.circuit} />}
                  </View>
                </View>
              </View>

              {presentation && <View style={[inset, styles.disclosures]}>
                <View style={styles.disclosureRow}>
                  <ProofUiIcon name="shield" size={20} color={colors.secondary} />
                  <View style={styles.disclosureBody}>
                    <Text style={[styles.disclosureTitle, primary]}>{t('host.proofRequest.review.sharedTitle')}</Text>
                    <Text lineBreakStrategyIOS="hangul-word" style={[styles.note, secondary]}>{presentation.shared}</Text>
                  </View>
                </View>
                <View style={styles.disclosureRow}>
                  <ProofUiIcon name="eye-off" size={20} color={colors.secondary} />
                  <View style={styles.disclosureBody}>
                    <Text style={[styles.disclosureTitle, primary]}>{t('host.proofRequest.review.privateTitle')}</Text>
                    <Text lineBreakStrategyIOS="hangul-word" style={[styles.note, secondary]}>{presentation.private}</Text>
                  </View>
                </View>
              </View>}

              {action !== undefined && <ActionReviewCard action={action} onOpen={() => {
                if (canHandle()) {
                  current.current.actionOpen = true;
                  setActionFor(request);
                }
              }} />}

              <View style={inset}>
                <TouchableOpacity testID="request-details" accessibilityRole="button"
                  accessibilityState={{expanded: detailsExpanded}}
                  onPress={() => setDetailsFor(detailsExpanded ? null : request)} style={styles.detailsToggle}>
                  <Text style={[styles.detailsTitle, primary]}>{t('host.proofRequest.review.technicalDetails')}</Text>
                  <ProofUiIcon name={detailsExpanded ? 'chevron-down' : 'chevron-right'} size={18} color={colors.muted} />
                </TouchableOpacity>
                {detailsExpanded && <>
                  <ReadonlyValue label="requestId" value={request.requestId} />
                  <ReadonlyValue label="circuit" value={request.circuit} />
                  <ReadonlyValue label={t('host.proofRequest.review.deliveryEndpoint')} value={deliveryHost(request.callbackUrl)} />
                  <Text style={[styles.note, secondary]}>{t('host.proofRequest.review.deliveryDescription')}</Text>
                  <ReadonlyValue label="callbackUrl" value={request.callbackUrl} />
                  <ReadonlyValue label={t('host.proofRequest.expiresAt')} value={request.expiresAt === undefined
                    ? t('host.proofRequest.noExpiry')
                    : Number.isFinite(request.expiresAt) && Math.abs(request.expiresAt) <= 8640000000000000
                      ? new Date(request.expiresAt).toLocaleString() : String(request.expiresAt)} />
                  {returnTarget && <ReadonlyValue label={t('host.proofRequest.returnsTo')} value={returnTarget} />}
                  <ReadonlyValue label={t('host.proofRequest.review.originalRequest')} value={request} initiallyExpanded={false} />
                </>}
              </View>

              <View style={styles.infoRow}>
                <ProofUiIcon name="info" size={16} color={colors.muted} />
                <Text style={[styles.infoText, {color: colors.muted}]}>{t('host.proofRequest.review.checkRequest')}</Text>
              </View>
              {blocked && <Text accessibilityRole="alert" style={[styles.note, {color: colors.gold}]}>{t(`host.proofRequest.review.${blocked}`)}</Text>}
              <View style={styles.actions}>
                <TouchableOpacity testID="request-accept" accessibilityRole="button"
                  accessibilityState={{disabled: !!blocked || finished}} disabled={!!blocked || finished}
                  style={[styles.button, {backgroundColor: colors.blue}, (blocked || finished) && styles.disabled]} onPress={accept}>
                  <Text style={[styles.buttonText, styles.confirmText]}>{t('host.proofRequest.review.confirm')}</Text>
                </TouchableOpacity>
                <TouchableOpacity testID="request-reject" accessibilityRole="button" disabled={finished}
                  style={[styles.button, styles.cancel, {borderColor: colors.border}]} onPress={reject}>
                  <Text style={[styles.buttonText, primary]}>{t('host.proofRequest.review.cancel')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </>}
      </SafeAreaView>
      </SafeAreaProvider>
    </Modal>
  );
};

const styles = StyleSheet.create({
  screen: {flex: 1},
  header: {flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8},
  back: {width: 40, minHeight: 44, justifyContent: 'center'},
  headerTitle: {fontSize: 19, lineHeight: 27, fontWeight: '700', flexShrink: 1},
  scroll: {flex: 1},
  content: {paddingHorizontal: 20, paddingTop: 14, paddingBottom: 32},
  card: {padding: 20, borderRadius: 16, borderWidth: 1, gap: 16},
  identity: {flexDirection: 'row', alignItems: 'flex-start', gap: 14, paddingBottom: 5},
  dappIcon: {width: 52, height: 52, borderRadius: 12},
  initialTile: {alignItems: 'center', justifyContent: 'center', borderWidth: 1},
  initial: {fontSize: 24, lineHeight: 32, fontWeight: '600'},
  requesterBody: {flex: 1, gap: 5},
  requester: {fontSize: 12, lineHeight: 17},
  requestTitle: {fontSize: 20, lineHeight: 29, fontWeight: '700'},
  message: {fontSize: 13, lineHeight: 20},
  inset: {paddingHorizontal: 14, paddingVertical: 12, borderRadius: 10, borderWidth: 1},
  eyebrow: {fontSize: 12, lineHeight: 18},
  conditionBody: {flexDirection: 'row', alignItems: 'center', gap: 10},
  conditionIcon: {paddingVertical: 12},
  conditionValues: {flex: 1, minWidth: 0},
  disclosures: {gap: 16, paddingVertical: 16},
  disclosureRow: {flexDirection: 'row', alignItems: 'flex-start', gap: 10},
  disclosureBody: {flex: 1, gap: 4},
  disclosureTitle: {fontSize: 13, lineHeight: 18, fontWeight: '600'},
  note: {fontSize: 12, lineHeight: 19},
  detailsToggle: {minHeight: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12},
  detailsTitle: {fontSize: 13, lineHeight: 20},
  infoRow: {flexDirection: 'row', alignItems: 'center', gap: 7},
  infoText: {fontSize: 11, lineHeight: 17, flex: 1},
  actions: {gap: 10},
  button: {minHeight: 46, padding: 12, borderRadius: 9, alignItems: 'center', justifyContent: 'center'},
  cancel: {borderWidth: 1},
  buttonText: {fontSize: 15, lineHeight: 22, fontWeight: '600'},
  confirmText: {color: '#FFFFFF'},
  disabled: {opacity: 0.45},
});

export default ProofRequestModal;
