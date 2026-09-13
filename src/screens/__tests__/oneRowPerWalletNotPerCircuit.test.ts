/**
 * The Wallet tab shows one row per WALLET, not one per circuit.
 *
 * Coinbase KYC, Coinbase Country and Arc read attestations on the same
 * Coinbase-attested wallet, and the store already binds them under one key.
 * Listing every circuit that needs a signature showed that single binding
 * three times — and since all three read the same stored entry, connecting
 * once made all three rows say Connected. A person who had connected only for
 * Arc saw three chains' wallets apparently connected. Reported 2026-09-12.
 *
 * The row count also depends on asking the RIGHT question. "Does the relay
 * demand a signature on the request" and "does this circuit's proof need a
 * wallet" are different: `giwa_attestation` answers no to the first and yes to
 * the second, and borrowing the first answer deleted GIWA's row.
 */
jest.mock('react-native', () => ({NativeModules: {}}));

import * as fs from 'fs';
import * as path from 'path';
import {walletGroupKey, CIRCUIT_BINDS_A_WALLET} from '../../stores/circuitWalletStore';
import {ALL_CIRCUIT_IDS} from '../../config/circuitIds';
import {WALLET_BINDING_ROWS} from '../../stores/circuitWalletStore';

/**
 * THE REAL LIST, imported rather than recomputed.
 *
 * A first version of this test worked the rows out for itself and passed even
 * with the grouping torn back out — a guard that looked like it bit and did
 * not. The rows now live in the store, so there is one definition to check and
 * the screen cannot disagree with it.
 */
const rows = WALLET_BINDING_ROWS;

const card = () =>
  fs.readFileSync(path.join(__dirname, '..', 'wallet', 'CircuitWalletsCard.tsx'), 'utf8');

describe('one row per wallet, not per circuit', () => {
  it('shows the three Coinbase-wallet circuits as a single row', () => {
    const coinbase = rows.filter(
      c => walletGroupKey(c) === walletGroupKey('coinbase_attestation'),
    );
    expect(coinbase).toHaveLength(1);
  });

  it('still shows GIWA, which binds its own wallet', () => {
    expect(CIRCUIT_BINDS_A_WALLET.giwa_attestation).toBe(true);
    expect(
      rows.some(c => walletGroupKey(c) === walletGroupKey('giwa_attestation')),
    ).toBe(true);
  });

  it('shows no row for a flow that never reads a wallet', () => {
    for (const c of ['oidc_domain_attestation', 'mdl_kr_age'] as const) {
      expect(CIRCUIT_BINDS_A_WALLET[c]).toBe(false);
      expect(rows).not.toContain(c);
    }
  });

  it('has exactly one row per binding group, whatever the circuit count', () => {
    const keys = rows.map(walletGroupKey);
    expect(new Set(keys).size).toBe(keys.length);
    const bound = ALL_CIRCUIT_IDS.filter(c => CIRCUIT_BINDS_A_WALLET[c]);
    expect(new Set(bound.map(walletGroupKey)).size).toBe(rows.length);
  });

  it('names every circuit the row stands for, so nothing looks missing', () => {
    expect(card()).toContain('circuitsInWalletGroup(c).map(getCircuitDisplayName)');
  });

  it('asks whether the circuit binds a wallet, not what the relay demands', () => {
    // Those are different questions and GIWA answers them differently: the
    // relay accepts its request unsigned while its proof needs a personal_sign.
    // Borrowing the relay's answer here deleted GIWA's row.
    const store = fs.readFileSync(
      path.join(__dirname, '..', '..', 'stores', 'circuitWalletStore.ts'),
      'utf8',
    );
    expect(store).toContain('CIRCUIT_BINDS_A_WALLET[c]');
    expect(store).not.toContain('CIRCUIT_NEEDS_WALLET_SIGNATURE');
    expect(card()).not.toContain('CIRCUIT_NEEDS_WALLET_SIGNATURE');
  });
});
