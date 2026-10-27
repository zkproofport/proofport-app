/**
 * The CBOR reader takes App Attest's two objects and refuses everything else
 * quickly -- in particular a declared length larger than the input, which must
 * fail before any allocation (a "length bomb").
 */
import {decodeCbor, CborError} from '../cbor';
import {decodeAssertion, decodeAttestationObject} from '../appAttestObjects';
import {AppAttestError} from '../appAttestError';
import {APP_ATTEST_APP_ID} from '../constants';
import {cbor} from './syntheticAppAttest';

const L = {maxBytes: 4096, maxDepth: 4, maxItems: 16};
const bytes = (...b: number[]) => new Uint8Array(b);

describe('decodeCbor', () => {
  it('reads the shapes App Attest uses', () => {
    const v = decodeCbor(cbor(new Map<string, unknown>([['fmt', 'apple-appattest'], ['x5c', [new Uint8Array([1, 2])]], ['n', 300]])), L);
    expect(v).toBeInstanceOf(Map);
    const m = v as Map<string, unknown>;
    expect(m.get('fmt')).toBe('apple-appattest');
    expect(m.get('n')).toBe(300);
    expect(Array.from((m.get('x5c') as Uint8Array[])[0])).toEqual([1, 2]);
  });

  it('refuses a byte string that declares 2^32 - 1 bytes, without allocating them', () => {
    const t = Date.now();
    expect(() => decodeCbor(bytes(0x5a, 0xff, 0xff, 0xff, 0xff, 0x00), L)).toThrow(/needs 4294967295 bytes/);
    expect(Date.now() - t).toBeLessThan(50);
  });

  it('refuses an 8-byte length beyond 2^53 and one that merely overruns', () => {
    expect(() => decodeCbor(bytes(0x5b, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff), L)).toThrow(/2\^53/);
    expect(() => decodeCbor(bytes(0x5b, 0, 0, 0, 1, 0, 0, 0, 0), L)).toThrow(/needs/);
  });

  it('refuses an array count larger than the input or the limit', () => {
    expect(() => decodeCbor(bytes(0x8f, 0x01), L)).toThrow(/needs 15 bytes/);
    expect(() => decodeCbor(bytes(0x98, 0x20, ...new Array(32).fill(0)), L)).toThrow(/at most 16/);
  });

  it('refuses nesting deeper than the limit', () => {
    expect(() => decodeCbor(bytes(0x81, 0x81, 0x81, 0x81, 0x81, 0x01), L)).toThrow(/nesting/);
  });

  it('refuses indefinite lengths, tags, negative integers and floats', () => {
    expect(() => decodeCbor(bytes(0x5f, 0x41, 0x00, 0xff), L)).toThrow(/indefinite/);
    expect(() => decodeCbor(bytes(0xc0, 0x00), L)).toThrow(/major type 6/);
    expect(() => decodeCbor(bytes(0x20), L)).toThrow(/major type 1/);
    expect(() => decodeCbor(bytes(0xf9, 0x3c, 0x00), L)).toThrow(/major type 7/);
  });

  it('refuses duplicate and non-text map keys', () => {
    expect(() => decodeCbor(bytes(0xa2, 0x61, 0x61, 0x01, 0x61, 0x61, 0x02), L)).toThrow(/duplicate map key 'a'/);
    expect(() => decodeCbor(bytes(0xa1, 0x01, 0x02), L)).toThrow(/not a text string/);
  });

  it('refuses trailing bytes, empty input and oversize input', () => {
    expect(() => decodeCbor(bytes(0x01, 0x02), L)).toThrow(/trailing/);
    expect(() => decodeCbor(new Uint8Array(0), L)).toThrow(/empty/);
    expect(() => decodeCbor(new Uint8Array(5000), L)).toThrow(/at most 4096/);
  });

  it('refuses non-minimal lengths and invalid UTF-8', () => {
    expect(() => decodeCbor(bytes(0x58, 0x01, 0x00), L)).toThrow(/non-minimal/);
    expect(() => decodeCbor(bytes(0x62, 0xc0, 0x80), L)).toThrow(/UTF-8/);
    expect(() => decodeCbor(bytes(0x63, 0xed, 0xa0, 0x80), L)).toThrow(/UTF-8/);
  });

  it('reads Korean and emoji text intact', () => {
    expect(decodeCbor(cbor('증명 🔐'), L)).toBe('증명 🔐');
  });
});

describe('the App Attest decoders report CBOR damage as E2014', () => {
  const code = (f: () => unknown) => {
    try {
      f();
    } catch (e) {
      return e instanceof AppAttestError ? e.code : (e as Error).name;
    }
    return 'no error';
  };

  it('for an attestation object', () => {
    expect(code(() => decodeAttestationObject(bytes(0x5a, 0xff, 0xff, 0xff, 0xff), 'AAAA', new Uint8Array(32), APP_ATTEST_APP_ID))).toBe('E2014');
    expect(code(() => decodeAttestationObject(cbor(new Map([['fmt', 'packed']])), 'AAAA', new Uint8Array(32), APP_ATTEST_APP_ID))).toBe('E2014');
    expect(code(() => decodeAttestationObject(cbor(new Map<string, unknown>([['fmt', 'apple-appattest'], ['attStmt', new Map([['x5c', []]])], ['authData', new Uint8Array(1)]])), 'AAAA', new Uint8Array(32), APP_ATTEST_APP_ID))).toBe('E2014');
    expect(code(() => decodeAttestationObject(new Uint8Array(20000), 'AAAA', new Uint8Array(32), APP_ATTEST_APP_ID))).toBe('E2014');
  });

  it('for an assertion', () => {
    expect(code(() => decodeAssertion(bytes(0xa0), APP_ATTEST_APP_ID))).toBe('E2014');
    expect(code(() => decodeAssertion(cbor(new Map<string, unknown>([['signature', new Uint8Array(70)], ['authenticatorData', new Uint8Array(129)]])), APP_ATTEST_APP_ID))).toBe('E2014');
    expect(code(() => decodeAssertion(new Uint8Array(2048), APP_ATTEST_APP_ID))).toBe('E2014');
  });
});

it('CborError is what the reader throws', () => {
  expect(() => decodeCbor(bytes(0xff), L)).toThrow(CborError);
});
