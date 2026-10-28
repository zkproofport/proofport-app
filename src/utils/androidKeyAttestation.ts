/**
 * An Android key attestation chain (leaf first, as KeyStore.getCertificateChain
 * returns it) -> the AndroidChain private inputs of circuits'
 * android-key-attestation library, which the Android packages
 * (oidc_domain_attestation_android, coinbase_attestation_v2_android) take
 * after their own inputs:
 *
 *   ca2_tbs [u8; 600], ca2_tbs_len, ca2_sig [u8; 96]   Droid CA2, signed by the root (P-384)
 *   ca3_tbs [u8; 768], ca3_tbs_len, ca3_sig [u8; 96]   Droid CA3, signed by CA2 (P-384)
 *   att_tbs [u8; 512], att_tbs_len, att_sig [u8; 64]   RKP attestation key, signed by CA3 (P-256)
 *   leaf_tbs [u8; 1024], leaf_tbs_len, leaf_sig [u8; 64] leaf, signed by the attestation key (P-256)
 *
 * A MIRROR of circuits scripts/android-key-attestation/chain.js `chainInputs`,
 * step for step and in the same order: each certificate split into its TBS
 * (zero-padded to its limit; a longer one is refused) and its issuer's
 * signature as r || s with s in LOW form for the issuer's curve; the chain
 * exactly [leaf, attestation key, CA3, CA2, root] or the same without the
 * root; a present root must be Google's Key Attestation CA1 key. The root
 * itself is not an input (the circuit pins its key).
 * `androidChainMatchesTheCircuitsConverter.test.ts` holds this to chain.js's
 * output byte for byte (fixtures written by
 * scripts/export-android-signer-fixtures.js).
 *
 * The DER reading is der.ts's strict reader, which gives the same slices as
 * chain.js's for every well-formed certificate and refuses more.
 *
 * Every refusal is an AppAttestError: ANDROID_ATTEST_ERROR_CODE.unavailable
 * for a chain of another shape (factory provisioning, an RSA root, another
 * root), .malformed for bytes that are not what a certificate should be.
 * The finer RKP checks (algorithms, extensions, validity, key description)
 * are androidChainChecks.ts's, run before this.
 */
import {ethers} from 'ethers';
import {AppAttestError, ANDROID_ATTEST_ERROR_CODE} from '../appAttest/appAttestError';
import {N_P256, N_P384} from '../appAttest/constants';
import {bytesEqual, children, DerError, ecdsaDerToLowS, hexToBytes, OID, parseCertificate, parseTbs, readTlv, toHex} from '../appAttest/der';

/** 1.2.840.113549.1.1, the RSA (PKCS #1) family: factory-provisioning roots sign with these. */
export const OID_RSA_FAMILY_PREFIX = '2a864886f70d0101';

/**
 * A certificate's signature algorithm and key algorithm OIDs (content hex),
 * read structurally -- without parseCertificate's ECDSA-only rules -- so an
 * RSA certificate is named for what it is rather than reported as broken.
 */
export function certificateAlgorithms(certDer: Uint8Array, what: string): {signature: string; key: string} {
  return der(what, () => {
    const outer = readTlv(certDer, 0, certDer.length, 0x30);
    if (outer.end !== certDer.length) throw new DerError('bytes after the certificate');
    const parts = children(certDer, outer, 3);
    const [tbs, alg] = parts;
    if (parts.length !== 3 || tbs.tag !== 0x30 || alg.tag !== 0x30) throw new DerError('a certificate is SEQUENCE {tbs, algorithm, signature}');
    const sigOid = readTlv(certDer, alg.contentStart, alg.end, 0x06);
    const spki = children(certDer, tbs, 12)[6];
    if (!spki || spki.tag !== 0x30) throw new DerError('TBS has no SubjectPublicKeyInfo');
    const [keyAlg] = children(certDer, spki, 2);
    if (!keyAlg || keyAlg.tag !== 0x30) throw new DerError('SubjectPublicKeyInfo has no AlgorithmIdentifier');
    const keyOid = readTlv(certDer, keyAlg.contentStart, keyAlg.end, 0x06);
    return {
      signature: toHex(certDer.slice(sigOid.contentStart, sigOid.end)),
      key: toHex(certDer.slice(keyOid.contentStart, keyOid.end)),
    };
  });
}

