/**
 * The shared proof checks every proof hook calls.
 *
 * On-chain verification must go through `verifyProofOnChain` from
 * `@zkproofport-app/core`, against core's pinned verifier on the circuit's own
 * chain, with the address the app resolved passed only as a claim to compare. Off-chain verification
 * must stay on mopro, the prover that made the proof. Both used to be copied
 * into six hooks; the last describe block holds them to the shared helpers.
 */
// Coinbase KYC v2 and OIDC read per-platform circuit files; this test is the iPhone's.
jest.mock('react-native', () => ({NativeModules: {}, Platform: {OS: 'ios'}}));
import * as fs from 'fs';
import * as path from 'path';

const mockVerifyProofOnChain = jest.fn();
const mockContractVerify = jest.fn();
const mockGetVerifierContract = jest.fn((..._a: unknown[]) => ({verify: (...a: unknown[]) => mockContractVerify(...a)}));
jest.mock('@zkproofport-app/core', () => ({
  ...jest.requireActual('@zkproofport-app/core'),
  verifyProofOnChain: (...args: unknown[]) => mockVerifyProofOnChain(...args),
  getVerifierContract: (...args: unknown[]) => mockGetVerifierContract(...args),
}));

const mockVerifyNoirProof = jest.fn();
jest.mock('mopro-ffi', () => ({
  verifyNoirProof: (...args: unknown[]) => mockVerifyNoirProof(...args),
}));

const mockGetVerifierAddress = jest.fn();
const mockGetNetworkConfigForCircuit = jest.fn();
let mockEnv = 'development';
jest.mock('../../config/environment', () => ({
  getEnvironment: () => mockEnv,
  getVerifierAddress: (...args: unknown[]) => mockGetVerifierAddress(...args),
  getNetworkConfigForCircuit: (...args: unknown[]) => mockGetNetworkConfigForCircuit(...args),
}));

const mockGetAssetPath = jest.fn();
jest.mock('../asset', () => ({
  getAssetPath: (...args: unknown[]) => mockGetAssetPath(...args),
}));

// A provider that records which RPC it was made for and never dials out.
jest.mock('ethers', () => {
  const actual = jest.requireActual('ethers');
  class RecordingProvider {
    readonly mockUrl: string;
    constructor(mockRpcUrl: string) {
      this.mockUrl = mockRpcUrl;
    }
  }
  return {
    ...actual,
    ethers: {...actual.ethers, providers: {...actual.ethers.providers, JsonRpcProvider: RecordingProvider}},
  };
});

import {getPinnedVariantVerifier, getPinnedVerifier} from '@zkproofport-app/core';
import {
  maskLongHex,
  proofAgeSeconds,
  REQUEST_WINDOWS,
  verifyProofOffChainWithMopro,
  verifyProofOnChainWithCore,
} from '../proofVerification';
import type {CircuitName} from '../../config/circuitIds';

const NETWORKS: Record<string, {name: string; chainId: number; rpcUrl: string}> = {
  coinbase_country_attestation: {name: 'Base Sepolia', chainId: 84532, rpcUrl: 'https://base-sepolia.example'},
  giwa_attestation: {name: 'GIWA Sepolia', chainId: 91342, rpcUrl: 'https://giwa-sepolia.example'},
};
const ADDRESSES: Record<string, string> = {
  coinbase_country_attestation: '0x1111111111111111111111111111111111111111',
  giwa_attestation: '0x2222222222222222222222222222222222222222',
};

const parsed = {
  proofHex: '0xaabb',
  publicInputsHex: ['0x' + '00'.repeat(31) + '01'],
  numPublicInputs: 1,
};

/**
 * A Coinbase KYC v2 public-input vector core's own checks accept: 193
 * fields, Coinbase's signer root at 96, attested_at (192) `ageSeconds` ago.
 * The proof bytes are `proofBytes` long: 10,304 for the standard package,
 * 10,688 for the Android ones.
 */
