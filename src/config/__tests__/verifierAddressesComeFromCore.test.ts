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
  AWAITING_REDEPLOY,
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

/*
 * What core says about the contract for a circuit on a chain: the address it
 * pins, or -- for a contract built from a key that is no longer the circuit's
 * -- the address it lists in AWAITING_REDEPLOY and refuses to verify on (the
 * mainnet rows until the production release redeploys them). Production is
 * the only environment allowed to name an awaiting contract; any other
 * refusal from core is rethrown.
 */
function coreClaim(circuit: string, chainId: number, variant = 'standard'): {kind: 'pinned' | 'awaiting'; address: string} {
  if (variant === 'standard') {
    try {
      return {kind: 'pinned', address: getPinnedVerifier(circuit, chainId).address};
    } catch (e) {
      if (!/awaits a redeploy/.test(String(e))) throw e;
    }
  } else {
    const row = (PINNED_VARIANT_VERIFIERS as Record<string, Record<string, Record<number, {address: string}>>>)[variant]?.[circuit]?.[chainId];
    if (row) return {kind: 'pinned', address: row.address};
  }
  const awaiting = AWAITING_REDEPLOY.filter(a => a.circuit === circuit && a.chainId === chainId && a.variant === variant);
  if (awaiting.length !== 1) throw new Error(`core neither pins nor awaits ${variant} ${circuit} on ${chainId}`);
  return {kind: 'awaiting', address: awaiting[0].previousAddress};
}

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

  it.each(ENVS)('%s: each address is core\'s pinned verifier on the circuit\'s own chain (production: or the contract core awaits a redeploy of)', env => {
    for (const circuit of IN_CORE) {
      const chainId = CIRCUIT_NETWORKS[env][circuit].chainId;
      const claim = coreClaim(circuit, chainId);
      expect([circuit, FALLBACK_VERIFIERS[env][circuit].toLowerCase()]).toEqual([circuit, claim.address]);
      if (env !== 'production') expect([circuit, claim.kind]).toEqual([circuit, 'pinned']);
    }
  });

  it('testnet rows are pinned, never awaiting: every development / staging contract is one core verifies on', () => {
    for (const env of ['development', 'staging'] as const) {
      for (const circuit of IN_CORE) {
        expect(coreClaim(circuit, CIRCUIT_NETWORKS[env][circuit].chainId).kind).toBe('pinned');
      }
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

  it("core's rows count 133 public inputs (OPRF nullifier) and are none of v1's contracts", () => {
    expect(CORE_COINBASE_COUNT).toBe(133);
    for (const env of ENVS) {
      const a = FALLBACK_VERIFIERS[env].coinbase_attestation.toLowerCase();
      expect([env, V1.includes(a)]).toEqual([env, false]);
      expect(a).toBe(coreClaim('coinbase_attestation', CIRCUIT_NETWORKS[env].coinbase_attestation.chainId).address);
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
    expect(a.toLowerCase()).toBe(coreClaim('coinbase_country_attestation', CIRCUIT_NETWORKS[env].coinbase_country_attestation.chainId).address);
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
      // circuits 954eb90, broadcast/DeployOidcDomainAttestation.s.sol/84532 (bb 6.0.0).
      expect(FALLBACK_VERIFIERS[env].oidc_domain_attestation).toBe('0x14a2241B0A24679825BeFAaa562d4A204262D84f');
      for (const old of ['0xea5933abc598401c89f63b3f13ae56a7e78984e8', '0x003334a7c2ff15ee9ee845ab88e152a2a3694167', '0x5d9ece4f0276d12693f79659760a68011efef485']) {
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
    // bb 6.0.0 OPRF-era contracts, circuits 954eb90 records, pinned by core 0.4.0-beta.9.
    android: {oidc_domain_attestation: '0x31fea05b9fa197b591d66cff0fef5698e6a5d9c0', coinbase_attestation: '0x551af332b494658ece6124c1a5c48202c0580e28', coinbase_country_attestation: '0x8e86cc23c908792ad4f2eb1df9a485a518eeea0e'},
    android_factory: {oidc_domain_attestation: '0xaef0af1b129035b6ceef40241fd75871d15a5f41', coinbase_attestation: '0xe0982a6ecffc0ef1bd43d1d8bfe8c5089f3ff5bd', coinbase_country_attestation: '0x26d4cfae6654c31d10d669c0ebc6428802adf9d0'},
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

  it("every row is the published core's: pinned on Base Sepolia, awaiting a redeploy under the same address on Base mainnet", () => {
    for (const v of VARIANTS) {
      for (const c of CIRCUITS) {
        expect([v, c, coreClaim(c, 84532, v)]).toEqual([v, c, {kind: 'pinned', address: EXPECTED[v][c]}]);
        expect([v, c, coreClaim(c, 8453, v)]).toEqual([v, c, {kind: 'awaiting', address: MAINNET[v][c]}]);
        expect(androidVerifierFor(c, 'staging', v).address.toLowerCase()).toBe(EXPECTED[v][c]);
        expect(androidVerifierFor(c, 'production', v).address.toLowerCase()).toBe(MAINNET[v][c]);
      }
    }
  });

  const coreSource = path.join(PARENT, 'proofport-app-sdk', 'packages', 'core', 'src', 'pinnedVerifiers.generated.ts');
  // The source beside this app may be ahead of the published core: after a
  // circuit rebuild its generator moves every verifier built from another key
  // out of PINNED_VARIANT_VERIFIERS into AWAITING_REDEPLOY, under the same
  // address, until the redeploy is recorded. Either way the address is the
  // one this app pins; any other address in either place is a failure.
  (fs.existsSync(coreSource) ? it : it.skip)("the OIDC rows are core's PINNED_VARIANT_VERIFIERS, or its AWAITING_REDEPLOY entry for the same contract (core source beside this app)", () => {
    const text: string = fs.readFileSync(coreSource, 'utf8');
    const start = text.indexOf('export const PINNED_VARIANT_VERIFIERS');
    expect(start).toBeGreaterThan(-1);
    const block = text.slice(start);
    const awaiting = (v: string, chainId: number): string | undefined =>
      new RegExp(`circuit: 'oidc_domain_attestation', variant: '${v}', chainId: ${chainId}, previousAddress: '(0x[0-9a-f]{40})'`).exec(text)?.[1];
    const pinned = (v: string, chainId: number): string | undefined => {
      const vAt = block.indexOf(`  ${v}: Object.freeze({`);
      if (vAt < 0) return undefined;
      const vEnd = block.indexOf('\n  }),', vAt);
      const variantBlock = block.slice(vAt, vEnd < 0 ? undefined : vEnd);
      const oidcAt = variantBlock.indexOf('oidc_domain_attestation:');
      if (oidcAt < 0) return undefined;
      const rowEnd = variantBlock.indexOf('\n    }),', oidcAt);
      const row = variantBlock.slice(oidcAt, rowEnd < 0 ? undefined : rowEnd);
      return new RegExp(`\\b${chainId}: Object\\.freeze\\(\\{ address: '(0x[0-9a-f]{40})'`).exec(row)?.[1];
    };
    for (const v of VARIANTS) {
      for (const [chainId, expected] of [[84532, EXPECTED[v].oidc_domain_attestation], [8453, MAINNET[v].oidc_domain_attestation]] as const) {
        const p = pinned(v, chainId);
        const a = awaiting(v, chainId);
        expect([v, chainId, p === undefined && a === undefined]).toEqual([v, chainId, false]);
        if (p !== undefined) expect([v, chainId, 'pinned', p]).toEqual([v, chainId, 'pinned', expected]);
        if (a !== undefined) expect([v, chainId, 'awaiting', a]).toEqual([v, chainId, 'awaiting', expected]);
      }
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
