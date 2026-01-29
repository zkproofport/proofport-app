import React from 'react';
import {View, Text, StyleSheet} from 'react-native';

type BadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'neutral';

interface BadgeProps {
  variant: BadgeVariant;
  text: string;
}

const VARIANT_STYLES: Record<
  BadgeVariant,
  {backgroundColor: string; textColor: string}
> = {
  success: {
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    textColor: '#10B981',
  },
  warning: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    textColor: '#F59E0B',
  },
  error: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    textColor: '#EF4444',
  },
  info: {
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
    textColor: '#3B82F6',
  },
  neutral: {
    backgroundColor: 'rgba(156, 163, 175, 0.15)',
    textColor: '#9CA3AF',
  },
};

export const Badge: React.FC<BadgeProps> = ({variant, text}) => {
  const variantStyle = VARIANT_STYLES[variant];

  return (
    <View
      style={[
        styles.container,
        {backgroundColor: variantStyle.backgroundColor},
      ]}>
      <Text style={[styles.text, {color: variantStyle.textColor}]}>
        {text}
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  text: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
});
