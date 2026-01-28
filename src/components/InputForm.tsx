import React from 'react';
import {View, Text, TextInput, StyleSheet} from 'react-native';
import type {AgeVerifierInputs} from '../types';

interface InputFormProps {
  inputs: AgeVerifierInputs;
  onInputChange: (field: keyof AgeVerifierInputs, value: string) => void;
}

export const InputForm: React.FC<InputFormProps> = ({inputs, onInputChange}) => {
  return (
    <View style={styles.container}>
      <Text style={styles.label}>Input Parameters</Text>
      <View style={styles.row}>
        <View style={styles.group}>
          <Text style={styles.title}>Birth Year</Text>
          <TextInput
            style={styles.input}
            value={inputs.birthYear}
            onChangeText={value => onInputChange('birthYear', value)}
            keyboardType="number-pad"
            placeholder="e.g., 2000"
            placeholderTextColor="#999"
          />
        </View>
        <View style={styles.group}>
          <Text style={styles.title}>Current Year</Text>
          <TextInput
            style={styles.input}
            value={inputs.currentYear}
            onChangeText={value => onInputChange('currentYear', value)}
            keyboardType="number-pad"
            placeholder="e.g., 2024"
            placeholderTextColor="#999"
          />
        </View>
        <View style={styles.group}>
          <Text style={styles.title}>Min Age</Text>
          <TextInput
            style={styles.input}
            value={inputs.minAge}
            onChangeText={value => onInputChange('minAge', value)}
            keyboardType="number-pad"
            placeholder="e.g., 18"
            placeholderTextColor="#999"
          />
        </View>
      </View>
      <Text style={styles.hint}>
        Circuit verifies: current_year - birth_year {'>'}= min_age
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FFFFFF',
    margin: 16,
    padding: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  group: {
    flex: 1,
  },
  title: {
    fontSize: 12,
    color: '#666',
    marginBottom: 4,
  },
  input: {
    backgroundColor: '#F5F5F5',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
    color: '#333',
    borderWidth: 1,
    borderColor: '#E0E0E0',
    textAlign: 'center',
  },
  hint: {
    fontSize: 12,
    color: '#999',
    marginTop: 12,
    textAlign: 'center',
    fontStyle: 'italic',
  },
});
