/**
 * The two objects App Attest returns, taken apart into exactly the values the
 * circuit reads.
 *
 * Format and validation steps: Apple, "Validating apps that connect to your
 * server" (developer.apple.com/documentation/devicecheck/validating-apps-that-connect-to-your-server),
 * checked against Apple's sample in the "attestation object validation guide"
 * (developer.apple.com/documentation/devicecheck/attestation-object-validation-guide).
 * What the circuit does with them: circuits branch `coinbase-app-attest-poc`,
 * `app-attest-libs/src/{credential,assertion}.nr`.
 *
 * Two layers, deliberately:
 *   - `decodeAttestationObject` performs Apple's own steps and nothing more,
 *     so Apple's published sample (another team's app, a 24-byte challenge)
 *     can be checked against it byte for byte;
 *   - `toCircuitCredential` adds what this circuit additionally requires
 *     (our App ID, the pinned CA, a 32-byte clientDataHash, the array bounds).
 */
import {ethers} from 'ethers';
import {cborBytes, cborMap, decodeCbor, CborError} from './cbor';
import {
  appleAppId,
  appleNonce,
  bytesEqual,
  DerError,
  ecdsaDerToLowS,
  hexToBytes,
  OID,
  parseCertificate,
  parseTbs,
  toHex,
} from './der';
import {
  AAGUID_DEVELOPMENT,
  AAGUID_PRODUCTION,
  ASSERT_AUTH_DATA_MAX_LEN,
  ASSERT_AUTH_DATA_MIN_LEN,
  ASSERTION_OBJECT_MAX_BYTES,
  ATT_AUTH_DATA_MAX_LEN,
  ATT_AUTH_DATA_MIN_LEN,
  ATTESTATION_OBJECT_MAX_BYTES,
  CREDENTIAL_TBS_MAX_LEN,
  N_P256,
  N_P384,
} from './constants';
import {AppAttestError, APP_ATTEST_ERROR_CODE} from './appAttestError';

export function sha256(bytes: Uint8Array): Uint8Array {
  return ethers.utils.arrayify(ethers.utils.sha256(bytes));
}

const utf8Bytes = (s: string) => ethers.utils.toUtf8Bytes(s);

function malformed(message: string): never {
  throw new AppAttestError(APP_ATTEST_ERROR_CODE.malformed, message);
}

/** Run a parse step and report CBOR/DER failures as malformed App Attest data. */
function parsing<T>(what: string, step: () => T): T {
  try {
    return step();
  } catch (e) {
    if (e instanceof CborError || e instanceof DerError) malformed(`${what}: ${e.message}`);
    throw e;
  }
}

function be32(b: Uint8Array, pos: number): number {
  return ((b[pos] << 24) >>> 0) + ((b[pos + 1] << 16) | (b[pos + 2] << 8) | b[pos + 3]);
}

export function base64ToBytes(s: string): Uint8Array {
  if (typeof s !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(s) || s.length % 4 !== 0) {
    malformed('not standard base64');
  }
  return ethers.utils.base64.decode(s);
}

export interface DecodedAttestation {
  /** The credential certificate's TBSCertificate, as signed. */
  credentialTbs: Uint8Array;
  /** The credential certificate's signature as r || s, s low (P-384, 48 + 48). */
  credentialSig: Uint8Array;
  /** The intermediate CA public key X || Y (P-384, 96 bytes). */
  caKey: Uint8Array;
  /** SHA256(caKey), as 0x-hex. */
  caKeyHash: string;
  /** The App Attest credential key X || Y (P-256, 64 bytes). */
  credentialKey: Uint8Array;
  /** The App ID in the certificate's [1204] item. */
  certificateAppId: string;
  /** The attestation's authenticator data, whole (extensions included). */
  authData: Uint8Array;
  /** True for "appattest" + 7 zero bytes, false for "appattestdevelop". */
  production: boolean;
}

/**
 * Apple's validation steps for an attestation object, given the key id and
 * the clientDataHash the app passed to `attestKey`. Throws AppAttestError
 * (E2014) naming the first step that fails.
 */
