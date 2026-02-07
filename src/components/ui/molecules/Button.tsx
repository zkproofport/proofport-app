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
import {useThemeColors} from '../../../context';

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
  const {mode, colors: themeColors} = useThemeColors();
  const isDark = mode === 'dark';
  const sizeStyle = SIZE_STYLES[size];
  const isDisabled = disabled || loading;

  const renderContent = () => {
    const textColor = isDisabled
      ? (isDark ? '#6B7280' : '#FFFFFF')
      : variant === 'secondary'
        ? themeColors.info[500]
        : variant === 'ghost'
          ? themeColors.text.secondary
          : '#FFFFFF';

    return (
      <>
        {loading && (
          <ActivityIndicator
            size="small"
            color={variant === 'secondary' ? themeColors.info[500] : '#FFFFFF'}
            style={styles.loader}
          />
        )}
        <Text style={[styles.text, {fontSize: sizeStyle.fontSize, color: textColor}]}>{title}</Text>
      </>
    );
  };

  const disabledBg = isDark ? '#374151' : '#9CA3AF';

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
          isDisabled && {backgroundColor: disabledBg, ...(isDark && {opacity: 0.7})},
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
        variant === 'secondary' && {borderWidth: 2, borderColor: themeColors.info[500]},
        variant === 'ghost' && styles.ghost,
        isDisabled && (isDark ? styles.containerDisabled : {opacity: 0.85}),
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
