/**
 * The verifier addresses this app reports and checks come from
 * `@zkproofport-app/core`'s pinned table.
 *
 * Since core 0.2.0 every verifier calls the pinned contract for a circuit on a
 * chain and refuses a proof whose response names another address. The app
 * sends `verifierAddress` with every proof, so a hand-kept copy that drifted
 * from core's table would make every dApp refuse the app's proofs, while the
 * phone itself reported "verified".
 */
jest.mock('react-native', () => ({NativeModules: {}}));

import {ethers} from 'ethers';
import {getPinnedVerifier} from '@zkproofport-app/core';
import {ALL_CIRCUIT_IDS} from '../circuitIds';
import {CIRCUIT_NETWORKS, FALLBACK_VERIFIERS} from '../contracts';
import type {Environment} from '../contracts';

const ENVS: Environment[] = ['development', 'staging', 'production'];

describe('every environment resolves every circuit through core', () => {
  it('core throws for a chain it pins nothing on, so the rows below cannot pass by a default', () => {
    expect(() => getPinnedVerifier('giwa_attestation', 84532)).toThrow(/84532/);
    expect(() => getPinnedVerifier('not_a_circuit', 84532)).toThrow(/not_a_circuit/);
  });

  it('covers exactly the three environments and every published circuit', () => {
    expect(Object.keys(FALLBACK_VERIFIERS).sort()).toEqual([...ENVS].sort());
    for (const env of ENVS) {
      expect(Object.keys(FALLBACK_VERIFIERS[env]).sort()).toEqual([...ALL_CIRCUIT_IDS].sort());
    }
  });

  it.each(ENVS)('%s: each address is core\'s pinned verifier on the circuit\'s own chain', env => {
    for (const circuit of ALL_CIRCUIT_IDS) {
      const chainId = CIRCUIT_NETWORKS[env][circuit].chainId;
      expect(FALLBACK_VERIFIERS[env][circuit].toLowerCase()).toBe(
        getPinnedVerifier(circuit, chainId).address,
      );
    }
  });

  it('addresses are checksummed, as History and the relay callback showed them before', () => {
    for (const env of ENVS) {
      for (const circuit of ALL_CIRCUIT_IDS) {
        const a = FALLBACK_VERIFIERS[env][circuit];
        expect(a).toBe(ethers.utils.getAddress(a));
      }
    }
  });

  it('dev and staging are testnets: Base Sepolia or GIWA Sepolia, never a mainnet', () => {
    for (const env of ['development', 'staging'] as const) {
      for (const circuit of ALL_CIRCUIT_IDS) {
        expect([84532, 91342]).toContain(CIRCUIT_NETWORKS[env][circuit].chainId);
      }
    }
  });
});
