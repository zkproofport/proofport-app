import React, {useState, useEffect, useRef} from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  ScrollView,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import {useRoute, useNavigation, RouteProp} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {useTranslation} from 'react-i18next';
import {Icon, Badge, Button, Card} from '../../components/ui';
import {useThemeColors} from '../../context';
import type {ProofStackParamList} from '../../navigation/types';
import {useCoinbaseKyc, useCoinbaseCountry, useOidcDomain, useGiwaKyc, useLogs} from '../../hooks';
import {useMdlKr} from '../../hooks/useMdlKr';
import {proofHistoryStore} from '../../stores';
import {getVerifierAddressSync, getNetworkConfig, getNetworkConfigForCircuit} from '../../config';
import {findGiwaAttestationTransaction} from '../../utils';

type ProofCompleteRouteProp = RouteProp<ProofStackParamList, 'ProofComplete'>;
type NavigationProp = NativeStackNavigationProp<ProofStackParamList, 'ProofComplete'>;

const CIRCUIT_DISPLAY_NAMES: Record<string, string> = {
  'coinbase-kyc': 'Coinbase KYC',
  'coinbase-country': 'Coinbase Country',
  'oidc_domain_attestation': 'OIDC Domain',
  'giwa-kyc': 'GIWA KYC',
  'giwa_attestation': 'GIWA KYC',
  'mdl-kr-ownership': 'Korea Mobile ID — Ownership',
  'mdl-kr-age': 'Korea Mobile ID — Age',
  'mdl-kr-region': 'Korea Mobile ID — Region',
  // Canonical underscore ids — deep links / OpenStoa login arrive with these.
  'mdl_kr_ownership': 'Korea Mobile ID — Ownership',
  'mdl_kr_age': 'Korea Mobile ID — Age',
  'mdl_kr_region': 'Korea Mobile ID — Region',
};

