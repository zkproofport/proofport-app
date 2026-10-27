/**
 * Does the deep link carry the inputs the dApp gave the relay?
 *
 * The relay answers GET /api/v1/proof/:requestId with up to two hashes of the
 * request's `inputs` (proofport-relay src/inputsHash.ts):
 *
 *   inputsHashV2  sha256 of the canonical JSON: keys sorted at EVERY depth,
 *                 arrays in order, no whitespace. Checked whenever present.
 *   inputsHash    LEGACY. sha256 of JSON.stringify(inputs, topLevelKeys.sort()).
 *                 An array replacer is an allowlist at every depth, so nested
 *                 objects keep only keys that also exist at the top level —
 *                 `{action: {value: 1}}` and `{action: {value: 1000}}` hash the
 *                 same. Checked only for a request from a relay that predates
 *                 V2 and so sends nothing else.
 *
 * When V2 is present the legacy hash is not consulted at all: it can only
 * agree with V2 or be weaker, and a field that is present but unusable (not a
 * 64-character hex string) is a refusal, never a reason to drop to legacy.
 */
// ethers v5's own sha256 package, not @noble/hashes and not 'ethers' itself:
// noble v2 is ESM-only and jest's CommonJS runtime cannot load it, and the
// 'ethers' entry point references node's types, which -- this file being
// reached early through App.tsx -> deeplink.ts -- made tsc take node's fetch
// and AbortSignal over React Native's for the whole program.
import {sha256} from '@ethersproject/sha2';
import {toUtf8Bytes} from '@ethersproject/strings';

/** Same cap as the relay: deeper input never got a hash there. */
export const MAX_INPUTS_DEPTH = 32;

export class InputsNotHashableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InputsNotHashableError';
  }
}

/** Byte-for-byte the relay's canonicalJson. */
export function canonicalJson(value: unknown, depth = 0): string {
  if (depth > MAX_INPUTS_DEPTH) {
    throw new InputsNotHashableError(`inputs are nested more than ${MAX_INPUTS_DEPTH} levels deep`);
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new InputsNotHashableError('inputs contain a non-finite number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(item => canonicalJson(item, depth + 1)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalJson(record[k], depth + 1)}`).join(',')}}`;
  }
  throw new InputsNotHashableError(`inputs contain a value JSON cannot carry (${typeof value})`);
}

/**
 * Lowercase hex, no 0x, as the relay's node:crypto digest('hex'). JSON.stringify
 * escapes lone surrogates, so the text is always valid UTF-16 and the UTF-8
 * bytes are the same as node's.
 */
function sha256Hex(text: string): string {
  return sha256(toUtf8Bytes(text)).slice(2);
}

export function computeInputsHashV2(inputs: Record<string, unknown>): string {
  return sha256Hex(canonicalJson(inputs));
}

/** What every shipped app computed. Kept only for relays that send nothing else. */
export function computeLegacyInputsHash(inputs: Record<string, unknown>): string {
  return sha256Hex(JSON.stringify(inputs, Object.keys(inputs).sort()));
}

const HEX_DIGEST = /^[0-9a-f]{64}$/;

export type InputsHashCheck =
  | {ok: true; checked: 'v2' | 'legacy' | 'none'}
  | {ok: false; checked: 'v2' | 'legacy'; reason: string};

/**
 * @param relay  the relay's status body (only the two hash fields are read)
 * @param inputs the inputs parsed out of the deep link
 */
export function checkInputsHash(
  relay: {inputsHash?: unknown; inputsHashV2?: unknown},
  inputs: Record<string, unknown> | undefined,
): InputsHashCheck {
  if (!inputs) return {ok: true, checked: 'none'};
  if (relay.inputsHashV2 !== undefined && relay.inputsHashV2 !== null) {
    if (typeof relay.inputsHashV2 !== 'string' || !HEX_DIGEST.test(relay.inputsHashV2)) {
      return {ok: false, checked: 'v2', reason: `relay inputsHashV2 is not a sha256 hex digest: ${JSON.stringify(relay.inputsHashV2)}`};
    }
    let local: string;
    try {
      local = computeInputsHashV2(inputs);
    } catch (error) {
      return {ok: false, checked: 'v2', reason: `inputs cannot be hashed: ${(error as Error).message}`};
    }
    if (local !== relay.inputsHashV2) {
      return {ok: false, checked: 'v2', reason: `inputsHashV2 mismatch: local ${local}, relay ${relay.inputsHashV2}`};
    }
    return {ok: true, checked: 'v2'};
  }
  if (relay.inputsHash) {
    const local = computeLegacyInputsHash(inputs);
    if (local !== relay.inputsHash) {
      return {ok: false, checked: 'legacy', reason: `inputsHash mismatch: local ${local}, relay ${String(relay.inputsHash)}`};
    }
    return {ok: true, checked: 'legacy'};
  }
  return {ok: true, checked: 'none'};
}
