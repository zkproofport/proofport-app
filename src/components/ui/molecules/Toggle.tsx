import React from 'react';
import {Switch, View, Text, StyleSheet} from 'react-native';
import {useThemeColors} from '../../../context';

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
  const {colors: themeColors} = useThemeColors();

  return (
    <View style={styles.container}>
      {label && (
        <Text style={[styles.label, {color: themeColors.text.primary}]}>
          {label}
        </Text>
      )}
      <Switch
        value={value}
        onValueChange={onValueChange}
        trackColor={{false: themeColors.text.disabled, true: '#3B82F6'}}
        thumbColor="#FFFFFF"
        ios_backgroundColor={themeColors.text.disabled}
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
    flex: 1,
    marginRight: 12,
  },
});
