import type {ImageSourcePropType} from 'react-native';

/**
 * The ZKProofport marks, from the brand kit (2026-10-13) in `assets/brand/`.
 * Screens take them from here so a new kit version changes one file.
 */
export const BRAND_SYMBOL: ImageSourcePropType = require('../../assets/brand/zkproofport-symbol.png');

const WORDMARKS: Readonly<Record<'dark' | 'light', ImageSourcePropType>> = {
  dark: require('../../assets/brand/zkproofport-wordmark-dark.png'),
  light: require('../../assets/brand/zkproofport-wordmark-light.png'),
};

/** Width / height of the wordmark artwork (1624 × 360). */
export const WORDMARK_ASPECT = 1624 / 360;
/** The kit's minimum width for the wordmark on its own. */
export const WORDMARK_MIN_WIDTH = 160;

/** The wordmark drawn for a background of this theme mode. */
export function wordmarkFor(mode: string): ImageSourcePropType {
  // Own keys only: 'constructor' or 'toString' must not resolve to a prototype member.
  if (!Object.prototype.hasOwnProperty.call(WORDMARKS, mode)) {
    throw new Error(`Unknown theme mode '${mode}'. Known: ${Object.keys(WORDMARKS).join(', ')}.`);
  }
  return WORDMARKS[mode as keyof typeof WORDMARKS];
}
