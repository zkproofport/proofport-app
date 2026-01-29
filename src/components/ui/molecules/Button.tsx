import React from 'react';
import {
  TouchableOpacity,
  Text,
  StyleSheet,
  ActivityIndicator,
  ViewStyle,
  TextStyle,
  View,
} from 'react-native';

type ButtonVariant = 'primary' | 'secondary' | 'ghost';
type ButtonSize = 'large' | 'medium' | 'small';

interface ButtonProps {
  onPress: () => void;
  title: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
}

const SIZE_STYLES: Record<ButtonSize, {height: number; fontSize: number}> = {
  large: {height: 52, fontSize: 16},
  medium: {height: 44, fontSize: 15},
  small: {height: 40, fontSize: 14},
};

export const Button: React.FC<ButtonProps> = ({
  onPress,
  title,
  variant = 'primary',
  size = 'medium',
  disabled = false,
  loading = false,
  style,
}) => {
  const sizeStyle = SIZE_STYLES[size];
  const isDisabled = disabled || loading;

  const renderContent = () => {
    const textStyle: (TextStyle | false)[] = [
      styles.text,
      {fontSize: sizeStyle.fontSize},
      variant === 'secondary' && styles.textSecondary,
      variant === 'ghost' && styles.textGhost,
      isDisabled && styles.textDisabled,
    ].filter(Boolean) as TextStyle[];

    return (
      <>
        {loading && (
          <ActivityIndicator
            size="small"
            color={variant === 'secondary' ? '#3B82F6' : '#FFFFFF'}
            style={styles.loader}
          />
        )}
        <Text style={textStyle}>{title}</Text>
      </>
    );
  };

  if (variant === 'primary') {
    return (
      <TouchableOpacity
        onPress={onPress}
        disabled={isDisabled}
        activeOpacity={0.8}
        style={[
          styles.container,
          {height: sizeStyle.height},
          styles.primary,
          isDisabled && styles.primaryDisabled,
          style,
        ]}>
        <View style={styles.primaryInner}>
          {renderContent()}
        </View>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.7}
      style={[
        styles.container,
        {height: sizeStyle.height},
        variant === 'secondary' && styles.secondary,
        variant === 'ghost' && styles.ghost,
        isDisabled && styles.containerDisabled,
        style,
      ]}>
      {renderContent()}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    borderRadius: 12,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
  },
  primary: {
    backgroundColor: '#3B82F6',
  },
  primaryDisabled: {
    backgroundColor: '#374151',
    opacity: 0.5,
  },
  primaryInner: {
    flex: 1,
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  secondary: {
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: '#3B82F6',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  ghost: {
    backgroundColor: 'transparent',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  containerDisabled: {
    opacity: 0.5,
  },
  text: {
    color: '#FFFFFF',
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  textSecondary: {
    color: '#3B82F6',
  },
  textGhost: {
    color: '#9CA3AF',
  },
  textDisabled: {
    color: '#6B7280',
  },
  loader: {
    marginRight: 8,
  },
});
