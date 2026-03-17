import React, {useState} from 'react';
import {View, Text, StyleSheet, SafeAreaView, ScrollView, TextInput} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {Button, Card} from '../../components/ui';
import {useThemeColors} from '../../context';
import type {ProofStackParamList} from '../../navigation/types';

type NavigationProp = NativeStackNavigationProp<ProofStackParamList, 'DomainInput'>;

export const DomainInputScreen: React.FC = () => {
  const {colors: themeColors} = useThemeColors();
  const navigation = useNavigation<NavigationProp>();
  const [domain, setDomain] = useState('');
  const [scope, setScope] = useState('proofport:default');

  const isValid = domain.trim().length > 0 && domain.includes('.');

  const handleContinue = () => {
    navigation.navigate('ProofGeneration', {
      circuitId: 'oidc_domain_attestation',
      domainInput: {
        domain: domain.trim().toLowerCase(),
        scope: scope.trim() || 'proofport:default',
      },
    });
  };

  return (
    <SafeAreaView style={{flex: 1, backgroundColor: themeColors.background.primary}}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}>

        <Card style={styles.heroCard}>
          <Text style={{fontSize: 11, fontWeight: '600', color: themeColors.info[400], letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8}}>OIDC DOMAIN VERIFICATION</Text>
          <Text style={{fontSize: 24, fontWeight: '700', color: themeColors.text.primary, letterSpacing: -0.5, marginBottom: 8}}>Domain Verification</Text>
          <Text style={{fontSize: 15, color: themeColors.text.secondary, lineHeight: 22}}>
            Prove your email belongs to a specific domain using Google Sign-In. Your email address is never revealed.
          </Text>
        </Card>

        <Card style={styles.sectionCard}>
          <Text style={{fontSize: 11, fontWeight: '600', color: themeColors.text.tertiary, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 12}}>DOMAIN TO PROVE</Text>
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
            placeholder="e.g. gmail.com"
            placeholderTextColor={themeColors.text.disabled}
            value={domain}
            onChangeText={setDomain}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <Text style={{fontSize: 13, color: themeColors.text.tertiary, marginTop: 8, lineHeight: 18}}>
            Your Google account email must end with @{domain || '...'}
          </Text>
        </Card>

        <Card style={styles.sectionCard}>
          <Text style={{fontSize: 11, fontWeight: '600', color: themeColors.text.tertiary, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 12}}>SCOPE (OPTIONAL)</Text>
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
            Application-specific identifier for proof uniqueness
          </Text>
        </Card>

        <Card style={{marginBottom: 24, backgroundColor: themeColors.background.tertiary}}>
          <Text style={{fontSize: 11, fontWeight: '600', color: themeColors.text.tertiary, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8}}>SUMMARY</Text>
          <Text style={[
            {fontSize: 14, fontStyle: 'italic', color: themeColors.info[400], lineHeight: 20},
            !isValid && {color: themeColors.warning[400]},
          ]}>
            {isValid
              ? `Prove that your email domain is: ${domain.trim().toLowerCase()}`
              : 'Enter a valid domain to continue (e.g. gmail.com)'}
          </Text>
        </Card>

        <Button
          title="Sign in with Google & Prove"
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
