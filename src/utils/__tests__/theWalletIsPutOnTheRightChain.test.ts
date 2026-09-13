/**
 * A wallet on the wrong chain refuses to sign, and says only "Active chainId
 * is 0x1 but received 0x4cef52".
 *
 * The app asked for no switch and no add, so the Arc flow stopped there and a
 * person had to add the network by hand — from an RPC URL and a chain id that
 * appeared in no document. Reported from the simulator on 2026-09-12.
 *
 * The chain's own answer, checked the same day: https://rpc.testnet.arc.io
 * returns 0x4cef52 for eth_chainId and 5042002 for net_version.
 */
// The network config reads native build settings to pick development vs
// production, the same stub the sibling deep-link tests use.
jest.mock('react-native', () => ({NativeModules: {}}));


import {ensureWalletOnChain, nativeCurrencyFor} from '../walletChain';
import {getNetworkConfigForCircuit} from '../../config/environment';

const ARC = 'arc_eligibility' as const;

/** A wallet that records what was asked of it. */
function fakeWallet(opts: {chainId: string; knowsChain?: boolean; rejectSwitch?: boolean}) {
  const calls: Array<{method: string; params?: unknown[]}> = [];
  let chainId = opts.chainId;
  return {
    calls,
    get chainId() {
      return chainId;
    },
    request: async ({method, params}: {method: string; params?: unknown[]}) => {
      calls.push({method, params});
      if (method === 'eth_chainId') return chainId;
      if (method === 'wallet_switchEthereumChain') {
        if (opts.rejectSwitch) throw Object.assign(new Error('user rejected'), {code: 4001});
        if (!opts.knowsChain) throw Object.assign(new Error('Unrecognized chain ID'), {code: 4902});
        chainId = (params?.[0] as {chainId: string}).chainId;
        return null;
      }
      if (method === 'wallet_addEthereumChain') {
        opts.knowsChain = true;
        chainId = (params?.[0] as {chainId: string}).chainId;
        return null;
      }
      throw new Error(`unexpected ${method}`);
    },
  };
}

describe('the wallet is put on the chain an action is signed for', () => {
  it.each([1, 8453, 84532, 91342])('names the gas token for known ether chain %i', chainId => {
    expect(nativeCurrencyFor(chainId)).toEqual({name: 'Ether', symbol: 'ETH', decimals: 18});
  });

  it.each([0, -1, 999, Number.NaN, Number.POSITIVE_INFINITY, 'toString' as never])('refuses to guess the gas token for unknown chain %s', chainId => {
    expect(() => nativeCurrencyFor(chainId)).toThrow(/Unknown native currency/);
  });

  it('asks for nothing when the wallet is already there', async () => {
    const w = fakeWallet({chainId: '0x4cef52', knowsChain: true});
    await ensureWalletOnChain(w, ARC);
    expect(w.calls.map(c => c.method)).toEqual(['eth_chainId']);
  });

  it('switches when the wallet knows the chain', async () => {
    const w = fakeWallet({chainId: '0x1', knowsChain: true});
    await ensureWalletOnChain(w, ARC);
    expect(w.calls.map(c => c.method)).toEqual(['eth_chainId', 'wallet_switchEthereumChain']);
    expect(w.chainId).toBe('0x4cef52');
  });

  it('adds the chain first when the wallet has never seen it', async () => {
    const w = fakeWallet({chainId: '0x1', knowsChain: false});
    await ensureWalletOnChain(w, ARC);
    expect(w.calls.map(c => c.method)).toContain('wallet_addEthereumChain');
    expect(w.chainId).toBe('0x4cef52');
  });

  it('sends the RPC and explorer from config, never typed in here', async () => {
    const w = fakeWallet({chainId: '0x1', knowsChain: false});
    await ensureWalletOnChain(w, ARC);
    const add = w.calls.find(c => c.method === 'wallet_addEthereumChain');
    const net = getNetworkConfigForCircuit(ARC);
    expect(add?.params?.[0]).toMatchObject({
      chainId: `0x${net.chainId.toString(16)}`,
      chainName: net.name,
      rpcUrls: [net.rpcUrl],
      blockExplorerUrls: [net.explorerUrl],
    });
  });

  it('names USDC as Arc’s gas token, with native decimals', async () => {
    // One balance, two views: an 18-decimal native one and a 6-decimal ERC-20
    // one at 0x3600…0000. A wallet sends native value, so 18 is the right one
    // to hand it — putting 6 here would misprice every gas estimate.
    const w = fakeWallet({chainId: '0x1', knowsChain: false});
    await ensureWalletOnChain(w, ARC);
    const add = w.calls.find(c => c.method === 'wallet_addEthereumChain');
    expect((add?.params?.[0] as {nativeCurrency: unknown}).nativeCurrency).toEqual({
      name: 'USD Coin',
      symbol: 'USDC',
      decimals: 18,
    });
  });

  it('says why nothing can be signed when the person declines', async () => {
    const w = fakeWallet({chainId: '0x1', rejectSwitch: true});
    await expect(ensureWalletOnChain(w, ARC)).rejects.toThrow(
      /stayed on its current network|nothing can be signed/,
    );
  });
});
