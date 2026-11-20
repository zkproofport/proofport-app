/**
 * BLAKE3 (hash mode, extendable output), no dependencies.
 *
 * The OPRF nodes combine their two nonce commitments with a BLAKE3 hash
 * (taceo-oprf-core 0.6.3, ddlog_equality.rs `combine_two_nonce_randomness`),
 * so the client must compute the same hash to rebuild the Chaum-Pedersen
 * challenge (src/oprf/shamir.ts). Written here rather than imported because
 * the app's BLAKE3 package ships as ES modules only, which this app's jest
 * setup does not load; held to that package's output by
 * __tests__/fixtures/oprf-wire-vectors.json (`blake3`), across the chunk and
 * tree boundaries.
 *
 * Spec: https://github.com/BLAKE3-team/BLAKE3-specs (hash mode only; no keyed
 * hash or key derivation).
 */

const IV = Uint32Array.of(
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
);
const MSG_PERMUTATION = [2, 6, 3, 10, 7, 0, 4, 13, 1, 11, 12, 5, 9, 14, 15, 8];

const CHUNK_START = 1;
const CHUNK_END = 2;
const PARENT = 4;
const ROOT = 8;

const BLOCK_LEN = 64;
const CHUNK_LEN = 1024;

const rotr = (x: number, n: number): number => ((x >>> n) | (x << (32 - n))) >>> 0;

function g(s: Uint32Array, a: number, b: number, c: number, d: number, mx: number, my: number): void {
  s[a] = (s[a] + s[b] + mx) >>> 0;
  s[d] = rotr(s[d] ^ s[a], 16);
  s[c] = (s[c] + s[d]) >>> 0;
  s[b] = rotr(s[b] ^ s[c], 12);
  s[a] = (s[a] + s[b] + my) >>> 0;
  s[d] = rotr(s[d] ^ s[a], 8);
  s[c] = (s[c] + s[d]) >>> 0;
  s[b] = rotr(s[b] ^ s[c], 7);
}

/** The full 16-word compression output. */
function compress(cv: Uint32Array, block: Uint32Array, counter: number, blockLen: number, flags: number): Uint32Array {
  const s = new Uint32Array(16);
  s.set(cv, 0);
  s.set(IV.subarray(0, 4), 8);
  s[12] = counter >>> 0;
  s[13] = Math.floor(counter / 0x100000000) >>> 0;
  s[14] = blockLen;
  s[15] = flags;
  let m = Uint32Array.from(block);
  for (let round = 0; round < 7; round++) {
    g(s, 0, 4, 8, 12, m[0], m[1]);
    g(s, 1, 5, 9, 13, m[2], m[3]);
    g(s, 2, 6, 10, 14, m[4], m[5]);
    g(s, 3, 7, 11, 15, m[6], m[7]);
    g(s, 0, 5, 10, 15, m[8], m[9]);
    g(s, 1, 6, 11, 12, m[10], m[11]);
    g(s, 2, 7, 8, 13, m[12], m[13]);
    g(s, 3, 4, 9, 14, m[14], m[15]);
    if (round < 6) m = Uint32Array.from(MSG_PERMUTATION, i => m[i]);
  }
  for (let i = 0; i < 8; i++) {
    s[i] = (s[i] ^ s[i + 8]) >>> 0;
    s[i + 8] = (s[i + 8] ^ cv[i]) >>> 0;
  }
  return s;
}

function wordsFromBlock(bytes: Uint8Array, offset: number, len: number): Uint32Array {
  const block = new Uint8Array(BLOCK_LEN);
  block.set(bytes.subarray(offset, offset + len));
  const w = new Uint32Array(16);
  for (let i = 0; i < 16; i++) {
    w[i] = (block[4 * i] | (block[4 * i + 1] << 8) | (block[4 * i + 2] << 16) | (block[4 * i + 3] << 24)) >>> 0;
  }
  return w;
}

/** What is needed to produce a node's chaining value, or the root's output. */
interface Output {
  cv: Uint32Array;
  block: Uint32Array;
  counter: number;
  blockLen: number;
  flags: number;
}

const chainingValue = (o: Output): Uint32Array => compress(o.cv, o.block, o.counter, o.blockLen, o.flags).subarray(0, 8);

/** The Output of one chunk (up to 1024 bytes) at `chunkIndex`. */
function chunkOutput(input: Uint8Array, start: number, len: number, chunkIndex: number): Output {
  let cv = IV.slice();
  const blocks = Math.max(1, Math.ceil(len / BLOCK_LEN));
  for (let b = 0; b < blocks - 1; b++) {
    const flags = b === 0 ? CHUNK_START : 0;
    cv = compress(cv, wordsFromBlock(input, start + b * BLOCK_LEN, BLOCK_LEN), chunkIndex, BLOCK_LEN, flags).slice(0, 8);
  }
  const lastLen = len - (blocks - 1) * BLOCK_LEN;
  return {
    cv,
    block: wordsFromBlock(input, start + (blocks - 1) * BLOCK_LEN, lastLen),
    counter: chunkIndex,
    blockLen: lastLen,
    flags: CHUNK_END | (blocks === 1 ? CHUNK_START : 0),
  };
}

function parentOutput(left: Uint32Array, right: Uint32Array): Output {
  const block = new Uint32Array(16);
  block.set(left, 0);
  block.set(right, 8);
  return {cv: IV.slice(), block, counter: 0, blockLen: BLOCK_LEN, flags: PARENT};
}

/** BLAKE3 of `input`, `outLen` bytes of extendable output (default 32). */
export function blake3(input: Uint8Array, outLen = 32): Uint8Array {
  if (!(input instanceof Uint8Array)) throw new Error('blake3 input must be a Uint8Array.');
  if (!Number.isSafeInteger(outLen) || outLen < 0) throw new Error(`blake3 output length must be a non-negative integer, got ${outLen}.`);
  const chunks = Math.max(1, Math.ceil(input.length / CHUNK_LEN));
  // The spec's incremental tree: a stack of subtree chaining values, merged
  // whenever the number of completed chunks says a subtree is complete. The
  // last chunk is not merged here: it ends at the root (or under it).
  const stack: Uint32Array[] = [];
  for (let i = 0; i < chunks - 1; i++) {
    let cv = chainingValue(chunkOutput(input, i * CHUNK_LEN, CHUNK_LEN, i));
    let total = i + 1;
    while ((total & 1) === 0) {
      cv = chainingValue(parentOutput(stack.pop() as Uint32Array, cv));
      total >>= 1;
    }
    stack.push(cv);
  }
  const lastStart = (chunks - 1) * CHUNK_LEN;
  let output = chunkOutput(input, lastStart, input.length - lastStart, chunks - 1);
  while (stack.length > 0) {
    output = parentOutput(stack.pop() as Uint32Array, chainingValue(output));
  }
  const out = new Uint8Array(outLen);
  for (let block = 0, pos = 0; pos < outLen; block++) {
    const words = compress(output.cv, output.block, block, output.blockLen, output.flags | ROOT);
    for (let w = 0; w < 16 && pos < outLen; w++) {
      for (let b = 0; b < 4 && pos < outLen; b++) out[pos++] = (words[w] >>> (8 * b)) & 0xff;
    }
  }
  return out;
}
