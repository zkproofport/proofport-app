/**
 * The two names an OPRF nullifier is keyed by, taken from the request.
 *
 * - domain: the requesting dApp, as the request's `oprfDomain` input carries
 *   it (the SDK sets it; a relay request's inputs are covered by the relay's
 *   inputs hash). Used exactly as sent -- no trimming, case folding or
 *   normalization -- because the verifier reduces the request's own string
 *   and compares; any change here makes every proof fail there. A request
 *   without it is refused (E1010), never given another app's or a shared
 *   domain: a shared domain would let two dApps link one wallet's proofs.
 * - scope: the request's `scope`, also used exactly as sent.
 *
 * An in-app proof (no request) is the app asking itself; its domain is
 * {@link IN_APP_OPRF_DOMAIN}, named here rather than filled in.
 *
 * Both must pass the node's name rules (1-256 UTF-8 bytes, no Cc or Cf
 * character; core `oprfNameError`), checked before anything is signed.
 */
import {oprfNameError, type OprfNameError} from './core/client';

/** The domain of a proof the app makes for itself (no dApp request). */
export const IN_APP_OPRF_DOMAIN = 'zkproofport.app';

const WHY: Readonly<Record<OprfNameError, string>> = Object.freeze({
  'not-a-string': 'is not text',
  'not-utf8': 'is not valid Unicode text (a lone surrogate)',
  empty: 'is empty',
  'too-long': 'is longer than 256 UTF-8 bytes',
  'control-character': 'contains a control character',
  'format-character': 'contains an invisible formatting character',
});

/** A request whose OPRF names cannot be used: shown as E1010. */
export class OprfNameRefusedError extends Error {
  constructor(readonly field: 'oprfDomain' | 'scope', readonly reason: OprfNameError | 'missing', message: string) {
    super(message);
    this.name = 'OprfNameRefusedError';
  }
}

function checked(value: unknown, field: 'oprfDomain' | 'scope'): string {
  if (value === undefined || value === null) {
    throw new OprfNameRefusedError(field, 'missing', `The request has no ${field}.`);
  }
  const why = oprfNameError(value);
  if (why !== null) {
    const shown = typeof value === 'string' ? JSON.stringify(value) : typeof value;
    throw new OprfNameRefusedError(field, why, `The request's ${field} ${shown} ${WHY[why]}.`);
  }
  return value as string;
}

export interface OprfRequestNames {
  domainName: string;
  scopeName: string;
}

/**
 * The OPRF names for a proof. `request` is the dApp request's inputs, or
 * `null` for an in-app proof (whose scope the app chose itself).
 */
export function oprfNamesFor(request: {inputs: unknown} | null, inAppScope?: string): OprfRequestNames {
  if (request === null) {
    return {domainName: IN_APP_OPRF_DOMAIN, scopeName: checked(inAppScope, 'scope')};
  }
  const inputs = request.inputs;
  if (inputs === null || typeof inputs !== 'object' || Array.isArray(inputs)) {
    throw new OprfNameRefusedError('oprfDomain', 'missing', 'The request carries no inputs object.');
  }
  const i = inputs as {oprfDomain?: unknown; scope?: unknown};
  return {domainName: checked(i.oprfDomain, 'oprfDomain'), scopeName: checked(i.scope, 'scope')};
}

/** The requesting app's domain for the consent screen, or null when the request names none (it will be refused). */
export function requesterDomainForDisplay(inputs: unknown): string | null {
  if (inputs === null || typeof inputs !== 'object') return null;
  const d = (inputs as {oprfDomain?: unknown}).oprfDomain;
  return typeof d === 'string' && oprfNameError(d) === null ? d : null;
}
