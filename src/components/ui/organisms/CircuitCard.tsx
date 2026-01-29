import React from 'react';
import {View, Text, StyleSheet, TouchableOpacity} from 'react-native';
import {Icon} from '../atoms/Icon';
import {Badge} from '../atoms/Badge';

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

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.7}
      style={[styles.container, isDisabled && styles.containerDisabled]}>
      <View style={styles.content}>
        <View
          style={[
            styles.iconContainer,
            isDisabled && styles.iconContainerDisabled,
          ]}>
          <Icon name={icon as any} size="xl" color="#3B82F6" />
        </View>
        <View style={styles.textContainer}>
          <View style={styles.titleRow}>
            <Text style={[styles.title, isDisabled && styles.titleDisabled]}>
              {title}
            </Text>
            {comingSoon && <Badge variant="neutral" text="Coming Soon" />}
          </View>
          <Text
            style={[
              styles.description,
              isDisabled && styles.descriptionDisabled,
            ]}>
            {description}
          </Text>
        </View>
      </View>
      {!isDisabled && (
        <Icon name="chevron-right" size="md" color="#6B7280" />
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1A2332',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2D3748',
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
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
    backgroundColor: 'rgba(59, 130, 246, 0.1)',
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
    color: '#FFFFFF',
  },
  titleDisabled: {
    color: '#6B7280',
  },
  description: {
    fontSize: 13,
    color: '#9CA3AF',
    lineHeight: 18,
  },
  descriptionDisabled: {
    color: '#6B7280',
  },
});
