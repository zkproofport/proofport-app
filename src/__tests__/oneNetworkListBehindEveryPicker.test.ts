/**
 * More owns the default-network picker. The proof home selects a purpose
 * without changing that preference. Network options still come from config,
 * including the chain-independent category. Developer Mode hides none of them.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  NETWORK_CATEGORIES,
  OTHER_NETWORK,
  circuitsForCategory,
} from '../config/networks';

const APP_ROOT = path.resolve(__dirname, '..', '..');

const PICKERS = [
  'src/screens/more/MoreMainScreen.tsx',
];

describe('one network list behind every picker', () => {
  it.each(PICKERS)('%s asks config for its options', (file) => {
    const source = fs.readFileSync(path.join(APP_ROOT, file), 'utf8');
    expect(source).toContain('NETWORK_CATEGORIES.map(');
    // Filtering USER_FACING_NETWORKS by hand is how the lists drifted apart.
    expect(source).not.toContain('USER_FACING_NETWORKS.filter');
  });

  it('offers every configured row, "Other" included', () => {
    expect(NETWORK_CATEGORIES.map((n) => n.id)).toEqual(['base', 'giwa', 'omnione', OTHER_NETWORK]);
  });

  it('every row names circuits, and "Other" holds the chainless one', () => {
    for (const n of NETWORK_CATEGORIES) {
      expect(n.circuits.length).toBeGreaterThan(0);
    }
    expect(circuitsForCategory(OTHER_NETWORK)).toContain('oidc_domain_attestation');
    expect(circuitsForCategory('giwa')).toContain('giwa_attestation');
  });

  it('refuses an unknown network instead of answering with an empty list', () => {
    expect(() => circuitsForCategory('solana')).toThrow(/Unknown network category 'solana'/);
  });
});