/** Refuse, by name, a certificate that signs or holds an RSA key: factory provisioning. */
export function refuseRsa(certDer: Uint8Array, what: string): void {
  const algs = certificateAlgorithms(certDer, what);
  if (algs.signature.startsWith(OID_RSA_FAMILY_PREFIX) || algs.key.startsWith(OID_RSA_FAMILY_PREFIX)) {
    unavailable(
      `${what} uses RSA: this is a factory-provisioned chain. Only Remote Key Provisioning chains under Key Attestation CA1 are accepted`,
    );
  }
}

/** TBS room per certificate (android-key-attestation CA2/CA3/ATT/LEAF_TBS_MAX_LEN). */
export const ANDROID_TBS_LIMITS = Object.freeze({ca2: 600, ca3: 768, att: 512, leaf: 1024});

/**
 * Key Attestation CA1, X || Y (P-384): the root of Google's attestation
 * chains from 2026-02-01, valid to 2035-07-15
 * (developer.android.com/privacy-and-security/security-key-attestation).
 * The circuit pins it (statement-signer android_root.nr); chain.js names the
 * same bytes.
 */
export const GOOGLE_KEY_ATTESTATION_CA1 = hexToBytes(
  '23da23714edf3e5b050a3c72e8846ace078ea0ad1bf98b15f453d0cb08b2c3c110453909f6edeac1f9c8e031a848b941' +
    'a829535c97e07c2719beceb416290d3079eee1f911cce6df803914d8a3577b34fdfd143e5ef36c9713c7ac70a8c211ab',
);

export interface AndroidChainInputs {
  ca2_tbs: Uint8Array;
  ca2_tbs_len: number;
  ca2_sig: Uint8Array;
  ca3_tbs: Uint8Array;
  ca3_tbs_len: number;
  ca3_sig: Uint8Array;
  att_tbs: Uint8Array;
  att_tbs_len: number;
  att_sig: Uint8Array;
  leaf_tbs: Uint8Array;
  leaf_tbs_len: number;
  leaf_sig: Uint8Array;
  /** X || Y of the leaf's P-256 key: the key that signs the statement. */
  leaf_key: Uint8Array;
}

const unavailable = (why: string): never => {
  throw new AppAttestError(ANDROID_ATTEST_ERROR_CODE.unavailable, why);
};
const malformed = (why: string): never => {
  throw new AppAttestError(ANDROID_ATTEST_ERROR_CODE.malformed, why);
};

/** Run a DER step, reporting a DerError as malformed data named by `what`. */
function der<T>(what: string, step: () => T): T {
  try {
    return step();
  } catch (e) {
    if (e instanceof DerError) malformed(`${what}: ${e.message}`);
    throw e;
  }
}

const CURVE_NAMES: ReadonlyArray<[Uint8Array, string]> = [
  [OID.prime256v1, 'P-256'],
  [OID.secp384r1, 'P-384'],
];

/** X || Y of a certificate's EC key, refusing any other curve than `crv` (chain.js certKey). */
export function certKey(certDer: Uint8Array, crv: 'P-256' | 'P-384', what: string): Uint8Array {
  refuseRsa(certDer, what);
  const cert = der(what, () => parseCertificate(certDer));
  const fields = der(what, () => parseTbs(cert.tbs));
  const found = CURVE_NAMES.find(([oid]) => bytesEqual(oid, fields.curve));
  if (!found) return unavailable(`${what}'s key is on curve ${toHex(fields.curve)}, not ${crv}`);
  if (found[1] !== crv) return unavailable(`${what}'s key is ${found[1]}, not ${crv}`);
  const size = crv === 'P-256' ? 64 : 96;
  if (fields.publicKey.length !== size) return malformed(`${what}'s ${crv} key is ${fields.publicKey.length} bytes, not ${size}`);
  return fields.publicKey;
}

