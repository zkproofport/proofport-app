import {decodeBase64UrlBytes} from './proofLog';

/**
 * One log line naming the claims of a sign-in ID token that decide whether it
 * can be proved for this request -- iss, aud, azp, nonce, exp, iat -- and
 * never the token itself. Lets a developer read on the device which client
 * the token was minted for and which nonce it carries.
 *
 * Values are JSON-quoted so a claim holding a newline cannot forge a second
 * log line. A token that cannot be read says so; it is not an error here, the
 * proof's own validation decides that.
 */
const CLAIMS = ['iss', 'aud', 'azp', 'nonce', 'exp', 'iat'] as const;

export function describeIdTokenClaims(token: unknown): string {
  if (typeof token !== 'string') return `[OIDC] Sign-in claims unreadable: token is ${token === null ? 'null' : typeof token}`;
  const parts = token.split('.');
  if (parts.length !== 3) return `[OIDC] Sign-in claims unreadable: ${parts.length} dot-separated parts, expected 3`;
  let payload: unknown;
  try {
    payload = JSON.parse(decodeBase64UrlBytes(parts[1]));
  } catch {
    return '[OIDC] Sign-in claims unreadable: the payload is not JSON';
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return '[OIDC] Sign-in claims unreadable: the payload is not a JSON object';
  }
  const claims = payload as Record<string, unknown>;
  const shown = CLAIMS.map(name => {
    const value = claims[name];
    if (value === undefined) return `${name}=(none)`;
    const text = JSON.stringify(value);
    if ((name === 'exp' || name === 'iat') && typeof value === 'number' && Number.isFinite(value)) {
      const date = new Date(value * 1000);
      if (!Number.isNaN(date.getTime())) return `${name}=${text} (${date.toISOString()})`;
    }
    return `${name}=${text}`;
  });
  return `[OIDC] Sign-in claims: ${shown.join(' ')}`;
}
