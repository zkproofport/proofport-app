/**
 * Putting the wallet on the chain an action is signed for.
 *
 * `eth_signTypedData_v4` is refused when the domain's `chainId` is not the
 * wallet's active chain — MetaMask answers "Active chainId is 0x1 but received
 * 0x4cef52" and stops there. Nothing in this app asked the wallet to switch, so
 * a person testing the Arc flow saw that sentence and had to add the network by
 * hand, from values nobody had written down.
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

/** The shape of the provider the app already passes around. */
interface Eip1193 {
  request: (args: {method: string; params?: unknown[]}) => Promise<unknown>;
}

/** MetaMask's code for "this chain is not in the wallet". */
const CHAIN_NOT_ADDED = 4902;

/** The user closed the prompt. Not an error to retry; an answer. */
const USER_REJECTED = 4001;

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
 * the same answer when it declares which chains it wants.
 *
 * Arc's is USDC, which is unusual enough to be worth stating: one balance with
 * two views, an 18-decimal native one and a 6-decimal ERC-20 one at
 * `0x3600…0000`. A wallet sending native value uses the 18, so that is what
 * goes here. Every other chain this app touches pays gas in ether.
 */
const NATIVE_CURRENCIES = new Map([
  [1, {name: 'Ether', symbol: 'ETH', decimals: 18}],
  [8453, {name: 'Ether', symbol: 'ETH', decimals: 18}],
  [84532, {name: 'Ether', symbol: 'ETH', decimals: 18}],
  [91342, {name: 'Ether', symbol: 'ETH', decimals: 18}],
  [5042002, {name: 'USD Coin', symbol: 'USDC', decimals: 18}],
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

  const current = await ethereum.request({method: 'eth_chainId'});
  if (typeof current === 'string' && current.toLowerCase() === wanted.toLowerCase()) {
    log?.(`[Chain] Wallet is already on ${net.name} (${wanted})`);
    return;
  }
  log?.(`[Chain] Wallet is on ${String(current)}, asking it to switch to ${net.name} (${wanted})`);

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
      throw e;
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
    throw e;
  }

  // Some wallets add without switching, so ask again rather than assume.
  const after = await ethereum.request({method: 'eth_chainId'});
  if (typeof after === 'string' && after.toLowerCase() === wanted.toLowerCase()) {
    log?.(`[Chain] Added and switched to ${net.name}`);
    return;
  }
  await ethereum.request({
    method: 'wallet_switchEthereumChain',
    params: [{chainId: wanted}],
  });
  log?.(`[Chain] Added ${net.name} and switched to it`);
}
