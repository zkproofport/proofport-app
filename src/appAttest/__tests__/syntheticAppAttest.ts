/**
 * A synthetic App Attest device for tests: our own P-384 "CA" and P-256
 * Secure Enclave key, producing attestation and assertion objects in Apple's
 * shapes. Ported from the circuit's fixture generator
 * (circuits/scripts/coinbase-attestation-v2/generate-prover-toml.js) so the
 * app parses what the circuit was tested with; the CBOR envelope follows
 * Apple's "Validating apps that connect to your server".
 *
 * Not a test file itself (no `.test.ts`), so jest does not run it alone.
 */
import * as crypto from 'crypto';

export const sha256 = (...parts: Uint8Array[]) =>
  new Uint8Array(crypto.createHash('sha256').update(Buffer.concat(parts.map(p => Buffer.from(p)))).digest());

// ---- DER --------------------------------------------------------------------
function derLen(n: number): number[] {
  if (n < 0x80) return [n];
  if (n < 0x100) return [0x81, n];
  return [0x82, n >> 8, n & 0xff];
}
export const tlv = (tag: number, ...content: Uint8Array[]) => {
  const body = Buffer.concat(content.map(c => Buffer.from(c)));
  return new Uint8Array([tag, ...derLen(body.length), ...body]);
};
const raw = (h: string) => new Uint8Array(Buffer.from(h.replace(/ /g, ''), 'hex'));
const seq = (...c: Uint8Array[]) => tlv(0x30, ...c);
const oid = (h: string) => tlv(0x06, raw(h));
const utf8 = (s: string) => tlv(0x0c, new Uint8Array(Buffer.from(s)));
const rdn = (o: string, v: string) => tlv(0x31, seq(oid(o), utf8(v)));
const utcTime = (d: Date) => tlv(0x17, new Uint8Array(Buffer.from(d.toISOString().replace(/[-:T]/g, '').slice(2, 14) + 'Z')));

/** The 8.5 items of a real certificate, with [1204] rebuilt for `appId`. */
function appIdExtensionValue(appId: string) {
  const items = [
    'a40302010a', 'bf893003020101', 'bf893103020100', 'bf893203020101', 'bf893303020101',
    null,
    'a5060404736b7320', 'bf893603020105', 'bf893703020100', 'bf893903020100', 'bf893a03020100',
    'bf893b03020100', 'aa03020100', 'bf893c060204736b7320',
  ];
  const body = items.map(h => {
    if (h) return raw(h);
    const oct = tlv(0x04, new Uint8Array(Buffer.from(appId)));
    return new Uint8Array([0xbf, 0x89, 0x34, ...derLen(oct.length), ...oct]);
  });
  return seq(...body);
}

export interface EcKey {
  privateKey: crypto.KeyObject;
  publicKey: crypto.KeyObject;
  x: Uint8Array;
  y: Uint8Array;
}
export function ecKey(curve: 'prime256v1' | 'secp384r1'): EcKey {
  const {privateKey, publicKey} = crypto.generateKeyPairSync('ec', {namedCurve: curve});
  const jwk = publicKey.export({format: 'jwk'}) as {x: string; y: string};
  return {privateKey, publicKey, x: new Uint8Array(Buffer.from(jwk.x, 'base64url')), y: new Uint8Array(Buffer.from(jwk.y, 'base64url'))};
}

const ALG_SHA256 = raw('300a06082a8648ce3d040302');
const ALG_SHA384 = raw('300a06082a8648ce3d040303');

