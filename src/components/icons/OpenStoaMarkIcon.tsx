import React from 'react';
import { Image } from 'react-native';

interface Props {
  size?: number;
  color?: string;
}

/**
 * OpenStoa brand mark — uses the original PNG asset
 * (`assets/openstoa-mark.png`, the same file that ships on
 * openstoa.xyz) so the glyph matches the brand pixel-for-pixel.
 * `tintColor` recolours the alpha channel for active / inactive
 * tab states without us having to maintain a separate vector.
 */
export default function OpenStoaMarkIcon({ size = 24, color = '#9ca3af' }: Props) {
  return (
    <Image
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      source={require('../../../assets/openstoa-mark.png')}
      style={{ width: size, height: size, tintColor: color }}
      resizeMode="contain"
    />
  );
}