function coinbaseParsed(ageSeconds: number, opts: {root?: string; proofBytes?: number} = {}) {
  const core = jest.requireActual('@zkproofport-app/core');
  const L = core.COINBASE_ATTESTATION_PUBLIC_INPUT_LAYOUT;
  const root: string = opts.root ?? core.COINBASE_SIGNER_SET.root;
  const inputs = Array.from({length: core.COINBASE_ATTESTATION_PUBLIC_INPUT_COUNT}, () => '0x' + '00'.repeat(32));
  for (let i = 0; i < 32; i++) {
    inputs[L.MERKLE_ROOT_START + i] = '0x' + root.slice(2 + i * 2, 4 + i * 2).padStart(64, '0');
  }
  const t = Math.floor(Date.now() / 1000) - ageSeconds;
  inputs[L.ATTESTED_AT] = '0x' + t.toString(16).padStart(64, '0');
  return {proofHex: '0x' + 'ab'.repeat(opts.proofBytes ?? 10304), publicInputsHex: inputs, numPublicInputs: inputs.length};
}

function reporter() {
  const logs: string[] = [];
  const statuses: string[] = [];
  const loading: boolean[] = [];
  return {
    logs,
    statuses,
    loading,
    r: {
      addLog: (m: string) => logs.push(m),
      setStatus: (s: string) => statuses.push(s),
      setIsLoading: (l: boolean) => loading.push(l),
    } as Parameters<typeof verifyProofOnChainWithCore>[2],
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetVerifierAddress.mockImplementation(async (c: string) => ADDRESSES[c]);
  mockGetNetworkConfigForCircuit.mockImplementation((c: string) => {
    const n = NETWORKS[c];
    if (!n) throw new Error(`No network is configured for circuit '${c}'`);
    return n;
  });
  mockGetAssetPath.mockImplementation(async (f: string) => `/docs/circuits/${f}`);
});

describe('on-chain verification goes through @zkproofport-app/core', () => {
  it.each(Object.keys(NETWORKS))(
    'CONTRACT: %s is checked by core verifyProofOnChain with its own verifier, chain and RPC',
    async circuit => {
      mockVerifyProofOnChain.mockResolvedValue({valid: true});
      const {r, statuses, loading} = reporter();

      await expect(verifyProofOnChainWithCore(circuit as CircuitName, parsed, r)).resolves.toBe(true);

      expect(mockVerifyProofOnChain).toHaveBeenCalledTimes(1);
      const [c, proof, provider, target, claimed] = mockVerifyProofOnChain.mock.calls[0];
      expect(c).toBe(circuit);
      expect(proof).toBe(parsed);
      expect((provider as {mockUrl: string}).mockUrl).toBe(NETWORKS[circuit].rpcUrl);
      // The contract is core's pinned one on the circuit's chain -- never the
      // address the app resolved, which is only handed over to be compared.
      expect(target).toEqual({chainId: NETWORKS[circuit].chainId});
      expect(mockVerifyProofOnChain.mock.calls[0][5]).toEqual({signerVariant: 'standard'});
      expect(claimed).toEqual({
        verifierAddress: ADDRESSES[circuit],
        chainId: NETWORKS[circuit].chainId,
      });
      expect(statuses).toEqual(['Verifying proof on-chain...', 'Proof verified on-chain!']);
      expect(loading).toEqual([true, false]);
    },
  );

  it('a proof the contract rejects is false, not an error', async () => {
    mockVerifyProofOnChain.mockResolvedValue({valid: false});
    const {r, statuses, logs} = reporter();
    await expect(verifyProofOnChainWithCore('coinbase_country_attestation', parsed, r)).resolves.toBe(false);
    expect(statuses.at(-1)).toBe('Proof invalid (on-chain)');
    expect(logs).toContain('Proof rejected by on-chain verifier');
  });

  it('an error core reports is an error status with its message logged, never "invalid"', async () => {
    mockVerifyProofOnChain.mockResolvedValue({valid: false, error: 'call revert exception'});
    const {r, statuses, logs, loading} = reporter();
    await expect(verifyProofOnChainWithCore('coinbase_country_attestation', parsed, r)).resolves.toBe(false);
    expect(statuses.at(-1)).toBe('Error: on-chain verification failed');
    expect(logs).toContain('On-chain verification error: call revert exception');
    expect(logs).toContain('[OnChain] Contract call reverted');
    expect(loading).toEqual([true, false]);
  });

  it('an unreachable RPC is named as such, not as a generic network error', async () => {
    mockVerifyProofOnChain.mockResolvedValue({valid: false, error: 'could not detect network'});
    const {r, logs} = reporter();
    await verifyProofOnChainWithCore('coinbase_country_attestation', parsed, r);
    expect(logs).toContain('[OnChain] RPC endpoint unreachable');
    expect(logs).not.toContain('[OnChain] Network error - check internet connection');
  });

  it('a thrown failure is caught: false, error status, loading cleared', async () => {
    mockVerifyProofOnChain.mockRejectedValue(new Error('boom'));
    const {r, statuses, loading} = reporter();
    await expect(verifyProofOnChainWithCore('coinbase_country_attestation', parsed, r)).resolves.toBe(false);
    expect(statuses.at(-1)).toBe('Error: on-chain verification failed');
    expect(loading).toEqual([true, false]);
  });

  it('an empty verifier address stops before core is asked', async () => {
    mockGetVerifierAddress.mockResolvedValue('');
    const {r, statuses} = reporter();
    await expect(verifyProofOnChainWithCore('coinbase_country_attestation', parsed, r)).resolves.toBe(false);
    expect(mockVerifyProofOnChain).not.toHaveBeenCalled();
    expect(statuses.at(-1)).toBe('Verification unavailable');
  });

  it('an OIDC proof with an empty verifier address names the circuit, and never asks core', async () => {
    mockGetVerifierAddress.mockResolvedValue('');
    const {r, logs, statuses} = reporter();
    await expect(verifyProofOnChainWithCore('oidc_domain_attestation', parsed, r)).resolves.toBe(false);
    expect(mockVerifyProofOnChain).not.toHaveBeenCalled();
    expect(logs.join('\n')).toContain('Verifier address is empty for oidc_domain_attestation');
    expect(statuses.at(-1)).toBe('Verification unavailable');
  });

  it('a circuit with no network written down is an error, never a default chain', async () => {
    mockGetVerifierAddress.mockResolvedValue('0x3333333333333333333333333333333333333333');
    const {r, statuses, logs} = reporter();
    await expect(verifyProofOnChainWithCore('dojang_playground', parsed, r)).resolves.toBe(false);
    expect(mockGetVerifierAddress).toHaveBeenCalledWith('dojang_playground');
    expect(mockVerifyProofOnChain).not.toHaveBeenCalled();
    expect(statuses.at(-1)).toBe('Error: on-chain verification failed');
    expect(logs.some(l => l.includes("No network is configured for circuit 'dojang_playground'"))).toBe(true);
  });

  it('no proof yet: says so and touches nothing', async () => {
    const {r, logs, statuses, loading} = reporter();
    await expect(verifyProofOnChainWithCore('coinbase_country_attestation', null, r)).resolves.toBe(false);
    expect(logs).toEqual(['Please generate proof first']);
    expect(statuses).toEqual([]);
    expect(loading).toEqual([]);
    expect(mockVerifyProofOnChain).not.toHaveBeenCalled();
  });
});