function credentialTbs(cred: EcKey, keyId: Uint8Array, nonce: Uint8Array, appId: string) {
  const now = Date.now();
  return seq(
    raw('a003020102'),
    tlv(0x02, raw('01aabbccdd01')),
    ALG_SHA256,
    seq(rdn('550403', 'Apple App Attestation CA 1'), rdn('55040a', 'Apple Inc.'), rdn('550408', 'California')),
    seq(utcTime(new Date(now - 86400e3)), utcTime(new Date(now + 270 * 86400e3))),
    seq(rdn('550403', Buffer.from(keyId).toString('hex')), rdn('55040b', 'AAA Certification'), rdn('55040a', 'Apple Inc.'), rdn('550408', 'California')),
    new Uint8Array([...raw('3059301306072a8648ce3d020106082a8648ce3d030107034200'), 4, ...cred.x, ...cred.y]),
    tlv(0xa3, seq(
      raw('300c0603551d130101ff04023000'),
      raw('300e0603551d0f0101ff0404030204f0'),
      seq(oid('2a864886f763640805'), tlv(0x04, appIdExtensionValue(appId))),
      seq(oid('2a864886f763640802'), tlv(0x04, seq(tlv(0xa1, tlv(0x04, nonce))))),
    )),
  );
}

function intermediateTbs(ca: EcKey) {
  return seq(
    raw('a003020102'),
    tlv(0x02, raw('09bac5e1bc')),
    ALG_SHA384,
    seq(rdn('550403', 'Synthetic Root')),
    seq(utcTime(new Date(Date.now() - 86400e3)), utcTime(new Date(Date.now() + 86400e3))),
    seq(rdn('550403', 'Apple App Attestation CA 1')),
    new Uint8Array([...raw('3076301006072a8648ce3d020106052b81040022036200'), 4, ...ca.x, ...ca.y]),
  );
}

/** Sign and wrap: Certificate ::= SEQUENCE {tbs, alg, BIT STRING (DER sig)}. */
function certificate(tbs: Uint8Array, alg: Uint8Array, signer: EcKey, hash: 'sha256' | 'sha384', highS = false, n?: bigint) {
  let sig: Uint8Array = new Uint8Array(crypto.sign(hash, tbs, {key: signer.privateKey, dsaEncoding: 'der'}));
  if (highS && n) sig = forceHighS(sig, n);
  return seq(tbs, alg, tlv(0x03, new Uint8Array([0]), sig));
}

/** DER ECDSA signature with s moved to the upper half (same signature). */
export function forceHighS(der: Uint8Array, n: bigint): Uint8Array {
  const b = Buffer.from(der);
  const rLen = b[3];
  const r = b.subarray(4, 4 + rLen);
  const sLen = b[5 + rLen];
  let s = BigInt('0x' + b.subarray(6 + rLen, 6 + rLen + sLen).toString('hex'));
  if (s <= n / 2n) s = n - s;
  const int = (v: Uint8Array) => tlv(0x02, v);
  let sHex = s.toString(16);
  if (sHex.length % 2) sHex = '0' + sHex;
  let sBytes = new Uint8Array(Buffer.from(sHex, 'hex'));
  if (sBytes[0] & 0x80) sBytes = new Uint8Array([0, ...sBytes]);
  return seq(int(new Uint8Array(r)), int(sBytes));
}

