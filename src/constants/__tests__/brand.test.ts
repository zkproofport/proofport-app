/**
 * The marks come from the brand kit's files in `assets/brand/`, and only
 * through `src/constants/brand.ts`. The old logo files were deleted on
 * 2026-10-15; a screen that names a path again fails here.
 */
import * as fs from 'fs';
import * as path from 'path';

jest.mock('../../../assets/brand/zkproofport-symbol.png', () => 'symbol');
jest.mock('../../../assets/brand/zkproofport-wordmark-dark.png', () => 'wordmark-on-dark');
jest.mock('../../../assets/brand/zkproofport-wordmark-light.png', () => 'wordmark-on-light');

import {BRAND_SYMBOL, WORDMARK_ASPECT, wordmarkFor} from '../brand';

const APP = path.resolve(__dirname, '..', '..', '..');

function sources(dir: string): string[] {
  return fs.readdirSync(dir, {withFileTypes: true}).flatMap(entry => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : sources(full);
    return /\.(tsx?|jsx?)$/.test(entry.name) ? [full] : [];
  });
}

describe('ZKProofport brand marks', () => {
  it('draws the paper-suffix wordmark on dark and the navy one on light', () => {
    expect(wordmarkFor('dark')).toBe('wordmark-on-dark');
    expect(wordmarkFor('light')).toBe('wordmark-on-light');
    expect(BRAND_SYMBOL).toBe('symbol');
  });

  it.each(['', 'system', 'Dark', 'constructor', 'toString', '__proto__'])('refuses theme mode %j', mode => {
    expect(() => wordmarkFor(mode)).toThrow(/Unknown theme mode/);
  });

  it('keeps the artwork proportions of the kit files (1624 × 360)', () => {
    expect(WORDMARK_ASPECT).toBeCloseTo(4.511, 3);
  });

  it('ships every brand file, and none of the deleted logos', () => {
    for (const name of ['zkproofport-symbol.png', 'zkproofport-wordmark-dark.png', 'zkproofport-wordmark-light.png']) {
      expect(fs.existsSync(path.join(APP, 'assets', 'brand', name))).toBe(true);
    }
    for (const name of ['logo.png', 'logo_dark_bg.png', 'logo_2048_2048.jpeg', 'logo_2048_v2.jpg']) {
      expect(fs.existsSync(path.join(APP, 'assets', name))).toBe(false);
    }
  });

  it('is required by path only in the brand module', () => {
    const files = [...sources(path.join(APP, 'src')), path.join(APP, 'App.tsx')];
    const naming = files
      .filter(file => /assets\/(brand\/|logo)/.test(fs.readFileSync(file, 'utf8')))
      .map(file => path.relative(APP, file).split(path.sep).join('/'));
    expect(naming).toEqual(['src/constants/brand.ts']);
  });
});