describe('with the real core: the pinned table decides, the app only claims', () => {
  // These run core's own verifyProofOnChain. Each refusal below must come
  // before core reaches for the provider: the provider here cannot dial out.
  beforeEach(() => {
    mockVerifyProofOnChain.mockImplementation(
      jest.requireActual('@zkproofport-app/core').verifyProofOnChain,
    );
  });

  it('an app address that differs from the pinned verifier is refused, not checked elsewhere', async () => {
    // ADDRESSES.coinbase_country_attestation is 0x1111..., which core does not pin.
    const {r, statuses, logs} = reporter();
    await expect(verifyProofOnChainWithCore('coinbase_country_attestation', parsed, r)).resolves.toBe(false);
    expect(statuses.at(-1)).toBe('Error: on-chain verification failed');
    const pinned = getPinnedVerifier('coinbase_country_attestation', 84532).address;
    const errorLine = logs.find(l => l.startsWith('On-chain verification error: '));
    expect(errorLine).toBeDefined();
    expect(errorLine!.toLowerCase()).toContain(pinned);
  });

  it('a chain core pins nothing on is an error naming the chain, never another chain', async () => {
    mockGetNetworkConfigForCircuit.mockReturnValue({
      name: 'Nowhere', chainId: 999999, rpcUrl: 'https://nowhere.example',
    });
    mockGetVerifierAddress.mockResolvedValue(getPinnedVerifier('coinbase_country_attestation', 84532).address);
    const {r, statuses, logs} = reporter();
    await expect(verifyProofOnChainWithCore('coinbase_country_attestation', parsed, r)).resolves.toBe(false);
    expect(statuses.at(-1)).toBe('Error: on-chain verification failed');
    expect(logs.some(l => l.includes('999999'))).toBe(true);
  });
});

