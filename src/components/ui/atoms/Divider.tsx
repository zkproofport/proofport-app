import React from 'react';
import {View, Text, StyleSheet} from 'react-native';

interface DividerProps {
  label?: string;
}

export const Divider: React.FC<DividerProps> = ({label}) => {
  if (label) {
    return (
      <View style={styles.containerWithLabel}>
        <View style={styles.line} />
        <Text style={styles.label}>{label}</Text>
        <View style={styles.line} />
      </View>
    );
  }

  return <View style={styles.divider} />;
};

const styles = StyleSheet.create({
  divider: {
    height: 1,
    backgroundColor: '#2D3748',
    width: '100%',
  },
  containerWithLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
  },
  line: {
    flex: 1,
    height: 1,
    backgroundColor: '#2D3748',
  },
  label: {
    color: '#6B7280',
    fontSize: 12,
    fontWeight: '500',
    marginHorizontal: 12,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
});
