/**
 * The Android signer's inputs as data: their type, their `fn main` order and
 * how they flatten. Pure (no react-native, no native module), so the input
 * builders and their tests can use it without a phone; the signing itself is
 * androidSigner.ts.
 */

/** The Android packages' signer inputs, in their `fn main` order after `statement_sig`. */
export interface AndroidSignerInputs {
  variant: 'android';
  statement_sig: Uint8Array;
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
}

/** `fn main` parameter names of the Android signer, in order (both packages). */
export const ANDROID_SIGNER_ABI_PARAMETERS = Object.freeze([
  'statement_sig',
  'ca2_tbs', 'ca2_tbs_len', 'ca2_sig',
  'ca3_tbs', 'ca3_tbs_len', 'ca3_sig',
  'att_tbs', 'att_tbs_len', 'att_sig',
  'leaf_tbs', 'leaf_tbs_len', 'leaf_sig',
] as const);

/** Flattened values the Android signer adds: 64 + (600+1+96) + (768+1+96) + (512+1+64) + (1024+1+64). */
export const ANDROID_SIGNER_FLAT_COUNT = 3292;

export function isAndroidSignerInputs(v: unknown): v is AndroidSignerInputs {
  return typeof v === 'object' && v !== null && (v as {variant?: unknown}).variant === 'android';
}

/**
 * The factory packages' signer inputs (`*_android_factory`), in their
 * `fn main` order: statement_sig, the FactoryChain, the Play Integrity
 * verdict, then the two pinned-by-hash prover inputs (Google's RSA root and
 * our Play verification key).
 */
export interface AndroidFactorySignerInputs {
  variant: 'android_factory';
  statement_sig: Uint8Array;
  ik_tbs: Uint8Array;
  ik_tbs_len: number;
  ik_sig: bigint[];
  batch_tbs: Uint8Array;
  batch_tbs_len: number;
  batch_sig: Uint8Array;
  leaf_tbs: Uint8Array;
  leaf_tbs_len: number;
  leaf_sig: Uint8Array;
  integrity_payload_b64: Uint8Array;
  integrity_payload_b64_len: number;
  integrity_signature: Uint8Array;
  rsa_root_modulus: bigint[];
  rsa_root_redc: bigint[];
  play_integrity_key: Uint8Array;
}

export const ANDROID_FACTORY_SIGNER_ABI_PARAMETERS = Object.freeze([
  'statement_sig',
  'ik_tbs', 'ik_tbs_len', 'ik_sig',
  'batch_tbs', 'batch_tbs_len', 'batch_sig',
  'leaf_tbs', 'leaf_tbs_len', 'leaf_sig',
  'integrity_payload_b64', 'integrity_payload_b64_len', 'integrity_signature',
  'rsa_root_modulus', 'rsa_root_redc', 'play_integrity_key',
] as const);

/** 64 + (512+1+35) + (512+1+96) + (1024+1+64) + (1368+1+64) + 35 + 35 + 64. */
export const ANDROID_FACTORY_SIGNER_FLAT_COUNT = 3877;

export function isAndroidFactorySignerInputs(v: unknown): v is AndroidFactorySignerInputs {
  return typeof v === 'object' && v !== null && (v as {variant?: unknown}).variant === 'android_factory';
}

export type AnyAndroidSignerInputs = AndroidSignerInputs | AndroidFactorySignerInputs;

/** The Android phone's Coinbase KYC v2 statement: the clientData, signed by an attested Keystore key. */
export interface AndroidStatementWitness {
  variant: 'android' | 'android_factory';
  clientData: Uint8Array;
  attestedAt: number;
  signer: AnyAndroidSignerInputs;
}

export function isAndroidStatementWitness(w: unknown): w is AndroidStatementWitness {
  const v = (w as {variant?: unknown} | null)?.variant;
  return typeof w === 'object' && w !== null && (v === 'android' || v === 'android_factory');
}

/**
 * The signer inputs as the flat values bb reads, in ABI order, each byte or
 * length rendered by `render` (the OIDC builder writes decimals, the Coinbase
 * builder 0x-hex).
 */
