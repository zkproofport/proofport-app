import React from 'react';
import {View, Text, StyleSheet} from 'react-native';
import type {ProofStatus} from '../types';

interface HeaderProps {
  status: ProofStatus;
}

export const Header: React.FC<HeaderProps> = ({status}) => {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>ZKProofport</Text>
      <Text style={styles.subtitle}>Zero-Knowledge Proof Generation</Text>
      <Text style={styles.status}>{status}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 20,
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#333',
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
  status: {
    fontSize: 16,
    color: '#007AFF',
    marginTop: 12,
    fontWeight: '600',
  },
});
