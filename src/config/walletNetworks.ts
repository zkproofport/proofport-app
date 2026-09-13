/**
 * The chains the wallet connection asks for.
 *
 * A WalletConnect session approves a fixed set of chains when it is created.
 * Anything outside that set cannot be signed for, no matter what the wallet has
 * configured on its own side — which is why adding Arc Testnet inside MetaMask
 * by hand did not help: the session had never asked for it.
 *
 * This list used to be two chains typed into the connection setup, Ethereum
 * and Base, while the app pinned circuits to Arc, GIWA and a Korea mobile-ID
 * network. Every one of those was unreachable from a connected wallet.
 *
 * So the list is DERIVED: the base network for this build, plus every chain a
 * circuit is pinned to. Adding a circuit on a new chain puts that chain in the
 * session with no further edit.
 */
import {ALL_CIRCUIT_IDS} from './circuitIds';
import {getNetworkConfigForCircuit} from './environment';
import {nativeCurrencyFor} from '../utils/walletChain';
import type {AppKitNetwork} from '@reown/appkit-react-native';

/** Ethereum mainnet, kept because a wallet usually opens on it. */
const ETHEREUM = {
  chainId: 1,
  name: 'Ethereum',
  rpcUrl: 'https://cloudflare-eth.com',
  explorerUrl: 'https://etherscan.io',
} as const;

function toAppKitNetwork(net: {
  chainId: number;
  name: string;
  rpcUrl: string;
  explorerUrl: string;
}): AppKitNetwork {
  return {
    id: net.chainId,
    name: net.name,
    chainNamespace: 'eip155',
    caipNetworkId: `eip155:${net.chainId}`,
    nativeCurrency: nativeCurrencyFor(net.chainId),
    rpcUrls: {default: {http: [net.rpcUrl]}},
    blockExplorers: {default: {name: `${net.name} Explorer`, url: net.explorerUrl}},
  };
}

/**
 * Every chain the session should carry, each one once.
 *
 * Ordered with the build's own network first, because a wallet picker shows
 * them in order and that is the one almost every proof uses.
 */
export function walletNetworks(): AppKitNetwork[] {
  const seen = new Map<number, AppKitNetwork>();
  const add = (net: {chainId: number; name: string; rpcUrl: string; explorerUrl: string}) => {
    if (!seen.has(net.chainId)) seen.set(net.chainId, toAppKitNetwork(net));
  };

  for (const circuit of ALL_CIRCUIT_IDS) {
    add(getNetworkConfigForCircuit(circuit));
  }
  add(ETHEREUM);

  return [...seen.values()];
}