describe('Coinbase KYC v2 is checked on core\'s pinned contract, like every other circuit', () => {
  // core 0.4.0-beta.1 pins the v2 contracts; until then the app named its own
  // v2 address because core pinned v1's.
  it('the standard package: core picks the contract, the app only claims its own address', async () => {
    const v2 = '0x1885aA2283DB21ad0fc63A2Df98efe92F31908E6';
    expect(v2.toLowerCase()).toBe(getPinnedVerifier('coinbase_attestation', 84532).address);
    mockGetVerifierAddress.mockResolvedValue(v2);
    mockGetNetworkConfigForCircuit.mockReturnValue(NETWORKS.coinbase_country_attestation);
    mockVerifyProofOnChain.mockResolvedValue({valid: true});
    const {r} = reporter();
    await expect(verifyProofOnChainWithCore('coinbase_attestation', parsed, r)).resolves.toBe(true);
    const [c, , , target, claimed, options] = mockVerifyProofOnChain.mock.calls[0];
    expect(c).toBe('coinbase_attestation');
    expect(target).toEqual({chainId: 84532});
    expect(claimed).toEqual({verifierAddress: v2, chainId: 84532});
    expect(options).toEqual({signerVariant: 'standard'});
  });

  it('with the real core, a build still naming the v1 contract is refused, never checked there', async () => {
    mockVerifyProofOnChain.mockImplementation(jest.requireActual('@zkproofport-app/core').verifyProofOnChain);
    mockGetVerifierAddress.mockResolvedValue('0x42d165a48256AE184E1DE4e7E6372e870e2Bc883');
    mockGetNetworkConfigForCircuit.mockReturnValue(NETWORKS.coinbase_country_attestation);
    const {r, logs} = reporter();
    await expect(verifyProofOnChainWithCore('coinbase_attestation', coinbaseParsed(60), r)).resolves.toBe(false);
    expect(mockContractVerify).not.toHaveBeenCalled();
    expect(logs.join('\n')).toContain(getPinnedVerifier('coinbase_attestation', 84532).address);
  });
});

describe('off-chain verification stays on mopro', () => {
  const vk = new ArrayBuffer(8);
  const fullProof = new ArrayBuffer(16);

  it("CONTRACT: calls mopro verifyNoirProof with the named circuit's json, the proof and the VK", async () => {
    mockVerifyNoirProof.mockReturnValue(true);
    const {r, statuses, loading} = reporter();
    await expect(verifyProofOffChainWithMopro('giwa_attestation', vk, fullProof, r)).resolves.toBe(true);
    expect(mockGetAssetPath).toHaveBeenCalledWith('giwa_attestation.json');
    expect(mockVerifyNoirProof).toHaveBeenCalledWith(
      '/docs/circuits/giwa_attestation.json', fullProof, true, vk, true,
    );
    expect(statuses).toEqual(['Verifying proof...', 'Proof verified!']);
    expect(loading).toEqual([true, false]);
    expect(mockVerifyProofOnChain).not.toHaveBeenCalled();
  });

  it('an invalid proof is "Proof invalid"', async () => {
    mockVerifyNoirProof.mockReturnValue(false);
    const {r, statuses} = reporter();
    await expect(verifyProofOffChainWithMopro('coinbase_country_attestation', vk, fullProof, r)).resolves.toBe(false);
    expect(statuses.at(-1)).toBe('Proof invalid');
  });

  it('a mopro failure is caught: false, error status, loading cleared', async () => {
    mockVerifyNoirProof.mockImplementation(() => {
      throw new Error('NoirError');
    });
    const {r, statuses, logs, loading} = reporter();
    await expect(verifyProofOffChainWithMopro('coinbase_country_attestation', vk, fullProof, r)).resolves.toBe(false);
    expect(statuses.at(-1)).toBe('Error verifying proof');
    expect(logs).toContain('Error: NoirError');
    expect(loading).toEqual([true, false]);
  });

  it('a missing circuit file is caught the same way', async () => {
    mockGetAssetPath.mockRejectedValue(new Error('Circuit file not found: x.json'));
    const {r, statuses} = reporter();
    await expect(verifyProofOffChainWithMopro('coinbase_country_attestation', vk, fullProof, r)).resolves.toBe(false);
    expect(mockVerifyNoirProof).not.toHaveBeenCalled();
    expect(statuses.at(-1)).toBe('Error verifying proof');
  });

  it.each([
    ['no VK', null, fullProof],
    ['no proof', vk, null],
  ])('%s: says so and touches nothing', async (_label, v, p) => {
    const {r, logs, statuses, loading} = reporter();
    await expect(verifyProofOffChainWithMopro('coinbase_country_attestation', v, p, r)).resolves.toBe(false);
    expect(logs).toEqual(['Please generate proof first']);
    expect(statuses).toEqual([]);
    expect(loading).toEqual([]);
    expect(mockVerifyNoirProof).not.toHaveBeenCalled();
  });
});

