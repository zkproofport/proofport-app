/**
 * The circuit identifiers, and the ONE table that translates this app's own
 * historical route ids into them.
 *
 * ## Where the identifiers come from
 *
 * They are NOT declared here. `@zkproofport-app/sdk/circuits` is the published
 * source of truth for the canonical `Nargo.toml` names, and this app reads its
 * list from there. Before that package existed there were twenty-four separate
 * spellings of the same seven strings scattered across this repository, and
 * they drifted: a deep link carrying `mdl_kr_age` reached the right proof flow
 * and rendered the OWNERSHIP title, because one of those lists had only ever
 * learned the hyphenated spelling.
 *
 * The dependency-free `/circuits` subpath is imported rather than the package
 * root on purpose. The root pulls in `socket.io-client` and `qrcode` — a relay
 * client this app does not use, because the app IS the prover. The subpath has
 * no imports at all, so taking the id list costs the bundle nothing.
 *
 * ## Identifiers vs. this app's data
 *
 * Only the LIST of ids comes from the SDK. Everything the app knows about a
 * circuit — file paths, verifier addresses, cache versions, icons, labels,
 * wallet groups, which network it lives on — stays here, keyed by the
 * canonical id. Those tables are typed `Record<CircuitName, …>`, so a circuit
 * added to the SDK is a compile error in every one of them rather than a
 * silent hole.
 *
 * ## Route ids
 *
 * The hyphenated spellings (`coinbase-kyc`, `mdl-kr-age`, …) are this app's
 * own historical navigation ids. They are NOT circuit ids and never were. They
 * survive for exactly one reason: deep links issued before the canonical
 * spelling was adopted still carry them, and a link that has already been sent
 * cannot be recalled. `ROUTE_CIRCUIT_IDS` below is the only place in the app
 * that knows them; everything downstream of `canonicalCircuitId()` sees the
 * canonical name and nothing else.
 */
import {
  ALL_CIRCUIT_IDS,
  CIRCUIT_IDS,
  CIRCUIT_SUPPORT_STATUS,
  CIRCUIT_NEEDS_WALLET_SIGNATURE,
  CIRCUIT_VK_PATHS,
  EXPERIMENTAL_CIRCUIT_IDS,
  PLANNED_CIRCUIT_IDS,
  SUPPORTED_CIRCUIT_IDS,
  getCircuitSupportStatus,
  isCircuitId,
  isSupportedCircuitId,
  type CircuitId,
  type CircuitSupportStatus,
} from '@zkproofport-app/sdk/circuits';

export {
  ALL_CIRCUIT_IDS,
  CIRCUIT_IDS,
  CIRCUIT_SUPPORT_STATUS,
  // Where each circuit's verification key lives in the circuits repo. The app
  // downloads by these paths; the SDK verifies off-chain with them. One list.
  CIRCUIT_NEEDS_WALLET_SIGNATURE,
  CIRCUIT_VK_PATHS,
  EXPERIMENTAL_CIRCUIT_IDS,
  PLANNED_CIRCUIT_IDS,
  SUPPORTED_CIRCUIT_IDS,
  getCircuitSupportStatus,
  isCircuitId,
  isSupportedCircuitId,
};
export type {CircuitId, CircuitSupportStatus};

/**
 * The app's long-standing name for a canonical circuit id. Kept as an alias so
 * the several hundred existing `CircuitName` annotations keep reading
 * naturally, but it is the SDK's union — not a second copy of it.
 */
export type CircuitName = CircuitId;

/**
 * Legacy navigation ids -> canonical circuit id. THE ONE ALIAS TABLE.
 *
 * Adding a row here is close to always wrong. New screens navigate with the
 * canonical id; this table exists to keep deep links that were minted before
 * that rule working, and nothing else.
 */
export const ROUTE_CIRCUIT_IDS: Readonly<Record<string, CircuitName>> =
  Object.freeze({
    'coinbase-kyc': CIRCUIT_IDS.COINBASE_ATTESTATION,
    'coinbase-country': CIRCUIT_IDS.COINBASE_COUNTRY_ATTESTATION,
    'giwa-kyc': CIRCUIT_IDS.GIWA_ATTESTATION,
    // Never carried by a released deep link — the Verify tab set this as a
    // route id and then navigated to a screen that ignores the argument, so it
    // reached no table and no table missed it. Listed rather than deleted
    // because it is one line here versus a value that reads valid at the call
    // site and resolves to nothing.
    'oidc-domain': CIRCUIT_IDS.OIDC_DOMAIN_ATTESTATION,
    'mdl-kr-ownership': CIRCUIT_IDS.MDL_KR_OWNERSHIP,
    'mdl-kr-age': CIRCUIT_IDS.MDL_KR_AGE,
    'mdl-kr-region': CIRCUIT_IDS.MDL_KR_REGION,
  });

/**
 * Resolve anything that names a circuit — a canonical id, or one of the
 * legacy route ids above — to the canonical id.
 *
 * Returns `undefined` for a name this app does not serve. There is no default:
 * substituting a circuit for one the caller did not ask for is how a request
 * for a Korea Mobile ID proof came back as a Coinbase KYC proof.
 */
export function canonicalCircuitId(
  id: string | null | undefined,
): CircuitName | undefined {
  if (!id) return undefined;
  if (isCircuitId(id)) return id;
  /*
   * `hasOwn`, not a plain index. A deep link supplies this string, and a plain
   * `ROUTE_CIRCUIT_IDS['__proto__']` answers `Object.prototype` — a truthy
   * value that is not a circuit id, which every caller downstream would then
   * use as one. `constructor` and `toString` do the same. `Object.freeze` does
   * not help: the entries are inherited, not own.
   */
  if (!Object.prototype.hasOwnProperty.call(ROUTE_CIRCUIT_IDS, id)) {
    return undefined;
  }
  return ROUTE_CIRCUIT_IDS[id];
}

/**
 * Checking the EIP-712 action an `arc_eligibility` proof binds to.
 *
 * Re-exported from here because this file is the app's ONE door to the SDK —
 * a contract held by `theCircuitListComesFromTheSdk.test.ts`, and the reason
 * twenty-four copies of the circuit list became one. `./typedAction` is a
 * dependency-free subpath like `./circuits`: importing the package ROOT
 * instead drags qrcode, ethers and @babel/runtime into the React Native bundle
 * and breaks every jest suite that touches the deep link.
 */
export {
  validateTypedAction,
  parseTypedAction,
} from '@zkproofport-app/sdk/typedAction';
export type {TypedAction} from '@zkproofport-app/sdk/typedAction';

/**
 * Circuits that only exist behind Developer Mode, and only on `main`.
 *
 * Two questions the app asks separately — which circuits to prefetch at
 * startup, and which to fetch from `main` rather than a release tag — have the
 * same answer, so the answer lives here once.
 *
 * The SDK's `supported` / `experimental` / `planned` split is what decides it:
 * a supported circuit ships in the release tag and is prefetched for everyone;
 * the other two do not exist in a release tag and would 404. Arc arrived as a
 * third status and briefly fell into NEITHER of the two lists this replaced,
 * which meant its files were never prefetched and were looked for in a release
 * that does not contain them.
 */
export const DEV_ONLY_CIRCUIT_IDS: readonly CircuitName[] = [
  ...EXPERIMENTAL_CIRCUIT_IDS,
  ...PLANNED_CIRCUIT_IDS,
];
