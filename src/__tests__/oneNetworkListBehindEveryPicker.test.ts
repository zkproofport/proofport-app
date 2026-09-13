/**
 * Two screens let you choose a network, and they used to build the list twice.
 *
 * The Verify tab appended "Other" — the bucket for a proof tied to no chain —
 * and the More tab's default-network setting did not. Both write the SAME
 * setting, so after choosing "Other" in one, the other showed a picker with no
 * matching row and no way back to it. Nobody noticed because each list looked
 * complete on its own screen.
 *
 * So: one list, in src/config/networks.ts, and this fails if a picker starts
 * assembling its own again.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  NETWORK_CATEGORIES,
  OTHER_NETWORK,
  visibleNetworkCategories,
  circuitsForCategory,
} from '../config/networks';

const APP_ROOT = path.resolve(__dirname, '..', '..');

const PICKERS = [
  'src/screens/proof/CircuitSelectionScreen.tsx',
  'src/screens/more/MoreMainScreen.tsx',
];

describe('one network list behind every picker', () => {
  it.each(PICKERS)('%s asks config for its options', (file) => {
    const source = fs.readFileSync(path.join(APP_ROOT, file), 'utf8');
    expect(source).toContain('visibleNetworkCategories(');
    // Filtering USER_FACING_NETWORKS by hand is how the lists drifted apart.
    expect(source).not.toContain('USER_FACING_NETWORKS.filter');
  });

  it('offers the same rows to both, "Other" included', () => {
    const ids = visibleNetworkCategories(true).map((n) => n.id);
    expect(ids).toContain(OTHER_NETWORK);
    expect(ids).toEqual(NETWORK_CATEGORIES.map((n) => n.id));
  });

  it('hides developer-only chains until the switch is on', () => {
    const shipped = visibleNetworkCategories(false).map((n) => n.id);
    expect(shipped).toEqual(['base', OTHER_NETWORK]);
  });

  it('keeps a developer-only chain visible while it is the current value', () => {
    expect(visibleNetworkCategories(false, 'arc').map((n) => n.id)).toContain('arc');
  });

  it('every row names circuits, and "Other" holds the chainless one', () => {
    for (const n of NETWORK_CATEGORIES) {
      expect(n.circuits.length).toBeGreaterThan(0);
    }
    expect(circuitsForCategory(OTHER_NETWORK)).toContain('oidc_domain_attestation');
    expect(circuitsForCategory('arc')).toContain('arc_eligibility');
  });

  it('refuses an unknown network instead of answering with an empty list', () => {
    expect(() => circuitsForCategory('solana')).toThrow(/Unknown network category 'solana'/);
  });
});
