/**
 * The app as the OIDC circuit's provider-key signer: this phone's hardware
 * key vouches for the provider's RSA modulus, signing the 313-byte
 * provider-key statement. Which hardware depends on the platform
 * (src/config/signerPlatform.ts), and so does the circuit:
 *
 *   iPhone   App Attest (signer kind 1 of `oidc_domain_attestation`), the
 *            same key and machinery as Coinbase KYC v2
 *   Android  Android key attestation: a fresh attested Keystore key per
 *            statement; `oidc_domain_attestation_android` for a Remote Key
 *            Provisioning chain, `oidc_domain_attestation_android_factory`
 *            (plus a Play Integrity verdict) for a factory-provisioned one
 *
 * Two halves, called at two moments:
 *
 *   prepareOidcAppSigner(log)  -- BEFORE the sign-in sheet. On iPhone: a
 *       device or simulator without App Attest (E2009) or a development key
 *       (E2014) is refused, and the key is certified on first use. On
 *       Android: a build without the native module is refused (E2015), and
 *       the phone's chain kind is learned (one key) so the right circuit
 *       files are chosen. So
 *       nobody signs in to Google or Microsoft for a proof this phone cannot
 *       make.
 *
 *   signer(request)  -- after the live key list was fetched and `now` chosen.
 *       Refuses a modulus that is not in that list (requireLiveModulus), then
 *       has the device sign the statement and returns the signer inputs,
 *       refusing what the circuit refuses (App Attest: E2014; Android: E2015
 *       for a chain, key or build the circuit does not accept, E2016 for
 *       malformed data).
 */
import {assertClientData, ensureAttestedKey, type AppAttestDeps} from '../appAttest/appAttestKey';
import {appSignerInputs, type AppSignerInputs} from '../appAttest/appSignerInputs';
import {APPLE_APP_ATTEST_CA1_KEY_HASH} from '../appAttest/constants';
import {getAppAttestNative, type AppAttestNative} from '../appAttest/nativeAppAttest';
import {requireProductionCredential} from '../appAttest/revocationStatement';
import {
  ANDROID_CIRCUIT_TRUST,
  ensureAndroidChainKind,
  relayIntegrityDecrypter,
  signStatementOnAndroid,
  type AndroidSignOptions,
} from '../androidAttest/androidSigner';
import type {AnyAndroidSignerInputs} from '../androidAttest/androidSignerInputs';
import {STATIC_CONFIGS} from '../config/contracts';
import {getEnvironment} from '../config/environment';
import {getAndroidKeyAttestationNative, type AndroidKeyAttestationNative} from '../androidAttest/nativeAndroidKeyAttestation';
import {currentSignerPlatform, type SignerPlatform} from '../config/signerPlatform';
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

/** Either device's signer inputs; the OIDC builder flattens each in its circuit's order. */
export type StatementSignerInputs = AppSignerInputs | AnyAndroidSignerInputs;

export type ProviderKeySigner = (request: ProviderKeySignRequest) => Promise<StatementSignerInputs>;

export interface OidcSignerOverrides {
  /** Tests only: which platform's signer, instead of this phone's. */
  platform?: SignerPlatform;
  native?: AppAttestNative;
  /** Tests only: a synthetic CA pin and an in-memory key store. */
  keyDeps?: Pick<AppAttestDeps, 'storage' | 'pinnedCaKeyHash'>;
  /** Tests only: a fake Android module and the trust anchors its synthetic chain carries. */
  android?: {
    native: AndroidKeyAttestationNative;
    trust: AndroidSignOptions['trust'];
    integrity?: AndroidSignOptions['integrity'];
  };
  /** Unix seconds; injectable for tests. */
  nowSeconds?: () => number;
}

async function prepareAppAttestSigner(log: (msg: string) => void, overrides: OidcSignerOverrides): Promise<ProviderKeySigner> {
  // Throws E2009 when the module is missing.
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

async function prepareAndroidSigner(log: (msg: string) => void, overrides: OidcSignerOverrides): Promise<ProviderKeySigner> {
  // Throws E2015 when the module is missing, before any sign-in.
  const native = overrides.android?.native ?? getAndroidKeyAttestationNative();
  const trust = overrides.android?.trust ?? ANDROID_CIRCUIT_TRUST;
  const integrity =
    overrides.android?.integrity ?? relayIntegrityDecrypter(() => STATIC_CONFIGS[getEnvironment()].relay.apiBaseUrl, log);
  const clock = overrides.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
  // The chain kind picks the circuit files the hook downloads before signing.
  const kind = await ensureAndroidChainKind(native, log, trust);
  log(`[AndroidAttest] Ready to sign the provider-key statement with a fresh attested key (${kind})`);

  return async ({provider, now, modulus, live}) => {
    requireLiveModulus(live, provider, modulus, clock());
    const statement = providerKeyStatement(provider, now, modulus);
    // The key signs the statement itself (SHA256withECDSA): the digest the
    // circuit checks is SHA256(statement), recomputed from public inputs.
    // The chain must be valid at the statement's `now`.
    const signer = await signStatementOnAndroid(statement, {now, log, native, trust, integrity});
    log('[AndroidAttest] Provider-key statement signed');
    return signer;
  };
}

const PREPARE: Readonly<Record<SignerPlatform, typeof prepareAppAttestSigner>> = Object.freeze({
  ios: prepareAppAttestSigner,
  android: prepareAndroidSigner,
});

export async function prepareOidcAppSigner(
  log: (msg: string) => void,
  overrides: OidcSignerOverrides = {},
): Promise<ProviderKeySigner> {
  const platform = overrides.platform ?? currentSignerPlatform();
  if (!Object.prototype.hasOwnProperty.call(PREPARE, platform)) {
    throw new Error(`No OIDC provider-key signer for '${platform}'. Known: ${Object.keys(PREPARE).join(', ')}.`);
  }
  return PREPARE[platform](log, overrides);
}
