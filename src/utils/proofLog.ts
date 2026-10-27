/**
 * The proof log a developer can keep and copy.
 *
 * With Developer Mode AND live logs on, the log of one proof attempt
 * (generation through off/on-chain verification, failures included) is
 * written into that attempt's History record as plain text, and can be copied
 * from the completion screen and from History. With either switch off,
 * nothing is kept: the decision is made once, from the settings read when the
 * attempt starts (`proofLogEnabled`).
 *
 * Everything that leaves the live panel -- stored or copied -- goes through
 * `scrubLogText` first, then a size cap. What is removed is what must never
 * sit in plain storage or a clipboard: ID tokens and other JWTs, bearer and
 * access tokens, wallet signatures, App Attest assertions and key ids, private
 * keys, secrets and OAuth codes. Each becomes `[redacted <kind>, <n> chars]`.
 * What a debugger reads stays: nonce, aud/azp/iss/exp, request ids, circuit
 * ids, addresses, tx hashes, timings, error codes and messages.
 *
 * Known limit: a private key logged with NO label is 64 hex digits, the same
 * shape as a tx hash, nullifier or nonce, so it cannot be told apart and is
 * not removed. Nothing in the app logs one; a labelled one is removed.
 */

/** Characters kept per record: the start (request, nonce) and the end (failure). */
export const PROOF_LOG_LIMITS = {
  perRecordChars: 32_000,
  headChars: 8_000,
  /** All records together. History is ONE AsyncStorage value (Android row limit 2 MB). */
  totalChars: 200_000,
} as const;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Keep (and show live) the proof log only when Developer Mode AND live logs
 * are on. Strictly `true`: a damaged settings value never turns capture on.
 */
export function proofLogEnabled(settings: unknown): boolean {
  return isObject(settings) && settings.developerMode === true && settings.showLiveLogs === true;
}

/**
 * Stored logs are shown in History only while Developer Mode is on. They are
 * a developer tool: turning Developer Mode off hides them (and the copy
 * action) without deleting them, and turning it back on shows them again.
 * The live-logs switch is not consulted -- turning off the live panel should
 * not take away logs already kept.
 */
export function storedLogsVisible(settings: unknown): boolean {
  return isObject(settings) && settings.developerMode === true;
}

const redacted = (kind: string, length: number) => `[redacted ${kind}, ${length} chars]`;
const REDACTED_PREFIX = '[redacted';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/** Bytes of a base64url (or base64) string, as a Latin-1 string. Stops at an invalid character. */
export function decodeBase64UrlBytes(segment: string, maxChars = Infinity): string {
  let bits = 0;
  let value = 0;
  let out = '';
  const n = Math.min(segment.length, maxChars);
  for (let i = 0; i < n; i++) {
    const c = segment[i];
    let v = B64.indexOf(c);
    if (c === '-' || c === '+') v = 62;
    else if (c === '_' || c === '/') v = 63;
    if (v < 0) break;
    value = (value << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((value >> bits) & 0xff);
    }
  }
  return out;
}

/** A JOSE header is a JSON object: `{"alg"...` or `{ "typ"...`. */
const looksLikeJoseHeader = (segment: string) => /^\s*\{\s*"/.test(decodeBase64UrlBytes(segment, 16));

// Header segment: base64url of '{' always starts with 'e' then [w-z0-9_-].
const JWT_CANDIDATE = /(^|[^A-Za-z0-9_-])(e[w-z0-9_-][A-Za-z0-9_-]{2,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]*){0,2})/g;

function scrubJwts(text: string): string {
  let out = '';
  let from = 0;
  JWT_CANDIDATE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = JWT_CANDIDATE.exec(text)) !== null) {
    const start = m.index + m[1].length;
    const token = m[2];
    if (looksLikeJoseHeader(token.slice(0, token.indexOf('.')))) {
      out += text.slice(from, start) + redacted('jwt', token.length);
      from = start + token.length;
      JWT_CANDIDATE.lastIndex = from;
    } else {
      // Not a token. Look again one character on, so a real token that this
      // look-alike swallowed ("eyewitness.eyJ...") is still found.
      JWT_CANDIDATE.lastIndex = start + 1;
    }
  }
  return out + text.slice(from);
}

