/**
 * The app as the OIDC circuit's provider-key signer (signer kind 1): the same
 * App Attest key and machinery as Coinbase KYC v2, signing the 313-byte
 * provider-key statement instead of the revocation statement.
 *
 * Two halves, called at two moments:
 *
 *   prepareOidcAppSigner(log)  -- BEFORE the sign-in sheet. Refuses on Android
 *       (E2010: there is no App Attest, and the app has no other signer; the
 *       AI server's kind is the server's, and the app never talks to it), on
 *       a device or simulator without App Attest (E2009), and for a
 *       development key (E2014). Certifies the key on first use. So nobody
 *       signs in to Google or Microsoft for a proof this phone cannot make.
 *
 *   signer(request)  -- after the live key list was fetched and `now` chosen.
 *       Refuses a modulus that is not in that list (requireLiveModulus), then
 *       asks App Attest for an assertion with clientDataHash =
 *       SHA256(statement), and returns the ten signer inputs, refusing what
 *       the circuit refuses (appSignerInputs: E2014).
 */
import {assertClientData, ensureAttestedKey, type AppAttestDeps} from '../appAttest/appAttestKey';
import {appSignerInputs, type AppSignerInputs} from '../appAttest/appSignerInputs';
import {APPLE_APP_ATTEST_CA1_KEY_HASH} from '../appAttest/constants';
import {getAppAttestNative, type AppAttestNative} from '../appAttest/nativeAppAttest';
import {requireProductionCredential} from '../appAttest/revocationStatement';
import {
  providerKeyStatement,
  requireLiveModulus,
  type LiveProviderKeys,
  type OidcProviderId,
} from './providerKeyStatement';

const PROOF = 'the OIDC domain proof';

export interface ProviderKeySignRequest {
  provider: OidcProviderId;
  /** The public `now`, unix seconds. */
  now: number;
  /** 256 bytes, big-endian: the key the token's RSA signature is checked with. */
  modulus: Uint8Array;
  /** The list the modulus must be in, from fetchLiveProviderKeys. */
  live: LiveProviderKeys;
}

export type ProviderKeySigner = (request: ProviderKeySignRequest) => Promise<AppSignerInputs>;

export async function prepareOidcAppSigner(
  log: (msg: string) => void,
  overrides: {
    native?: AppAttestNative;
    /** Tests only: a synthetic CA pin and an in-memory key store. */
    keyDeps?: Pick<AppAttestDeps, 'storage' | 'pinnedCaKeyHash'>;
    /** Unix seconds; injectable for tests. */
    nowSeconds?: () => number;
  } = {},
): Promise<ProviderKeySigner> {
  // Throws E2010 on Android and E2009 when the module is missing.
  const native = overrides.native ?? getAppAttestNative();
  const deps: AppAttestDeps = {...overrides.keyDeps, native, log};
  const pinned = overrides.keyDeps?.pinnedCaKeyHash ?? APPLE_APP_ATTEST_CA1_KEY_HASH;
  const clock = overrides.nowSeconds ?? (() => Math.floor(Date.now() / 1000));

  const key = await ensureAttestedKey(deps);
  requireProductionCredential(key.credential, PROOF);
  log(`[AppAttest] Key ${key.keyId} ready to sign the provider-key statement`);

  return async ({provider, now, modulus, live}) => {
    requireLiveModulus(live, provider, modulus, clock());
    const statement = providerKeyStatement(provider, now, modulus);
    // assertClientData asks App Attest for an assertion with clientDataHash =
    // SHA256(statement), the hash the circuit recomputes from public inputs.
    const signed = await assertClientData(deps, statement);
    // assertClientData may have replaced the key; check the one that signed.
    requireProductionCredential(signed.credential, PROOF);
    log(`[AppAttest] Provider-key statement signed with key ${signed.keyId} (counter ${signed.assertion.counter})`);
    return appSignerInputs(signed.credential, signed.assertion, pinned);
  };
}