export const ProofCompleteScreen: React.FC = () => {
  const { colors: themeColors } = useThemeColors();
  const route = useRoute<ProofCompleteRouteProp>();
  const navigation = useNavigation<NavigationProp>();
  const { t } = useTranslation();

  const params = route.params || {} as any;
  const proofHex = params.proofHex || '0x0000000000000000';
  const circuitId = params.circuitId || 'coinbase-kyc';
  const timestamp = params.timestamp || Date.now().toString();
  const verification = params.verification || {
    offChain: null,
    onChain: null,
    verifierContract: getVerifierAddressSync('coinbase_attestation'),
    chainName: getNetworkConfig().name,
    explorerUrl: getNetworkConfig().explorerUrl,
  };
  const walletAddress = params.walletAddress;
  const historyIdFromParams = params.historyId || null;

  const shortProofHash = proofHex.length > 18
    ? `${proofHex.slice(0, 10)}...${proofHex.slice(-8)}`
    : proofHex;
  const formattedDate = new Date(parseInt(timestamp)).toLocaleString();
  const circuitName = CIRCUIT_DISPLAY_NAMES[circuitId] || circuitId;

  const [offChainStatus, setOffChainStatus] = useState<'generated' | 'loading' | 'verified' | 'failed'>('generated');
  const [onChainStatus, setOnChainStatus] = useState<'generated' | 'loading' | 'verified' | 'failed'>('generated');

  const isCountryCircuit = circuitId === 'coinbase-country';
  const isOidcCircuit = circuitId === 'oidc_domain_attestation';
  const isGiwaCircuit = circuitId === 'giwa-kyc' || circuitId === 'giwa_attestation';
  const mdlVariant: 'ownership' | 'age' | 'region' | null =
    circuitId === 'mdl-kr-ownership' || circuitId === 'mdl_kr_ownership' ? 'ownership'
    : circuitId === 'mdl-kr-age' || circuitId === 'mdl_kr_age' ? 'age'
    : circuitId === 'mdl-kr-region' || circuitId === 'mdl_kr_region' ? 'region'
    : null;
  const isMdlCircuit = mdlVariant !== null;
  const kycHook = useCoinbaseKyc();
  const countryHook = useCoinbaseCountry();
  const oidcHook = useOidcDomain();
  const giwaHook = useGiwaKyc();
  // useMdlKr requires a variant at hook init. When this screen is not
  // serving an mDL proof, the hook still mounts (rules of hooks) but
  // is never driven.
  const mdlHook = useMdlKr(mdlVariant ?? 'ownership');
  const activeHook = isMdlCircuit
    ? mdlHook
    : isOidcCircuit
    ? oidcHook
    : isGiwaCircuit
    ? giwaHook
    : (isCountryCircuit ? countryHook : kycHook);
  const {verifyProofOffChain, verifyProofOnChain, resetProofCache} = activeHook;
  const {logs, addLog} = useLogs();

  const handleCopyProof = () => {
    Clipboard.setString(proofHex);
    Alert.alert(t('host.proof.complete.copiedTitle'), t('host.proof.complete.copiedMessage'));
  };

  const handleVerifyOffChain = async () => {
    setOffChainStatus('loading');
    console.log('[History] Updating off-chain status with ID:', historyIdFromParams);
    try {
      const result = await verifyProofOffChain(addLog);
      const newStatus = result ? 'verified' : 'failed';
      setOffChainStatus(newStatus);
      if (historyIdFromParams) {
        proofHistoryStore.update(historyIdFromParams, {
          offChainStatus: result ? 'verified' : 'failed',
          overallStatus: result ? 'verified' : 'verified_failed',
        }).catch(console.error);
      }
    } catch {
      setOffChainStatus('failed');
      if (historyIdFromParams) {
        proofHistoryStore.update(historyIdFromParams, {
          offChainStatus: 'failed',
          overallStatus: 'verified_failed',
        }).catch(console.error);
      }
    }
  };

  const handleVerifyOnChain = async () => {
    setOnChainStatus('loading');
    console.log('[History] Updating on-chain status with ID:', historyIdFromParams);
    try {
      const result = await verifyProofOnChain(addLog);
      const newStatus = result ? 'verified' : 'failed';
      setOnChainStatus(newStatus);
      if (historyIdFromParams) {
        proofHistoryStore.update(historyIdFromParams, {
          onChainStatus: result ? 'verified' : 'failed',
          overallStatus: result ? 'verified' : 'verified_failed',
        }).catch(console.error);
      }
    } catch {
      setOnChainStatus('failed');
      if (historyIdFromParams) {
        proofHistoryStore.update(historyIdFromParams, {
          onChainStatus: 'failed',
          overallStatus: 'verified_failed',
        }).catch(console.error);
      }
    }
  };

  const handleViewEASScan = async () => {
    const addr = walletAddress || '';
    if (isGiwaCircuit) {
      // GIWA has no easscan — link directly to the attestation tx on
      // the explorer pulled from CIRCUIT_NETWORK_OVERRIDES.giwa_attestation
      // so the URL stays in one place if the explorer ever moves.
      const explorer = getNetworkConfigForCircuit('giwa_attestation').explorerUrl;
      try {
        const result = await findGiwaAttestationTransaction(addr);
        if (result?.attestation.txHash) {
          navigation.navigate('InAppBrowser', {
            url: `${explorer}/tx/${result.attestation.txHash}`,
            title: 'Transaction',
          });
          return;
        }
      } catch (e) {
        console.warn('[GIWA] tx lookup failed, falling back to address view:', e);
      }
      navigation.navigate('InAppBrowser', {
        url: `${explorer}/address/${addr}`,
        title: 'Explorer',
      });
      return;
    }
    navigation.navigate('InAppBrowser', {
      url: `https://base.easscan.org/address/${addr}`,
      title: 'EAS Scan',
    });
  };

  const handleGenerateAnother = () => {
    resetProofCache();
    navigation.popToTop();
  };

  return (
    <SafeAreaView style={{flex: 1, backgroundColor: themeColors.background.primary}}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}>
        <View style={styles.successSection}>
          <View style={{width: 80, height: 80, borderRadius: 40, backgroundColor: themeColors.success.background, borderWidth: 3, borderColor: themeColors.success[500], justifyContent: 'center', alignItems: 'center', marginBottom: 24}}>
            <Icon name="check" size="xl" color={themeColors.success[400]} />
          </View>
          <Text style={{fontSize: 28, fontWeight: '700', color: themeColors.text.primary, marginBottom: 8}}>
            {t('host.proof.complete.successTitle')}
          </Text>
          <Text style={{fontSize: 15, color: themeColors.text.secondary, textAlign: 'center', lineHeight: 22}}>
            {t('host.proof.complete.successDescription')}
          </Text>
        </View>

        <Card style={styles.proofHashCard}>
          <View style={styles.proofHashHeader}>
            <Text style={{fontSize: 12, fontWeight: '600', color: themeColors.text.secondary, letterSpacing: 0.5, textTransform: 'uppercase'}}>
              {t('host.proof.complete.proofHashLabel')}
            </Text>
            <TouchableOpacity
              onPress={handleCopyProof}
              style={styles.copyButton}
              activeOpacity={0.7}>
              <Icon name="copy" size="sm" color={themeColors.text.secondary} />
            </TouchableOpacity>
          </View>
          <Text style={{fontSize: 16, fontWeight: '500', color: themeColors.info[400], fontFamily: 'monospace'}}>{shortProofHash}</Text>
        </Card>

        <Card style={styles.detailsCard}>
          <Text style={{fontSize: 14, fontWeight: '600', color: themeColors.text.secondary, letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 16}}>
            {t('host.proof.complete.proofDetailsLabel')}
          </Text>

          <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12}}>
            <Text style={{fontSize: 15, color: themeColors.text.secondary}}>{t('host.proof.complete.offChain')}</Text>
            {offChainStatus === 'generated' ? (
              <TouchableOpacity onPress={handleVerifyOffChain} style={{backgroundColor: themeColors.info[500], paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8}}>
                <Text style={{color: '#FFFFFF', fontSize: 13, fontWeight: '600'}}>{t('host.proof.complete.verifyButton')}</Text>
              </TouchableOpacity>
            ) : offChainStatus === 'loading' ? (
              <ActivityIndicator size="small" color={themeColors.info[400]} />
            ) : (
              <Badge
                variant={offChainStatus === 'verified' ? 'success' : 'error'}
                text={offChainStatus === 'verified' ? t('host.proof.complete.verified') : t('host.proof.complete.failed')}
              />
            )}
          </View>

          <View style={{height: 1, backgroundColor: themeColors.border.primary}} />

          <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12}}>
            <Text style={{fontSize: 15, color: themeColors.text.secondary}}>{t('host.proof.complete.onChain')}</Text>
            {onChainStatus === 'generated' ? (
              <TouchableOpacity onPress={handleVerifyOnChain} style={{backgroundColor: themeColors.info[500], paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8}}>
                <Text style={{color: '#FFFFFF', fontSize: 13, fontWeight: '600'}}>{t('host.proof.complete.verifyButton')}</Text>
              </TouchableOpacity>
            ) : onChainStatus === 'loading' ? (
              <ActivityIndicator size="small" color={themeColors.info[400]} />
            ) : (
              <Badge
                variant={onChainStatus === 'verified' ? 'success' : 'error'}
                text={onChainStatus === 'verified' ? t('host.proof.complete.verified') : t('host.proof.complete.failed')}
              />
            )}
          </View>

          <View style={{height: 1, backgroundColor: themeColors.border.primary}} />

          <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12}}>
            <Text style={{fontSize: 15, color: themeColors.text.secondary}}>{t('host.proof.complete.verificationChain')}</Text>
            <View style={{flexDirection: 'row', alignItems: 'center'}}>
              <View style={styles.chainBadge}>
                <View style={{width: 8, height: 8, borderRadius: 4, backgroundColor: themeColors.info[500], marginRight: 6}} />
                <Text style={{fontSize: 13, fontWeight: '600', color: themeColors.info[400]}}>{verification.chainName}</Text>
              </View>
            </View>
          </View>

          <View style={{height: 1, backgroundColor: themeColors.border.primary}} />

          <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12}}>
            <Text style={{fontSize: 15, color: themeColors.text.secondary}}>{t('host.proof.complete.circuit')}</Text>
            <Text style={{fontSize: 15, fontWeight: '500', color: themeColors.text.primary}}>{circuitName}</Text>
          </View>

          <View style={{height: 1, backgroundColor: themeColors.border.primary}} />

          <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12}}>
            <Text style={{fontSize: 15, color: themeColors.text.secondary}}>{t('host.proof.complete.generated')}</Text>
            <Text style={{fontSize: 15, fontWeight: '500', color: themeColors.text.primary}}>{formattedDate}</Text>
          </View>
        </Card>

        <View style={styles.buttonsContainer}>
          {/* OIDC and Korea mDL proofs are wallet-less / EAS-less —
              there is no attestation address or tx to show, so hide
              the explorer button entirely. */}
          {!isOidcCircuit && !isMdlCircuit && (
            <>
              <Button
                title={t(
                  isGiwaCircuit
                    ? 'host.proof.complete.viewGiwaExplorer'
                    : 'host.proof.complete.viewEASScan',
                )}
                onPress={handleViewEASScan}
                variant="secondary"
                size="large"
              />
              <View style={styles.buttonSpacer} />
            </>
          )}
          <Button
            title={t('host.proof.complete.generateAnother')}
            onPress={handleGenerateAnother}
            variant="ghost"
            size="large"
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: 16,
    paddingTop: 40,
    paddingBottom: 32,
  },
  successSection: {
    alignItems: 'center',
    marginBottom: 32,
  },
  proofHashCard: {
    marginBottom: 16,
  },
  proofHashHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  copyButton: {
    padding: 4,
  },
  detailsCard: {
    marginBottom: 24,
  },
  chainBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(99, 102, 241, 0.18)',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  buttonsContainer: {
    marginTop: 8,
  },
  buttonSpacer: {
    height: 12,
  },
});
