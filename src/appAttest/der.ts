/**
 * Just enough DER (X.690) to take an App Attest certificate chain apart the way
 * the circuit expects it: the credential certificate's TBS bytes and signature,
 * the intermediate CA's public key, and the two Apple extensions the circuit
 * reads (the nonce, 1.2.840.113635.100.8.2, and the App ID item inside
 * 1.2.840.113635.100.8.5).
 *
 * Strict on purpose: definite lengths in their shortest form only, every child
 * ending exactly where its parent says, nothing after the outer element. The
 * circuit walks the same TBS with the same rules (`app-attest-libs/src/der.nr`
 * refuses non-minimal and 3-byte length forms), so input this file accepts and
 * the circuit refuses would only move the failure to a slower, vaguer place.
 */

export class DerError extends Error {
  constructor(message: string) {
    super(`DER: ${message}`);
    this.name = 'DerError';
  }
}

export interface Tlv {
  tag: number;
  /** Offset of the tag byte. */
  start: number;
  /** Offset of the first content byte. */
  contentStart: number;
  /** Offset just past the content. */
  end: number;
}

/**
 * A definite length in its shortest form at `pos`: one byte below 0x80, else
 * 0x81 or 0x82 and the length. 0x80 is BER's indefinite form; 0x83 and up
 * describe more than 64 KiB, which nothing in an App Attest certificate is.
 */
export function readLength(buf: Uint8Array, pos: number, limit: number): {len: number; lengthBytes: number} {
  if (pos >= limit) throw new DerError(`length at ${pos} runs past its container`);
  const first = buf[pos];
  if (first < 0x80) return {len: first, lengthBytes: 1};
  if (first === 0x81) {
    if (pos + 2 > limit) throw new DerError(`length at ${pos} runs past its container`);
    const len = buf[pos + 1];
    if (len < 0x80) throw new DerError(`non-minimal length at ${pos}`);
    return {len, lengthBytes: 2};
  }
  if (first === 0x82) {
    if (pos + 3 > limit) throw new DerError(`length at ${pos} runs past its container`);
    const len = (buf[pos + 1] << 8) | buf[pos + 2];
    if (len < 0x100) throw new DerError(`non-minimal length at ${pos}`);
    return {len, lengthBytes: 3};
  }
  throw new DerError(`unsupported length form 0x${first.toString(16)} at ${pos}`);
}

/** Read one TLV at `pos` inside `buf[0..limit)`. Tags are single-byte here. */
export function readTlv(buf: Uint8Array, pos: number, limit: number = buf.length, expectTag?: number): Tlv {
  if (pos + 2 > limit) throw new DerError(`element at ${pos} runs past its container`);
  const tag = buf[pos];
  if ((tag & 0x1f) === 0x1f) throw new DerError(`multi-byte tag at ${pos} where a single-byte one belongs`);
  if (expectTag !== undefined && tag !== expectTag) {
    throw new DerError(`expected tag 0x${expectTag.toString(16)} at ${pos}, found 0x${tag.toString(16)}`);
  }
  const {len, lengthBytes} = readLength(buf, pos + 1, limit);
  const headerLen = 1 + lengthBytes;
  const contentStart = pos + headerLen;
  const end = contentStart + len;
  if (end > limit) throw new DerError(`element at ${pos} declares ${len} bytes; only ${limit - contentStart} remain`);
  return {tag, start: pos, contentStart, end};
}

/** The children of a constructed element, each required to end inside it. */
export function children(buf: Uint8Array, parent: Tlv, max = 64): Tlv[] {
  const out: Tlv[] = [];
  let p = parent.contentStart;
  while (p < parent.end) {
    if (out.length >= max) throw new DerError(`more than ${max} children at ${parent.start}`);
    const c = readTlv(buf, p, parent.end);
    out.push(c);
    p = c.end;
  }
  if (p !== parent.end) throw new DerError(`children of the element at ${parent.start} overrun it`);
  return out;
}

const eq = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
const hex = (s: string) => Uint8Array.from(s.match(/../g)!.map(h => parseInt(h, 16)));

export const OID = {
  ecdsaWithSha256: hex('2a8648ce3d040302'),
  ecdsaWithSha384: hex('2a8648ce3d040303'),
  ecPublicKey: hex('2a8648ce3d0201'),
  prime256v1: hex('2a8648ce3d030107'),
  secp384r1: hex('2b81040022'),
  appleNonce: hex('2a864886f763640802'),
  appleAppId: hex('2a864886f763640805'),
} as const;

export interface Certificate {
  /** The whole TBSCertificate element, tag and length included -- what was signed. */
  tbs: Uint8Array;
  /** The signature algorithm OID's content bytes. */
  signatureAlgorithm: Uint8Array;
  /** The DER `ECDSA-Sig-Value` from inside the BIT STRING. */
  signature: Uint8Array;
}

