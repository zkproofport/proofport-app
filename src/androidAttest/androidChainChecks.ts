/**
 * Refuse, before proving, an Android key attestation chain the circuit would
 * refuse -- with the reason, and the ErrorModal code for it.
 *
 * The converter (src/utils/androidKeyAttestation.ts) mirrors circuits'
 * chain.js and only splits certificates; the circuit then checks far more
 * (android-key-attestation lib.nr, cert.nr, key_description.nr). Each check
 * below is one of those, so a phone that cannot make a proof is told why in
 * a second instead of after a 2^21 prove:
 *
 *   shape       exactly [leaf, attestation key, Droid CA3, Droid CA2(, root)];
 *               no RSA anywhere (factory provisioning); the attestation-key
 *               certificate carries the provisioning-information extension
 *               (Remote Key Provisioning's mark) and no key description; the
 *               leaf carries one key description
 *   algorithms  leaf and attestation key signed with ecdsa-with-SHA256, CA3
 *               and CA2 with ecdsa-with-SHA384; leaf, attestation key and CA3
 *               keys P-256, CA2 P-384
 *   time        CA2, CA3 and the attestation-key certificate valid at the
 *               statement's own time (UTCTime, as the circuit reads it)
 *   key         attestation and KeyMint security level both TEE or both
 *               StrongBox; [709] exactly one package, ours, and exactly one
 *               signing-certificate digest, Play's; [704] deviceLocked and
 *               verifiedBootState Verified; [702] origin GENERATED
 *
 * Not repeated here (the circuit checks them; the app cannot be wrong about
 * them without the converter test failing): the signatures themselves, and
 * the TBS walk's own limits (serial length, at most 8 extensions).
 *
 * `unavailable` (E2015) is a phone or build that cannot prove; `malformed`
 * (E2016) is data that is not what a certificate should be.
 */
import {AppAttestError, ANDROID_ATTEST_ERROR_CODE} from '../appAttest/appAttestError';
import {bytesEqual, children, DerError, OID, parseCertificate, parseTbs, readLength, readTlv, toHex, type Tlv} from '../appAttest/der';
import {ecKeyOf, refuseRsa, rsaModulusOf, splitStructural} from '../utils/androidKeyAttestation';
import {
  ANDROID_APP_PACKAGE,
  ANDROID_PLAY_SIGNING_CERT_SHA256,
  AUTH_TAG,
  MAX_AUTH_ENTRIES,
  OID_KEY_ATTESTATION,
  OID_PROVISIONING_INFO,
  SECURITY_LEVEL,
} from './constants';

export interface AndroidAppIdentity {
  packageName: string;
  /** Lowercase hex SHA-256 of the app's signing certificate. */
  signingCertSha256: string;
}

/** The app the circuit accepts: our package, signed by Play. */
export const ZKPROOFPORT_ANDROID_APP: AndroidAppIdentity = Object.freeze({
  packageName: ANDROID_APP_PACKAGE,
  signingCertSha256: ANDROID_PLAY_SIGNING_CERT_SHA256,
});

export interface AndroidChainCheckOptions {
  /** Unix seconds the statement claims; CA2, CA3 and the attestation key must be valid then. */
  now: number;
  app: AndroidAppIdentity;
  /** X || Y of the root the circuit pins: GOOGLE_KEY_ATTESTATION_CA1 in the app. Required, never assumed. */
  rootKey: Uint8Array;
}

/** What the leaf's key description said, for the log. */
export interface KeyDescriptionSummary {
  securityLevel: 'TrustedEnvironment' | 'StrongBox';
  attestationVersion: number;
}

const unavailable = (why: string): never => {
  throw new AppAttestError(ANDROID_ATTEST_ERROR_CODE.unavailable, why);
};
const malformed = (why: string): never => {
  throw new AppAttestError(ANDROID_ATTEST_ERROR_CODE.malformed, why);
};
function der<T>(what: string, step: () => T): T {
  try {
    return step();
  } catch (e) {
    if (e instanceof DerError) malformed(`${what}: ${e.message}`);
    throw e;
  }
}

const SHA256_ALG = OID.ecdsaWithSha256;
const SHA384_ALG = OID.ecdsaWithSha384;

interface Role {
  name: string;
  curve: Uint8Array;
  curveName: 'P-256' | 'P-384';
  signedWith: Uint8Array;
  signedWithName: string;
}

