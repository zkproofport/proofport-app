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
import {
  getPinnedVerifier,
  COINBASE_ATTESTATION_PUBLIC_INPUT_COUNT as CORE_COINBASE_COUNT,
  OIDC_PUBLIC_INPUT_COUNT as CORE_OIDC_PUBLIC_INPUT_COUNT,
  PINNED_VARIANT_VERIFIERS,
} from '@zkproofport-app/core';
import {ALL_CIRCUIT_IDS, type CircuitName} from '../circuitIds';
import {CIRCUIT_NETWORKS, FALLBACK_VERIFIERS} from '../contracts';
import type {Environment} from '../contracts';
import {OIDC_PUBLIC_INPUT_COUNT} from '../../utils/oidcDomain';
import {hasPinnedArtifactSource} from '../circuitArtifacts';

// Every circuit is held to core's table -- Coinbase KYC v2 too, since core
// 0.4.0-beta.1 pins its contracts (core 0.4.0-beta.0 still pinned v1's) --
// except Coinbase Country v2 while its row is the empty placeholder (no
// verifier deployed and pinned yet; held below).
const COUNTRY_PENDING = (['development', 'staging', 'production'] as const)
  .some(env => FALLBACK_VERIFIERS[env].coinbase_country_attestation === '');
const IN_CORE = ALL_CIRCUIT_IDS.filter(id => !(COUNTRY_PENDING && id === 'coinbase_country_attestation'));

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
      for (const circuit of IN_CORE) {
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

describe('Coinbase KYC: v2 everywhere, never a v1 contract', () => {
  // core 0.4.0-beta.0's coinbase_attestation rows (DeployCoinbaseAttestation.s.sol).
  const V1 = [
    '0xf3d5a09d2c85b28c52ef2905c1be3a852b609d0c', // 1
    '0xf7ded73e7a7fc8fb030c35c5a88d40abe6865382', // 8453
    '0x42d165a48256ae184e1de4e7e6372e870e2bc883', // 84532
    '0x7fc2059a73cef2b572c8deee911c72963dcb4a8a', // 11155111
  ];

  it("core's rows count 193 public inputs and are none of v1's contracts", () => {
    expect(CORE_COINBASE_COUNT).toBe(193);
    for (const env of ENVS) {
      const a = FALLBACK_VERIFIERS[env].coinbase_attestation.toLowerCase();
      expect([env, V1.includes(a)]).toEqual([env, false]);
      expect(a).toBe(getPinnedVerifier('coinbase_attestation', CIRCUIT_NETWORKS[env].coinbase_attestation.chainId).address);
    }
  });

  it('is read from a pinned circuits commit', () => {
    expect(hasPinnedArtifactSource('coinbase_attestation')).toBe(true);
  });
});

describe('Coinbase Country: v2 or nothing, never a v1 contract', () => {
  // core 0.4.0-beta.1's coinbase_country_attestation rows (v1, 150 inputs).
  const V1 = [
    '0x9deea2189ae694d7a36f65fb7d7dbe9f75abddce', // 84532
    '0x8e89f11e65f219203f5be9d6a69a4da084630c56', // 8453
    '0xdee363585926c3c28327efd1edd01cf4559738cf', // 84532, older
    '0xf3d5a09d2c85b28c52ef2905c1be3a852b609d0c', // beta.8
  ];

  it.each(ENVS)('%s: the row is empty (refused before proving) or a checksummed contract that is none of v1\'s', env => {
    const a = FALLBACK_VERIFIERS[env].coinbase_country_attestation;
    if (a === '') return;
    expect(a).toBe(ethers.utils.getAddress(a));
    expect(V1.includes(a.toLowerCase())).toBe(false);
    expect(a.toLowerCase()).toBe(getPinnedVerifier('coinbase_country_attestation', CIRCUIT_NETWORKS[env].coinbase_country_attestation.chainId).address);
  });

  it('is read from a pinned circuits ref', () => {
    expect(hasPinnedArtifactSource('coinbase_country_attestation')).toBe(true);
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
 * published core (0.4.0-beta.2) pins all six in PINNED_VARIANT_VERIFIERS and
 * the rows are held to it. When core's source is checked out beside this app
 * (the parent repository's proofport-app-sdk submodule), the OIDC rows are
 * held to that too, and every row to the circuits repository's own deployment
 * records when circuits is checked out. CI checks out this app alone: there
 * those two read nothing and the published-core case still runs.
 */
describe('Android package verifiers', () => {
  /* eslint-disable @typescript-eslint/no-var-requires */
  const fs = require('node:fs');
  const path = require('node:path');
  const {androidVerifierFor, AndroidVerifierMissingError} = require('../variantVerifiers');
  const {FALLBACK_VERIFIERS: FALLBACK} = require('../contracts');
  /* eslint-enable @typescript-eslint/no-var-requires */
  const PARENT = path.join(__dirname, '..', '..', '..', '..');
  const VARIANTS = ['android', 'android_factory'] as const;
  const CIRCUITS = ['oidc_domain_attestation', 'coinbase_attestation', 'coinbase_country_attestation'] as const;
  const EXPECTED: Record<string, Record<string, string>> = {
    android: {oidc_domain_attestation: '0x64866bf6734ed43d34799c7949f5ecb35b7e7e44', coinbase_attestation: '0x395b3bcc27e7e405ec909a81374243fd0b44aacc', coinbase_country_attestation: '0x98013abb7ac83b6c985dcfbd5748ad2ae04c8c12'},
    android_factory: {oidc_domain_attestation: '0x9e47e3c2b30e840cfc4d6901ba3e28fc666b3135', coinbase_attestation: '0xbfaf9390c36d14d596556e42eb52d984de040aa1', coinbase_country_attestation: '0xd7bfd6d7bcc6c627da12cfcdf39fca6f64fdc0b9'},
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
    expect(new Set(VARIANTS.flatMap(v => CIRCUITS.map(c => androidVerifierFor(c, env, v).address))).size).toBe(6);
  });

  const MAINNET: Record<string, Record<string, string>> = {
    android: {oidc_domain_attestation: '0x3d99a36b39231bc35f6e840f18ac443bf5d229de', coinbase_attestation: '0x836d8b0fd01bed4e34220ebcee6d63265951fbf9', coinbase_country_attestation: '0xb57182062141f59ddbb98da73764ec1676689832'},
    android_factory: {oidc_domain_attestation: '0x1b8e60db8b51015cdb1983f64c1210ac40d8f532', coinbase_attestation: '0x87d9a66cacac95b2bc43bac8e610c59acb67c5e0', coinbase_country_attestation: '0x1f2975abd0711cf6b98084829e04712ee105d8f7'},
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
    expect(new Set(VARIANTS.flatMap(v => CIRCUITS.map(c => androidVerifierFor(c, 'production', v).address))).size).toBe(6);
  });

  it('an unknown variant, environment or circuit is an error, never a default', () => {
    expect(() => androidVerifierFor('oidc_domain_attestation', 'staging', 'standard')).toThrow(/Unknown Android signer variant 'standard'/);
    expect(() => androidVerifierFor('oidc_domain_attestation', 'mainnet', 'android')).toThrow(/Unknown environment 'mainnet'/);
    expect(() => androidVerifierFor('giwa_attestation', 'staging', 'android')).toThrow(AndroidVerifierMissingError);
    expect(() => androidVerifierFor('__proto__', 'staging', 'android')).toThrow(AndroidVerifierMissingError);
  });

  it("every row is the published core's PINNED_VARIANT_VERIFIERS, on Base Sepolia and Base mainnet", () => {
    for (const v of VARIANTS) {
      for (const c of CIRCUITS) {
        const rows = PINNED_VARIANT_VERIFIERS[v][c];
        expect([v, c, rows?.[84532]?.address]).toEqual([v, c, EXPECTED[v][c]]);
        expect([v, c, rows?.[8453]?.address]).toEqual([v, c, MAINNET[v][c]]);
        expect(androidVerifierFor(c, 'staging', v).address.toLowerCase()).toBe(rows?.[84532]?.address);
        expect(androidVerifierFor(c, 'production', v).address.toLowerCase()).toBe(rows?.[8453]?.address);
      }
    }
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
    android: {oidc_domain_attestation: 'DeployOidcDomainAttestationAndroid', coinbase_attestation: 'DeployCoinbaseAttestationV2Android', coinbase_country_attestation: 'DeployCoinbaseCountryAttestationV2Android'},
    android_factory: {oidc_domain_attestation: 'DeployOidcDomainAttestationAndroidFactory', coinbase_attestation: 'DeployCoinbaseAttestationV2AndroidFactory', coinbase_country_attestation: 'DeployCoinbaseCountryAttestationV2AndroidFactory'},
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
