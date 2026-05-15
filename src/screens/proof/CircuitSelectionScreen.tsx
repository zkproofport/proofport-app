import React from 'react';
import {View, Text, StyleSheet, SafeAreaView, ScrollView} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {useTranslation} from 'react-i18next';
import {CircuitCard} from '../../components/ui';
import {useThemeColors} from '../../context';
import {getCircuitIcon} from '../../utils';
import type {ProofStackParamList} from '../../navigation/types';

type NavigationProp = NativeStackNavigationProp<ProofStackParamList, 'CircuitSelection'>;

export const CircuitSelectionScreen: React.FC = () => {
  const { colors: themeColors } = useThemeColors();
  const navigation = useNavigation<NavigationProp>();
  const { t } = useTranslation();

  const handleCoinbaseKyc = () => {
    navigation.navigate('ProofGeneration', {circuitId: 'coinbase-kyc'});
  };

  const handleGiwaKyc = () => {
    navigation.navigate('ProofGeneration', {circuitId: 'giwa-kyc'});
  };

  return (
    <SafeAreaView style={{flex: 1, backgroundColor: themeColors.background.primary}}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={{fontSize: 32, fontWeight: '700', color: themeColors.text.primary, letterSpacing: -0.5}}>
            {t('host.proof.circuitSelection.title')}
          </Text>
        </View>

        <View style={styles.section}>
          <Text style={{fontSize: 14, fontWeight: '600', color: themeColors.text.secondary, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 16}}>
            {t('host.proof.circuitSelection.sectionLabel')}
          </Text>

          <CircuitCard
            icon={getCircuitIcon('coinbase-kyc')}
            title={t('host.proof.circuitSelection.coinbaseKyc.title')}
            description={t('host.proof.circuitSelection.coinbaseKyc.description')}
            onPress={handleCoinbaseKyc}
          />

          <CircuitCard
            icon={getCircuitIcon('coinbase-country')}
            title={t('host.proof.circuitSelection.coinbaseCountry.title')}
            description={t('host.proof.circuitSelection.coinbaseCountry.description')}
            onPress={() => navigation.navigate('CountryInput')}
          />

          <CircuitCard
            icon={getCircuitIcon('oidc_domain_attestation')}
            title={t('host.proof.circuitSelection.oidcDomain.title')}
            description={t('host.proof.circuitSelection.oidcDomain.description')}
            onPress={() => navigation.navigate('DomainInput')}
          />

          <CircuitCard
            icon={getCircuitIcon('giwa-kyc')}
            title={t('host.proof.circuitSelection.giwaKyc.title')}
            description={t('host.proof.circuitSelection.giwaKyc.description')}
            onPress={handleGiwaKyc}
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
    paddingBottom: 32,
  },
  header: {
    paddingVertical: 24,
  },
  section: {
    marginTop: 8,
  },
});
