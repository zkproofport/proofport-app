import React, {useState} from 'react';
import {View, Text, StyleSheet, SafeAreaView, ScrollView, TextInput, TouchableOpacity} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {useTranslation} from 'react-i18next';
import {Button, Card} from '../../components/ui';
import {useThemeColors} from '../../context';
import type {ProofStackParamList} from '../../navigation/types';

type NavigationProp = NativeStackNavigationProp<ProofStackParamList, 'DomainInput'>;

export const DomainInputScreen: React.FC = () => {
  const {colors: themeColors} = useThemeColors();
  const navigation = useNavigation<NavigationProp>();
  const {t} = useTranslation();
  const [domain, setDomain] = useState('');
  const [scope, setScope] = useState('proofport:default');
  const [provider, setProvider] = useState<string | undefined>(undefined);

  const PROVIDER_OPTIONS = [
    {value: undefined, label: t('host.proof.domain.anyEmail'), desc: t('host.proof.domain.anyEmailDesc')},
    {value: 'google', label: t('host.proof.domain.googleWorkspace'), desc: t('host.proof.domain.googleWorkspaceDesc')},
    {value: 'microsoft', label: t('host.proof.domain.microsoft365'), desc: t('host.proof.domain.microsoft365Desc')},
  ] as const;

  // Domain is always optional — auto-extracted from JWT email if not provided
  const isValid = domain.trim().length === 0 || domain.includes('.');

  const handleContinue = () => {
    navigation.navigate('ProofGeneration', {
      circuitId: 'oidc_domain_attestation',
      domainInput: {
        domain: domain.trim().toLowerCase() || undefined,  // undefined = auto-extract from JWT
        scope: scope.trim() || 'proofport:default',
        ...(provider ? {provider} : {}),
      },
    });
  };

  const getSummaryText = () => {
    if (!isValid) {
      return t('host.proof.domain.summaryInvalidDomain');
    }
    if (!domain.trim()) {
      return t('host.proof.domain.summaryAutoDetect');
    }
    if (provider === 'microsoft') {
      return t('host.proof.domain.summaryMicrosoftMembership', {domain: domain.trim().toLowerCase()});
    }
    if (provider === 'google') {
      return t('host.proof.domain.summaryGoogleMembership', {domain: domain.trim().toLowerCase()});
    }
    return t('host.proof.domain.summaryEmailDomain', {domain: domain.trim().toLowerCase()});
  };

  return (
    <SafeAreaView style={{flex: 1, backgroundColor: themeColors.background.primary}}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}>

        <Card style={styles.heroCard}>
          <Text style={{fontSize: 11, fontWeight: '600', color: themeColors.info[400], letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8}}>
            {t('host.proof.domain.heroLabel')}
          </Text>
          <Text style={{fontSize: 24, fontWeight: '700', color: themeColors.text.primary, letterSpacing: -0.5, marginBottom: 8}}>
            {t('host.proof.domain.heroTitle')}
          </Text>
          <Text style={{fontSize: 15, color: themeColors.text.secondary, lineHeight: 22}}>
            {t('host.proof.domain.heroDescription')}
          </Text>
        </Card>

        <Card style={styles.sectionCard}>
          <Text style={{fontSize: 11, fontWeight: '600', color: themeColors.text.tertiary, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 12}}>
            {t('host.proof.domain.domainLabel')}
          </Text>
          <TextInput
            style={{
              backgroundColor: themeColors.background.secondary,
              borderWidth: 1.5,
              borderColor: domain ? themeColors.info[500] : themeColors.border.primary,
              borderRadius: 12,
              padding: 16,
              fontSize: 18,
              fontWeight: '600',
              color: themeColors.text.primary,
            }}
            placeholder={t('host.proof.domain.domainPlaceholder')}
            placeholderTextColor={themeColors.text.disabled}
            value={domain}
            onChangeText={setDomain}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <Text style={{fontSize: 13, color: themeColors.text.tertiary, marginTop: 8, lineHeight: 18}}>
            {t('host.proof.domain.domainHint', {domain: domain || '...'})}
          </Text>
        </Card>

        <Card style={styles.sectionCard}>
          <Text style={{fontSize: 11, fontWeight: '600', color: themeColors.text.tertiary, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 12}}>
            {t('host.proof.domain.scopeLabel')}
          </Text>
          <TextInput
            style={{
              backgroundColor: themeColors.background.secondary,
              borderWidth: 1.5,
              borderColor: themeColors.border.primary,
              borderRadius: 12,
              padding: 16,
              fontSize: 16,
              color: themeColors.text.primary,
            }}
            placeholder="proofport:default"
            placeholderTextColor={themeColors.text.disabled}
            value={scope}
            onChangeText={setScope}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text style={{fontSize: 13, color: themeColors.text.tertiary, marginTop: 8, lineHeight: 18}}>
            {t('host.proof.domain.scopeHint')}
          </Text>
        </Card>

        <Card style={styles.sectionCard}>
          <Text style={{fontSize: 11, fontWeight: '600', color: themeColors.text.tertiary, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 12}}>
            {t('host.proof.domain.modeLabel')}
          </Text>
          {PROVIDER_OPTIONS.map(opt => {
            const isSelected = provider === opt.value;
            return (
              <TouchableOpacity
                key={opt.label}
                style={{
                  backgroundColor: themeColors.background.secondary,
                  borderWidth: 1.5,
                  borderColor: isSelected ? themeColors.info[500] : themeColors.border.primary,
                  borderRadius: 12,
                  padding: 16,
                  marginBottom: 10,
                  ...(isSelected && {backgroundColor: themeColors.info.background}),
                }}
                onPress={() => setProvider(opt.value)}>
                <Text style={{
                  fontSize: 16, fontWeight: '600', marginBottom: 4,
                  color: isSelected ? themeColors.info[400] : themeColors.text.primary,
                }}>
                  {opt.label}
                </Text>
                <Text style={{fontSize: 13, color: themeColors.text.tertiary, lineHeight: 18}}>
                  {opt.desc}
                </Text>
              </TouchableOpacity>
            );
          })}
        </Card>

        <Card style={{marginBottom: 24, backgroundColor: themeColors.background.tertiary}}>
          <Text style={{fontSize: 11, fontWeight: '600', color: themeColors.text.tertiary, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8}}>
            {t('host.proof.domain.summaryLabel')}
          </Text>
          <Text style={[
            {fontSize: 14, fontStyle: 'italic', color: themeColors.info[400], lineHeight: 20},
            !isValid && {color: themeColors.warning[400]},
          ]}>
            {getSummaryText()}
          </Text>
        </Card>

        <Button
          title={provider === 'microsoft' ? t('host.proof.domain.signInMicrosoft') : t('host.proof.domain.signInGoogle')}
          onPress={handleContinue}
          disabled={!isValid}
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
  heroCard: {marginBottom: 16},
  sectionCard: {marginBottom: 16},
  continueButton: {marginBottom: 16},
});
