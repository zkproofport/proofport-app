/**
 * A bounded CBOR (RFC 8949) reader for the two objects App Attest returns.
 *
 * The attestation object is `{fmt, attStmt: {x5c: [bytes...], receipt}, authData}`
 * and the assertion is `{signature, authenticatorData}` (Apple, "Validating apps
 * that connect to your server"). Both use only definite-length maps, arrays,
 * byte strings, text strings and small unsigned integers, so that is all this
 * reads. Everything else -- indefinite lengths, tags, floats, negative
 * integers, simple values -- is refused rather than skipped, because a parser
 * that guesses is where two readers come to disagree about one message.
 *
 * Why not a dependency: the app has no CBOR library, the subset is small, and
 * every length here is checked against the bytes that remain BEFORE anything
 * is allocated, which is the property that matters for hostile input (a
 * declared length of 2^64 must fail at once, not try to allocate it).
 */

export type CborValue =
  | number
  | string
  | Uint8Array
  | CborValue[]
  | Map<string, CborValue>;

export interface CborLimits {
  /** Refuse an input longer than this before reading a byte. */
  maxBytes: number;
  /** Refuse nesting deeper than this. */
  maxDepth: number;
  /** Refuse an array or map with more entries than this. */
  maxItems: number;
}

export class CborError extends Error {
  constructor(message: string) {
    super(`CBOR: ${message}`);
    this.name = 'CborError';
  }
}

const MAJOR_UINT = 0;
const MAJOR_BYTES = 2;
const MAJOR_TEXT = 3;
const MAJOR_ARRAY = 4;
const MAJOR_MAP = 5;

/**
 * Decode exactly one CBOR item that fills `bytes` completely.
 *
 * Map keys must be text strings and unique: App Attest's maps are keyed by
 * name, and a duplicate key is the classic way to show two parsers two
 * different objects.
 */
