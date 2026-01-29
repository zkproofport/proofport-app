import React from 'react';
import {Switch, View, Text, StyleSheet} from 'react-native';

interface ToggleProps {
  value: boolean;
  onValueChange: (value: boolean) => void;
  label?: string;
}

export const Toggle: React.FC<ToggleProps> = ({
  value,
  onValueChange,
  label,
}) => {
  return (
    <View style={styles.container}>
      {label && <Text style={styles.label}>{label}</Text>}
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{false: '#4B5563', true: '#3B82F6'}}
        thumbColor="#FFFFFF"
        ios_backgroundColor="#4B5563"
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    fontSize: 15,
    fontWeight: '500',
    color: '#FFFFFF',
    flex: 1,
    marginRight: 12,
  },
});
