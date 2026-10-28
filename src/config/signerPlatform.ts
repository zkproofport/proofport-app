/**
 * Which device signer vouches for a statement on this phone, from the
 * platform it runs on. One table, and an unknown platform is an error.
 *
 *   ios      Apple App Attest (src/appAttest/*), the iOS circuits
 *   android  Android key attestation (src/androidAttest/*), the Android
 *            packages that serve the same circuit ids
 *            (circuits oidc-domain-attestation-android,
 *            coinbase-attestation-v2-android)
 *
 * The two variants prove the same public inputs with different circuits, so
 * the variant decides the circuit files, the input layout and the verifier.
 * Read here, never guessed from what a file or a witness looks like.
 */

export type StatementSignerVariant = 'app_attest' | 'android';

export const STATEMENT_SIGNER_VARIANTS: readonly StatementSignerVariant[] = Object.freeze(['app_attest', 'android']);

const VARIANT_BY_PLATFORM: Readonly<Record<string, StatementSignerVariant>> = Object.freeze({
  ios: 'app_attest',
  android: 'android',
});

/** The variant for a React Native `Platform.OS` value. Own keys only. */
export function signerVariantFor(platformOS: string): StatementSignerVariant {
  if (!Object.prototype.hasOwnProperty.call(VARIANT_BY_PLATFORM, platformOS)) {
    throw new Error(
      `No statement signer for platform '${platformOS}'. Known: ${Object.keys(VARIANT_BY_PLATFORM).join(', ')}.`,
    );
  }
  return VARIANT_BY_PLATFORM[platformOS];
}

/**
 * This phone's variant. `react-native` is required lazily so that modules
 * which only sometimes need the platform (the circuit download, for the two
 * circuits that have per-platform files) stay importable in plain node tests.
 */
export function currentSignerVariant(): StatementSignerVariant {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const {Platform} = require('react-native') as {Platform: {OS: string}};
  return signerVariantFor(Platform.OS);
}
