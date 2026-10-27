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
import {CIRCUIT_NETWORKS, FALLBACK_VERIFIERS, OIDC_V2_VERIFIER_BASE_SEPOLIA} from '../contracts';
import type {Environment} from '../contracts';
import {OIDC_PUBLIC_INPUT_COUNT} from '../../utils/oidcDomain';

/*
 * The one exemption, and it expires by itself. This build proves OIDC v2
 * (214 public inputs); core 0.2.0 pins the v1 contract and layout (148), so
 * the testnet OIDC rows cannot equal core's table yet -- they hold the v2
 * address from OIDC_V2_VERIFIER_BASE_SEPOLIA instead. The moment core's OIDC
 * layout is v2, `coreIsBehindOidcV2` turns false and those rows are held to
 * core's pinned address like every other row.
 */
const coreIsBehindOidcV2 = (CORE_OIDC_PUBLIC_INPUT_COUNT as number) !== (OIDC_PUBLIC_INPUT_COUNT as number);
const exemptFromCore = (env: Environment, circuit: string) =>
  coreIsBehindOidcV2 && circuit === 'oidc_domain_attestation' && env !== 'production';

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
      if (exemptFromCore(env, circuit)) continue;
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
        if (exemptFromCore(env, circuit) && a === '') continue;
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

describe('the OIDC v2 verifier has exactly one place to be filled in', () => {
  it('core 0.2.0 is still on the v1 layout (148), so the exemption above is live', () => {
    // When this fails, core has moved to v2: delete the exemption and this case.
    expect(CORE_OIDC_PUBLIC_INPUT_COUNT).toBe(148);
    expect(OIDC_PUBLIC_INPUT_COUNT).toBe(214);
  });

  it('development and staging read OIDC_V2_VERIFIER_BASE_SEPOLIA, never the v1 contract', () => {
    for (const env of ['development', 'staging'] as const) {
      expect(FALLBACK_VERIFIERS[env].oidc_domain_attestation).toBe(OIDC_V2_VERIFIER_BASE_SEPOLIA);
      expect(FALLBACK_VERIFIERS[env].oidc_domain_attestation.toLowerCase()).not.toBe(
        getPinnedVerifier('oidc_domain_attestation', 84532).address,
      );
    }
  });

  it('is empty (not deployed) or a checksummed address, nothing else', () => {
    if (OIDC_V2_VERIFIER_BASE_SEPOLIA !== '') {
      expect(OIDC_V2_VERIFIER_BASE_SEPOLIA).toBe(ethers.utils.getAddress(OIDC_V2_VERIFIER_BASE_SEPOLIA));
    }
  });
});