export function decodeCbor(bytes: Uint8Array, limits: CborLimits): CborValue {
  if (!(bytes instanceof Uint8Array)) {
    throw new CborError('input is not a byte array');
  }
  if (bytes.length === 0) {
    throw new CborError('input is empty');
  }
  if (bytes.length > limits.maxBytes) {
    throw new CborError(`input is ${bytes.length} bytes; at most ${limits.maxBytes} are accepted`);
  }
  let pos = 0;

  const need = (n: number, what: string) => {
    if (n < 0 || pos + n > bytes.length) {
      throw new CborError(`${what} needs ${n} bytes at offset ${pos}; ${bytes.length - pos} remain`);
    }
  };

  /** The argument of a head byte; never more than 2^53 - 1. */
  const readArgument = (info: number): number => {
    if (info < 24) return info;
    if (info === 24) {
      need(1, 'a 1-byte length');
      const v = bytes[pos];
      pos += 1;
      if (v < 24) throw new CborError(`non-minimal 1-byte argument ${v}`);
      return v;
    }
    if (info === 25) {
      need(2, 'a 2-byte length');
      const v = (bytes[pos] << 8) | bytes[pos + 1];
      pos += 2;
      if (v < 0x100) throw new CborError(`non-minimal 2-byte argument ${v}`);
      return v;
    }
    if (info === 26) {
      need(4, 'a 4-byte length');
      const v = ((bytes[pos] << 24) >>> 0) + ((bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3]);
      pos += 4;
      if (v < 0x10000) throw new CborError(`non-minimal 4-byte argument ${v}`);
      return v;
    }
    if (info === 27) {
      need(8, 'an 8-byte length');
      const hi = ((bytes[pos] << 24) >>> 0) + ((bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3]);
      const lo = ((bytes[pos + 4] << 24) >>> 0) + ((bytes[pos + 5] << 16) | (bytes[pos + 6] << 8) | bytes[pos + 7]);
      pos += 8;
      // Anything this large is longer than the input by construction; say so
      // without building a number JavaScript cannot hold exactly.
      if (hi >= 0x200000) {
        throw new CborError('an 8-byte argument larger than 2^53 - 1');
      }
      const v = hi * 0x100000000 + lo;
      if (v <= 0xffffffff) throw new CborError(`non-minimal 8-byte argument ${v}`);
      return v;
    }
    if (info === 31) throw new CborError('indefinite lengths are not accepted');
    throw new CborError(`reserved additional information ${info}`);
  };

  const readItem = (depth: number): CborValue => {
    if (depth > limits.maxDepth) {
      throw new CborError(`nesting deeper than ${limits.maxDepth}`);
    }
    need(1, 'an item head');
    const head = bytes[pos];
    pos += 1;
    const major = head >> 5;
    const info = head & 0x1f;
    switch (major) {
      case MAJOR_UINT:
        return readArgument(info);
      case MAJOR_BYTES: {
        const len = readArgument(info);
        need(len, 'a byte string');
        const out = bytes.slice(pos, pos + len);
        pos += len;
        return out;
      }
      case MAJOR_TEXT: {
        const len = readArgument(info);
        need(len, 'a text string');
        const out = utf8(bytes.subarray(pos, pos + len));
        pos += len;
        return out;
      }
      case MAJOR_ARRAY: {
        const count = readArgument(info);
        if (count > limits.maxItems) throw new CborError(`array of ${count} items; at most ${limits.maxItems}`);
        // Every item takes at least one byte, so a count beyond the remaining
        // bytes is a lie that would otherwise loop until it hits the end.
        need(count, 'an array');
        const out: CborValue[] = [];
        for (let i = 0; i < count; i++) out.push(readItem(depth + 1));
        return out;
      }
      case MAJOR_MAP: {
        const count = readArgument(info);
        if (count > limits.maxItems) throw new CborError(`map of ${count} entries; at most ${limits.maxItems}`);
        need(count * 2, 'a map');
        const out = new Map<string, CborValue>();
        for (let i = 0; i < count; i++) {
          const key = readItem(depth + 1);
          if (typeof key !== 'string') throw new CborError('a map key that is not a text string');
          if (out.has(key)) throw new CborError(`duplicate map key '${key}'`);
          out.set(key, readItem(depth + 1));
        }
        return out;
      }
      default:
        throw new CborError(`major type ${major} is not accepted`);
    }
  };

  const value = readItem(0);
  if (pos !== bytes.length) {
    throw new CborError(`${bytes.length - pos} trailing bytes after the item`);
  }
  return value;
}

/** Strict UTF-8: an invalid sequence is an error, not a replacement character. */
function utf8(b: Uint8Array): string {
  let out = '';
  let i = 0;
  while (i < b.length) {
    const c = b[i];
    let cp: number;
    let extra: number;
    if (c < 0x80) {
      cp = c;
      extra = 0;
    } else if (c >= 0xc2 && c < 0xe0) {
      cp = c & 0x1f;
      extra = 1;
    } else if (c >= 0xe0 && c < 0xf0) {
      cp = c & 0x0f;
      extra = 2;
    } else if (c >= 0xf0 && c < 0xf5) {
      cp = c & 0x07;
      extra = 3;
    } else {
      throw new CborError(`invalid UTF-8 lead byte 0x${c.toString(16)}`);
    }
    for (let k = 1; k <= extra; k++) {
      const n = b[i + k];
      if (n === undefined || (n & 0xc0) !== 0x80) throw new CborError('invalid UTF-8 continuation byte');
      cp = (cp << 6) | (n & 0x3f);
    }
    const min = [0, 0x80, 0x800, 0x10000][extra];
    if (cp < min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) {
      throw new CborError('overlong or out-of-range UTF-8');
    }
    out += String.fromCodePoint(cp);
    i += extra + 1;
  }
  return out;
}

/** Read a map entry that must be a byte string. */
export function cborBytes(map: Map<string, CborValue>, key: string, what: string): Uint8Array {
  const v = map.get(key);
  if (!(v instanceof Uint8Array)) {
    throw new CborError(`${what}: '${key}' is missing or not a byte string`);
  }
  return v;
}

/** Narrow a decoded value to a map, naming what was expected. */
export function cborMap(v: CborValue, what: string): Map<string, CborValue> {
  if (!(v instanceof Map)) throw new CborError(`${what} is not a map`);
  return v;
}
