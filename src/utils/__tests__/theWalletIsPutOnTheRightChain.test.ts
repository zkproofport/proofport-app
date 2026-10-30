/**
 * A wallet on the wrong chain refuses to sign typed data, and says only
 * "Active chainId is 0x1 but received 0x…".
 *
 * The app asked for no switch and no add, so an action-bound flow stopped
 * there and a person had to add the network by hand — from an RPC URL and a
 * chain id that appeared in no document. Reported from the simulator on
 * 2026-09-12. GIWA Sepolia (91342, 0x164ce) is the action-binding chain today.
 */
// The network config reads native build settings to pick development vs
// production, the same stub the sibling deep-link tests use.
jest.mock('react-native', () => ({NativeModules: {}}));


import {chainIdNumber, ensureWalletOnChain, nativeCurrencyFor} from '../walletChain';
import {getNetworkConfigForCircuit} from '../../config/environment';

const GIWA = 'giwa_attestation' as const;

/** A wallet that records what was asked of it. */
function fakeWallet(opts: {chainId: unknown; knowsChain?: boolean; rejectSwitch?: boolean; switchError?: unknown}) {
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
        if (opts.switchError !== undefined) throw opts.switchError;
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

  // 5042002 was Arc Testnet, removed from the app on 2026-10-13.
  it.each([0, -1, 999, 5042002, Number.NaN, Number.POSITIVE_INFINITY, 'toString' as never])('refuses to guess the gas token for unknown chain %s', chainId => {
    expect(() => nativeCurrencyFor(chainId)).toThrow(/Unknown native currency/);
  });

  it('asks for nothing when the wallet is already there', async () => {
    const w = fakeWallet({chainId: '0x164ce', knowsChain: true});
    await ensureWalletOnChain(w, GIWA);
    expect(w.calls.map(c => c.method)).toEqual(['eth_chainId']);
  });

  it('switches when the wallet knows the chain', async () => {
    const w = fakeWallet({chainId: '0x1', knowsChain: true});
    await ensureWalletOnChain(w, GIWA);
    expect(w.calls.map(c => c.method)).toEqual(['eth_chainId', 'wallet_switchEthereumChain']);
    expect(w.chainId).toBe('0x164ce');
  });

  it('adds the chain first when the wallet has never seen it', async () => {
    const w = fakeWallet({chainId: '0x1', knowsChain: false});
    await ensureWalletOnChain(w, GIWA);
    expect(w.calls.map(c => c.method)).toContain('wallet_addEthereumChain');
    expect(w.chainId).toBe('0x164ce');
  });

  it('sends the RPC and explorer from config, never typed in here', async () => {
    const w = fakeWallet({chainId: '0x1', knowsChain: false});
    await ensureWalletOnChain(w, GIWA);
    const add = w.calls.find(c => c.method === 'wallet_addEthereumChain');
    const net = getNetworkConfigForCircuit(GIWA);
    expect(add?.params?.[0]).toMatchObject({
      chainId: `0x${net.chainId.toString(16)}`,
      chainName: net.name,
      rpcUrls: [net.rpcUrl],
      blockExplorerUrls: [net.explorerUrl],
    });
  });

  it('names ether as GIWA Sepolia’s gas token, with native decimals', async () => {
    const w = fakeWallet({chainId: '0x1', knowsChain: false});
    await ensureWalletOnChain(w, GIWA);
    const add = w.calls.find(c => c.method === 'wallet_addEthereumChain');
    expect((add?.params?.[0] as {nativeCurrency: unknown}).nativeCurrency).toEqual({
      name: 'Ether',
      symbol: 'ETH',
      decimals: 18,
    });
  });

  it('says why nothing can be signed when the person declines', async () => {
    const w = fakeWallet({chainId: '0x1', rejectSwitch: true});
    await expect(ensureWalletOnChain(w, GIWA)).rejects.toThrow(
      /stayed on its current network|nothing can be signed/,
    );
  });

  /*
   * 2026-10-30, a phone on Base Sepolia: AppKit's provider answers eth_chainId
   * itself with a NUMBER (WalletConnect UniversalProvider:
   * `parseInt(this.getDefaultChain())`). Compared as a string to "0x14a34" it
   * never matched, and the log read "Wallet is on 84532, asking it to switch
   * to Base Sepolia (0x14a34)".
   */
  it.each([
    ['the number AppKit answers', 0x164ce],
    ['a hex string', '0x164ce'],
    ['upper-case hex', '0x164CE'],
    ['a decimal string', '91342'],
    ['a CAIP-2 id', 'eip155:91342'],
  ])('asks for nothing when the wallet answers %s for the same chain', async (_label, chainId) => {
    const w = fakeWallet({chainId, knowsChain: true});
    const log: string[] = [];
    await ensureWalletOnChain(w, GIWA, line => log.push(line));
    expect(w.calls.map(c => c.method)).toEqual(['eth_chainId']);
    expect(log.join('\n')).toMatch(/already on/);
  });

  it.each([[0x1], ['0x1'], ['8453'], [null], [undefined], [''], ['0x'], ['eip155:'], ['banana'], [{}], [-91342], [1.5], ['0x' + 'f'.repeat(40)]])(
    'switches when the answer is another or unreadable chain: %p',
    async chainId => {
      const w = fakeWallet({chainId, knowsChain: true});
      await ensureWalletOnChain(w, GIWA);
      expect(w.calls.map(c => c.method)).toEqual(['eth_chainId', 'wallet_switchEthereumChain']);
    },
  );

  it('reads chain ids without guessing', () => {
    expect(chainIdNumber(84532)).toBe(84532);
    expect(chainIdNumber('0x14a34')).toBe(84532);
    expect(chainIdNumber('84532')).toBe(84532);
    expect(chainIdNumber('eip155:84532')).toBe(84532);
    expect(chainIdNumber(0)).toBeUndefined();
    expect(chainIdNumber(Number.NaN)).toBeUndefined();
    expect(chainIdNumber('0x0')).toBeUndefined();
    expect(chainIdNumber(' 0x14a34 ')).toBe(84532);
    expect(chainIdNumber('solana:84532')).toBeUndefined();
  });

  it('says what the wallet said when a switch fails with a plain JSON-RPC object', async () => {
    const w = fakeWallet({chainId: '0x1', switchError: {code: -32603, message: 'Internal error', data: {message: 'switch broke'}}});
    const err = await ensureWalletOnChain(w, GIWA).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('The wallet did not switch to ' + getNetworkConfigForCircuit(GIWA).name + ': Internal error (code -32603): switch broke');
    expect((err as Error).message).not.toContain('[object Object]');
  });

  it('treats a plain-object 4001 as the person declining', async () => {
    const w = fakeWallet({chainId: '0x1', switchError: {code: 4001, message: 'User rejected'}});
    await expect(ensureWalletOnChain(w, GIWA)).rejects.toThrow(/stayed on its current network/);
  });
});

