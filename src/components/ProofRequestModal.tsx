import React from 'react';
import {useTranslation} from 'react-i18next';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Image,
} from 'react-native';
import {
  normalizeReturnScheme,
  type ProofRequest,
  type CoinbaseKycInputs,
  type OidcDomainInputs,
} from '../utils/deeplink';

interface ProofRequestModalProps {
  visible: boolean;
  request: ProofRequest | null;
  onAccept: () => void;
  onReject: () => void;
}

/**
 * Each circuit's icon, and WHERE its words live — not the words themselves.
 *
 * This file used to carry its own English name and description per circuit,
 * a second copy of what the circuit picker already had translated. On a Korean
 * phone the picker said "Coinbase KYC 인증" and this modal, the screen where a
 * person actually decides whether to hand over a proof, said "Coinbase KYC" in
 * English. Pointing at the picker's entries keeps one set of words.
 */
const CIRCUIT_INFO: Record<
  string,
  {icon: string; nameKey: string; descriptionKey: string; prefixKey?: string}
> = {
  coinbase_attestation: {
    icon: '🏦',
    nameKey: 'host.proof.circuitSelection.coinbaseKyc.title',
    descriptionKey: 'host.proof.circuitSelection.coinbaseKyc.description',
  },
  coinbase_country_attestation: {
    icon: '🌍',
    nameKey: 'host.proof.circuitSelection.coinbaseCountry.title',
    descriptionKey: 'host.proof.circuitSelection.coinbaseCountry.description',
  },
  oidc_domain_attestation: {
    icon: '🔐',
    nameKey: 'host.proof.circuitSelection.oidcDomain.title',
    descriptionKey: 'host.proof.circuitSelection.oidcDomain.description',
  },
  giwa_attestation: {
    icon: '🏯',
    nameKey: 'host.proof.circuitSelection.giwaKyc.title',
    descriptionKey: 'host.proof.circuitSelection.giwaKyc.description',
  },
  // The three Korea mobile ID entries are named "Ownership" / "Age" / "Region"
  // in the picker, where they sit under a "Korea Mobile ID" heading that
  // supplies the context. Alone in this modal they would be meaningless, so
  // the heading is prefixed back on.
  mdl_kr_ownership: {
    icon: '🪪',
    prefixKey: 'host.proof.circuitSelection.mdlKr.title',
    nameKey: 'host.proof.circuitSelection.mdlKrOwnership.title',
    descriptionKey: 'host.proof.circuitSelection.mdlKrOwnership.description',
  },
  mdl_kr_age: {
    icon: '🪪',
    prefixKey: 'host.proof.circuitSelection.mdlKr.title',
    nameKey: 'host.proof.circuitSelection.mdlKrAge.title',
    descriptionKey: 'host.proof.circuitSelection.mdlKrAge.description',
  },
  mdl_kr_region: {
    icon: '🪪',
    prefixKey: 'host.proof.circuitSelection.mdlKr.title',
    nameKey: 'host.proof.circuitSelection.mdlKrRegion.title',
    descriptionKey: 'host.proof.circuitSelection.mdlKrRegion.description',
  },
};

