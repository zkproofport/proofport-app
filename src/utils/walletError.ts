/**
 * Turning what a wallet throws into words.
 *
 * A wallet connected over WalletConnect does not throw an `Error`. It answers
 * the JSON-RPC request with an error member, and the provider rejects with
 * that member as it arrived: a plain object, `{code, message, data?}`. Every
 * signing hook did `e instanceof Error ? e.message : String(e)`, and
 * `String({code, message})` is "[object Object]" -- so on 2026-10-30 a
 * Coinbase Country proof with a typed action ended at
 * "Signature failed: [object Object]", and the one sentence that said why the
 * wallet refused was gone from the screen and from the log alike.
 *
 * `describeWalletError` keeps the wallet's own message, its code, and the
 * message nested in `data` when there is one. Nothing here may ever produce
 * "[object Object]".
 */
import {WALLET_REJECTED_PREFIX, isWalletRejection} from './walletRejection';

/** The JSON-RPC code for "a request of this kind is already waiting". */
const REQUEST_ALREADY_PENDING = -32002;

function textOf(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** `data` is free-form in JSON-RPC: a string, an object with a message, or anything. */
function nestedMessage(data: unknown): string | undefined {
  if (typeof data === 'string') return textOf(data);
  if (typeof data === 'object' && data !== null) {
    const inner = data as {message?: unknown; originalError?: {message?: unknown}};
    return textOf(inner.message) ?? textOf(inner.originalError?.message);
  }
  return undefined;
}

/** JSON that cannot throw: circular structures and BigInts are written as markers. */
function safeJson(value: unknown): string | undefined {
  const seen = new WeakSet<object>();
  try {
    const json = JSON.stringify(value, (_key, v: unknown) => {
      if (typeof v === 'bigint') return `${v.toString()}n`;
      if (typeof v === 'object' && v !== null) {
        if (seen.has(v)) return '[circular]';
        seen.add(v);
      }
      return v;
    });
    return json === undefined || json === '{}' ? undefined : json;
  } catch {
    return undefined;
  }
}

export interface WalletErrorParts {
  code?: number | string;
  message: string;
  /** `data.message` (or `data` itself when it is a string), when it adds something. */
  detail?: string;
}

export function walletErrorParts(error: unknown): WalletErrorParts {
  if (typeof error === 'string') {
    return {message: textOf(error) ?? 'The wallet returned an empty error.'};
  }
  if (typeof error !== 'object' || error === null) {
    return {message: `The wallet returned no error detail (${String(error)}).`};
  }
  const raw = error as {code?: unknown; message?: unknown; data?: unknown; error?: unknown};
  // Some providers wrap the JSON-RPC error member once more as `{error: {...}}`.
  if (raw.message === undefined && typeof raw.error === 'object' && raw.error !== null) {
    return walletErrorParts(raw.error);
  }
  const code = typeof raw.code === 'number' || typeof raw.code === 'string' ? raw.code : undefined;
  const message =
    textOf(raw.message) ??
    safeJson(error) ??
    (error instanceof Error ? error.name : 'The wallet returned an error with no message.');
  const nested = nestedMessage(raw.data);
  return {
    ...(code !== undefined ? {code} : {}),
    message,
    ...(nested && nested !== message ? {detail: nested} : {}),
  };
}

/** "message (code N): data.message" -- the wallet's words, never "[object Object]". */
export function describeWalletError(error: unknown): string {
  const {code, message, detail} = walletErrorParts(error);
  return `${message}${code !== undefined ? ` (code ${code})` : ''}${detail ? `: ${detail}` : ''}`;
}

/**
 * The error a signing hook throws when the wallet did not return a signature.
 *
 * Three answers, one place, so the four hooks that sign cannot drift: the
 * person said no (the proof screen answers the relay `cancelled`), a request
 * is already waiting in the wallet, or anything else, with the wallet's own
 * words.
 */
export function signingFailure(error: unknown): Error {
  const described = describeWalletError(error);
  const {code} = walletErrorParts(error);
  if (code === REQUEST_ALREADY_PENDING || described.includes('already pending')) {
    return new Error('Signing request already pending. Please try again.');
  }
  if (isWalletRejection(error)) {
    return new Error(`${WALLET_REJECTED_PREFIX}: ${described}`);
  }
  return new Error(`Signature failed: ${described}`);
}