// ---- CBOR -------------------------------------------------------------------
function head(major: number, n: number): number[] {
  if (n < 24) return [(major << 5) | n];
  if (n < 0x100) return [(major << 5) | 24, n];
  if (n < 0x10000) return [(major << 5) | 25, n >> 8, n & 0xff];
  return [(major << 5) | 26, (n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}
export function cbor(v: unknown): Uint8Array {
  if (typeof v === 'number') return new Uint8Array(head(0, v));
  if (typeof v === 'string') {
    const b = Buffer.from(v);
    return new Uint8Array([...head(3, b.length), ...b]);
  }
  if (v instanceof Uint8Array) return new Uint8Array([...head(2, v.length), ...v]);
  if (v instanceof Map) {
    const parts: number[] = head(5, v.size);
    for (const [k, val] of v) parts.push(...cbor(k), ...cbor(val));
    return new Uint8Array(parts);
  }
  if (Array.isArray(v)) {
    return new Uint8Array([...head(4, v.length), ...v.flatMap(x => Array.from(cbor(x)))]);
  }
  throw new Error(`cannot encode ${typeof v}`);
}

// ---- the device -------------------------------------------------------------
export const AAGUID = {
  production: new Uint8Array([...Buffer.from('appattest'), 0, 0, 0, 0, 0, 0, 0]),
  development: new Uint8Array(Buffer.from('appattestdevelop')),
  sandbox: new Uint8Array(Buffer.from('appattestsandbox')),
};

export const N_P256 = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
export const N_P384 = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffc7634d81f4372ddf581a0db248b0a77aecec196accc52973');

export interface SyntheticDevice {
  ca: EcKey;
  caKeyHash: string;
  cred: EcKey;
  keyId: string;
  /** Build the attestation object for `clientDataHash`. */
  attestation(clientDataHash: Uint8Array, o?: {appId?: string; aaguid?: Uint8Array; certAppId?: string; counter?: number; highS?: boolean}): Uint8Array;
  /** Build an assertion over `clientData` with `counter`. */
  assertion(clientData: Uint8Array, o?: {counter?: number; appId?: string; highS?: boolean}): Uint8Array;
}

export function syntheticDevice(appId: string, sharedCa?: EcKey): SyntheticDevice {
  const ca = sharedCa ?? ecKey('secp384r1');
  const cred = ecKey('prime256v1');
  const keyIdBytes = sha256(new Uint8Array([4]), cred.x, cred.y);
  const keyId = Buffer.from(keyIdBytes).toString('base64');
  const interDer = certificate(intermediateTbs(ca), ALG_SHA384, ca, 'sha384');
  return {
    ca,
    caKeyHash: '0x' + Buffer.from(sha256(ca.x, ca.y)).toString('hex'),
    cred,
    keyId,
    attestation(cdh, o = {}) {
      const counter = Buffer.alloc(4);
      counter.writeUInt32BE(o.counter ?? 0);
      const cose = new Uint8Array([...raw('a501020326200121582 0'.replace(/ /g, '')), ...cred.x, ...raw('225820'), ...cred.y]);
      const authData = new Uint8Array([
        ...sha256(new Uint8Array(Buffer.from(o.appId ?? appId))), 0x40, ...counter,
        ...(o.aaguid ?? AAGUID.production), 0, 32, ...keyIdBytes, ...cose,
      ]);
      const nonce = sha256(authData, cdh);
      const credDer = certificate(credentialTbs(cred, keyIdBytes, nonce, o.certAppId ?? appId), ALG_SHA256, ca, 'sha256', o.highS, N_P384);
      return cbor(new Map<string, unknown>([
        ['fmt', 'apple-appattest'],
        ['attStmt', new Map<string, unknown>([['x5c', [credDer, interDer]], ['receipt', new Uint8Array([1, 2, 3])]])],
        ['authData', authData],
      ]));
    },
    assertion(clientData, o = {}) {
      const counter = Buffer.alloc(4);
      counter.writeUInt32BE(o.counter ?? 1);
      const authData = new Uint8Array([...sha256(new Uint8Array(Buffer.from(o.appId ?? appId))), 0x00, ...counter]);
      const nonce = sha256(authData, sha256(clientData));
      let sig: Uint8Array = new Uint8Array(crypto.sign('sha256', nonce, {key: cred.privateKey, dsaEncoding: 'der'}));
      if (o.highS) sig = forceHighS(sig, N_P256);
      return cbor(new Map<string, unknown>([['signature', sig], ['authenticatorData', authData]]));
    },
  };
}

/** Verify r || s the way the circuit does: ECDSA-SHA256 over the message. */
export function verifyP1363(curveKey: EcKey | {x: Uint8Array; y: Uint8Array; crv: 'P-256' | 'P-384'}, message: Uint8Array, sig: Uint8Array): boolean {
  const key = 'publicKey' in curveKey
    ? curveKey.publicKey
    : crypto.createPublicKey({
        key: {kty: 'EC', crv: curveKey.crv, x: Buffer.from(curveKey.x).toString('base64url'), y: Buffer.from(curveKey.y).toString('base64url')},
        format: 'jwk',
      });
  return crypto.verify('sha256', message, {key, dsaEncoding: 'ieee-p1363'}, sig);
}
