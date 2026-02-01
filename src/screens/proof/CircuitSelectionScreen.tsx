import React from 'react';
import {View, Text, StyleSheet, SafeAreaView, ScrollView} from 'react-native';
import {useNavigation} from '@react-navigation/native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import {CircuitCard} from '../../components/ui';
import {colors} from '../../theme';
import type {ProofStackParamList} from '../../navigation/types';

type NavigationProp = NativeStackNavigationProp<ProofStackParamList, 'CircuitSelection'>;

export const CircuitSelectionScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();

  const handleCoinbaseKyc = () => {
    navigation.navigate('ProofGeneration', {circuitId: 'coinbase-kyc'});
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Text style={styles.title}>Proof</Text>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Select Proof Type</Text>

          <CircuitCard
            icon="check-circle"
            title="Coinbase KYC Verification"
            description="Prove identity without revealing wallet"
            onPress={handleCoinbaseKyc}
          />

          <CircuitCard
            icon="globe"
            title="Coinbase Country Verification"
            description="Verify your country through Coinbase"
            onPress={() => navigation.navigate('CountryInput')}
          />

          <CircuitCard
            icon="map-pin"
            title="Location Proof"
            description="Prove location without revealing exact coordinates"
            onPress={() => {}}
            comingSoon
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background.primary,
  },
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
  title: {
    fontSize: 32,
    fontWeight: '700',
    color: colors.text.primary,
    letterSpacing: -0.5,
  },
  section: {
    marginTop: 8,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text.secondary,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 16,
  },
});
