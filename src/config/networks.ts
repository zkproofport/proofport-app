/**
 * Single source of truth for user-facing networks.
 *
 * Adding a new chain to the app:
 *   1. Add its `NetworkConfig` to `CIRCUIT_NETWORK_OVERRIDES` (contracts.ts)
 *      if any circuit is pinned to it.
 *   2. Add an entry below with the i18n label key + the circuit IDs that
 *      belong on the network.
 *
 * Both the More-tab default-network picker and the Verify-tab category
 * filter iterate this list, so the UI scales without further code edits.
 */
import type {CircuitName} from './contracts';

export type NetworkId = 'base' | 'giwa' | 'omnione';

export interface NetworkDescriptor {
  id: NetworkId;
  /** i18n key for the label shown in pickers. */
  labelKey: string;
  /** Circuits that live on this network — drives the Verify tab filter. */
  circuits: CircuitName[];
  /** When true, hidden from pickers unless Developer Mode is on. PoC /
   *  testnet networks live here so demo users only see what's
   *  production-ready by default. */
  developerOnly?: boolean;
}

export const USER_FACING_NETWORKS: ReadonlyArray<NetworkDescriptor> = [
  {
    id: 'base',
    labelKey: 'host.more.networkBase',
    circuits: ['coinbase_attestation', 'coinbase_country_attestation'],
  },
  {
    id: 'giwa',
    labelKey: 'host.more.networkGiwa',
    circuits: ['giwa_attestation'],
    developerOnly: true,
  },
  {
    id: 'omnione',
    labelKey: 'host.more.networkOmniOne',
    circuits: ['mdl_kr_ownership', 'mdl_kr_age', 'mdl_kr_region'],
    developerOnly: true,
  },
];

/**
 * Whether a network should be hidden from default UI surfaces when
 * Developer Mode is off. The currently-selected value is always kept
 * visible by callers so a previously-set developer-only network can be
 * swapped back to a normal one without flipping the dev flag.
 */
export function isNetworkVisible(
  net: NetworkDescriptor,
  developerMode: boolean,
  currentValue?: string,
): boolean {
  if (!net.developerOnly) return true;
  if (developerMode) return true;
  return currentValue === net.id;
}

/**
 * Circuits that have no on-chain attestation lookup and therefore are
 * not tied to a specific network — surfaced under the Verify-tab "Other"
 * bucket so they're still reachable regardless of the selected network.
 */
export const NETWORK_INDEPENDENT_CIRCUITS: ReadonlyArray<CircuitName> = [
  'oidc_domain_attestation',
];
