/**
 * Constants the App Attest prototype shares with its circuit.
 *
 * Every value here is also a constant (or a bound) in
 * `circuits/coinbase-app-attest-poc` / `circuits/app-attest-libs` on the
 * circuits branch `coinbase-app-attest-poc`. When they disagree the proof
 * fails inside the prover with a message that names none of this, so the app
 * checks each bound itself first and refuses with the reason.
 */

/**
 * The App ID: team id (`DEVELOPMENT_TEAM` in the Xcode project) + "." + bundle
 * id. The circuit compiles this in (`APP_ID` in main.nr); a team change (the
 * move to another developer account) changes the circuit too.
 */
export const APP_ATTEST_APP_ID = 'R4G32CVY29.com.masselabs.zkproofport';

/**
 * SHA256(X || Y) of "Apple App Attestation CA 1", the intermediate that signs
 * every App Attest credential certificate (valid to 2030-03-13). Printed by
 * `circuits/scripts/coinbase-app-attest-poc/check-apple-vector.js`, which
 * checks the intermediate against Apple's published root; it is the value a
 * verifier pins for the public input `app_attest_ca_key_hash`.
 *
 * Development-environment keys are certified by the same intermediate: the
 * real chain in that script's vector is a development credential certificate
 * signed by CA 1, and Apple's own production sample (the attestation-object
 * validation guide) carries the same intermediate. Only the authenticator
 * data's AAGUID tells the environments apart.
 */
export const APPLE_APP_ATTEST_CA1_KEY_HASH =
  '0x8ef85f951d5958d17e728c881f11f059f370aff763503903a96417405b59747f';

/** "appattest" followed by seven zero bytes. */
export const AAGUID_PRODUCTION = Uint8Array.from([
  0x61, 0x70, 0x70, 0x61, 0x74, 0x74, 0x65, 0x73, 0x74, 0, 0, 0, 0, 0, 0, 0,
]);
/** "appattestdevelop" -- the circuit's development AAGUID. */
export const AAGUID_DEVELOPMENT = Uint8Array.from([
  0x61, 0x70, 0x70, 0x61, 0x74, 0x74, 0x65, 0x73, 0x74, 0x64, 0x65, 0x76, 0x65, 0x6c, 0x6f, 0x70,
]);

/** Circuit bounds (`app-attest-libs`): what the arrays can hold. */
export const CREDENTIAL_TBS_MAX_LEN = 1000;
export const ATT_AUTH_DATA_MIN_LEN = 164;
export const ATT_AUTH_DATA_MAX_LEN = 256;
export const ASSERT_AUTH_DATA_MIN_LEN = 37;
export const ASSERT_AUTH_DATA_MAX_LEN = 128;

/** Curve orders, for putting s in low form. */
export const N_P256 = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
export const N_P384 = BigInt(
  '0xffffffffffffffffffffffffffffffffffffffffffffffffc7634d81f4372ddf581a0db248b0a77aecec196accc52973',
);

/**
 * Bounds for the CBOR reader. A real attestation object is about 5.9 KB
 * (Apple's sample: 5,906 bytes, most of it the receipt); an assertion is a
 * few hundred. Anything far past that is not something App Attest produced.
 */
export const ATTESTATION_OBJECT_MAX_BYTES = 16 * 1024;
export const ASSERTION_OBJECT_MAX_BYTES = 1024;
