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

export type NetworkId = 'base' | 'giwa';

export interface NetworkDescriptor {
  id: NetworkId;
  /** i18n key for the label shown in pickers. */
  labelKey: string;
  /** Circuits that live on this network — drives the Verify tab filter. */
  circuits: CircuitName[];
}

export const USER_FACING_NETWORKS: ReadonlyArray<NetworkDescriptor> = [
  {
    id: 'base',
    labelKey: 'host.more.networkBase',
    circuits: ['coinbase_attestation', 'coinbase_country_attestation', 'human_passport_score'],
  },
  {
    id: 'giwa',
    labelKey: 'host.more.networkGiwa',
    circuits: ['giwa_attestation', 'dojang_playground'],
  },
];

/**
 * Circuits that have no on-chain attestation lookup and therefore are
 * not tied to a specific network — surfaced under the Verify-tab "Other"
 * bucket so they're still reachable regardless of the selected network.
 */
export const NETWORK_INDEPENDENT_CIRCUITS: ReadonlyArray<CircuitName> = [
  'oidc_domain_attestation',
];

/**
 * The picker list, shared by every surface that lets a user choose a network.
 *
 * There is exactly one of these. Two screens used to build their own — the
 * Verify tab appended "Other" and the More tab did not — so the More tab could
 * not show, or return from, a setting the Verify tab writes. Both now read this.
 */
export type NetworkCategoryId = NetworkId | 'other';

export const OTHER_NETWORK = 'other' as const;

export interface NetworkCategoryDescriptor {
  id: NetworkCategoryId;
  labelKey: string;
  circuits: ReadonlyArray<CircuitName>;
}

/**
 * Chains, then the bucket for circuits bound to no chain (currently the OIDC
 * domain proof). "Other" is a real, selectable and persistable value — the
 * Verify tab writes it into the default-network setting. Every row is offered
 * to everyone: Developer Mode gates no network and no circuit.
 */
export const NETWORK_CATEGORIES: ReadonlyArray<NetworkCategoryDescriptor> = [
  ...USER_FACING_NETWORKS,
  {
    id: OTHER_NETWORK,
    labelKey: 'host.more.networkOther',
    circuits: NETWORK_INDEPENDENT_CIRCUITS,
  },
];

/**
 * The circuits in a category. An unknown id is a caller asking for something
 * that does not exist, so it throws rather than answering with an empty list
 * that looks like "this network has no circuits yet".
 */
export function circuitsForCategory(id: string): ReadonlyArray<CircuitName> {
  const found = NETWORK_CATEGORIES.find((n) => n.id === id);
  if (!found) {
    throw new Error(
      `Unknown network category '${id}'. Known: ${NETWORK_CATEGORIES.map((n) => n.id).join(', ')}`,
    );
  }
  return found.circuits;
}