describe('every proof hook uses the shared checks and carries no copy', () => {
  const HOOKS = [
    'useCoinbaseKyc.ts',
    'useCoinbaseCountry.ts',
    'useGiwaKyc.ts',
    'useOidcDomain.ts',
    'useDojangPlayground.ts',
  ];
  const code = (file: string) =>
    fs
      .readFileSync(path.join(__dirname, '..', '..', 'hooks', file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter(line => !line.trim().startsWith('//'))
      .join('\n');

  it.each(HOOKS)('%s', file => {
    const src = code(file);
    expect(src).toMatch(/verifyProofOnChainWithCore\(/);
    expect(src).toMatch(/verifyProofOffChainWithMopro\(/);
    expect(src).not.toMatch(/new ethers\.Contract\(/);
    expect(src).not.toMatch(/\.verify\(/);
    expect(src).not.toMatch(/verifyNoirProof/);
  });

  it('the hook directory holds exactly these six proof hooks with a verifier', () => {
    // A seventh hook that verifies must be added to the list above, so it is
    // held to the same rule rather than growing its own copy.
    const verifying = fs
      .readdirSync(path.join(__dirname, '..', '..', 'hooks'))
      .filter(f => f.endsWith('.ts'))
      .filter(f => /verifyProofOnChain|verifyNoirProof|ethers\.Contract/.test(code(f)));
    expect(verifying.sort()).toEqual([...HOOKS].sort());
  });
});

describe('an Android proof is checked on its own package\'s contract', () => {
  /* eslint-disable @typescript-eslint/no-var-requires */
  const rn = jest.requireMock('react-native') as {Platform: {OS: string}};
  const {__setAndroidChainKindForTests} = require('../../config/signerPlatform');
  const {androidVerifierFor} = require('../../config/variantVerifiers');
  /* eslint-enable @typescript-eslint/no-var-requires */
  beforeEach(() => {
    mockVerifyProofOnChain.mockReset();
    mockGetVerifierAddress.mockReset();
    mockGetNetworkConfigForCircuit.mockReturnValue({name: 'Base Sepolia', chainId: 84532, rpcUrl: 'https://base-sepolia.example'});
    rn.Platform.OS = 'android';
  });
  afterEach(() => {
    rn.Platform.OS = 'ios';
    mockEnv = 'development';
    __setAndroidChainKindForTests(null);
  });

  it.each([
    ['android', 'coinbase_attestation'],
    ['android_factory', 'coinbase_attestation'],
    ['android', 'oidc_domain_attestation'],
    ['android_factory', 'oidc_domain_attestation'],
  ] as const)('%s %s: the variant\'s address, named as the target, never the standard one', async (kind, circuit) => {
    __setAndroidChainKindForTests(kind);
    mockVerifyProofOnChain.mockResolvedValue({valid: true});
    const rep = reporter();
    await expect(verifyProofOnChainWithCore(circuit, parsed, rep.r)).resolves.toBe(true);
    const want = androidVerifierFor(circuit, 'development', kind).address;
    const [c, , , target, claim, options] = mockVerifyProofOnChain.mock.calls[0];
    expect(c).toBe(circuit);
    // A chain and the package: core's pinned row for that package decides.
    // Naming the address instead makes core read the proof as the standard
    // package's and refuse an Android-length proof.
    expect(target).toEqual({chainId: 84532});
    expect(options).toEqual({signerVariant: kind});
    expect(claim).toEqual({verifierAddress: want, chainId: 84532});
    expect(want.toLowerCase()).toBe(getPinnedVariantVerifier(circuit, kind, 84532).address);
    expect(mockGetVerifierAddress).not.toHaveBeenCalled();
  });

  it('production: the variant\'s Base mainnet contract, named as the target', async () => {
    mockEnv = 'production';
    __setAndroidChainKindForTests('android_factory');
    mockVerifyProofOnChain.mockResolvedValue({valid: true});
    const rep = reporter();
    await expect(verifyProofOnChainWithCore('coinbase_attestation', parsed, rep.r)).resolves.toBe(true);
    const [, , , target, claim, options] = mockVerifyProofOnChain.mock.calls[0];
    expect(target).toEqual({chainId: 8453});
    expect(options).toEqual({signerVariant: 'android_factory'});
    expect(claim).toEqual({verifierAddress: '0x87d9a66CAcaC95b2Bc43bAc8E610c59ACB67c5E0', chainId: 8453});
    expect(mockGetVerifierAddress).not.toHaveBeenCalled();
  });

  it.each(['android', 'android_factory'] as const)(
    'with the real core, a fresh %s Coinbase proof passes every check and reaches the contract call',
    async kind => {
      // Before: the app named the address and core read a 10,688-byte proof
      // as the standard package's, refusing it before any contract was asked.
      // core calls its own getVerifierContract, so the provider this file
      // fakes is what stops it: that error is the evidence it got that far.
      mockVerifyProofOnChain.mockImplementation(jest.requireActual('@zkproofport-app/core').verifyProofOnChain);
      __setAndroidChainKindForTests(kind);
      const rep = reporter();
      await expect(
        verifyProofOnChainWithCore('coinbase_attestation', coinbaseParsed(60, {proofBytes: 10688}), rep.r),
      ).resolves.toBe(false);
      const errors = rep.logs.filter(l => l.startsWith('On-chain verification error: '));
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatch(/invalid signer or provider/);
      expect(errors[0]).toContain('base-sepolia.example');
    },
  );
});

describe('a History proof older than the request window is asked of the contract', () => {
  // 01:29 on 2026-10-29: an OIDC proof made at 01:06 read "on-chain failed".
  // core refuses a proof whose time is over 15 min old before it asks the
  // contract -- right for a dApp, wrong for the phone checking its History.
  // core 0.4.0-beta.1 holds a Coinbase KYC proof's attested_at to the same
  // window, so an old Coinbase proof read "failed" the same way.
  const core = jest.requireActual('@zkproofport-app/core');
  const NOW = core.OIDC_DOMAIN_ATTESTATION_PUBLIC_INPUT_LAYOUT.NOW;
  const oidcParsed = (ageSeconds: number) => {
    const inputs = Array.from({length: 214}, () => '0x' + '00'.repeat(32));
    const t = Math.floor(Date.now() / 1000) - ageSeconds;
    inputs[NOW] = '0x' + t.toString(16).padStart(64, '0');
    return {proofHex: '0x' + 'ab'.repeat(10304), publicInputsHex: inputs, numPublicInputs: 214};
  };
  const CASES = {
    oidc_domain_attestation: {make: oidcParsed, input: 'now'},
    coinbase_attestation: {make: (age: number) => coinbaseParsed(age), input: 'attested_at'},
  } as const;
  const CIRCUITS = Object.keys(CASES) as (keyof typeof CASES)[];

  beforeEach(() => {
    mockGetVerifierAddress.mockImplementation(async (c: string) => getPinnedVerifier(c, 84532).address);
    mockGetNetworkConfigForCircuit.mockReturnValue({name: 'Base Sepolia', chainId: 84532, rpcUrl: 'https://base-sepolia.example'});
  });

  it.each(CIRCUITS)('%s: is asked of core\'s pinned contract directly, and the contract decides', async circuit => {
    mockContractVerify.mockResolvedValue(true);
    const {r, logs, statuses} = reporter();
    const proof = CASES[circuit].make(23 * 60);
    await expect(verifyProofOnChainWithCore(circuit, proof, r)).resolves.toBe(true);
    expect(mockVerifyProofOnChain).not.toHaveBeenCalled();
    expect(mockContractVerify).toHaveBeenCalledTimes(1);
    expect(mockContractVerify).toHaveBeenCalledWith(proof.proofHex, proof.publicInputsHex);
    expect(mockGetVerifierContract.mock.calls[0][1]).toMatchObject({address: getPinnedVerifier(circuit, 84532).address, chainId: 84532});
    expect(logs.some(l => new RegExp(`Proof made 13\\d\\ds ago \\(${CASES[circuit].input}\\), past the 900s`).test(l))).toBe(true);
    expect(statuses.at(-1)).toBe('Proof verified on-chain!');
  });

  it.each(CIRCUITS)('%s: a contract that rejects it is still "invalid"', async circuit => {
    mockContractVerify.mockResolvedValue(false);
    const {r, statuses} = reporter();
    await expect(verifyProofOnChainWithCore(circuit, CASES[circuit].make(3600), r)).resolves.toBe(false);
    expect(statuses.at(-1)).toBe('Proof invalid (on-chain)');
  });

  it.each(CIRCUITS)('%s: a contract call that throws is an error, never "verified"', async circuit => {
    mockContractVerify.mockRejectedValue(new Error('could not detect network'));
    const {r, statuses, logs} = reporter();
    await expect(verifyProofOnChainWithCore(circuit, CASES[circuit].make(3600), r)).resolves.toBe(false);
    expect(statuses.at(-1)).toBe('Error: on-chain verification failed');
    expect(logs).toContain('[OnChain] RPC endpoint unreachable');
  });

  it.each(CIRCUITS)('%s: a build naming another contract is refused before the contract is asked', async circuit => {
    mockGetVerifierAddress.mockResolvedValue('0x1111111111111111111111111111111111111111');
    const {r, logs} = reporter();
    await expect(verifyProofOnChainWithCore(circuit, CASES[circuit].make(3600), r)).resolves.toBe(false);
    expect(mockContractVerify).not.toHaveBeenCalled();
    expect(logs.join('\n')).toContain(getPinnedVerifier(circuit, 84532).address);
  });

  it.each([
    [60, 'core'],
    [900, 'core'],
    [901, 'contract'],
  ] as const)('%ss old: goes to the %s (the window is core\'s 900 s, exclusive)', async (age, via) => {
    for (const circuit of CIRCUITS) {
      jest.clearAllMocks();
      mockVerifyProofOnChain.mockResolvedValue({valid: true});
      mockContractVerify.mockResolvedValue(true);
      const {r} = reporter();
      await expect(verifyProofOnChainWithCore(circuit, CASES[circuit].make(age), r)).resolves.toBe(true);
      expect([circuit, mockVerifyProofOnChain.mock.calls.length, mockContractVerify.mock.calls.length]).toEqual(
        [circuit, via === 'core' ? 1 : 0, via === 'core' ? 0 : 1],
      );
    }
  });

  it('a proof dated in the future goes through core, which judges the clock skew', async () => {
    mockVerifyProofOnChain.mockResolvedValue({valid: false, error: 'ahead of this verifier\'s clock'});
    const {r} = reporter();
    await expect(verifyProofOnChainWithCore('coinbase_attestation', coinbaseParsed(-3600), r)).resolves.toBe(false);
    expect(mockVerifyProofOnChain).toHaveBeenCalledTimes(1);
    expect(mockContractVerify).not.toHaveBeenCalled();
  });

  it('an old Coinbase proof still has its signer root compared with Coinbase\'s, before the contract', async () => {
    const {r, statuses, logs} = reporter();
    const forged = coinbaseParsed(3600, {root: '0x' + '11'.repeat(32)});
    await expect(verifyProofOnChainWithCore('coinbase_attestation', forged, r)).resolves.toBe(false);
    expect(mockContractVerify).not.toHaveBeenCalled();
    expect(statuses.at(-1)).toBe('Error: on-chain verification failed');
    expect(logs.join('\n')).toMatch(/signer-list root 0x(11){32} is not the root of Coinbase/);
  });

  it('an old v1-shaped (128-input) Coinbase proof is refused by count, never sent to the contract', async () => {
    const v1 = coinbaseParsed(3600);
    const old = {...v1, publicInputsHex: v1.publicInputsHex.slice(0, 128), numPublicInputs: 128};
    // attested_at sits at 192, which a 128-input vector does not have: no age,
    // so core decides -- and core refuses v1 by name.
    mockVerifyProofOnChain.mockImplementation(jest.requireActual('@zkproofport-app/core').verifyProofOnChain);
    const {r, logs} = reporter();
    await expect(verifyProofOnChainWithCore('coinbase_attestation', old, r)).resolves.toBe(false);
    expect(mockContractVerify).not.toHaveBeenCalled();
    expect(logs.join('\n')).toMatch(/Coinbase KYC v1 proof/);
  });

  describe('on Android', () => {
    /* eslint-disable @typescript-eslint/no-var-requires */
    const rn = jest.requireMock('react-native') as {Platform: {OS: string}};
    const {__setAndroidChainKindForTests} = require('../../config/signerPlatform');
    const {androidVerifierFor} = require('../../config/variantVerifiers');
    /* eslint-enable @typescript-eslint/no-var-requires */
    beforeEach(() => {
      rn.Platform.OS = 'android';
    });
    afterEach(() => {
      rn.Platform.OS = 'ios';
      __setAndroidChainKindForTests(null);
    });

    it.each([
      ['android', 'coinbase_attestation'],
      ['android_factory', 'coinbase_attestation'],
      ['android', 'oidc_domain_attestation'],
      ['android_factory', 'oidc_domain_attestation'],
    ] as const)('%s %s: the package\'s own pinned contract, asked directly', async (kind, circuit) => {
      __setAndroidChainKindForTests(kind);
      mockContractVerify.mockResolvedValue(true);
      const {r} = reporter();
      await expect(verifyProofOnChainWithCore(circuit, CASES[circuit].make(3600), r)).resolves.toBe(true);
      expect(mockVerifyProofOnChain).not.toHaveBeenCalled();
      const want = getPinnedVariantVerifier(circuit, kind, 84532).address;
      expect(androidVerifierFor(circuit, 'development', kind).address.toLowerCase()).toBe(want);
      expect(mockGetVerifierContract.mock.calls[0][1]).toMatchObject({address: want, chainId: 84532});
    });
  });

  it('the age is read by each circuit\'s own time input; a circuit without one, or a garbled value, reads as unknown', () => {
    const coinbase = coinbaseParsed(100).publicInputsHex;
    expect(proofAgeSeconds('coinbase_attestation', coinbase, Math.floor(Date.now() / 1000))).toBeGreaterThanOrEqual(100);
    const oidc = oidcParsed(200).publicInputsHex;
    expect(proofAgeSeconds('oidc_domain_attestation', oidc, Math.floor(Date.now() / 1000))).toBeGreaterThanOrEqual(200);
    // OIDC's `now` is not where Coinbase keeps attested_at, and the reverse.
    expect(REQUEST_WINDOWS.coinbase_attestation!.index).toBe(192);
    expect(REQUEST_WINDOWS.oidc_domain_attestation!.index).toBe(NOW);
    for (const c of ['coinbase_country_attestation', 'giwa_attestation', 'dojang_playground']) {
      expect(proofAgeSeconds(c, coinbase, 100)).toBeNull();
    }
    expect(proofAgeSeconds('oidc_domain_attestation', [], 100)).toBeNull();
    const bad = Array(214).fill('0x00');
    bad[NOW] = 'not hex';
    expect(proofAgeSeconds('oidc_domain_attestation', bad, 100)).toBeNull();
    const badCoinbase = [...coinbase];
    badCoinbase[192] = '0xzz';
    expect(proofAgeSeconds('coinbase_attestation', badCoinbase, 100)).toBeNull();
  });

  it.each(['arc_eligibility', '__proto__', 'constructor', ''])('an unknown circuit %j is an error, never "no window"', id => {
    expect(() => proofAgeSeconds(id, [], 100)).toThrow(/Unknown circuit/);
  });

  it('every circuit has its window decided, and only OIDC and Coinbase KYC have one', () => {
    const {ALL_CIRCUIT_IDS} = jest.requireActual('@zkproofport-app/core');
    expect(Object.keys(REQUEST_WINDOWS).sort()).toEqual([...ALL_CIRCUIT_IDS].sort());
    expect(Object.entries(REQUEST_WINDOWS).filter(([, w]) => w).map(([c]) => c).sort()).toEqual(
      ['coinbase_attestation', 'oidc_domain_attestation'],
    );
    expect(REQUEST_WINDOWS.coinbase_attestation!.maxAgeSeconds).toBe(core.COINBASE_ATTESTED_AT_MAX_AGE_SECONDS);
    expect(REQUEST_WINDOWS.oidc_domain_attestation!.maxAgeSeconds).toBe(core.OIDC_NOW_MAX_AGE_SECONDS);
  });

  it('logcat lines carry no long hex (a public input can be a nullifier)', () => {
    const line = `call failed data=0x${'12'.repeat(32)} to 0x1111111111111111111111111111111111111111`;
    expect(maskLongHex(line)).toBe('call failed data=0x1212…1212 to 0x1111111111111111111111111111111111111111');
  });
});