export const ProofRequestModal: React.FC<ProofRequestModalProps> = ({
  visible,
  request,
  onAccept,
  onReject,
}) => {
  const {t} = useTranslation();

  if (!request) return null;

  const circuitInfo = CIRCUIT_INFO[request.circuit];
  // A request naming a circuit this build does not know must still render —
  // the person needs to see who is asking and be able to refuse.
  const circuitName = circuitInfo
    ? [circuitInfo.prefixKey && t(circuitInfo.prefixKey), t(circuitInfo.nameKey)]
        .filter(Boolean)
        .join(' — ')
    : request.circuit;
  const circuitDescription = circuitInfo ? t(circuitInfo.descriptionKey) : '';
  const inputs = request.inputs as CoinbaseKycInputs;
  // Shown so the user consents to the app switch as part of consenting to the
  // proof — a request can name any app, and "the proof app opened this" should
  // never be a surprise. Runs through the same normaliser the switch uses, so
  // what is displayed is exactly what will be opened.
  const returnTarget = normalizeReturnScheme(request.returnScheme);

  function formatTime(timestamp?: number): string {
    if (!timestamp) return t('host.proofRequest.noExpiry');
    return new Date(timestamp).toLocaleTimeString();
  }

  function getDappHost(url: string): string {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onReject}>
      <View style={styles.overlay}>
        <View style={styles.container}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.headerIcon}>{circuitInfo?.icon ?? '🔐'}</Text>
            <Text style={styles.headerTitle}>{t('host.proofRequest.title')}</Text>
          </View>

          <ScrollView style={styles.content}>
            {/* Dapp Info */}
            <View style={styles.dappSection}>
              {request.dappIcon && (
                <Image
                  source={{uri: request.dappIcon}}
                  style={styles.dappIcon}
                />
              )}
              <View style={styles.dappInfo}>
                <Text style={styles.dappName}>
                  {request.dappName || t('host.proofRequest.unknownSite')}
                </Text>
                <Text style={styles.dappUrl}>
                  {getDappHost(request.callbackUrl)}
                </Text>
              </View>
            </View>

            {/* Request Details */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{circuitName}</Text>
              <Text style={styles.sectionDescription}>{circuitDescription}</Text>
            </View>

            {/* Message */}
            {request.message && (
              <View style={styles.messageBox}>
                <Text style={styles.messageText}>{request.message}</Text>
              </View>
            )}

            {/* Input Details */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>{t('host.proofRequest.details')}</Text>

              <View style={styles.inputsList}>
                {request.circuit === 'oidc_domain_attestation' ? (
                  <View style={styles.inputRow}>
                    <Text style={styles.inputLabel}>{t('host.proofRequest.domain')}</Text>
                    <Text style={styles.inputValue} numberOfLines={1}>
                      {(request.inputs as OidcDomainInputs).domain}
                    </Text>
                  </View>
                ) : (
                  <View style={styles.inputRow}>
                    <Text style={styles.inputLabel}>{t('host.proofRequest.walletAddress')}</Text>
                    <Text style={styles.inputValue} numberOfLines={1}>
                      {(request.inputs as CoinbaseKycInputs).userAddress
                        ? `${(request.inputs as CoinbaseKycInputs).userAddress!.slice(0, 10)}...${(request.inputs as CoinbaseKycInputs).userAddress!.slice(-8)}`
                        : t('host.proofRequest.willConnectWallet')}
                    </Text>
                  </View>
                )}

                {returnTarget && (
                  <View style={styles.inputRow}>
                    <Text style={styles.inputLabel}>{t('host.proofRequest.returnsTo')}</Text>
                    <Text style={styles.inputValue} numberOfLines={1}>
                      {returnTarget}
                    </Text>
                  </View>
                )}
              </View>
            </View>

            {/* Expiry Info */}
            <View style={styles.expiryInfo}>
              <Text style={styles.expiryLabel}>{t('host.proofRequest.requestId')}: </Text>
              <Text style={styles.expiryValue}>{request.requestId}</Text>
            </View>
            {request.expiresAt && (
              <View style={styles.expiryInfo}>
                <Text style={styles.expiryLabel}>{t('host.proofRequest.expiresAt')}: </Text>
                <Text style={styles.expiryValue}>
                  {formatTime(request.expiresAt)}
                </Text>
              </View>
            )}
          </ScrollView>

          {/* Actions */}
          <View style={styles.actions}>
            <TouchableOpacity
              style={[styles.button, styles.rejectButton]}
              onPress={onReject}>
              <Text style={styles.rejectButtonText}>{t('host.proofRequest.reject')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.acceptButton]}
              onPress={onAccept}>
              <Text style={styles.acceptButtonText}>{t('host.proofRequest.generate')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'flex-end',
  },
  container: {
    backgroundColor: '#1e293b',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '80%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
  },
  headerIcon: {
    fontSize: 28,
    marginRight: 10,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#f1f5f9',
  },
  content: {
    padding: 20,
  },
  dappSection: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0f172a',
    padding: 16,
    borderRadius: 12,
    marginBottom: 20,
  },
  dappIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    marginRight: 12,
  },
  dappInfo: {
    flex: 1,
  },
  dappName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#f1f5f9',
    marginBottom: 4,
  },
  dappUrl: {
    fontSize: 14,
    color: '#94a3b8',
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#f1f5f9',
    marginBottom: 8,
  },
  sectionDescription: {
    fontSize: 14,
    color: '#94a3b8',
    lineHeight: 20,
  },
  messageBox: {
    backgroundColor: 'rgba(99, 102, 241, 0.1)',
    borderWidth: 1,
    borderColor: '#6366f1',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  messageText: {
    fontSize: 14,
    color: '#a5b4fc',
    lineHeight: 20,
  },
  inputsList: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    padding: 4,
  },
  inputRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  inputLabel: {
    fontSize: 14,
    color: '#94a3b8',
  },
  inputValue: {
    fontSize: 14,
    color: '#f1f5f9',
    fontWeight: '500',
  },
  privateTag: {
    fontSize: 12,
    color: '#22c55e',
    fontStyle: 'italic',
  },
  expiryInfo: {
    flexDirection: 'row',
    marginBottom: 4,
  },
  expiryLabel: {
    fontSize: 12,
    color: '#64748b',
  },
  expiryValue: {
    fontSize: 12,
    color: '#94a3b8',
    fontFamily: 'monospace',
  },
  actions: {
    flexDirection: 'row',
    padding: 20,
    borderTopWidth: 1,
    borderTopColor: '#334155',
    gap: 12,
  },
  button: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  rejectButton: {
    backgroundColor: '#334155',
  },
  rejectButtonText: {
    color: '#f1f5f9',
    fontSize: 16,
    fontWeight: '600',
  },
  acceptButton: {
    backgroundColor: '#6366f1',
  },
  acceptButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default ProofRequestModal;