export function parseCertificate(der: Uint8Array): Certificate {
  const outer = readTlv(der, 0, der.length, 0x30);
  if (outer.end !== der.length) throw new DerError('bytes after the certificate');
  const [tbs, alg, sig, ...rest] = children(der, outer, 4);
  if (!tbs || !alg || !sig || rest.length > 0) throw new DerError('a certificate is SEQUENCE {tbs, algorithm, signature}');
  if (tbs.tag !== 0x30 || alg.tag !== 0x30 || sig.tag !== 0x03) throw new DerError('certificate fields have the wrong tags');
  const algOid = readTlv(der, alg.contentStart, alg.end, 0x06);
  // ECDSA algorithm identifiers carry no parameters (RFC 5758 3.2).
  if (algOid.end !== alg.end) throw new DerError('ECDSA algorithm identifier with parameters');
  if (der[sig.contentStart] !== 0x00) throw new DerError('signature BIT STRING has unused bits');
  return {
    tbs: der.slice(tbs.start, tbs.end),
    signatureAlgorithm: der.slice(algOid.contentStart, algOid.end),
    signature: der.slice(sig.contentStart + 1, sig.end),
  };
}

export interface TbsFields {
  /** The SubjectPublicKeyInfo's curve OID content bytes. */
  curve: Uint8Array;
  /** The uncompressed point X || Y (without the 0x04 marker). */
  publicKey: Uint8Array;
  /** extnID content bytes -> extnValue content bytes. */
  extensions: Map<string, Uint8Array>;
}

/**
 * Walk a TBSCertificate: [0] version, serial, signature, issuer, validity,
 * subject, SubjectPublicKeyInfo, then optional [3] extensions.
 */
export function parseTbs(tbs: Uint8Array): TbsFields {
  const outer = readTlv(tbs, 0, tbs.length, 0x30);
  if (outer.end !== tbs.length) throw new DerError('bytes after the TBS');
  const f = children(tbs, outer, 12);
  if (f.length < 7 || f[0].tag !== 0xa0) throw new DerError('TBS is not an X.509 v3 TBSCertificate');
  const spki = f[6];
  if (spki.tag !== 0x30) throw new DerError('SubjectPublicKeyInfo is not a SEQUENCE');
  const [algId, bitString] = children(tbs, spki, 2);
  if (!algId || !bitString || algId.tag !== 0x30 || bitString.tag !== 0x03) {
    throw new DerError('SubjectPublicKeyInfo is not {AlgorithmIdentifier, BIT STRING}');
  }
  const [keyType, curve] = children(tbs, algId, 2);
  if (!keyType || !curve || keyType.tag !== 0x06 || curve.tag !== 0x06) {
    throw new DerError('public key algorithm is not {OID, OID}');
  }
  if (!eq(tbs.slice(keyType.contentStart, keyType.end), OID.ecPublicKey)) {
    throw new DerError('public key is not an EC key');
  }
  if (tbs[bitString.contentStart] !== 0x00 || tbs[bitString.contentStart + 1] !== 0x04) {
    throw new DerError('public key is not an uncompressed point');
  }
  const publicKey = tbs.slice(bitString.contentStart + 2, bitString.end);

  const extensions = new Map<string, Uint8Array>();
  const extWrapper = f.slice(7).find(x => x.tag === 0xa3);
  if (extWrapper) {
    const [list, more] = children(tbs, extWrapper, 2);
    if (!list || more || list.tag !== 0x30) throw new DerError('[3] does not hold one SEQUENCE OF Extension');
    for (const ext of children(tbs, list, 32)) {
      const parts = children(tbs, ext, 3);
      const id = parts[0];
      const value = parts[parts.length - 1];
      if (!id || id.tag !== 0x06 || value.tag !== 0x04 || parts.length < 2) {
        throw new DerError(`extension at ${ext.start} is not {OID, [critical], OCTET STRING}`);
      }
      const key = toHex(tbs.slice(id.contentStart, id.end));
      if (extensions.has(key)) throw new DerError(`extension ${key} appears twice`);
      extensions.set(key, tbs.slice(value.contentStart, value.end));
    }
  }
  return {curve: tbs.slice(curve.contentStart, curve.end), publicKey, extensions};
}

/** Apple's nonce extension value: SEQUENCE { [1] { OCTET STRING (32) } }. */
export function appleNonce(fields: TbsFields): Uint8Array {
  const v = fields.extensions.get(toHex(OID.appleNonce));
  if (!v) throw new DerError('credential certificate has no nonce extension (1.2.840.113635.100.8.2)');
  const seq = readTlv(v, 0, v.length, 0x30);
  if (seq.end !== v.length) throw new DerError('bytes after the nonce SEQUENCE');
  const ctx = readTlv(v, seq.contentStart, seq.end, 0xa1);
  const oct = readTlv(v, ctx.contentStart, ctx.end, 0x04);
  if (ctx.end !== seq.end || oct.end !== ctx.end || oct.end - oct.contentStart !== 32) {
    throw new DerError('nonce extension is not one 32-byte OCTET STRING');
  }
  return v.slice(oct.contentStart, oct.end);
}

