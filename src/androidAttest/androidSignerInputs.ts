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

/** The Android phone's Coinbase KYC v2 statement: the clientData, signed by an attested Keystore key. */
export interface AndroidStatementWitness {
  variant: 'android';
  clientData: Uint8Array;
  attestedAt: number;
  signer: AndroidSignerInputs;
}

export function isAndroidStatementWitness(w: unknown): w is AndroidStatementWitness {
  return typeof w === 'object' && w !== null && (w as {variant?: unknown}).variant === 'android';
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