/** The four positions below the root, leaf first: what each must be. */
const ROLES: readonly Role[] = Object.freeze([
  {name: 'Leaf', curve: OID.prime256v1, curveName: 'P-256', signedWith: SHA256_ALG, signedWithName: 'ecdsa-with-SHA256'},
  {name: 'Attestation key', curve: OID.prime256v1, curveName: 'P-256', signedWith: SHA256_ALG, signedWithName: 'ecdsa-with-SHA256'},
  {name: 'Droid CA3', curve: OID.prime256v1, curveName: 'P-256', signedWith: SHA384_ALG, signedWithName: 'ecdsa-with-SHA384'},
  {name: 'Droid CA2', curve: OID.secp384r1, curveName: 'P-384', signedWith: SHA384_ALG, signedWithName: 'ecdsa-with-SHA384'},
]);

/** notBefore / notAfter as unix seconds; the circuit reads two UTCTimes. */
export function certificateValidity(tbs: Uint8Array, what: string): {notBefore: number; notAfter: number} {
  return der(what, () => {
    const outer = readTlv(tbs, 0, tbs.length, 0x30);
    const fields = children(tbs, outer, 12);
    const validity = fields[4];
    if (!validity || validity.tag !== 0x30) throw new DerError('TBS has no Validity SEQUENCE');
    const times = children(tbs, validity, 2);
    if (times.length !== 2) throw new DerError('Validity is not {notBefore, notAfter}');
    const [notBefore, notAfter] = times.map(t => utcTime(tbs, t));
    return {notBefore, notAfter};
  });
}

function utcTime(buf: Uint8Array, t: Tlv): number {
  if (t.tag !== 0x17 || t.end - t.contentStart !== 13) throw new DerError('validity time is not a 13-byte UTCTime');
  const s = String.fromCharCode(...buf.slice(t.contentStart, t.end));
  const m = /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/.exec(s);
  if (!m) throw new DerError(`UTCTime '${s}' is not YYMMDDHHMMSSZ`);
  const [yy, mo, d, h, mi, se] = m.slice(1).map(Number);
  // RFC 5280 4.1.2.5.1: YY >= 50 is 19YY, otherwise 20YY.
  const year = yy >= 50 ? 1900 + yy : 2000 + yy;
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || se > 59) throw new DerError(`UTCTime '${s}' is out of range`);
  return Date.UTC(year, mo - 1, d, h, mi, se) / 1000;
}

/** A context-specific constructed AuthorizationList entry: [n] in low or high tag form. */
function contextEntry(buf: Uint8Array, pos: number, limit: number): {number: number; contentStart: number; end: number} {
  const b = buf[pos];
  if ((b & 0xe0) !== 0xa0) throw new DerError(`authorization entry at ${pos} is not a context-specific constructed tag`);
  let number: number;
  let tagLen: number;
  if ((b & 0x1f) !== 0x1f) {
    number = b & 0x1f;
    tagLen = 1;
  } else {
    const b1 = buf[pos + 1];
    if (b1 === 0x80) throw new DerError(`authorization tag at ${pos} is not minimal`);
    if (b1 & 0x80) {
      const b2 = buf[pos + 2];
      if (b2 & 0x80) throw new DerError(`authorization tag at ${pos} is longer than the circuit reads`);
      number = ((b1 & 0x7f) << 7) | b2;
      tagLen = 3;
    } else {
      if (b1 < 31) throw new DerError(`authorization tag at ${pos} is not minimal`);
      number = b1;
      tagLen = 2;
    }
  }
  const {len, lengthBytes} = readLength(buf, pos + tagLen, limit);
  const contentStart = pos + tagLen + lengthBytes;
  const end = contentStart + len;
  if (end > limit) throw new DerError(`authorization entry at ${pos} overruns its list`);
  return {number, contentStart, end};
}

/** Every entry of an AuthorizationList with tag `tag`, as [contentStart, end). */
function entries(buf: Uint8Array, list: Tlv, tag: number, what: string): Array<{contentStart: number; end: number}> {
  const out: Array<{contentStart: number; end: number}> = [];
  let pos = list.contentStart;
  let seen = 0;
  while (pos < list.end) {
    if (++seen > MAX_AUTH_ENTRIES) {
      unavailable(`${what} has more than ${MAX_AUTH_ENTRIES} entries; the circuit walks at most ${MAX_AUTH_ENTRIES}`);
    }
    const e = contextEntry(buf, pos, list.end);
    if (e.number === tag) out.push({contentStart: e.contentStart, end: e.end});
    pos = e.end;
  }
  return out;
}

