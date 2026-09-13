/**
 * A WalletConnect session approves its chains once, when it is created.
 *
 * Nothing outside that set can be signed for afterwards, which is why adding
 * Arc Testnet inside MetaMask by hand did not help — the session had never
 * asked for it, and the app answered with "Active chainId is 0x1 but received
 * 0x4cef52" and no way forward. Reported from a simulator on 2026-09-12.
 *
 * The connection setup named two chains, Ethereum and Base, typed out by hand,
 * while the app pinned circuits to Arc Testnet, GIWA Sepolia and the Korea
 * mobile-ID network. Every one of those was unreachable from a connected
 * wallet, and nothing said so.
 */
jest.mock('react-native', () => ({NativeModules: {}}));

import * as fs from 'fs';
import * as path from 'path';

import {walletNetworks} from '../config/walletNetworks';
import {ALL_CIRCUIT_IDS} from '../config/circuitIds';
import {getNetworkConfigForCircuit} from '../config/environment';

describe('the wallet session carries every circuit’s chain', () => {
  const networks = walletNetworks();
  const ids = networks.map(n => n.id);

  it('asks for every chain a circuit is pinned to', () => {
    const missing = ALL_CIRCUIT_IDS.filter(
      c => !ids.includes(getNetworkConfigForCircuit(c).chainId),
    );
    expect(missing).toEqual([]);
  });

  it('includes Arc Testnet, the one that failed', () => {
    expect(ids).toContain(5042002);
  });

  it('includes the chain the Coinbase proofs verify on', () => {
    // There is no "build network" any more; the chain a circuit verifies on
    // is asked of the circuit. This is the one almost every proof uses.
    expect(ids).toContain(getNetworkConfigForCircuit('coinbase_attestation').chainId);
  });

  it('lists each chain once, however many circuits share it', () => {
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives each chain a usable RPC and a CAIP id the session can name', () => {
    for (const n of networks) {
      expect(n.rpcUrls.default.http[0]).toMatch(/^https?:\/\//);
      expect(n.caipNetworkId).toBe(`eip155:${n.id}`);
      expect(n.chainNamespace).toBe('eip155');
      expect(n.name.length).toBeGreaterThan(0);
    }
  });

  it('names USDC as Arc’s gas token, not ether', () => {
    // Arc pays gas in USDC. A wallet told "ETH" would price every fee against
    // a token the chain does not have.
    const arc = networks.find(n => n.id === 5042002);
    expect(arc?.nativeCurrency).toEqual({name: 'USD Coin', symbol: 'USDC', decimals: 18});
  });

  it('takes the RPC from the app config, never typed in twice', () => {
    const arc = networks.find(n => n.id === 5042002);
    expect(arc?.rpcUrls.default.http[0]).toBe(
      getNetworkConfigForCircuit('arc_eligibility').rpcUrl,
    );
  });

  /*
   * The checks above prove the LIST is right. This one proves the app uses it.
   *
   * Without it the guard did not bite: filtering the connection setup back down
   * to Ethereum and Base — the exact bug — left all seven green, because
   * nothing read the file that decides what the session asks for.
   */
  it('hands that list to the wallet connection, unfiltered', () => {
    const setup = fs.readFileSync(
      path.join(__dirname, '..', 'config', 'AppKitConfig.ts'),
      'utf8',
    );
    expect(setup).toContain('const networks = walletNetworks();');
    expect(setup).toMatch(/\n\s*networks,/);
    // The two chains that used to be typed in, and the viem imports that fed
    // them. Either one back means the session is hand-picked again.
    expect(setup).not.toMatch(/viem\/chains/);
    expect(setup).not.toMatch(/networks:\s*\[/);
  });
});