export function decodeAttestationObject(
  attestation: Uint8Array,
  keyIdBase64: string,
  clientDataHash: Uint8Array,
  appId: string,
): DecodedAttestation {
  const top = parsing('attestation object', () =>
    cborMap(decodeCbor(attestation, {maxBytes: ATTESTATION_OBJECT_MAX_BYTES, maxDepth: 4, maxItems: 16}), 'attestation object'),
  );
  if (top.get('fmt') !== 'apple-appattest') malformed(`attestation fmt is ${JSON.stringify(top.get('fmt'))}, not "apple-appattest"`);
  const attStmt = parsing('attStmt', () => cborMap(top.get('attStmt') ?? 0, 'attStmt'));
  const x5c = attStmt.get('x5c');
  if (!Array.isArray(x5c) || x5c.length < 2 || !x5c.every(c => c instanceof Uint8Array)) {
    malformed('attStmt.x5c is not [credential certificate, intermediate, ...]');
  }
  const authData = parsing('authData', () => cborBytes(top, 'authData', 'attestation object'));
  const [credDer, interDer] = x5c as Uint8Array[];

  const cred = parsing('credential certificate', () => parseCertificate(credDer));
  // Apple's credential certificates are ecdsa-with-SHA256 (the circuit hashes
  // the TBS with SHA-256); only root -> intermediate is SHA-384.
  if (!bytesEqual(cred.signatureAlgorithm, OID.ecdsaWithSha256)) {
    malformed('credential certificate is not signed with ecdsa-with-SHA256');
  }
  const credFields = parsing('credential TBS', () => parseTbs(cred.tbs));
  if (!bytesEqual(credFields.curve, OID.prime256v1) || credFields.publicKey.length !== 64) {
    malformed('credential key is not an uncompressed P-256 key');
  }
  const inter = parsing('intermediate certificate', () => parseCertificate(interDer));
  const interFields = parsing('intermediate TBS', () => parseTbs(inter.tbs));
  if (!bytesEqual(interFields.curve, OID.secp384r1) || interFields.publicKey.length !== 96) {
    malformed('intermediate key is not an uncompressed P-384 key');
  }

  // keyId is SHA256 of the credential key in X9.62 uncompressed form.
  const keyId = base64ToBytes(keyIdBase64);
  const keyHash = sha256(Uint8Array.from([0x04, ...credFields.publicKey]));
  if (!bytesEqual(keyHash, keyId)) malformed('credential certificate key does not hash to the key id');

  // nonce = SHA256(authData || clientDataHash) is in extension 8.2.
  const nonce = parsing('nonce extension', () => appleNonce(credFields));
  if (!bytesEqual(sha256(Uint8Array.from([...authData, ...clientDataHash])), nonce)) {
    malformed('attestation authData and clientDataHash do not hash to the certificate nonce');
  }

  if (authData.length < 55) malformed(`attestation authData is ${authData.length} bytes, too short to hold its fixed fields`);
  if (!bytesEqual(authData.slice(0, 32), sha256(utf8Bytes(appId)))) {
    malformed(`attestation RP ID hash is not SHA256("${appId}")`);
  }
  if (be32(authData, 33) !== 0) malformed('attestation counter is not 0');
  const aaguid = authData.slice(37, 53);
  let production: boolean;
  if (bytesEqual(aaguid, AAGUID_PRODUCTION)) production = true;
  else if (bytesEqual(aaguid, AAGUID_DEVELOPMENT)) production = false;
  else malformed(`attestation AAGUID ${JSON.stringify(String.fromCharCode(...aaguid))} is neither production nor development`);
  const credIdLen = (authData[53] << 8) | authData[54];
  if (credIdLen !== 32 || authData.length < 55 + 32 || !bytesEqual(authData.slice(55, 87), keyId)) {
    malformed('attestation credentialId is not the key id');
  }

  const certificateAppId = parsing('App ID extension', () => appleAppId(credFields));

  return {
    credentialTbs: cred.tbs,
    credentialSig: parsing('credential signature', () => ecdsaDerToLowS(cred.signature, 48, N_P384)),
    caKey: interFields.publicKey,
    caKeyHash: '0x' + toHex(sha256(interFields.publicKey)),
    credentialKey: credFields.publicKey,
    certificateAppId,
    authData,
    production: production!,
  };
}

