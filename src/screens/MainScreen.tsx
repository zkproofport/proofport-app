import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
} from 'react-native';
import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {RootStackParamList} from '../types';

type MainScreenProps = {
  navigation: NativeStackNavigationProp<RootStackParamList, 'Main'>;
};

export const MainScreen: React.FC<MainScreenProps> = ({navigation}) => {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>zkProofPort</Text>
        <Text style={styles.subtitle}>Select a feature to explore</Text>

        <View style={styles.buttonContainer}>
          <TouchableOpacity
            style={[styles.button, styles.ageVerifierButton]}
            onPress={() => navigation.navigate('AgeVerifier')}>
            <Text style={styles.buttonText}>Age Verifier</Text>
            <Text style={styles.buttonDescription}>
              Zero-knowledge age proof
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, styles.coinbaseKycButton]}
            onPress={() => navigation.navigate('CoinbaseKyc')}>
            <Text style={styles.buttonText}>Coinbase KYC</Text>
            <Text style={styles.buttonDescription}>
              Prove identity verification
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, styles.walletButton]}
            onPress={() => navigation.navigate('PrivyWallet')}>
            <Text style={styles.buttonText}>Connect Wallet</Text>
            <Text style={styles.buttonDescription}>
              Link your external wallet
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    marginBottom: 40,
  },
  buttonContainer: {
    width: '100%',
    gap: 16,
  },
  button: {
    padding: 24,
    borderRadius: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {width: 0, height: 2},
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  ageVerifierButton: {
    backgroundColor: '#007AFF',
  },
  coinbaseKycButton: {
    backgroundColor: '#0052FF', // Coinbase blue
  },
  walletButton: {
    backgroundColor: '#6366F1', // Purple
  },
  buttonText: {
    fontSize: 20,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  buttonDescription: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.8)',
  },
});
