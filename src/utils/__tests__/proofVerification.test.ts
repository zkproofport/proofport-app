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
jest.mock('@zkproofport-app/core', () => ({
  ...jest.requireActual('@zkproofport-app/core'),
  verifyProofOnChain: (...args: unknown[]) => mockVerifyProofOnChain(...args),
}));

const mockVerifyNoirProof = jest.fn();
jest.mock('mopro-ffi', () => ({
  verifyNoirProof: (...args: unknown[]) => mockVerifyNoirProof(...args),
}));

const mockGetVerifierAddress = jest.fn();
const mockGetNetworkConfigForCircuit = jest.fn();
jest.mock('../../config/environment', () => ({
  getEnvironment: () => 'development',
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

import {getPinnedVerifier} from '@zkproofport-app/core';
import {
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
    await expect(verifyProofOnChainWithCore('mdl_kr_age', parsed, r)).resolves.toBe(false);
    expect(mockGetVerifierAddress).toHaveBeenCalledWith('mdl_kr_age');
    expect(mockVerifyProofOnChain).not.toHaveBeenCalled();
    expect(statuses.at(-1)).toBe('Error: on-chain verification failed');
    expect(logs.some(l => l.includes("No network is configured for circuit 'mdl_kr_age'"))).toBe(true);
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

describe('Coinbase KYC v2 (pinned circuits tag) is checked against the contract the app configures', () => {
  it('names the v2 contract as the target, because core 0.3.0 pins only the v1 Coinbase verifier', async () => {
    const v2 = '0x1885aA2283DB21ad0fc63A2Df98efe92F31908E6';
    mockGetVerifierAddress.mockResolvedValue(v2);
    mockGetNetworkConfigForCircuit.mockReturnValue(NETWORKS.coinbase_country_attestation);
    mockVerifyProofOnChain.mockResolvedValue({valid: true});
    const {r} = reporter();
    await expect(verifyProofOnChainWithCore('coinbase_attestation', parsed, r)).resolves.toBe(true);
    const [c, , , target, claimed] = mockVerifyProofOnChain.mock.calls[0];
    expect(c).toBe('coinbase_attestation');
    expect(target).toEqual({address: v2, chainId: 84532, abi: jest.requireActual('@zkproofport-app/core').VERIFIER_ABI});
    expect(claimed).toEqual({verifierAddress: v2, chainId: 84532});
    expect(v2.toLowerCase()).not.toBe(getPinnedVerifier('coinbase_attestation', 84532).address);
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
    'useMdlKr.ts',
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