/** What the circuit takes from the attestation, once per key. */
export interface CircuitCredential {
  caKey: Uint8Array;
  caKeyHash: string;
  credentialTbs: Uint8Array;
  credentialSig: Uint8Array;
  attAuthData: Uint8Array;
  attClientDataHash: Uint8Array;
  credentialKey: Uint8Array;
  production: boolean;
}

/**
 * `decodeAttestationObject` plus everything this circuit requires beyond
 * Apple's steps: our App ID in the certificate, the pinned intermediate, a
 * 32-byte clientDataHash (`att_client_data_hash: [u8; 32]`), and lengths
 * that fit the circuit's arrays.
 */
export function toCircuitCredential(
  attestation: Uint8Array,
  keyIdBase64: string,
  clientDataHash: Uint8Array,
  appId: string,
  pinnedCaKeyHash: string,
): CircuitCredential {
  if (clientDataHash.length !== 32) {
    malformed(`attestation clientDataHash is ${clientDataHash.length} bytes; the circuit takes exactly 32`);
  }
  const d = decodeAttestationObject(attestation, keyIdBase64, clientDataHash, appId);
  if (d.certificateAppId !== appId) {
    malformed(`credential certificate is for "${d.certificateAppId}", not "${appId}"`);
  }
  if (d.caKeyHash.toLowerCase() !== pinnedCaKeyHash.toLowerCase()) {
    malformed(`intermediate CA key hash ${d.caKeyHash} is not the pinned ${pinnedCaKeyHash}`);
  }
  if (d.credentialTbs.length > CREDENTIAL_TBS_MAX_LEN) {
    malformed(`credential TBS is ${d.credentialTbs.length} bytes; the circuit holds ${CREDENTIAL_TBS_MAX_LEN}`);
  }
  if (d.authData.length < ATT_AUTH_DATA_MIN_LEN || d.authData.length > ATT_AUTH_DATA_MAX_LEN) {
    malformed(`attestation authData is ${d.authData.length} bytes; the circuit takes ${ATT_AUTH_DATA_MIN_LEN}..${ATT_AUTH_DATA_MAX_LEN}`);
  }
  return {
    caKey: d.caKey,
    caKeyHash: d.caKeyHash,
    credentialTbs: d.credentialTbs,
    credentialSig: d.credentialSig,
    attAuthData: d.authData,
    attClientDataHash: clientDataHash,
    credentialKey: d.credentialKey,
    production: d.production,
  };
}

export interface CircuitAssertion {
  authenticatorData: Uint8Array;
  /** r || s, s low (P-256). */
  signature: Uint8Array;
  counter: number;
}

/**
 * The assertion `{signature, authenticatorData}`. Checks the parts the app
 * can check without a P-256 verifier (the circuit verifies the signature):
 * RP ID hash, counter > 0, and the bounds of the circuit's array.
 */
export function decodeAssertion(assertion: Uint8Array, appId: string): CircuitAssertion {
  const top = parsing('assertion', () =>
    cborMap(decodeCbor(assertion, {maxBytes: ASSERTION_OBJECT_MAX_BYTES, maxDepth: 2, maxItems: 4}), 'assertion'),
  );
  const authenticatorData = parsing('assertion', () => cborBytes(top, 'authenticatorData', 'assertion'));
  const signatureDer = parsing('assertion', () => cborBytes(top, 'signature', 'assertion'));
  if (authenticatorData.length < ASSERT_AUTH_DATA_MIN_LEN || authenticatorData.length > ASSERT_AUTH_DATA_MAX_LEN) {
    malformed(
      `assertion authenticatorData is ${authenticatorData.length} bytes; the circuit takes ${ASSERT_AUTH_DATA_MIN_LEN}..${ASSERT_AUTH_DATA_MAX_LEN}`,
    );
  }
  if (!bytesEqual(authenticatorData.slice(0, 32), sha256(utf8Bytes(appId)))) {
    malformed(`assertion RP ID hash is not SHA256("${appId}")`);
  }
  const counter = be32(authenticatorData, 33);
  if (counter === 0) malformed('assertion counter is 0');
  return {
    authenticatorData,
    signature: parsing('assertion signature', () => ecdsaDerToLowS(signatureDer, 32, N_P256)),
    counter,
  };
}

export {hexToBytes, toHex};