export function flattenAndroidSigner(
  s: AndroidSignerInputs,
  byte: (b: number) => string,
  length: (n: number) => string,
): string[] {
  const bytes = (b: Uint8Array, n: number, what: string) => {
    if (b.length !== n) throw new Error(`${what} is ${b.length} bytes; the circuit takes ${n}`);
    return Array.from(b, byte);
  };
  const flat = [
    ...bytes(s.statement_sig, 64, 'statement_sig'),
    ...bytes(s.ca2_tbs, 600, 'ca2_tbs'), length(s.ca2_tbs_len), ...bytes(s.ca2_sig, 96, 'ca2_sig'),
    ...bytes(s.ca3_tbs, 768, 'ca3_tbs'), length(s.ca3_tbs_len), ...bytes(s.ca3_sig, 96, 'ca3_sig'),
    ...bytes(s.att_tbs, 512, 'att_tbs'), length(s.att_tbs_len), ...bytes(s.att_sig, 64, 'att_sig'),
    ...bytes(s.leaf_tbs, 1024, 'leaf_tbs'), length(s.leaf_tbs_len), ...bytes(s.leaf_sig, 64, 'leaf_sig'),
  ];
  if (flat.length !== ANDROID_SIGNER_FLAT_COUNT) {
    throw new Error(`Android signer flattened to ${flat.length} values; the circuit takes ${ANDROID_SIGNER_FLAT_COUNT}`);
  }
  return flat;
}

/** The factory signer inputs flattened in ABI order; `limb` renders a u128 limb. */
export function flattenAndroidFactorySigner(
  s: AndroidFactorySignerInputs,
  byte: (b: number) => string,
  length: (n: number) => string,
  limb: (v: bigint) => string,
): string[] {
  const bytes = (b: Uint8Array, n: number, what: string) => {
    if (b.length !== n) throw new Error(`${what} is ${b.length} bytes; the circuit takes ${n}`);
    return Array.from(b, byte);
  };
  const limbs = (l: bigint[], what: string) => {
    if (l.length !== 35) throw new Error(`${what} has ${l.length} limbs; the circuit takes 35`);
    return l.map(v => {
      if (v < 0n || v >= 1n << 120n) throw new Error(`${what} has a limb outside 120 bits`);
      return limb(v);
    });
  };
  const flat = [
    ...bytes(s.statement_sig, 64, 'statement_sig'),
    ...bytes(s.ik_tbs, 512, 'ik_tbs'), length(s.ik_tbs_len), ...limbs(s.ik_sig, 'ik_sig'),
    ...bytes(s.batch_tbs, 512, 'batch_tbs'), length(s.batch_tbs_len), ...bytes(s.batch_sig, 96, 'batch_sig'),
    ...bytes(s.leaf_tbs, 1024, 'leaf_tbs'), length(s.leaf_tbs_len), ...bytes(s.leaf_sig, 64, 'leaf_sig'),
    ...bytes(s.integrity_payload_b64, 1368, 'integrity_payload_b64'), length(s.integrity_payload_b64_len),
    ...bytes(s.integrity_signature, 64, 'integrity_signature'),
    ...limbs(s.rsa_root_modulus, 'rsa_root_modulus'),
    ...limbs(s.rsa_root_redc, 'rsa_root_redc'),
    ...bytes(s.play_integrity_key, 64, 'play_integrity_key'),
  ];
  if (flat.length !== ANDROID_FACTORY_SIGNER_FLAT_COUNT) {
    throw new Error(`Android factory signer flattened to ${flat.length} values; the circuit takes ${ANDROID_FACTORY_SIGNER_FLAT_COUNT}`);
  }
  return flat;
}

/** Either Android signer, flattened by its own layout; anything else throws. */
export function flattenAnyAndroidSigner(
  s: AnyAndroidSignerInputs,
  byte: (b: number) => string,
  length: (n: number) => string,
  limb: (v: bigint) => string,
): string[] {
  if (isAndroidSignerInputs(s)) return flattenAndroidSigner(s, byte, length);
  if (isAndroidFactorySignerInputs(s)) return flattenAndroidFactorySigner(s, byte, length, limb);
  throw new Error(`Not Android signer inputs (variant ${JSON.stringify((s as {variant?: unknown} | null)?.variant ?? null)})`);
}
