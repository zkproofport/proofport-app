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
import {getPinnedVerifier, OIDC_PUBLIC_INPUT_COUNT as CORE_OIDC_PUBLIC_INPUT_COUNT} from '@zkproofport-app/core';
import {ALL_CIRCUIT_IDS} from '../circuitIds';
import {CIRCUIT_NETWORKS, FALLBACK_VERIFIERS} from '../contracts';
import type {Environment} from '../contracts';
import {OIDC_PUBLIC_INPUT_COUNT} from '../../utils/oidcDomain';
import {circuitArtifactSource} from '../circuitArtifacts';

// Coinbase KYC v2 is read from a pinned circuits commit on this branch and is
// not in core 0.3.0's table (core still pins the v1 Coinbase verifier). Its
// rows are held below to the v2 deploy instead; drop this when core pins v2.
const IN_CORE = ALL_CIRCUIT_IDS.filter(c => !circuitArtifactSource(c));
const NOT_IN_CORE = ALL_CIRCUIT_IDS.filter(c => circuitArtifactSource(c));

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
    for (const circuit of IN_CORE) {
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
        // Empty = no deploy for that environment (Coinbase KYC v2 on mainnet).
        if (a === '' && NOT_IN_CORE.includes(circuit)) continue;
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

describe('circuits read from a pinned commit, not yet in core', () => {
  it('is exactly Coinbase KYC v2, so the exemption above cannot grow silently', () => {
    expect(NOT_IN_CORE).toEqual(['coinbase_attestation']);
  });

  it('never names the v1 contract core still pins, on any chain it pins', () => {
    for (const env of ENVS) {
      for (const circuit of NOT_IN_CORE) {
        const a = FALLBACK_VERIFIERS[env][circuit].toLowerCase();
        const chainId = CIRCUIT_NETWORKS[env][circuit].chainId;
        expect(a).not.toBe(getPinnedVerifier(circuit, chainId).address);
      }
    }
  });
});

describe('OIDC v2: the app and core agree on the circuit', () => {
  it('core counts the same 214 public inputs the app proves', () => {
    // A core on another layout refuses every OIDC proof this build makes.
    expect(OIDC_PUBLIC_INPUT_COUNT).toBe(214);
    expect(CORE_OIDC_PUBLIC_INPUT_COUNT).toBe(OIDC_PUBLIC_INPUT_COUNT);
  });

  it('development and staging name the Base Sepolia v2 verifier, never the v1 contract', () => {
    for (const env of ['development', 'staging'] as const) {
      expect(CIRCUIT_NETWORKS[env].oidc_domain_attestation.chainId).toBe(84532);
      expect(FALLBACK_VERIFIERS[env].oidc_domain_attestation).toBe('0x003334A7C2ff15ee9ee845Ab88e152A2A3694167');
      expect(FALLBACK_VERIFIERS[env].oidc_domain_attestation.toLowerCase()).not.toBe(
        '0x5d9ece4f0276d12693f79659760a68011efef485',
      );
    }
  });
});
