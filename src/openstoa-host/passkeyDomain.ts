/**
 * The domain a passkey is bound to.
 *
 * A passkey belongs to one domain. One made against staging cannot be used
 * against production, so this MUST track the same environment split as the
 * OpenStoa origin — see `resolveOpenStoaBaseUrl`. It was a fixed
 * `stg-community.zkproofport.app` in three separate places, which meant a build
 * pointed at production carried recovery bound to staging: the team turns the
 * mini-app on inside the store build, so that combination was reachable.
 *
 * Both origins already serve the Apple association file naming this app's team,
 * checked 2026-08-30 — production was ready before the app asked for it.
 *
 * Every domain returned here must ALSO be listed in the app's
 * `associated-domains` entitlement. iOS only honours domains declared there, so
 * a value this function returns that the entitlement omits fails at the passkey
 * prompt with no useful message.
 */
import { getEnvironment } from '../config';

export const PASSKEY_DOMAIN_PRODUCTION = 'www.openstoa.xyz';
export const PASSKEY_DOMAIN_STAGING = 'stg-community.zkproofport.app';

export function resolvePasskeyDomain(): string {
  // Development points at a local server that cannot serve an Apple-verified
  // association file, so a passkey there has to borrow a real domain. Staging
  // is the one the team already uses for that.
  return getEnvironment() === 'production'
    ? PASSKEY_DOMAIN_PRODUCTION
    : PASSKEY_DOMAIN_STAGING;
}
