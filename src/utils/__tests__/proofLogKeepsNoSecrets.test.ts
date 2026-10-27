/**
 * The proof log that is kept in History and copied (src/utils/proofLog.ts):
 * which settings turn it on, what is scrubbed from it, how big it may get,
 * and how a stored log is read back as plain text.
 *
 * EDGE-CASE MATRIX (CLAUDE.md) -> coverage
 *   gating     -> every developerMode x showLiveLogs combination, damaged
 *                 values ("true" strings, 1, null, missing settings)
 *   hostile    -> each secret type is removed (JWT in text / JSON / URL
 *                 fragment, JWE, bearer, access token, URL code, labelled
 *                 signature / private key / secret / password / keyId,
 *                 unlabelled 64- and 65-byte signatures, App Attest key ids and
 *                 blobs); near-misses are KEPT (domains, versions, i18n keys,
 *                 "eyewitness", nonce, request id, tx hash, address, public
 *                 key, error codes, file paths, "Signature: ✓", short values)
 *   integrity  -> scrub is idempotent; a look-alike in front of a real JWT
 *                 does not hide it; claims line survives the scrub
 *   boundary   -> cap at 0 / limit / limit+1 / 2x limit, head and tail kept,
 *                 tiny limits, cut never splits an emoji
 *   UTF-8      -> Korean, emoji, tabs and newlines pass through unchanged
 *   empty      -> '', whitespace-only, null, undefined, non-string, array
 *                 records -> "no log"
 *   large      -> a 1 MB stored log reads back capped
 *   budget     -> newest records keep logs, older ones lose only the log, the
 *                 record being written always keeps its own, damaged logs drop
 *   authz      -> N/A: no caller identity on the phone; Developer Mode is the gate
 *   race       -> covered in historyStoreKeepsProofLogs.test.ts (serialized writes)
 */
import {
  PROOF_LOG_LIMITS,
  capLogText,
  fitLogBudget,
  proofLogEnabled,
  proofLogText,
  readStoredLog,
  scrubLogText,
  storedLogsVisible,
} from '../proofLog';
import {describeIdTokenClaims} from '../idTokenClaims';

const b64url = (value: unknown) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');
const NONCE = 'a1'.repeat(32);
const REQUEST_ID = '7f3e1c2a-0b1d-4c5e-8f9a-123456789abc';
const AUD = '448669482783-abcdef.apps.googleusercontent.com';
const AZP = '448669482783-ios123.apps.googleusercontent.com';
const CLAIMS = {iss: 'https://accounts.google.com', aud: AUD, azp: AZP, nonce: NONCE, exp: 1761530000, iat: 1761526400, email: 'dev@example.com'};
const JWT = `${b64url({alg: 'RS256', kid: 'k1', typ: 'JWT'})}.${b64url(CLAIMS)}.${'S'.repeat(342)}`;

describe('which settings keep a log', () => {
  it.each([
    [{developerMode: true, showLiveLogs: true}, true],
    [{developerMode: true, showLiveLogs: false}, false],
    [{developerMode: false, showLiveLogs: true}, false],
    [{developerMode: false, showLiveLogs: false}, false],
    [{developerMode: 'true', showLiveLogs: true}, false],
    [{developerMode: true, showLiveLogs: 'true'}, false],
    [{developerMode: 1, showLiveLogs: 1}, false],
    [{developerMode: true}, false],
    [null, false],
    [undefined, false],
    [[true, true], false],
  ])('%p -> %p', (settings, expected) => {
    expect(proofLogEnabled(settings)).toBe(expected);
  });

  it.each([
    [{developerMode: true, showLiveLogs: false}, true],
    [{developerMode: true, showLiveLogs: true}, true],
    [{developerMode: false, showLiveLogs: true}, false],
    [{developerMode: 'true'}, false],
    [null, false],
  ])('stored logs visible for %p -> %p', (settings, expected) => {
    expect(storedLogsVisible(settings)).toBe(expected);
  });
});

