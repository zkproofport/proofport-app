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

export type NetworkId = 'base' | 'giwa' | 'omnione' | 'arc';

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
    // Circle's Arc. Developer-only for the same reason GIWA and OmniOne are:
    // the verifier is not deployed on any mainnet, the circuit's public-input
    // layout may still change, and a release build must not offer a proof that
    // nothing can check.
    id: 'arc',
    labelKey: 'host.more.networkArc',
    circuits: ['arc_eligibility'],
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
  net: {id: string; developerOnly?: boolean},
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
  developerOnly?: boolean;
}

/**
 * Chains, then the bucket for circuits bound to no chain (currently the OIDC
 * domain proof). "Other" is a real, selectable and persistable value — the
 * Verify tab writes it into the default-network setting.
 */
export const NETWORK_CATEGORIES: ReadonlyArray<NetworkCategoryDescriptor> = [
  ...USER_FACING_NETWORKS,
  {
    id: OTHER_NETWORK,
    labelKey: 'host.more.networkOther',
    circuits: NETWORK_INDEPENDENT_CIRCUITS,
  },
];

/** What a picker should show, given Developer Mode and the current value. */
export function visibleNetworkCategories(
  developerMode: boolean,
  currentValue?: string,
): ReadonlyArray<NetworkCategoryDescriptor> {
  return NETWORK_CATEGORIES.filter((n) => isNetworkVisible(n, developerMode, currentValue));
}

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
