import React from 'react';
import {View, Text, TouchableOpacity, StyleSheet} from 'react-native';
import {Icon} from '../atoms/Icon';
import {useThemeColors} from '../../../context';

interface MenuItemProps {
  icon: string;
  title: string;
  subtitle?: string;
  onPress: () => void;
}

export const MenuItem: React.FC<MenuItemProps> = ({
  icon,
  title,
  subtitle,
  onPress,
}) => {
  const {colors: themeColors} = useThemeColors();

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[
        styles.touchWrapper,
        styles.container,
        {
          backgroundColor: themeColors.background.secondary,
          borderColor: themeColors.border.primary,
          borderWidth: 1,
          borderRadius: 12,
        },
      ]}>
      <View style={styles.iconContainer}>
        <Icon name={icon as any} size="lg" color="#3B82F6" />
      </View>
      <View style={styles.content}>
        <Text style={[styles.title, {color: themeColors.text.primary}]}>
          {title}
        </Text>
        {subtitle && (
          <Text style={[styles.subtitle, {color: themeColors.text.secondary}]}>
            {subtitle}
          </Text>
        )}
      </View>
      <Icon name="chevron-right" size="md" color={themeColors.text.tertiary} />
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  touchWrapper: {
    marginBottom: 8,
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  iconContainer: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  content: {
    flex: 1,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 2,
  },
  subtitle: {
    fontSize: 13,
  },
});