function securityLevel(buf: Uint8Array, pos: number, limit: number, what: string): {level: number; end: number} {
  const t = readTlv(buf, pos, limit, 0x0a);
  if (t.end - t.contentStart !== 1) throw new DerError(`${what} is not one byte`);
  return {level: buf[t.contentStart], end: t.end};
}

/**
 * The leaf's KeyDescription (the key attestation extension's value), checked
 * as key_description.nr checks it.
 */
export function checkKeyDescription(value: Uint8Array, app: AndroidAppIdentity): KeyDescriptionSummary {
  return der('Key description', () => {
    const kd = readTlv(value, 0, value.length, 0x30);
    if (kd.end !== value.length) throw new DerError('bytes after the KeyDescription');
    let p = kd.contentStart;
    const version = readTlv(value, p, kd.end, 0x02);
    const attestationVersion = Number(BigInt('0x' + (toHex(value.slice(version.contentStart, version.end)) || '0')));
    p = version.end;
    const att = securityLevel(value, p, kd.end, 'attestation security level');
    p = att.end;
    p = readTlv(value, p, kd.end, 0x02).end; // keyMintVersion
    const km = securityLevel(value, p, kd.end, 'KeyMint security level');
    p = km.end;
    if (att.level !== SECURITY_LEVEL.trustedEnvironment && att.level !== SECURITY_LEVEL.strongBox) {
      unavailable(`The key is not in secure hardware (attestation security level ${att.level}; TEE is 1, StrongBox 2)`);
    }
    if (km.level !== att.level) {
      unavailable(`KeyMint security level ${km.level} differs from attestation security level ${att.level}`);
    }
    p = readTlv(value, p, kd.end, 0x04).end; // attestationChallenge (not read: the key's signature binds the statement)
    p = readTlv(value, p, kd.end, 0x04).end; // uniqueId
    const sw = readTlv(value, p, kd.end, 0x30);
    const hw = readTlv(value, sw.end, kd.end, 0x30);
    if (hw.end !== kd.end) throw new DerError('fields after hardwareEnforced');

    const apps = entries(value, sw, AUTH_TAG.applicationId, 'softwareEnforced');
    if (apps.length !== 1) unavailable(`The key description names ${apps.length} applications; exactly one is required`);
    checkApplicationId(value, apps[0], app);

    const rots = entries(value, hw, AUTH_TAG.rootOfTrust, 'hardwareEnforced');
    if (rots.length !== 1) unavailable(`The key description has ${rots.length} hardware roots of trust; exactly one is required`);
    checkRootOfTrust(value, rots[0]);

    const origins = entries(value, hw, AUTH_TAG.origin, 'hardwareEnforced');
    const o = origins[0];
    const generated = origins.length === 1 && o.end - o.contentStart === 3
      && value[o.contentStart] === 0x02 && value[o.contentStart + 1] === 0x01 && value[o.contentStart + 2] === 0x00;
    if (!generated) unavailable('The key was not generated in secure hardware (origin is not GENERATED)');

    return {
      securityLevel: att.level === SECURITY_LEVEL.strongBox ? 'StrongBox' : 'TrustedEnvironment',
      attestationVersion,
    };
  });
}

/** [709]: OCTET STRING { SEQUENCE { SET OF {name, version}, SET OF digest } }. */
function checkApplicationId(buf: Uint8Array, at: {contentStart: number; end: number}, app: AndroidAppIdentity): void {
  const oct = readTlv(buf, at.contentStart, at.end, 0x04);
  if (oct.end !== at.end) throw new DerError('application id length mismatch');
  const seq = readTlv(buf, oct.contentStart, oct.end, 0x30);
  if (seq.end !== oct.end) throw new DerError('application id length mismatch');
  const [packageSet, digestSet, ...rest] = children(buf, seq, 3);
  if (!packageSet || !digestSet || rest.length || packageSet.tag !== 0x31 || digestSet.tag !== 0x31) {
    throw new DerError('application id is not {SET OF package, SET OF digest}');
  }
  const names = children(buf, packageSet, 16).map(info => {
    const [name, version, ...more] = children(buf, info, 3);
    if (info.tag !== 0x30 || !name || !version || more.length || name.tag !== 0x04 || version.tag !== 0x02) {
      throw new DerError('package info is not {OCTET STRING name, INTEGER version}');
    }
    return String.fromCharCode(...buf.slice(name.contentStart, name.end));
  });
  if (names.length !== 1) unavailable(`The key belongs to ${names.length} packages (${names.join(', ')}); exactly one is required`);
  if (names[0] !== app.packageName) unavailable(`The key belongs to another app (${names[0]}), not ${app.packageName}`);

  const digests = children(buf, digestSet, 16).map(d => {
    if (d.tag !== 0x04) throw new DerError('signature digest is not an OCTET STRING');
    return toHex(buf.slice(d.contentStart, d.end));
  });
  if (digests.length !== 1 || digests[0].length !== 64) {
    unavailable(`The app is signed with ${digests.length} certificates (${digests.join(', ')}); exactly one SHA-256 is required`);
  }
  if (digests[0] !== app.signingCertSha256.toLowerCase()) {
    unavailable(
      `This build is signed with certificate ${digests[0]}, not the store signing certificate ${app.signingCertSha256} ` +
        'the circuit accepts; only the store-installed app can prove',
    );
  }
}