describe('secrets are removed', () => {
  it.each([
    ['a JWT in running text', `[OIDC] got ${JWT} back`, 'jwt'],
    ['a JWT in JSON', `{"idToken":"${JWT}"}`, 'jwt'],
    ['a JWT in a URL fragment', `cb://x#id_token=${JWT}&state=1`, 'jwt'],
    ['a JWT with a spaced header', `t ${b64url('{ "alg": "none" }')}.${b64url(CLAIMS)}.`, 'jwt'],
    ['a JWT after a look-alike', `eyewitness.${JWT}`, 'jwt'],
    ['a JWE (five parts)', `${b64url({alg: 'RSA-OAEP', enc: 'A256GCM'})}.${'k'.repeat(40)}.${'i'.repeat(20)}.${'c'.repeat(60)}.${'t'.repeat(22)}`, 'jwt'],
    ['a bearer token', 'Authorization: Bearer ya29.a0AfH6SMBx-yz_123', 'bearer token'],
    ['an OAuth code in a URL', 'redirect zkproofport://oauth?code=4/0AbCdEf12345-xyz&state=s1', 'code'],
    ['an access token in a URL', 'https://x/cb#access_token=abcDEF123456&token_type=bearer', 'access_token'],
    ['a labelled access token', 'accessToken: ya29.a0AfH6SMBxyz123', 'accesstoken'],
    ['a server auth code', 'serverAuthCode=4/0AY0e-g7abcdefgh', 'serverauthcode'],
    ['a labelled partial signature', `[Sign] Signature: 0x${'ab'.repeat(20)}...`, 'signature'],
    ['a signature after "received"', `Signature received: 0x${'cd'.repeat(65)}`, 'signature'],
    ['a partial signature after "received"', `Signature received: 0x${'cd'.repeat(9)}...`, 'signature'],
    ['an unlabelled 65-byte signature', `sig 0x${'ef'.repeat(65)} end`, 'signature'],
    ['an unlabelled 64-byte signature', `(0x${'12'.repeat(64)})`, 'signature'],
    ['a private key', `privateKey: 0x${'1f'.repeat(32)}`, 'privatekey'],
    ['a spaced private key', `private key = ${'2e'.repeat(32)}`, 'privatekey'],
    ['a secret', 'clientSecret="GOCSPX-abcdefgh12345"', 'clientsecret'],
    ['a password with spaces in quotes', 'password: "correct horse battery staple"', 'password'],
    ['a mnemonic', 'mnemonic: "test test test test test test test test test test test junk"', 'mnemonic'],
    ['an App Attest key id (label)', `keyId: ${Buffer.alloc(32, 9).toString('base64')}`, 'keyid'],
    ['an App Attest key id (sentence)', `[AppAttest] Generated key ${Buffer.alloc(32, 7).toString('base64')}`, 'key id'],
    ['an App Attest assertion', `assertion=${Buffer.from('a1B2c3'.repeat(40)).toString('base64')}`, 'assertion'],
    ['an unlabelled attestation object', `blob ${Buffer.from('Zq9'.repeat(200)).toString('base64')}`, 'opaque value'],
    ['an unlabelled long base64url token', `t ${'aB3_-'.repeat(30)}`, 'opaque value'],
  ])('%s', (_name, line, kind) => {
    const out = scrubLogText(line);
    expect(out).toContain(`[redacted ${kind}, `);
    // Nothing of the secret's body is left: no 12-character run of it survives.
    const body = line.match(/[A-Za-z0-9+/_-]{24,}/g) ?? [];
    for (const run of body) expect(out).not.toContain(run.slice(4, 16));
  });

  it('says how long the removed value was', () => {
    expect(scrubLogText(`x ${JWT}`)).toBe(`x [redacted jwt, ${JWT.length} chars]`);
    expect(scrubLogText(`0x${'ef'.repeat(65)}`)).toBe('[redacted signature, 132 chars]');
  });
});

