import React from 'react';
import Feather from 'react-native-vector-icons/Feather';

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

export const Icon: React.FC<IconProps> = ({
  name,
  size = 'md',
  color = '#FFFFFF',
}) => {
  return (
    <Feather name={name} size={SIZE_MAP[size]} color={color} />
  );
};