/**
 * The App ID inside Apple's 8.5 extension: item [1204] (tag BF 89 34) holding
 * an OCTET STRING. Undocumented by Apple; read from real certificates (the
 * circuit's README, and Apple's own sample in the attestation-object
 * validation guide). Items use one-byte (A4) or three-byte (BF xx xx) tags.
 */
export function appleAppId(fields: TbsFields): string {
  const v = fields.extensions.get(toHex(OID.appleAppId));
  if (!v) throw new DerError('credential certificate has no App ID extension (1.2.840.113635.100.8.5)');
  const seq = readTlv(v, 0, v.length, 0x30);
  if (seq.end !== v.length) throw new DerError('bytes after the App ID SEQUENCE');
  let p = seq.contentStart;
  const found: string[] = [];
  let items = 0;
  while (p < seq.end) {
    if (++items > 32) throw new DerError('App ID extension has too many items');
    let tagLen = 1;
    if ((v[p] & 0x1f) === 0x1f) {
      if (p + 3 > seq.end || (v[p + 1] & 0x80) === 0 || (v[p + 2] & 0x80) !== 0) {
        throw new DerError(`unsupported tag form in the App ID extension at ${p}`);
      }
      tagLen = 3;
    }
    const {len, lengthBytes} = readLength(v, p + tagLen, seq.end);
    const contentStart = p + tagLen + lengthBytes;
    const end = contentStart + len;
    if (end > seq.end) throw new DerError(`App ID item at ${p} overruns its extension`);
    if (tagLen === 3 && v[p] === 0xbf && v[p + 1] === 0x89 && v[p + 2] === 0x34) {
      const oct = readTlv(v, contentStart, end, 0x04);
      if (oct.end !== end) throw new DerError('App ID item is not one OCTET STRING');
      found.push(String.fromCharCode(...v.slice(oct.contentStart, oct.end)));
    }
    p = end;
  }
  if (found.length !== 1) throw new DerError(`App ID extension holds ${found.length} App ID items; exactly one is required`);
  return found[0];
}

/**
 * An `ECDSA-Sig-Value` (SEQUENCE {INTEGER r, INTEGER s}) as fixed-width
 * r || s, with s replaced by n - s when it is in the upper half.
 *
 * Both of the circuit's verifiers refuse a high s (noir-ecdsa for P-384, the
 * Barretenberg black box for P-256), while Apple's signatures are not
 * normalised. n - s is the same signature: (r, s) and (r, n - s) verify under
 * the same key for the same message.
 */
export function ecdsaDerToLowS(der: Uint8Array, size: number, n: bigint): Uint8Array {
  const seq = readTlv(der, 0, der.length, 0x30);
  if (seq.end !== der.length) throw new DerError('bytes after the ECDSA signature');
  const ints = children(der, seq, 2);
  if (ints.length !== 2) throw new DerError('an ECDSA signature is SEQUENCE {r, s}');
  const [r, s] = ints.map(t => {
    if (t.tag !== 0x02) throw new DerError('ECDSA signature component is not an INTEGER');
    const body = der.slice(t.contentStart, t.end);
    if (body.length === 0) throw new DerError('empty INTEGER');
    if (body[0] & 0x80) throw new DerError('negative INTEGER in an ECDSA signature');
    if (body.length > 1 && body[0] === 0 && (body[1] & 0x80) === 0) throw new DerError('non-minimal INTEGER');
    const v = BigInt('0x' + toHex(body));
    if (v === 0n || v >= n) throw new DerError('ECDSA signature component out of range');
    return v;
  });
  const low = s > n / 2n ? n - s : s;
  return Uint8Array.from([...toFixed(r, size), ...toFixed(low, size)]);
}

export function toFixed(v: bigint, size: number): Uint8Array {
  const h = v.toString(16).padStart(size * 2, '0');
  if (h.length > size * 2) throw new DerError(`integer does not fit in ${size} bytes`);
  return hexToBytes(h);
}

export function toHex(b: Uint8Array): string {
  let s = '';
  for (const x of b) s += x.toString(16).padStart(2, '0');
  return s;
}

export function hexToBytes(h: string): Uint8Array {
  const clean = h.startsWith('0x') ? h.slice(2) : h;
  if (clean.length % 2 !== 0 || /[^0-9a-fA-F]/.test(clean)) throw new Error(`not a hex string: ${h}`);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export {eq as bytesEqual};