/** [704]: SEQUENCE { OCTET STRING key, BOOLEAN deviceLocked, ENUMERATED verifiedBootState, ... }. */
function checkRootOfTrust(buf: Uint8Array, at: {contentStart: number; end: number}): void {
  const seq = readTlv(buf, at.contentStart, at.end, 0x30);
  if (seq.end !== at.end) throw new DerError('root of trust length mismatch');
  const fields = children(buf, seq, 6);
  const [, locked, state] = fields;
  if (!fields[0] || fields[0].tag !== 0x04) throw new DerError('root of trust has no verifiedBootKey');
  if (!locked || locked.tag !== 0x01 || locked.end - locked.contentStart !== 1) throw new DerError('root of trust has no deviceLocked');
  if (!state || state.tag !== 0x0a || state.end - state.contentStart !== 1) throw new DerError('root of trust has no verifiedBootState');
  if (buf[locked.contentStart] === 0) unavailable("This phone's bootloader is unlocked");
  if (buf[state.contentStart] !== 0) unavailable(`This phone's boot state is not Verified (verifiedBootState ${buf[state.contentStart]})`);
}

/**
 * Every check above, in an order that names the most basic reason first.
 * Returns the leaf's key description summary for the log.
 */
export function requireAcceptableAndroidChain(ders: readonly Uint8Array[], opts: AndroidChainCheckOptions): KeyDescriptionSummary {
  if (ders.length !== 4 && ders.length !== 5) {
    unavailable(
      `An RKP chain has 4 certificates below the root (leaf, attestation key, Droid CA3, Droid CA2); got ${ders.length} in all. ` +
        'Factory-provisioned chains are not accepted.',
    );
  }
  const names = [...ROLES.map(r => r.name), 'The root'];
  ders.forEach((d, i) => refuseRsa(d, `${names[i]} (certificate ${i})`));

  const parsed = ROLES.map((role, i) => {
    const cert = der(role.name, () => parseCertificate(ders[i]));
    const fields = der(role.name, () => parseTbs(cert.tbs));
    if (!bytesEqual(cert.signatureAlgorithm, role.signedWith)) {
      unavailable(`${role.name} is signed with ${toHex(cert.signatureAlgorithm)}; an RKP chain signs it with ${role.signedWithName}`);
    }
    if (!bytesEqual(fields.curve, role.curve)) {
      unavailable(`${role.name}'s key is on curve ${toHex(fields.curve)}, not ${role.curveName}`);
    }
    return {role, cert, fields};
  });
  const [leaf, att, ca3, ca2] = parsed;

  if (!att.fields.extensions.has(OID_PROVISIONING_INFO)) {
    unavailable('The attestation key was not remotely provisioned (no provisioning-information extension); factory-provisioned chains are not accepted');
  }
  if (att.fields.extensions.has(OID_KEY_ATTESTATION)) {
    unavailable('The attestation-key certificate carries a key description; only the leaf may');
  }
  const keyDescription = leaf.fields.extensions.get(OID_KEY_ATTESTATION);
  if (!keyDescription) unavailable('The leaf certificate has no key description');

  if (ders.length === 5) {
    const root = der('The root', () => parseTbs(parseCertificate(ders[4]).tbs));
    if (!bytesEqual(root.curve, OID.secp384r1) || !bytesEqual(root.publicKey, opts.rootKey)) {
      unavailable('The chain does not end at the pinned root (Key Attestation CA1)');
    }
  }

  for (const {role, cert} of [ca2, ca3, att]) {
    const {notBefore, notAfter} = certificateValidity(cert.tbs, role.name);
    if (opts.now < notBefore) {
      unavailable(`${role.name} is not valid until ${new Date(notBefore * 1000).toISOString()}; the statement's time is ${new Date(opts.now * 1000).toISOString()}. Check the phone's clock`);
    }
    if (opts.now > notAfter) {
      unavailable(`${role.name} expired at ${new Date(notAfter * 1000).toISOString()}; the statement's time is ${new Date(opts.now * 1000).toISOString()}`);
    }
  }

  return checkKeyDescription(keyDescription as Uint8Array, opts.app);
}

