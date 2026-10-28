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
  return ecKeyOf(certDer, crv, what);
}

/**
 * X || Y of a certificate's EC key on `crv`, whatever its issuer signed it
 * with (a factory intermediate is signed with RSA and holds a P-384 key).
 */
export function ecKeyOf(certDer: Uint8Array, crv: 'P-256' | 'P-384', what: string): Uint8Array {
  const {tbs} = splitStructural(certDer, what);
  const fields = der(what, () => parseTbs(tbs));
  const found = CURVE_NAMES.find(([oid]) => bytesEqual(oid, fields.curve));
  if (!found) return unavailable(`${what}'s key is on curve ${toHex(fields.curve)}, not ${crv}`);
  if (found[1] !== crv) return unavailable(`${what}'s key is ${found[1]}, not ${crv}`);
  const size = crv === 'P-256' ? 64 : 96;
  if (fields.publicKey.length !== size) return malformed(`${what}'s ${crv} key is ${fields.publicKey.length} bytes, not ${size}`);
  return fields.publicKey;
}

/**
 * SEQUENCE {tbs, algorithm, BIT STRING signature} taken apart without
 * judging the algorithm: the TBS bytes, the algorithm OID (hex) and the
 * signature bytes after the unused-bits byte.
 */
export function splitStructural(certDer: Uint8Array, what: string): {tbs: Uint8Array; algorithm: string; signature: Uint8Array} {
  return der(what, () => {
    const outer = readTlv(certDer, 0, certDer.length, 0x30);
    if (outer.end !== certDer.length) throw new DerError('bytes after the certificate');
    const parts = children(certDer, outer, 3);
    const [tbs, alg, sig] = parts;
    if (parts.length !== 3 || tbs.tag !== 0x30 || alg.tag !== 0x30 || sig.tag !== 0x03) {
      throw new DerError('a certificate is SEQUENCE {tbs, algorithm, signature}');
    }
    if (sig.end - sig.contentStart < 2 || certDer[sig.contentStart] !== 0x00) throw new DerError('signature BIT STRING has unused bits');
    const algOid = readTlv(certDer, alg.contentStart, alg.end, 0x06);
    return {
      tbs: certDer.slice(tbs.start, tbs.end),
      algorithm: toHex(certDer.slice(algOid.contentStart, algOid.end)),
      signature: certDer.slice(sig.contentStart + 1, sig.end),
    };
  });
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

// ─── Factory-provisioned chains (Google's RSA root) ───────────────────────

/** TBS room per certificate (android-key-attestation IK/BATCH/LEAF_TBS_MAX_LEN). */
export const ANDROID_FACTORY_TBS_LIMITS = Object.freeze({ik: 512, batch: 512, leaf: 1024});

/**
 * Google's RSA-4096 attestation root (serialNumber f92009e853b6b045): one key
 * behind its 2016, 2019 and 2022 certificates
 * (developer.android.com/privacy-and-security/security-key-attestation);
 * chain.js GOOGLE_RSA_ROOT_MODULUS_HEX. The factory circuits take it as a
 * prover input pinned by hash.
 */
export const GOOGLE_RSA_ROOT_MODULUS_HEX =
  'afb6c7822bb1a701ec2bb42e8bcc541663abef982f32c77f7531030c97524b1b5fe809fbc72aa9451f743cbd9a6f1335744aa55e77f6b6ac3535ee17c25e6395' +
  '17dd9c92e6374a53cbfe258f8ffbb6fd129378a22a4ca99c452d47a59f3201f44197ca1ccd7e762fb2f53151b6feb2fffd2b6fe4fe5bc6bd9ec34bfe08239daa' +
  'fceb8eb5a8ed2b3acd9c5e3a7790e1b51442793159859811ad9eb2a96bbdd7a57c93a91c41fccd27d67fd6f671aa0b815261ad384fa37944864604ddb3d8c4f9' +
  '20a19b1656c2f14ad6d03c56ec060899041c1ed1a5fe6d3440b556bad1d0a152589c53e55d370762f0122eef91861b1b0e6c4c80927499c0e9bec0b83e3bc1f9' +
  '3c72c049604bbd2f1345e62c3f8e26dbec06c94766f3c128239d4f4312fad8123887e06becf567583bf8355a81feeabaf99a83c8df3e2a322afc672bf120b135' +
  '158b6821ceaf309b6eee77f98833b018daa10e451f06a374d50781f359082966bb778b9308942698e74e0bcd24628a01c2cc03e51f0b3e5b4ac1e4df9eaf9ff6' +
  'a492a77c1483882885015b422ce67b80b88c9b48e13b607ab545c723ff8c44f8f2d368b9f6520d31145ebf9e862ad71df6a3bfd2450959d653740d97a12f368b' +
  '13ef66d5d0a54a6e2f5d9a6fef446832bc67844725861f093dd0e6f3405da89643ef0f4d69b6420051fdb93049673e36950580d3cdf4fbd08bc5848395260063';

/** RSA-4096 values as noir-bignum takes them: 35 little-endian limbs of 120 bits. */
export const RSA4096_LIMBS = 35;

/** `v` as `count` little-endian 120-bit limbs (chain.js limbs120). */
export function limbs120(v: bigint, count: number): bigint[] {
  const out: bigint[] = [];
  const mask = (1n << 120n) - 1n;
  for (let i = 0; i < count; i++) {
    out.push(v & mask);
    v >>= 120n;
  }
  if (v !== 0n) throw new Error(`value does not fit ${count} limbs of 120 bits`);
  return out;
}

/** Modulus and Barrett parameter floor(2^(2*4096+4) / n) as limbs (chain.js rsa4096Params). */
export function rsa4096Params(modulusHex: string): {modulus: bigint[]; redc: bigint[]} {
  const n = BigInt('0x' + modulusHex);
  if (n >> 4095n !== 1n) throw new Error('not a 4096-bit modulus');
  return {modulus: limbs120(n, RSA4096_LIMBS), redc: limbs120((1n << (2n * 4096n + 4n)) / n, RSA4096_LIMBS)};
}

const OID_RSA_ENCRYPTION = '2a864886f70d010101';

/** The RSA modulus of a certificate's key, lowercase hex without a sign byte; null for a non-RSA key. */
export function rsaModulusOf(certDer: Uint8Array, what: string): string | null {
  const {tbs} = splitStructural(certDer, what);
  return der(what, () => {
    const outer = readTlv(tbs, 0, tbs.length, 0x30);
    const spki = children(tbs, outer, 12)[6];
    if (!spki || spki.tag !== 0x30) throw new DerError('TBS has no SubjectPublicKeyInfo');
    const [algId, bits] = children(tbs, spki, 2);
    if (!algId || !bits || algId.tag !== 0x30 || bits.tag !== 0x03) throw new DerError('SubjectPublicKeyInfo is not {AlgorithmIdentifier, BIT STRING}');
    const keyOid = readTlv(tbs, algId.contentStart, algId.end, 0x06);
    if (toHex(tbs.slice(keyOid.contentStart, keyOid.end)) !== OID_RSA_ENCRYPTION) return null;
    if (tbs[bits.contentStart] !== 0x00) throw new DerError('RSA key BIT STRING has unused bits');
    const key = readTlv(tbs, bits.contentStart + 1, bits.end, 0x30);
    const n = readTlv(tbs, key.contentStart, key.end, 0x02);
    let body = tbs.slice(n.contentStart, n.end);
    while (body.length > 1 && body[0] === 0) body = body.slice(1);
    return toHex(body);
  });
}

export interface AndroidFactoryChainInputs {
  ik_tbs: Uint8Array;
  ik_tbs_len: number;
  /** The root's RSA-4096 signature over the intermediate TBS, as 35 limbs. */
  ik_sig: bigint[];
  batch_tbs: Uint8Array;
  batch_tbs_len: number;
  batch_sig: Uint8Array;
  leaf_tbs: Uint8Array;
  leaf_tbs_len: number;
  leaf_sig: Uint8Array;
  /** X || Y of the leaf's P-256 key: the key that signs the statement. */
  leaf_key: Uint8Array;
}

/**
 * FactoryChain inputs from [leaf, batch, intermediate, root] (the root may be
 * left off) -- a mirror of chain.js factoryChainInputs, step for step: a
 * present root must hold `rootModulusHex` (GOOGLE_RSA_ROOT_MODULUS_HEX in the
 * app), the intermediate a P-384 key, the batch a P-256 key; each TBS padded
 * to its limit; the intermediate's RSA signature as raw limbs; the batch's
 * P-384 and the leaf's P-256 signatures as r || s, low s.
 */
export function androidFactoryChainInputs(ders: readonly Uint8Array[], rootModulusHex: string): AndroidFactoryChainInputs {
  if (typeof rootModulusHex !== 'string' || rootModulusHex.length !== 1024) {
    throw new Error('androidFactoryChainInputs needs the pinned RSA-4096 root modulus (1024 hex characters)');
  }
  if (ders.length !== 3 && ders.length !== 4) {
    unavailable(`A factory chain has 3 certificates below the root (leaf, batch, intermediate); got ${ders.length} in all.`);
  }
  const [leaf, batch, ik, root] = ders;
  if (root && rsaModulusOf(root, 'The root certificate') !== rootModulusHex.toLowerCase()) {
    unavailable('The chain does not end at the pinned RSA root');
  }
  ecKeyOf(ik, 'P-384', 'The intermediate');
  ecKeyOf(batch, 'P-256', 'The batch certificate');
  const L = splitStructural(leaf, 'Leaf');
  const B = splitStructural(batch, 'Batch');
  const I = splitStructural(ik, 'Intermediate');
  if (I.signature.length === 0) malformed('Intermediate has an empty signature');
  return {
    ik_tbs: pad(I.tbs, ANDROID_FACTORY_TBS_LIMITS.ik, 'Intermediate'),
    ik_tbs_len: I.tbs.length,
    ik_sig: limbs120(BigInt('0x' + toHex(I.signature)), RSA4096_LIMBS), // RSA signature, raw
    batch_tbs: pad(B.tbs, ANDROID_FACTORY_TBS_LIMITS.batch, 'Batch'),
    batch_tbs_len: B.tbs.length,
    batch_sig: lowS(B.signature, 48, N_P384, 'Batch'), // intermediate (P-384)
    leaf_tbs: pad(L.tbs, ANDROID_FACTORY_TBS_LIMITS.leaf, 'Leaf'),
    leaf_tbs_len: L.tbs.length,
    leaf_sig: lowS(L.signature, 32, N_P256, 'Leaf'), // batch key (P-256)
    leaf_key: ecKeyOf(leaf, 'P-256', 'The leaf'),
  };
}

/**
 * Which Android circuit a chain belongs to, by its shape -- never by what
 * would be convenient:
 *   android          5 certificates ending at Key Attestation CA1 (RKP)
 *   android_factory  4 certificates ending at Google's RSA root
 * (`roots` names both; the app passes ANDROID_CIRCUIT_TRUST's.)
 * Anything else is refused by name (E2015).
 */
export function classifyAndroidChain(
  ders: readonly Uint8Array[],
  roots: {rootKey: Uint8Array; rsaRootModulusHex: string},
): 'android' | 'android_factory' {
  const last = ders[ders.length - 1];
  if (ders.length === 5) {
    if (rsaModulusOf(last, 'The root certificate') === null) {
      const key = ecKeyOf(last, 'P-384', 'The root certificate');
      if (bytesEqual(key, roots.rootKey)) return 'android';
    }
    return unavailable('A 5-certificate chain must end at Key Attestation CA1; this one does not (an older RKP chain under the RSA root is not accepted)');
  }
  if (ders.length === 4) {
    if (rsaModulusOf(last, 'The root certificate') === roots.rsaRootModulusHex.toLowerCase()) return 'android_factory';
    return unavailable("A 4-certificate chain must be factory-provisioned under Google's RSA root; this one is not");
  }
  return unavailable(
    `An attestation chain has 5 certificates (Remote Key Provisioning) or 4 (factory-provisioned); got ${ders.length}`,
  );
}
