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
jest.mock('react-native', () => ({NativeModules: {}, Platform: {OS: 'ios'}}));

import {ethers} from 'ethers';
import {getPinnedVerifier, OIDC_PUBLIC_INPUT_COUNT as CORE_OIDC_PUBLIC_INPUT_COUNT} from '@zkproofport-app/core';
import {ALL_CIRCUIT_IDS} from '../circuitIds';
import {CIRCUIT_NETWORKS, FALLBACK_VERIFIERS} from '../contracts';
import type {Environment} from '../contracts';
import {OIDC_PUBLIC_INPUT_COUNT} from '../../utils/oidcDomain';
import {hasPinnedArtifactSource} from '../circuitArtifacts';

// Coinbase KYC v2 and OIDC with the provider-key statement are read from
// pinned circuits commits on this branch and are not in core 0.3.0's table
// (core still pins the v1 Coinbase verifier and the OIDC verifier from before
// the statement). Their rows are held below to their own deploys instead;
// drop this when core pins them.
const IN_CORE = ALL_CIRCUIT_IDS.filter(c => !hasPinnedArtifactSource(c));
const NOT_IN_CORE = ALL_CIRCUIT_IDS.filter(c => hasPinnedArtifactSource(c));

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
  it('is exactly Coinbase KYC v2 and OIDC, so the exemption above cannot grow silently', () => {
    expect(NOT_IN_CORE).toEqual(['coinbase_attestation', 'oidc_domain_attestation']);
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

  it('development and staging name the provider-key-statement verifier, never an older OIDC contract', () => {
    for (const env of ['development', 'staging'] as const) {
      expect(CIRCUIT_NETWORKS[env].oidc_domain_attestation.chainId).toBe(84532);
      // circuits 7e5c72d, broadcast/DeployOidcDomainAttestation.s.sol/84532.
      expect(FALLBACK_VERIFIERS[env].oidc_domain_attestation).toBe('0xeA5933ABc598401c89F63B3f13AE56A7E78984e8');
      for (const old of ['0x003334a7c2ff15ee9ee845ab88e152a2a3694167', '0x5d9ece4f0276d12693f79659760a68011efef485']) {
        expect(FALLBACK_VERIFIERS[env].oidc_domain_attestation.toLowerCase()).not.toBe(old);
      }
    }
  });

  it("production names the statement circuit's Base mainnet verifier, never the beta.8 one", () => {
    expect(CIRCUIT_NETWORKS.production.oidc_domain_attestation.chainId).toBe(8453);
    // circuits da21683, broadcast/DeployOidcDomainAttestation.s.sol/8453.
    expect(FALLBACK_VERIFIERS.production.oidc_domain_attestation).toBe('0xF1AA88aD844bFd1dc552526a67f5980aAd4E7f35');
    expect(FALLBACK_VERIFIERS.production.oidc_domain_attestation.toLowerCase()).not.toBe('0x9677ba46ad226ce8b3c4517d9c0143e4d458beae');
  });
});

/*
 * The Android packages' verifiers (src/config/variantVerifiers.ts). The
 * published core (0.3.0) has no per-variant table; core's android-signature
 * branch (abf5291) pins the OIDC ones in PINNED_VARIANT_VERIFIERS. When that
 * source is checked out beside this app (the parent repository's
 * proofport-app-sdk submodule), the rows are held to it; the Coinbase rows,
 * which core does not pin, are held to the circuits repository's own
 * deployment records. CI checks out this app alone: there these two read
 * nothing and the literal rows below stand.
 */
