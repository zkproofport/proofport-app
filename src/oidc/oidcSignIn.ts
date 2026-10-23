import type {SignInResult} from '../hooks/signInResult';
import {checkIdTokenNonce, deriveOidcNonce, isCanonicalRequestId} from './oidcNonce';

/**
 * Which request an OIDC proof answers, and the sign-in that binds its token.
 *
 * Where the two inputs come from:
 *  - dApp request (relay deep link): `requestId` is the relay's, minted by the
 *    relay as uuidv4 and confirmed with a trusted relay before the screen
 *    opens; `scope` is the request's `inputs.scope`, which the SDK requires
 *    and deep-link validation now requires for OIDC too.
 *  - In-app (standalone) proof: `requestId` is minted on this device per
 *    attempt and written to History; `scope` is what DomainInput passed.
 * The verifier that issued the request recomputes the nonce from the same two.
 */

export type OidcSignInProvider = 'google' | 'microsoft';

const SIGN_IN_OF_PROVIDER: Readonly<Record<string, OidcSignInProvider>> = {
  google: 'google',
  microsoft: 'microsoft',
};

/**
 * The identity provider to sign in with. No provider is the "Any email"
 * choice, which signs in with Google and proves with the circuit's provider 0
 * (DomainInputScreen, utils/oidcDomain.ts) -- a defined option, not a fill-in.
 * Any other value is refused: a misspelt 'Microsoft' used to sign in with Google.
 */
export function signInProviderFor(provider: unknown): OidcSignInProvider {
  if (provider === undefined) return 'google';
  if (typeof provider === 'string' && Object.prototype.hasOwnProperty.call(SIGN_IN_OF_PROVIDER, provider)) {
    return SIGN_IN_OF_PROVIDER[provider];
  }
  throw new Error(
    `Unknown OIDC provider ${JSON.stringify(provider)}. Known: ${Object.keys(SIGN_IN_OF_PROVIDER).join(', ')}, or none for any email.`,
  );
}

export type OidcBinding = {scope: string; requestId: string; nonce: string};

/**
 * @param relayRequestId the relay request's id, or undefined for an in-app proof
 * @param mint mints the in-app request id; never called for a relay request
 */
export function oidcBindingFor(
  scope: unknown,
  relayRequestId: string | undefined,
  mint: () => string,
): OidcBinding {
  if (typeof scope !== 'string') {
    throw new Error('OIDC proof has no scope.');
  }
  let requestId: string;
  if (relayRequestId === undefined) {
    requestId = mint();
  } else {
    if (!isCanonicalRequestId(relayRequestId)) {
      throw new Error(`Relay request id ${JSON.stringify(relayRequestId)} is not a lowercase UUID.`);
    }
    requestId = relayRequestId;
  }
  return {scope, requestId, nonce: deriveOidcNonce(scope, requestId)};
}

export type OidcSignInOutcome =
  | {token: string}
  | {error: string; cancelled: boolean; code: 'E2008' | 'E2012'};

/**
 * Sign in with `nonce` and accept the token only if it carries it. A token
 * that does not is refused with E2012 and is never proved.
 */
export async function signInBound(
  prompt: (nonce: string) => Promise<SignInResult>,
  nonce: string,
): Promise<OidcSignInOutcome> {
  const signIn = await prompt(nonce);
  if (!('token' in signIn)) {
    return {error: signIn.error, cancelled: signIn.cancelled, code: 'E2008'};
  }
  const check = checkIdTokenNonce(signIn.token, nonce);
  if (!check.ok) {
    return {
      error: `The sign-in token is not bound to this request (${check.reason}: ${check.detail}).`,
      cancelled: false,
      code: 'E2012',
    };
  }
  return {token: signIn.token};
}