describe('what a debugger needs is kept', () => {
  it.each([
    `[OIDC] Request ${REQUEST_ID} (relay), nonce ${NONCE}`,
    `aud=${AUD} azp=${AZP}`,
    'accounts.google.com login.microsoftonline.com 1.0.0-beta.19 host.proof.generation.title',
    'eyewitness.example.co eyJ alone eyJhbGci.short',
    `tx 0x${'9a'.repeat(32)} nullifier 0x${'0b'.repeat(32)} wallet 0x${'Ab'.repeat(20)}`,
    `[PubKey] Public key: 0x04${'a'.repeat(38)}...`,
    'errorCode: E2008 code: E2012 [Failed] E2001: Proof generation failed',
    '[Inputs] Signature: ✓',
    '[Sign] Signature received (132 chars)',
    'token: undefined, signature: null, secret=(none)',
    'password: short',
    '[JWT] Token validated',
    'OACX — token received, parsing VC (POST /trans/token)...',
    '/var/mobile/Containers/Data/Application/0A1B2C3D-1111-2222-3333-444455556666/Documents/circuits/oidc_domain_attestation.json',
    `[Parse] Public input #3: 0x${'f'.repeat(64)}`,
    `numbers ${'1234567890'.repeat(15)}`,
    `hex ${'abcdef0123'.repeat(20)}`,
    `[Proof] Generation time: 41235ms, VK loaded: 1816 bytes`,
    '증명 실패 — 다시 시도하세요 🙂\tTab\nNewline',
  ])('%s', line => {
    expect(scrubLogText(line)).toBe(line);
  });

  it('an unlabelled full public key has a signature\'s shape and is removed: over-removal is the safe side', () => {
    // 0x04 || x || y is 65 bytes, like r || s || v. The app logs only a prefix of it.
    expect(scrubLogText(`[PubKey] Public key 0x04${'c'.repeat(128)}`)).toBe('[PubKey] Public key [redacted signature, 132 chars]');
  });

  it('the claims line passes the scrub whole', () => {
    const line = describeIdTokenClaims(JWT);
    expect(scrubLogText(line)).toBe(line);
    expect(line).toContain(NONCE);
    expect(line).toContain(AUD);
    expect(line).toContain(AZP);
  });
});

it('scrubbing twice changes nothing more', () => {
  const text = [
    `a ${JWT}`, `Signature: 0x${'ab'.repeat(65)}`, 'Bearer abcdefgh1234', `?code=4/0Abc123456`,
    `keyId: ${Buffer.alloc(32, 1).toString('base64')}`, `x ${Buffer.from('Qz7'.repeat(80)).toString('base64')}`,
  ].join('\n');
  const once = scrubLogText(text);
  expect(scrubLogText(once)).toBe(once);
});

describe('the size cap', () => {
  const LIMIT = PROOF_LOG_LIMITS.perRecordChars;
  it.each([0, 1, LIMIT - 1, LIMIT])('%d characters pass unchanged', n => {
    const text = 'x'.repeat(n);
    expect(capLogText(text)).toBe(text);
  });

  it.each([LIMIT + 1, LIMIT * 2, 1_000_000])('%d characters are cut to the limit, start and end kept', n => {
    const text = `START-${'m'.repeat(n - 10)}-END`;
    const out = capLogText(text);
    expect(out.length).toBeLessThanOrEqual(LIMIT);
    expect(out.startsWith('START-')).toBe(true);
    expect(out.endsWith('-END')).toBe(true);
    expect(out).toMatch(/\[\.\.\. \d+ characters removed to fit the 32000-character log limit \.\.\.\]/);
    const removed = Number(out.match(/(\d+) characters removed/)![1]);
    expect(out.length - out.match(/\n\[\.\.\..*\.\.\.\]\n/)![0].length + removed).toBe(text.length);
  });

  it.each([[''], ['x'], ['xy'], ['xyz']])('never splits an emoji at either cut (prefix %p)', prefix => {
    // The prefix moves both cuts across a pair boundary in turn.
    const out = capLogText(prefix + '🙂'.repeat(LIMIT));
    expect(out.length).toBeLessThanOrEqual(LIMIT);
    expect(out).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
  });

  it('a limit smaller than its own note still holds the limit', () => {
    expect(capLogText('x'.repeat(500), 20, 5).length).toBeLessThanOrEqual(20);
    expect(capLogText('x'.repeat(500), 0, 0)).toBe('');
  });

  it('scrubs BEFORE cutting, so a cut cannot leave half a secret', () => {
    // The token starts 30 characters before the head cut: cutting first would
    // keep its first 30 characters, which no longer look like a token.
    const text = `${'a'.repeat(PROOF_LOG_LIMITS.headChars - 31)} ${JWT}${' z'.repeat(20_000)}`;
    const out = proofLogText([text]);
    expect(out).not.toContain(JWT.slice(0, 20));
    expect(out).toContain('[redacted jwt');
  });
});

