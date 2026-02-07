import React from 'react';
import {View, Text, StyleSheet, TouchableOpacity} from 'react-native';
import {Icon} from '../atoms/Icon';
import {Badge} from '../atoms/Badge';
import {useThemeColors} from '../../../context';

interface CircuitCardProps {
  icon: string;
  title: string;
  description: string;
  onPress: () => void;
  disabled?: boolean;
  comingSoon?: boolean;
}

export const CircuitCard: React.FC<CircuitCardProps> = ({
  icon,
  title,
  description,
  onPress,
  disabled = false,
  comingSoon = false,
}) => {
  const isDisabled = disabled || comingSoon;
  const {colors: themeColors} = useThemeColors();

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.7}
      style={[
        styles.touchWrapper,
        styles.container,
        {
          backgroundColor: themeColors.background.secondary,
          borderColor: themeColors.border.primary,
          borderWidth: 1,
          borderRadius: 16,
        },
        isDisabled && styles.containerDisabled,
      ]}>
      <View style={styles.content}>
        <View
          style={[
            styles.iconContainer,
            isDisabled && styles.iconContainerDisabled,
          ]}>
          <Icon
            name={icon as any}
            size="xl"
            color={themeColors.info[500]}
          />
        </View>
        <View style={styles.textContainer}>
          <View style={styles.titleRow}>
            <Text
              style={[
                styles.title,
                {color: themeColors.text.primary},
                isDisabled && {color: themeColors.text.tertiary},
              ]}>
              {title}
            </Text>
            {comingSoon && <Badge variant="neutral" text="Coming Soon" />}
          </View>
          <Text
            style={[
              styles.description,
              {color: themeColors.text.secondary},
              isDisabled && {color: themeColors.text.tertiary},
            ]}>
            {description}
          </Text>
        </View>
      </View>
      {!isDisabled && (
        <Icon
          name="chevron-right"
          size="md"
          color={themeColors.text.tertiary}
        />
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  touchWrapper: {
    marginBottom: 12,
  },
  container: {
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  containerDisabled: {
    opacity: 0.5,
  },
  content: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconContainer: {
    width: 56,
    height: 56,
    borderRadius: 14,
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
  },
  iconContainerDisabled: {
    backgroundColor: 'rgba(107, 114, 128, 0.1)',
  },
  textContainer: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
    gap: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
  },
  description: {
    fontSize: 13,
    lineHeight: 18,
  },
});
