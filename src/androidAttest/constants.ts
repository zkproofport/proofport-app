/**
 * What the Android packages' circuits (statement-signer
 * verify_statement_android, android-key-attestation) require of the key
 * that signs a statement, as constants the app checks before proving. When
 * these disagree with the circuit the proof fails inside the prover after a
 * minute or two of work, with a message that names none of this.
 */

/** proofport-app/android applicationId; the circuit's ANDROID_PACKAGE. */
export const ANDROID_APP_PACKAGE = 'com.masselabs.zkproofport';

/**
 * SHA-256 of the certificate Google Play signs every release of the app with
 * (Play app signing), as key attestation reports it in
 * attestationApplicationId.signature_digests; the circuit's
 * ANDROID_SIGNING_DIGEST (read 2026-10-28 from the Play Developer API,
 * generatedApks/10301). Debug builds and upload-key builds carry other
 * digests and cannot prove.
 */
export const ANDROID_PLAY_SIGNING_CERT_SHA256 = 'c39b407187d84ce59e90be7fcd0be834a226782c240257102f1d0a8816c6931f';

/** OID content bytes, hex: 1.3.6.1.4.1.11129.2.1.17, the key attestation extension. */
export const OID_KEY_ATTESTATION = '2b06010401d679020111';
/** 1.3.6.1.4.1.11129.2.1.30, Remote Key Provisioning's provisioning-information extension. */
export const OID_PROVISIONING_INFO = '2b06010401d67902011e';

/** KeyMint SecurityLevel values the circuit accepts. */
export const SECURITY_LEVEL = Object.freeze({software: 0, trustedEnvironment: 1, strongBox: 2});

/** AuthorizationList tags the circuit reads. */
export const AUTH_TAG = Object.freeze({origin: 702, rootOfTrust: 704, applicationId: 709});

/** The circuit walks at most this many entries per AuthorizationList. */
export const MAX_AUTH_ENTRIES = 24;