describe('Android package verifiers', () => {
  /* eslint-disable @typescript-eslint/no-var-requires */
  const fs = require('node:fs');
  const path = require('node:path');
  const {ANDROID_VARIANT_VERIFIERS, androidVerifierFor, AndroidVerifierMissingError} = require('../variantVerifiers');
  const {FALLBACK_VERIFIERS: FALLBACK} = require('../contracts');
  /* eslint-enable @typescript-eslint/no-var-requires */
  const PARENT = path.join(__dirname, '..', '..', '..', '..');
  const VARIANTS = ['android', 'android_factory'] as const;
  const CIRCUITS = ['oidc_domain_attestation', 'coinbase_attestation'] as const;
  const EXPECTED: Record<string, Record<string, string>> = {
    android: {oidc_domain_attestation: '0x64866bf6734ed43d34799c7949f5ecb35b7e7e44', coinbase_attestation: '0x395b3bcc27e7e405ec909a81374243fd0b44aacc'},
    android_factory: {oidc_domain_attestation: '0x9e47e3c2b30e840cfc4d6901ba3e28fc666b3135', coinbase_attestation: '0xbfaf9390c36d14d596556e42eb52d984de040aa1'},
  };

  it.each(['development', 'staging'] as const)("%s: each variant's Base Sepolia contract, checksummed, never the standard address", env => {
    for (const v of VARIANTS) {
      for (const c of CIRCUITS) {
        const row = androidVerifierFor(c, env, v);
        expect(row.address.toLowerCase()).toBe(EXPECTED[v][c]);
        expect(row.address).toBe(ethers.utils.getAddress(row.address));
        expect(row.chainId).toBe(84532);
        expect(CIRCUIT_NETWORKS[env][c].chainId).toBe(84532);
        expect(row.address.toLowerCase()).not.toBe(FALLBACK[env][c].toLowerCase());
      }
    }
    expect(new Set(VARIANTS.flatMap(v => CIRCUITS.map(c => androidVerifierFor(c, env, v).address))).size).toBe(4);
  });

  const MAINNET: Record<string, Record<string, string>> = {
    android: {oidc_domain_attestation: '0x3d99a36b39231bc35f6e840f18ac443bf5d229de', coinbase_attestation: '0x836d8b0fd01bed4e34220ebcee6d63265951fbf9'},
    android_factory: {oidc_domain_attestation: '0x1b8e60db8b51015cdb1983f64c1210ac40d8f532', coinbase_attestation: '0x87d9a66cacac95b2bc43bac8e610c59acb67c5e0'},
  };

  it("production: each variant's Base mainnet contract, checksummed, never the standard or a testnet address", () => {
    for (const v of VARIANTS) {
      for (const c of CIRCUITS) {
        const row = androidVerifierFor(c, 'production', v);
        expect(row.address.toLowerCase()).toBe(MAINNET[v][c]);
        expect(row.address).toBe(ethers.utils.getAddress(row.address));
        expect(row.chainId).toBe(8453);
        expect(CIRCUIT_NETWORKS.production[c].chainId).toBe(8453);
        expect(row.address.toLowerCase()).not.toBe(FALLBACK.production[c].toLowerCase());
        expect(row.address.toLowerCase()).not.toBe(EXPECTED[v][c]);
      }
    }
    expect(new Set(VARIANTS.flatMap(v => CIRCUITS.map(c => androidVerifierFor(c, 'production', v).address))).size).toBe(4);
  });

  it('an unknown variant, environment or circuit is an error, never a default', () => {
    expect(() => androidVerifierFor('oidc_domain_attestation', 'staging', 'standard')).toThrow(/Unknown Android signer variant 'standard'/);
    expect(() => androidVerifierFor('oidc_domain_attestation', 'mainnet', 'android')).toThrow(/Unknown environment 'mainnet'/);
    expect(() => androidVerifierFor('coinbase_country_attestation', 'staging', 'android')).toThrow(AndroidVerifierMissingError);
    expect(() => androidVerifierFor('__proto__', 'staging', 'android')).toThrow(AndroidVerifierMissingError);
  });

  const coreSource = path.join(PARENT, 'proofport-app-sdk', 'packages', 'core', 'src', 'pinnedVerifiers.generated.ts');
  (fs.existsSync(coreSource) ? it : it.skip)("the OIDC rows are core's PINNED_VARIANT_VERIFIERS on Base Sepolia (core source beside this app)", () => {
    const text: string = fs.readFileSync(coreSource, 'utf8');
    const start = text.indexOf('export const PINNED_VARIANT_VERIFIERS');
    expect(start).toBeGreaterThan(-1);
    const block = text.slice(start);
    for (const v of VARIANTS) {
      const vAt = block.indexOf(`  ${v}: Object.freeze({`);
      expect(vAt).toBeGreaterThan(-1);
      const oidcAt = block.indexOf('oidc_domain_attestation:', vAt);
      const row = /84532: Object\.freeze\(\{ address: '(0x[0-9a-f]{40})'/.exec(block.slice(oidcAt));
      expect([v, row?.[1]]).toEqual([v, EXPECTED[v].oidc_domain_attestation]);
      const main = /8453: Object\.freeze\(\{ address: '(0x[0-9a-f]{40})'/.exec(block.slice(oidcAt));
      expect([v, main?.[1]]).toEqual([v, MAINNET[v].oidc_domain_attestation]);
    }
  });

  const BROADCAST: Record<string, Record<string, string>> = {
    android: {oidc_domain_attestation: 'DeployOidcDomainAttestationAndroid', coinbase_attestation: 'DeployCoinbaseAttestationV2Android'},
    android_factory: {oidc_domain_attestation: 'DeployOidcDomainAttestationAndroidFactory', coinbase_attestation: 'DeployCoinbaseAttestationV2AndroidFactory'},
  };
  const broadcastDir = path.join(PARENT, 'circuits', 'broadcast');
  (fs.existsSync(path.join(broadcastDir, `${BROADCAST.android.coinbase_attestation}.s.sol`)) ? it : it.skip)(
    "every row is the circuits repository's own Base Sepolia deployment record (circuits checkout beside this app)",
    () => {
      for (const v of VARIANTS) {
        for (const c of CIRCUITS) {
          const run = JSON.parse(fs.readFileSync(path.join(broadcastDir, `${BROADCAST[v][c]}.s.sol`, '84532', 'run-latest.json'), 'utf8'));
          const created = run.transactions.filter((t: {transactionType: string}) => t.transactionType === 'CREATE');
          expect(created).toHaveLength(1);
          expect([v, c, created[0].contractAddress.toLowerCase()]).toEqual([v, c, EXPECTED[v][c]]);
          const mainRun = JSON.parse(fs.readFileSync(path.join(broadcastDir, `${BROADCAST[v][c]}.s.sol`, '8453', 'run-latest.json'), 'utf8'));
          const mainCreated = mainRun.transactions.filter((t: {transactionType: string}) => t.transactionType === 'CREATE');
          expect(mainCreated).toHaveLength(1);
          expect([v, c, mainCreated[0].contractAddress.toLowerCase()]).toEqual([v, c, MAINNET[v][c]]);
        }
      }
    },
  );
});
