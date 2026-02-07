import React from 'react';
import {View, Text, StyleSheet, SafeAreaView, ScrollView} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {CircuitCard} from '../../components/ui';
import {useThemeColors} from '../../context';
import {getCircuitIcon} from '../../utils';
import type {ProofStackParamList} from '../../navigation/types';

type NavigationProp = NativeStackNavigationProp<ProofStackParamList, 'CircuitSelection'>;

export const CircuitSelectionScreen: React.FC = () => {
  const { colors: themeColors } = useThemeColors();
  const navigation = useNavigation<NavigationProp>();

  const handleCoinbaseKyc = () => {
    navigation.navigate('ProofGeneration', {circuitId: 'coinbase-kyc'});
  };

  return (
    <SafeAreaView style={{flex: 1, backgroundColor: themeColors.background.primary}}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={{fontSize: 32, fontWeight: '700', color: themeColors.text.primary, letterSpacing: -0.5}}>Proofs</Text>
        </View>

        <View style={styles.section}>
          <Text style={{fontSize: 14, fontWeight: '600', color: themeColors.text.secondary, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 16}}>Select Proof Type</Text>

          <CircuitCard
            icon={getCircuitIcon('coinbase-kyc')}
            title="Coinbase KYC Verification"
            description="Prove identity without revealing wallet"
            onPress={handleCoinbaseKyc}
          />

          <CircuitCard
            icon={getCircuitIcon('coinbase-country')}
            title="Coinbase Country Verification"
            description="Verify your country through Coinbase"
            onPress={() => navigation.navigate('CountryInput')}
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