describe('reading a stored log', () => {
  it.each([
    ['no log field', {id: '1'}],
    ['empty', {id: '1', log: ''}],
    ['whitespace only', {id: '1', log: ' \n\t '}],
    ['null', {id: '1', log: null}],
    ['a number', {id: '1', log: 42}],
    ['an array', {id: '1', log: ['line']}],
    ['an object', {id: '1', log: {text: 'line'}}],
  ])('%s is no log', (_name, record) => {
    expect(readStoredLog(record)).toBeNull();
  });

  it.each([null, undefined, 'text', 7, [{log: 'x'}]])('a damaged record %p is no log', record => {
    expect(readStoredLog(record)).toBeNull();
  });

  it('an oversized stored log reads back capped', () => {
    const out = readStoredLog({log: 'y'.repeat(1_000_000)});
    expect(out!.length).toBeLessThanOrEqual(PROOF_LOG_LIMITS.perRecordChars);
  });

  it('a stored log written before a scrub rule existed is scrubbed on the way out', () => {
    expect(readStoredLog({log: `old ${JWT}`})).toBe(`old [redacted jwt, ${JWT.length} chars]`);
  });

  it('Korean and emoji come back as stored', () => {
    expect(readStoredLog({log: '증명 로그 🙂\n두 번째 줄'})).toBe('증명 로그 🙂\n두 번째 줄');
  });
});

describe('the total budget across records', () => {
  const rec = (id: string, log?: unknown) => (log === undefined ? {id} : {id, log});
  it('newest records keep their logs, older ones lose only the log', () => {
    const items = [rec('new', 'a'.repeat(60)), rec('mid', 'b'.repeat(30)), rec('old', 'c'.repeat(30)), rec('none')];
    const out = fitLogBudget(items, 'new', 100);
    expect(out.map(i => i.id)).toEqual(['new', 'mid', 'old', 'none']);
    expect(out[0]).toHaveProperty('log');
    expect(out[1]).toHaveProperty('log');
    expect(out[2]).not.toHaveProperty('log');
    expect(out[3]).toEqual({id: 'none'});
  });

  it('the record being written keeps its log even when it is not the newest', () => {
    const items = [rec('new', 'a'.repeat(80)), rec('written', 'b'.repeat(80))];
    const out = fitLogBudget(items, 'written', 100);
    expect(out[1]).toHaveProperty('log');
    expect(out[0]).not.toHaveProperty('log');
  });

  it('exactly the budget fits; one more character does not', () => {
    expect(fitLogBudget([rec('a', 'x'.repeat(50)), rec('b', 'y'.repeat(50))], 'a', 100)[1]).toHaveProperty('log');
    expect(fitLogBudget([rec('a', 'x'.repeat(50)), rec('b', 'y'.repeat(51))], 'a', 100)[1]).not.toHaveProperty('log');
  });

  it('a damaged log is dropped and a damaged record is left alone', () => {
    const items: unknown[] = [null, 'text', rec('a', {nested: true}), rec('b', 'ok')];
    const out = fitLogBudget(items, 'b', 100);
    expect(out[0]).toBeNull();
    expect(out[1]).toBe('text');
    expect(out[2]).toEqual({id: 'a'});
    expect(out[3]).toEqual({id: 'b', log: 'ok'});
  });

  it('does not change the list it was given', () => {
    const items = [rec('a', 'x'.repeat(200))];
    fitLogBudget(items, null, 100);
    expect(items[0]).toHaveProperty('log');
  });
});

describe('the sign-in claims line', () => {
  it('names iss, aud, azp, nonce, exp and iat, never the token', () => {
    const line = describeIdTokenClaims(JWT);
    expect(line).toBe(
      `[OIDC] Sign-in claims: iss="https://accounts.google.com" aud="${AUD}" azp="${AZP}" nonce="${NONCE}" ` +
        'exp=1761530000 (2025-10-27T01:53:20.000Z) iat=1761526400 (2025-10-27T00:53:20.000Z)',
    );
    expect(line).not.toContain(JWT.split('.')[1].slice(0, 20));
    expect(line).not.toContain('dev@example.com');
  });

  it('an array aud, a missing nonce and a hostile claim stay on one line', () => {
    const token = `${b64url({alg: 'RS256'})}.${b64url({aud: ['a', 'b'], azp: 'x\n[Forged] line', iss: '이슈어 🙂'})}.sig`;
    const line = describeIdTokenClaims(token);
    expect(line).toContain('aud=["a","b"]');
    expect(line).toContain('nonce=(none)');
    expect(line.split('\n')).toHaveLength(1);
  });

  it.each([
    ['not a string', undefined, 'token is undefined'],
    ['null', null, 'token is null'],
    ['two parts', 'a.b', '2 dot-separated parts'],
    ['garbage payload', 'a.!!!.c', 'not JSON'],
    ['array payload', `h.${b64url([1])}.s`, 'not a JSON object'],
  ])('%s says it is unreadable', (_name, token, said) => {
    expect(describeIdTokenClaims(token)).toContain(said);
  });
});
