import React from 'react';
import { Text } from 'react-native';

type IconSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

interface IconProps {
  name: string;
  size?: IconSize;
  color?: string;
}

const SIZE_MAP: Record<IconSize, number> = {
  xs: 12,
  sm: 16,
  md: 20,
  lg: 24,
  xl: 32,
};

const ICON_MAP: Record<string, string> = {
  'shield': '🛡',
  'credit-card': '💳',
  'user': '👤',
  'check-circle': '✓',
  'calendar': '📅',
  'map-pin': '📍',
  'chevron-right': '›',
  'arrow-left': '←',
  'check': '✓',
  'x': '✕',
  'copy': '📋',
  'external-link': '↗',
  'settings': '⚙',
  'clock': '🕐',
  'file-text': '📄',
  'link': '🔗',
  'link-2': '🔗',
  'bell': '🔔',
  'lock': '🔒',
  'info': 'ℹ',
  'alert-circle': '⚠',
  'trash-2': '🗑',
  'search': '🔍',
  'download': '⬇',
  'edit-3': '✏',
  'cpu': '⚡',
  'wallet': '💳',
  'globe': '🌍',
  'flag': '🏳',
};

export const Icon: React.FC<IconProps> = ({
  name,
  size = 'md',
  color = '#FFFFFF',
}) => {
  const icon = ICON_MAP[name] || '•';
  return (
    <Text style={{ fontSize: SIZE_MAP[size], color, textAlign: 'center' }}>
      {icon}
    </Text>
  );
};
