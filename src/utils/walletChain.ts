/**
 * Putting the wallet on the chain an action is signed for.
 *
 * `eth_signTypedData_v4` is refused when the domain's `chainId` is not the
 * wallet's active chain — MetaMask answers "Active chainId is 0x1 but received
 * 0x…" and stops there. Nothing in this app asked the wallet to switch, so a
 * person testing an action-bound flow saw that sentence and had to add the
 * network by hand, from values nobody had written down.
 *
 * Two requests, in order, because a wallet cannot switch to a chain it does not
 * know: ask to switch, and if the chain is unrecognised, ask to add it and
 * switch again. Both are the user's decision — a wallet shows a prompt for each
 * — and a refusal is reported as a refusal rather than swallowed.
 */
// Straight from the modules that hold these, not the `src/config` barrel:
// the barrel also pulls in the feature flags, which read native config and
// cannot be loaded by jest.
import {getNetworkConfigForCircuit} from '../config/environment';
import type {CircuitName} from '../config/circuitIds';
import {describeWalletError} from './walletError';

/** The shape of the provider the app already passes around. */
interface Eip1193 {
  request: (args: {method: string; params?: unknown[]}) => Promise<unknown>;
}

/** MetaMask's code for "this chain is not in the wallet". */
const CHAIN_NOT_ADDED = 4902;

/** The user closed the prompt. Not an error to retry; an answer. */
const USER_REJECTED = 4001;

/**
 * A chain id as a number, from any of the shapes a provider answers with.
 *
 * EIP-1193 says `eth_chainId` is a hex string, and the test wallet here
 * answered that way. AppKit's provider does not: WalletConnect's
 * UniversalProvider answers `eth_chainId` itself, with
 * `parseInt(this.getDefaultChain())` -- the NUMBER 84532. Compared as a string
 * against "0x14a34" it never matched, so on 2026-10-30 a phone already on Base
 * Sepolia logged "Wallet is on 84532, asking it to switch to Base Sepolia
 * (0x14a34)". Anything that is none of these shapes is undefined, and the
 * caller treats that as "not on the chain", never as a match.
 */
export function chainIdNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value > 0 ? value : undefined;
  if (typeof value !== 'string') return undefined;
  const s = value.trim();
  let n: number | undefined;
  if (/^0x[0-9a-f]+$/i.test(s)) n = parseInt(s, 16);
  else if (/^[0-9]+$/.test(s)) n = Number(s);
  else if (/^eip155:[0-9]+$/.test(s)) n = Number(s.slice('eip155:'.length));
  return n !== undefined && Number.isSafeInteger(n) && n > 0 ? n : undefined;
}

function errorCode(e: unknown): number | undefined {
  if (typeof e === 'object' && e !== null && 'code' in e) {
    const code = (e as {code: unknown}).code;
    if (typeof code === 'number') return code;
  }
  return undefined;
}

/**
 * What a wallet needs to add a chain it has never seen.
 *
 * Assembled from the app's own network config so there is one place the RPC
 * and explorer live, plus the native currency, which the config does not carry
 * because nothing else needed it.
 */
function addChainParams(circuit: CircuitName) {
  const net = getNetworkConfigForCircuit(circuit);
  return {
    chainId: `0x${net.chainId.toString(16)}`,
    chainName: net.name,
    rpcUrls: [net.rpcUrl],
    blockExplorerUrls: [net.explorerUrl],
    nativeCurrency: nativeCurrencyFor(net.chainId),
  };
}

/**
 * The chain's gas token. Exported because the wallet-connection session needs
 * the same answer when it declares which chains it wants. Every chain this app
 * touches pays gas in ether; a chain missing here is an error, not ether by
 * default.
 */
const NATIVE_CURRENCIES = new Map([
  [1, {name: 'Ether', symbol: 'ETH', decimals: 18}],
  [8453, {name: 'Ether', symbol: 'ETH', decimals: 18}],
  [84532, {name: 'Ether', symbol: 'ETH', decimals: 18}],
  [91342, {name: 'Ether', symbol: 'ETH', decimals: 18}],
]);

export function nativeCurrencyFor(chainId: number) {
  const currency = NATIVE_CURRENCIES.get(chainId);
  if (!currency) throw new Error(`Unknown native currency for chain ${chainId}. Configure its gas token before adding the network.`);
  return {...currency};
}

/**
 * Ensure the wallet is on the chain this circuit's actions are signed for.
 *
 * Returns nothing on success. Throws with the reason otherwise, so the caller
 * shows the person what happened instead of a signature failure two steps
 * later that says only that a chain id did not match.
 */
export async function ensureWalletOnChain(
  ethereum: Eip1193,
  circuit: CircuitName,
  log?: (line: string) => void,
): Promise<void> {
  const net = getNetworkConfigForCircuit(circuit);
  const wanted = `0x${net.chainId.toString(16)}`;

  // Over WalletConnect this is the SESSION's default chain, answered by the
  // provider without asking the wallet. The request that follows carries that
  // chain, and the wallet moves to it before signing; what the wallet's own
  // screen is set to cannot be read from here.
  const current = await ethereum.request({method: 'eth_chainId'});
  const currentId = chainIdNumber(current);
  if (currentId === net.chainId) {
    log?.(`[Chain] Wallet is already on ${net.name} (${net.chainId})`);
    return;
  }
  log?.(
    `[Chain] Wallet is on ${currentId ?? `an unreadable chain (${describeWalletError(current)})`}, ` +
      `asking it to switch to ${net.name} (${net.chainId}, ${wanted})`,
  );

  try {
    await ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{chainId: wanted}],
    });
    log?.(`[Chain] Switched to ${net.name}`);
    return;
  } catch (e) {
    if (errorCode(e) === USER_REJECTED) {
      throw new Error(
        `The wallet stayed on its current network. ${net.name} is where this proof's action is signed, so nothing can be signed until it switches.`,
      );
    }
    if (errorCode(e) !== CHAIN_NOT_ADDED) {
      throw new Error(`The wallet did not switch to ${net.name}: ${describeWalletError(e)}`);
    }
  }

  log?.(`[Chain] ${net.name} is not in the wallet yet, asking it to add the network`);
  try {
    await ethereum.request({
      method: 'wallet_addEthereumChain',
      params: [addChainParams(circuit)],
    });
  } catch (e) {
    if (errorCode(e) === USER_REJECTED) {
      throw new Error(
        `The wallet declined to add ${net.name}. It can be added by hand: RPC ${net.rpcUrl}, chain id ${net.chainId}, explorer ${net.explorerUrl}.`,
      );
    }
    throw new Error(`The wallet did not add ${net.name}: ${describeWalletError(e)}`);
  }

  // Some wallets add without switching, so ask again rather than assume.
  const after = await ethereum.request({method: 'eth_chainId'});
  if (chainIdNumber(after) === net.chainId) {
    log?.(`[Chain] Added and switched to ${net.name}`);
    return;
  }
  try {
    await ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{chainId: wanted}],
    });
  } catch (e) {
    throw new Error(`The wallet added ${net.name} but did not switch to it: ${describeWalletError(e)}`);
  }
  log?.(`[Chain] Added ${net.name} and switched to it`);
}