function pad(tbs: Uint8Array, max: number, what: string): Uint8Array {
  if (tbs.length > max) malformed(`${what} TBS is ${tbs.length} bytes; the circuit takes at most ${max}`);
  const out = new Uint8Array(max);
  out.set(tbs);
  return out;
}

/**
 * TBS bytes and the issuer's DER signature (chain.js splitCertificate). A
 * certificate signed with RSA is refused by name first (chain.js would go on
 * and fail on a size or a signature format instead).
 */
function splitCertificate(certDer: Uint8Array, what: string): {tbs: Uint8Array; sigDer: Uint8Array} {
  refuseRsa(certDer, what);
  const cert = der(what, () => parseCertificate(certDer));
  return {tbs: cert.tbs, sigDer: cert.signature};
}

function lowS(sigDer: Uint8Array, size: number, n: bigint, what: string): Uint8Array {
  return der(`${what} signature`, () => ecdsaDerToLowS(sigDer, size, n));
}

/**
 * AndroidChain inputs from [leaf, attestation key, Droid CA3, Droid CA2,
 * root] (the root may be left off). `rootKey` is the pinned root's X || Y:
 * GOOGLE_KEY_ATTESTATION_CA1 in the app; named by the caller, never assumed.
 */
export function androidChainInputs(ders: readonly Uint8Array[], rootKey: Uint8Array): AndroidChainInputs {
  if (!(rootKey instanceof Uint8Array) || rootKey.length !== 96) {
    throw new Error('androidChainInputs needs the pinned root key (96 bytes, X || Y)');
  }
  if (ders.length !== 4 && ders.length !== 5) {
    unavailable(
      `An RKP chain has 4 certificates below the root (leaf, attestation key, Droid CA3, Droid CA2); got ${ders.length} in all. ` +
        'Factory-provisioned chains are not accepted.',
    );
  }
  const [leaf, att, ca3, ca2, root] = ders;
  if (root && !bytesEqual(certKey(root, 'P-384', 'The root certificate'), rootKey)) {
    unavailable('The chain does not end at the pinned Google root (Key Attestation CA1)');
  }
  const L = splitCertificate(leaf, 'Leaf');
  const A = splitCertificate(att, 'Attestation key');
  const C3 = splitCertificate(ca3, 'Droid CA3');
  const C2 = splitCertificate(ca2, 'Droid CA2');
  return {
    ca2_tbs: pad(C2.tbs, ANDROID_TBS_LIMITS.ca2, 'Droid CA2'),
    ca2_tbs_len: C2.tbs.length,
    ca2_sig: lowS(C2.sigDer, 48, N_P384, 'Droid CA2'), // root (P-384)
    ca3_tbs: pad(C3.tbs, ANDROID_TBS_LIMITS.ca3, 'Droid CA3'),
    ca3_tbs_len: C3.tbs.length,
    ca3_sig: lowS(C3.sigDer, 48, N_P384, 'Droid CA3'), // CA2 (P-384)
    att_tbs: pad(A.tbs, ANDROID_TBS_LIMITS.att, 'Attestation key'),
    att_tbs_len: A.tbs.length,
    att_sig: lowS(A.sigDer, 32, N_P256, 'Attestation key'), // CA3 (P-256)
    leaf_tbs: pad(L.tbs, ANDROID_TBS_LIMITS.leaf, 'Leaf'),
    leaf_tbs_len: L.tbs.length,
    leaf_sig: lowS(L.sigDer, 32, N_P256, 'Leaf'), // attestation key (P-256)
    leaf_key: certKey(leaf, 'P-256', 'The leaf'),
  };
}

/** All certificates in a PEM bundle, as DER (chain.js pemChain). */
export function pemChain(text: string): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (const m of text.matchAll(/-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/g)) {
    out.push(ethers.utils.base64.decode(m[1].replace(/\s+/g, '')));
  }
  return out;
}
