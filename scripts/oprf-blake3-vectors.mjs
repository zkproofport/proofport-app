// BLAKE3 vectors for src/oprf/blake3.ts, from an independent implementation
// (@noble/hashes, a dependency of this app). Inputs follow the official test
// vector pattern (byte i = i mod 251) at the chunk and tree boundaries; each
// output is 131 bytes of the extendable output, as in the official vectors.
// Called by scripts/generate-oprf-wire-vectors.sh; prints JSON.
import {blake3} from '@noble/hashes/blake3.js';

const LENGTHS = [0, 1, 63, 64, 65, 127, 128, 1023, 1024, 1025, 2048, 2049, 3072, 3073, 4096, 4097, 5120, 5121, 8192, 8193, 16384, 31744, 102400];
const hex = b => Buffer.from(b).toString('hex');
const cases = LENGTHS.map(n => {
  const input = Uint8Array.from({length: n}, (_, i) => i % 251);
  return {length: n, hash: hex(blake3(input, {dkLen: 131}))};
});
process.stdout.write(JSON.stringify({generator: '@noble/hashes blake3', pattern: 'byte i = i mod 251', dkLen: 131, cases}));