// ─── Factory-provisioned chains ────────────────────────────────────────────

const OID_SHA256_WITH_RSA = '2a864886f70d01010b';
const OID_ECDSA_SHA256 = toHex(OID.ecdsaWithSha256);
const OID_BASIC_CONSTRAINTS = '551d13';

export interface FactoryChainCheckOptions {
  app: AndroidAppIdentity;
  /** The pinned RSA root modulus (hex): GOOGLE_RSA_ROOT_MODULUS_HEX in the app. Required. */
  rootModulusHex: string;
}

/**
 * A factory-provisioned chain [leaf, batch, intermediate(, root)], checked as
 * android-key-attestation android_factory_signing_key checks it, before
 * proving: the pinned RSA root, an intermediate holding a P-384 key, signed
 * with sha256WithRSAEncryption and marked CA; a batch certificate holding a
 * P-256 key, signed with ecdsa-with-SHA256 and carrying no key description;
 * a leaf signed with ecdsa-with-SHA256 whose key description passes
 * checkKeyDescription (TEE or StrongBox, our package and signing
 * certificate, locked and verified, generated). The circuit reads no
 * validity on this chain (the Play Integrity verdict stands in for
 * revocation), so neither does this.
 */
export function requireAcceptableFactoryChain(ders: readonly Uint8Array[], opts: FactoryChainCheckOptions): KeyDescriptionSummary {
  if (ders.length !== 3 && ders.length !== 4) {
    unavailable(`A factory chain has 3 certificates below the root (leaf, batch, intermediate); got ${ders.length} in all`);
  }
  const [leaf, batch, ik, root] = ders;
  if (root && rsaModulusOf(root, 'The root') !== opts.rootModulusHex.toLowerCase()) {
    unavailable("The chain does not end at the pinned RSA root (Google's attestation root)");
  }

  const ikParts = splitStructural(ik, 'The intermediate');
  if (ikParts.algorithm !== OID_SHA256_WITH_RSA) {
    unavailable(`The intermediate is signed with ${ikParts.algorithm}; a factory chain signs it with sha256WithRSAEncryption`);
  }
  ecKeyOf(ik, 'P-384', 'The intermediate');
  const ikFields = der('The intermediate', () => parseTbs(ikParts.tbs));
  const bc = ikFields.extensions.get(OID_BASIC_CONSTRAINTS);
  const isCa = !!bc && bc.length >= 5 && bc[0] === 0x30 && bc[2] === 0x01 && bc[3] === 0x01 && bc[4] !== 0;
  if (!isCa) unavailable('The intermediate is not a CA certificate');

  const batchParts = splitStructural(batch, 'The batch certificate');
  if (batchParts.algorithm !== OID_ECDSA_SHA256) {
    unavailable(`The batch certificate is signed with ${batchParts.algorithm}; a factory chain signs it with ecdsa-with-SHA256`);
  }
  ecKeyOf(batch, 'P-256', 'The batch certificate');
  if (der('The batch certificate', () => parseTbs(batchParts.tbs)).extensions.has(OID_KEY_ATTESTATION)) {
    unavailable('The batch certificate carries a key description; only the leaf may');
  }

  const leafParts = splitStructural(leaf, 'Leaf');
  if (leafParts.algorithm !== OID_ECDSA_SHA256) {
    unavailable(`Leaf is signed with ${leafParts.algorithm}; a factory chain signs it with ecdsa-with-SHA256`);
  }
  ecKeyOf(leaf, 'P-256', 'Leaf');
  const keyDescription = der('Leaf', () => parseTbs(leafParts.tbs)).extensions.get(OID_KEY_ATTESTATION);
  if (!keyDescription) return unavailable('The leaf certificate has no key description');
  return checkKeyDescription(keyDescription, opts.app);
}
