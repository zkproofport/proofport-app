import React from 'react';
import {
  View,
  TouchableOpacity,
  StyleSheet,
  ViewStyle,
  GestureResponderEvent,
} from 'react-native';
import {useThemeColors} from '../../../context';

interface CardProps {
  children: React.ReactNode;
  onPress?: (event: GestureResponderEvent) => void;
  style?: ViewStyle;
}

export const Card: React.FC<CardProps> = ({children, onPress, style}) => {
  const {colors: themeColors} = useThemeColors();

  const dynamicStyles = {
    backgroundColor: themeColors.background.secondary,
    borderColor: themeColors.border.primary,
    borderWidth: 1,
    borderRadius: 16,
  };

  if (onPress) {
    return (
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.85}
        style={[styles.card, dynamicStyles, styles.touchable, style]}>
        {children}
      </TouchableOpacity>
    );
  }

  return (
    <View style={[styles.card, dynamicStyles, style]}>
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    padding: 16,
  },
  touchable: {
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 4,
  },
});
