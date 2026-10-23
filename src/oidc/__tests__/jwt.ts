/** Unsigned test JWTs: only the payload matters to the nonce check. */
const b64url = (s: string) => Buffer.from(s, 'utf8').toString('base64url');

export const rawJwt = (payloadJson: string): string =>
  `${b64url('{"alg":"RS256","typ":"JWT"}')}.${b64url(payloadJson)}.c2lnbmF0dXJl`;

export const jwt = (payload: Record<string, unknown>): string => rawJwt(JSON.stringify(payload));