const NOT_A_VALUE = /^(?:undefined|null|true|false|none|\(none\)|n\/a)$/i;

// `?code=...`, `#id_token=...` in a URL.
const URL_SECRET = /([?&#])(code|id_token|access_token|refresh_token|token|code_verifier)=([^&#\s"']+)/gi;

const BEARER = /\b(Bearer)(\s+)([A-Za-z0-9._~+/=-]{8,})/g;

// `label: value`, `label=value`, `"label": "value"`. The label may carry a
// camelCase prefix (idToken, pushToken, serverAuthCode). `code` alone is NOT
// a label: `errorCode: E2008` is what a debugger needs.
const SECRET_LABEL =
  '(?:id[_-]?token|access[_-]?token|refresh[_-]?token|token|jwt|credential|signature|assertion|' +
  'attestation[_-]?object|client[_-]?data|key[_-]?id|private[ _-]?key|priv[_-]?key|secret[ _-]?key|' +
  'secret|mnemonic|seed[ _-]?phrase|password|passcode|code[_-]?verifier|auth(?:orization)?[ _-]?code|api[_-]?key)';
const LABELLED = new RegExp(
  `(^|[^A-Za-z0-9])([A-Za-z]*?${SECRET_LABEL}` +
    // "Signature received: 0x..." -- a few words between label and colon.
    `(?:\\s+received)?)(\\s*["']?\\s*[:=]\\s*)` +
    `(?!\\[redacted )("(?:[^"\\\\]|\\\\.)*"|'[^']*'|[^\\s"',;&)}\\]]+)`,
  'gi',
);

function scrubLabelled(text: string): string {
  return text.replace(LABELLED, (all, pre: string, label: string, sep: string, raw: string) => {
    const quote = raw[0] === '"' || raw[0] === "'" ? raw[0] : '';
    const inner = quote ? raw.slice(1, -1) : raw;
    if (inner.length < 8 || NOT_A_VALUE.test(inner) || inner.startsWith(REDACTED_PREFIX)) return all;
    const kind = label.toLowerCase().replace(/\s+received$/, '').replace(/[^a-z]/g, '');
    return `${pre}${label}${sep}${quote}${redacted(kind, inner.length)}${quote}`;
  });
}

// An unlabelled 65-byte (r,s,v) or 64-byte compact signature.
const SIGNATURE_HEX = /(^|[^0-9A-Za-z])(0x(?:[0-9a-fA-F]{130}|[0-9a-fA-F]{128}))(?![0-9a-fA-F])/g;

// App Attest key ids (base64 of 32 bytes) logged as "key <id>".
const APP_ATTEST_KEY = /(\bkey\s+)([A-Za-z0-9+/]{43}=|[A-Za-z0-9_-]{43})(?![A-Za-z0-9+/=_-])/gi;

// Long opaque blobs: App Attest attestation objects and assertions, access
// tokens without a label. Needs upper, lower AND digits, so long hex, words,
// numbers and file paths (broken up by '-', '_' or '.') are left alone.
const OPAQUE_STD = /[A-Za-z0-9+/]{100,}={0,2}/g;
const OPAQUE_URL = /[A-Za-z0-9_-]{100,}/g;
const mixed = (s: string) => /[A-Z]/.test(s) && /[a-z]/.test(s) && /[0-9]/.test(s);

/** Remove secrets from log text. Idempotent: scrubbing twice changes nothing more. */
export function scrubLogText(text: string): string {
  let out = scrubJwts(text);
  out = out.replace(URL_SECRET, (all, sep: string, name: string, value: string) =>
    value.startsWith(REDACTED_PREFIX) || value.length < 4 ? all : `${sep}${name}=${redacted(name.toLowerCase(), value.length)}`);
  out = out.replace(BEARER, (_all, word: string, space: string, value: string) =>
    `${word}${space}${redacted('bearer token', value.length)}`);
  out = scrubLabelled(out);
  out = out.replace(SIGNATURE_HEX, (_all, pre: string, sig: string) => `${pre}${redacted('signature', sig.length)}`);
  out = out.replace(APP_ATTEST_KEY, (_all, pre: string, id: string) => `${pre}${redacted('key id', id.length)}`);
  out = out.replace(OPAQUE_STD, blob => (mixed(blob) ? redacted('opaque value', blob.length) : blob));
  out = out.replace(OPAQUE_URL, blob => (mixed(blob) ? redacted('opaque value', blob.length) : blob));
  return out;
}

const isHigh = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLow = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/**
 * At most `limit` characters: the first `head` and the last part, with a line
 * saying how much was cut. Never splits a surrogate pair (emoji).
 */
export function capLogText(
  text: string,
  limit: number = PROOF_LOG_LIMITS.perRecordChars,
  head: number = PROOF_LOG_LIMITS.headChars,
): string {
  if (text.length <= limit) return text;
  const note = (removed: number) => `\n[... ${removed} characters removed to fit the ${limit}-character log limit ...]\n`;
  let headEnd = Math.max(0, Math.min(head, limit));
  const reserve = note(text.length).length;
  let tailStart = text.length - Math.max(0, limit - headEnd - reserve);
  if (tailStart < headEnd) tailStart = headEnd;
  if (headEnd > 0 && isHigh(text.charCodeAt(headEnd - 1))) headEnd -= 1;
  if (tailStart < text.length && isLow(text.charCodeAt(tailStart))) tailStart += 1;
  const capped = text.slice(0, headEnd) + note(tailStart - headEnd) + text.slice(tailStart);
  // A limit too small to hold the note at all: the note alone says what happened.
  return capped.length <= limit ? capped : capped.slice(0, limit);
}

/** The text that is stored or copied for these log lines: scrubbed, then capped. */
export function proofLogText(lines: readonly string[]): string {
  return capLogText(scrubLogText(lines.join('\n')));
}

/**
 * The log a History record holds, ready to show or copy -- or null when it
 * has none. Plain-text rule: a missing, empty or non-string value is "no log",
 * an oversized one is capped, and it is scrubbed again on the way out, so a
 * record written before a scrub rule existed cannot leak through a copy.
 */
export function readStoredLog(record: unknown): string | null {
  if (!isObject(record)) return null;
  const log = record.log;
  if (typeof log !== 'string' || log.trim() === '') return null;
  return capLogText(scrubLogText(log));
}

/**
 * Keep the total size of every record's log under `total`. Newest records
 * (first in the list) keep theirs; older ones lose their log, never the
 * record. `keepId`'s log is counted first, so the record being written always
 * keeps it. A non-string `log` (damaged) is dropped.
 */
export function fitLogBudget<T>(items: T[], keepId: string | null, total: number = PROOF_LOG_LIMITS.totalChars): T[] {
  let used = 0;
  const keepIndex = items.findIndex(item => isObject(item) && item.id === keepId);
  const order = keepIndex >= 0 ? [keepIndex, ...items.keys()].filter((v, i, all) => all.indexOf(v) === i) : [...items.keys()];
  const out = items.slice();
  for (const index of order) {
    const item = out[index];
    if (!isObject(item) || !Object.prototype.hasOwnProperty.call(item, 'log')) continue;
    const log = item.log;
    if (typeof log === 'string' && used + log.length <= total) {
      used += log.length;
      continue;
    }
    const {log: _dropped, ...rest} = item;
    out[index] = rest as T;
  }
  return out;
}
