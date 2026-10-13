/**
 * The words and the icon shown for a circuit, in one place.
 *
 * Both tables are `Record<CircuitName, …>`, so they are exhaustive over the
 * published circuit list: a circuit added to `@zkproofport-app/sdk` does not
 * compile until it has a name and an icon here. Before that, three of the
 * seven circuits were simply absent — `getCircuitDisplayName('mdl_kr_age')`
 * fell through to returning its argument, and the history screens showed
 * people the raw string `mdl-kr-age`.
 *
 * Keyed by the CANONICAL id only. A legacy route id is translated on the way
 * in, which is why there is no second row per circuit here — the duplicated
 * rows were how `giwa_attestation` came to be called "GIWA KYC (Experimental)"
 * in two tables and "GIWA KYC" in a third, so the name a person saw depended
 * on which screen they were looking at.
 */
import {canonicalCircuitId, type CircuitName} from '../config/circuitIds';

const CIRCUIT_ICONS: Readonly<Record<CircuitName, string>> = {
  coinbase_attestation: 'user',
  coinbase_country_attestation: 'globe',
  oidc_domain_attestation: 'shield',
  giwa_attestation: 'user',
  mdl_kr_ownership: 'credit-card',
  mdl_kr_age: 'credit-card',
  mdl_kr_region: 'credit-card',
};

const CIRCUIT_DISPLAY_NAMES: Readonly<Record<CircuitName, string>> = {
  coinbase_attestation: 'Coinbase KYC',
  coinbase_country_attestation: 'Coinbase Country',
  oidc_domain_attestation: 'OIDC Domain',
  giwa_attestation: 'GIWA KYC (Experimental)',
  mdl_kr_ownership: 'Korea Mobile ID — Ownership',
  mdl_kr_age: 'Korea Mobile ID — Age',
  mdl_kr_region: 'Korea Mobile ID — Region',
};

/*
 * Both lookups fall back on a MISSING ROW as well as an unknown id.
 *
 * `Record<CircuitName, string>` promises tsc that every row exists, so
 * `CIRCUIT_ICONS[canonical]` is typed `string` and a deleted row returns
 * `undefined` with nothing to say so. The first draft of this file read
 * `canonical ? CIRCUIT_ICONS[canonical] : 'shield'`, which handed
 * `<Icon name={undefined}>` down to Feather for a canonical id whose row had
 * been removed — a worse outcome than the generic icon it replaced. Caught by
 * deleting a row and finding the guard still green
 * (`scripts/mutate-circuit-guards.py`, mutation `icon-row-removed`).
 */

export function getCircuitIcon(circuitId: string): string {
  const canonical = canonicalCircuitId(circuitId);
  return (canonical && CIRCUIT_ICONS[canonical]) || 'shield';
}

/**
 * Falls back to the id itself for a circuit this build does not know — a proof
 * saved by a newer build and read by an older one has to render as something.
 * Every circuit the build DOES know has a row above, so the fallback is not
 * reachable for a current id.
 */
export function getCircuitDisplayName(circuitId: string): string {
  const canonical = canonicalCircuitId(circuitId);
  return (canonical && CIRCUIT_DISPLAY_NAMES[canonical]) || circuitId;
}
