/**
 * src/oprf/blake3.ts against @noble/hashes' BLAKE3 (an independent
 * implementation), at the single-block, chunk and tree boundaries, 131 bytes
 * of extendable output each (scripts/generate-oprf-wire-vectors.sh).
 */
import {blake3} from '../blake3';
import vectors from './fixtures/oprf-wire-vectors.json';

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

describe('blake3', () => {
  it.each(vectors.blake3.cases.map(c => [c.length, c.hash]))('input of %i bytes', (length, hash) => {
    const input = Uint8Array.from({length: length as number}, (_, i) => i % 251);
    expect(hex(blake3(input, 131))).toBe(hash);
  });

  it('a prefix of a longer output is the shorter output', () => {
    const input = Uint8Array.of(1, 2, 3);
    expect(hex(blake3(input, 131)).slice(0, 128)).toBe(hex(blake3(input, 64)));
  });

  it('refuses a non-byte input and a negative length', () => {
    expect(() => blake3('abc' as unknown as Uint8Array)).toThrow('Uint8Array');
    expect(() => blake3(new Uint8Array(1), -1)).toThrow('non-negative');
  });
});
