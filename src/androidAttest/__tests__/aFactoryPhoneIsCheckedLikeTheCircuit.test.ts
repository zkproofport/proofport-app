/**
 * What the app refuses before proving on a factory-provisioned phone, as the
 * factory circuits refuse it after proving: the chain
 * (requireAcceptableFactoryChain, android-key-attestation
 * android_factory_signing_key) and the Play Integrity verdict
 * (playIntegrity.ts, circuits play-integrity verify_integrity_token), plus
 * how each answer of the relay that decrypts the verdict maps to an
 * ErrorModal code.
 *
 * Verdicts are from fixtures/androidFactoryVectors.json: android.js playToken
 * signed with the INSECURE test Play key, for the synthetic device's
 * statement; the relay answers carry Google's signature with s in its HIGH
 * form, so the app's normalisation is exercised.
 */
import {AppAttestError} from '../../appAttest/appAttestError';
import {N_P256} from '../../appAttest/constants';
import {GOOGLE_RSA_ROOT_MODULUS_HEX} from '../../utils/androidKeyAttestation';
import factory from '../../utils/__tests__/fixtures/androidFactoryVectors.json';
import {requireAcceptableFactoryChain, ZKPROOFPORT_ANDROID_APP, type AndroidAppIdentity} from '../androidChainChecks';
import {
  decryptIntegrityTokenViaRelay,
  integrityTokenInputs,
  JWS_HEADER_B64,
  PLAY_INTEGRITY_DECRYPT_PATH,
  PLAY_INTEGRITY_VERIFICATION_KEY,
  playIntegrityNonce,
  playIntegrityNonceText,
} from '../playIntegrity';

const real = factory.real as unknown as Record<string, {chain: string[]}>;
const s = factory.synthetic;
const der = (chain: string[]) => chain.map(b => Uint8Array.from(Buffer.from(b, 'base64')));
const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const bytes = (h: string) => Uint8Array.from(Buffer.from(h, 'hex'));
const tokens = s.tokens as unknown as Record<string, {relay: {protectedHeader: string; payload: string; signature: string}; payloadB64Padded: string; payloadB64Len: number; signatureLow: string}>;

function refusal(f: () => unknown): {code: string; message: string} {
  try {
    f();
  } catch (e) {
    if (e instanceof AppAttestError) return {code: e.code, message: e.message};
    return {code: `not ours: ${String(e)}`, message: String(e)};
  }
  return {code: 'accepted', message: ''};
}
async function asyncRefusal(p: Promise<unknown>): Promise<{code: string; message: string}> {
  try {
    await p;
  } catch (e) {
    if (e instanceof AppAttestError) return {code: e.code, message: e.message};
    return {code: `not ours: ${String(e)}`, message: String(e)};
  }
  return {code: 'accepted', message: ''};
}

/** The apps that made the real chains, read from their leaves' [709]. */
const PLAY_STORE: AndroidAppIdentity = {
  packageName: 'com.android.vending',
  signingCertSha256: 'f0fd6c5b410f25cb25c3b53346c8972fae30f8ee7411df910480ad6b2d60db83',
};
const BLUELINE_COLLECTOR: AndroidAppIdentity = {
  packageName: 'com.google.wireless.android.security.attestationverifier.collector',
  signingCertSha256: '103938ee4537e59e8ee792f654504fb8346fc6b346d0bbc4415fc339fcfc8ec1',
};
const OURS = {app: ZKPROOFPORT_ANDROID_APP, rootModulusHex: s.rsaRootModulusHex};

describe('the factory chain', () => {
  it("accepts Sony's real chain for the app that made it (Play Store's key), and refuses it for ours", () => {
    expect(requireAcceptableFactoryChain(der(real['sony-xperia10iii-sdk33-factory'].chain), {app: PLAY_STORE, rootModulusHex: GOOGLE_RSA_ROOT_MODULUS_HEX}).securityLevel)
      .toBe('TrustedEnvironment');
    expect(refusal(() => requireAcceptableFactoryChain(der(real['sony-xperia10iii-sdk33-factory'].chain), {app: ZKPROOFPORT_ANDROID_APP, rootModulusHex: GOOGLE_RSA_ROOT_MODULUS_HEX})))
      .toEqual({code: 'E2015', message: expect.stringMatching(/belongs to another app \(com\.android\.vending\)/)});
  });

  it("refuses blueline (a real phone with an UNLOCKED bootloader), even for the app that made it", () => {
    const r = refusal(() => requireAcceptableFactoryChain(der(real['blueline-sdk28-tee-ec-factory'].chain), {app: BLUELINE_COLLECTOR, rootModulusHex: GOOGLE_RSA_ROOT_MODULUS_HEX}));
    expect(r).toEqual({code: 'E2015', message: expect.stringMatching(/bootloader is unlocked/)});
  });

  it('accepts the synthetic device (our package and signing certificate, locked)', () => {
    expect(requireAcceptableFactoryChain(der(s.chain), OURS).securityLevel).toBe('TrustedEnvironment');
  });

  it('refuses the synthetic device with an unlocked bootloader', () => {
    expect(refusal(() => requireAcceptableFactoryChain(der(s.unlockedChain), OURS)).message).toMatch(/bootloader is unlocked/);
  });

  it.each([
    ['another RSA root', () => ({chain: der(s.chain), opts: {...OURS, rootModulusHex: GOOGLE_RSA_ROOT_MODULUS_HEX}}), /does not end at the pinned RSA root/],
    ['too many certificates', () => ({chain: [...der(s.chain), der(s.chain)[3]], opts: OURS}), /got 5 in all/],
    ['too few', () => ({chain: der(s.chain).slice(0, 2), opts: OURS}), /got 2 in all/],
    ['the batch where the intermediate belongs', () => {
      const c = der(s.chain);
      return {chain: [c[0], c[1], c[1], c[3]], opts: OURS};
    }, /intermediate is signed with 2a8648ce3d040302; a factory chain signs it with sha256WithRSAEncryption/],
    ['the intermediate where the batch belongs', () => {
      const c = der(s.chain);
      return {chain: [c[0], c[2], c[2], c[3]], opts: OURS};
    }, /batch certificate is signed with 2a864886f70d01010b/],
  ])('refuses %s (E2015)', (_l, make, message) => {
    const {chain, opts} = make();
    const r = refusal(() => requireAcceptableFactoryChain(chain, opts));
    expect(r.code).toBe('E2015');
    expect(r.message).toMatch(message);
  });

  it('refuses bytes that are not certificates as malformed (E2016)', () => {
    const c = der(s.chain);
    expect(refusal(() => requireAcceptableFactoryChain([new Uint8Array([0x30, 0x80]), c[1], c[2], c[3]], OURS)).code).toBe('E2016');
    expect(refusal(() => requireAcceptableFactoryChain([c[0], c[1], c[2].slice(0, 100), c[3]], OURS)).code).toBe('E2016');
  });
});

describe('the Play Integrity nonce', () => {
  it("is android.js playIntegrityNonce: SHA256(SHA256(statement) || r || s), low s", () => {
    const nonce = playIntegrityNonce(bytes(s.statement), bytes(s.statementSigLow));
    expect(hex(nonce)).toBe(s.nonce);
    expect(playIntegrityNonceText(nonce)).toBe(s.nonceBase64Url);
    expect(s.nonceBase64Url).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('changes with any byte of the statement or the signature', () => {
    const st = bytes(s.statement);
    const sig = bytes(s.statementSigLow);
    st[0] ^= 1;
    expect(hex(playIntegrityNonce(st, bytes(s.statementSigLow)))).not.toBe(s.nonce);
    sig[63] ^= 1;
    expect(hex(playIntegrityNonce(bytes(s.statement), sig))).not.toBe(s.nonce);
  });

  it('refuses a signature that is not 64 bytes and a nonce that is not 32', () => {
    expect(() => playIntegrityNonce(bytes(s.statement), new Uint8Array(65))).toThrow(/65 bytes, not 64/);
    expect(() => playIntegrityNonceText(new Uint8Array(31))).toThrow(/31 bytes, not 32/);
  });

  it('the pinned verification key is the SPKI Play Console gives', () => {
    const spki = Buffer.from('MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE9mG5EsLPQCtC4JQDSgvE5WUjoXYnwmt1Xp1YfEOdQzsjwbDMVpN/QUbDB+vbGlUWMY/Z5Q3x6Z8sTFVQTwpnWw==', 'base64');
    expect(hex(PLAY_INTEGRITY_VERIFICATION_KEY)).toBe(hex(spki.subarray(spki.length - 64)));
  });
});

describe('the verdict', () => {
  const expect_ = {nonce: bytes(s.nonce), packageName: s.package};

  it.each(['good', 'escapedPaddedNonce', 'strongIntegrity'])("%s: the circuit's inputs, s lowered", name => {
    const t = tokens[name];
    const out = integrityTokenInputs(t.relay, expect_);
    expect(hex(out.integrity_payload_b64)).toBe(t.payloadB64Padded);
    expect(out.integrity_payload_b64_len).toBe(t.payloadB64Len);
    expect(hex(out.integrity_signature)).toBe(t.signatureLow);
    // The relay's answer really had a high s.
    expect(BigInt('0x' + hex(Buffer.from(t.relay.signature, 'base64url').subarray(32))) > N_P256 / 2n).toBe(true);
  });

  it.each([
    ['basicIntegrityOnly', 'E2017', /does not meet device integrity/],
    ['unrecognizedApp', 'E2017', /not recognized as the store's build/],
    ['otherPackage', 'E2017', /is for "com\.example\.other"/],
    ['otherRequestPackage', 'E2016', /requested by "com\.example\.other"/],
    ['otherNonce', 'E2016', /is not this statement's/],
    ['literalPaddedNonce', 'E2016', /is not this statement's/],
  ])('%s -> %s', (name, code, message) => {
    const r = refusal(() => integrityTokenInputs(tokens[name].relay, expect_));
    expect(r.code).toBe(code);
    expect(r.message).toMatch(message);
  });

  it.each([
    ['another protected header', () => ({...tokens.good.relay, protectedHeader: 'eyJhbGciOiJFUzI1NiIsImtpZCI6IngifQ'}), /header is/],
    ['the right header, unpadded but spelled with standard base64', () => ({...tokens.good.relay, protectedHeader: JWS_HEADER_B64 + '='}), /header is/],
    ['an empty payload', () => ({...tokens.good.relay, payload: ''}), /1\.\.1368/],
    ['a payload over 1368 characters', () => ({...tokens.good.relay, payload: 'A'.repeat(1369)}), /1\.\.1368/],
    ['a payload that is not base64url', () => ({...tokens.good.relay, payload: tokens.good.relay.payload.replace(/^./, '+')}), /not unpadded base64url/],
    ['a payload that is not JSON', () => ({...tokens.good.relay, payload: Buffer.from('not json').toString('base64url')}), /not JSON/],
    ['a JSON payload over 1024 bytes', () => ({...tokens.good.relay, payload: Buffer.from(JSON.stringify({x: 'y'.repeat(1018)})).toString('base64url')}), /reads at most 1024/],
    ['a 63-byte signature', () => ({...tokens.good.relay, signature: Buffer.alloc(63, 1).toString('base64url')}), /63 bytes/],
    ['a zero signature', () => ({...tokens.good.relay, signature: Buffer.alloc(64).toString('base64url')}), /out of range/],
  ])('refuses %s (E2016)', (_l, jws, message) => {
    const r = refusal(() => integrityTokenInputs(jws(), expect_));
    expect(r.code).toBe('E2016');
    expect(r.message).toMatch(message);
  });

  it('refuses a verdict without the three sections', () => {
    const payload = Buffer.from(JSON.stringify({requestDetails: {}})).toString('base64url');
    expect(refusal(() => integrityTokenInputs({...tokens.good.relay, payload}, expect_)).message).toMatch(/lacks requestDetails, appIntegrity or deviceIntegrity/);
  });
});

describe('the relay that decrypts the token', () => {
  const BASE = 'https://stg-relay.zkproofport.app';
  const answer = (status: number, body: unknown) =>
    jest.fn(async (_url: string, _init: unknown) => ({ok: status >= 200 && status < 300, status, json: async () => body}));

  it('POSTs {token} to /api/v1/play-integrity/decrypt and returns the three segments', async () => {
    const f = answer(200, tokens.good.relay);
    expect(await decryptIntegrityTokenViaRelay('jwe.token', {baseUrl: BASE, fetchImpl: f as never})).toEqual(tokens.good.relay);
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0] as unknown as [string, {method: string; headers: Record<string, string>; body: string}];
    expect(url).toBe(`${BASE}${PLAY_INTEGRITY_DECRYPT_PATH}`);
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({token: 'jwe.token'});
  });

  it.each([
    [400, 'token_missing', 'E2016'],
    [400, 'token_not_string', 'E2016'],
    [400, 'token_malformed', 'E2016'],
    [400, 'jwe_unsupported', 'E2016'],
    [400, 'key_unwrap_failed', 'E2016'],
    [400, 'decrypt_failed', 'E2016'],
    [400, 'not_a_jws', 'E2016'],
    [400, 'jws_unsupported', 'E2016'],
    [400, 'body_malformed', 'E2016'],
    [422, 'signature_invalid', 'E2016'],
    [413, 'body_too_large', 'E2016'],
    [400, 'a_reason_added_later', 'E2016'],
    [404, undefined, 'E3008'],
    [404, 'a_reason_added_later', 'E2016'],
    [429, undefined, 'E3008'],
    [503, 'not_configured', 'E3008'],
    [500, undefined, 'E3008'],
    [502, undefined, 'E3008'],
  ])('HTTP %s %s -> %s, naming it', async (status, reason, code) => {
    const r = await asyncRefusal(decryptIntegrityTokenViaRelay('t', {baseUrl: BASE, fetchImpl: answer(status, reason ? {error: 'x', reason} : {error: 'x'}) as never}));
    expect(r.code).toBe(code);
    expect(r.message).toContain(String(status));
    if (reason) expect(r.message).toContain(reason);
  });

  it.each([
    ['the network fails', jest.fn(async () => {
      throw new TypeError('Network request failed');
    }), 'E3008', /could not be reached: Network request failed/],
    ['200 without the segments', answer(200, {protectedHeader: 'x'}), 'E2016', /without \{protectedHeader, payload, signature\}/],
    ['200 that is not JSON', jest.fn(async () => ({ok: true, status: 200, json: async () => {
      throw new SyntaxError('bad');
    }})), 'E2016', /without/],
  ])('%s -> %s', async (_l, f, code, message) => {
    const r = await asyncRefusal(decryptIntegrityTokenViaRelay('t', {baseUrl: BASE, fetchImpl: f as never}));
    expect(r.code).toBe(code);
    expect(r.message).toMatch(message);
  });

  it('times out as E3008', async () => {
    const never = jest.fn((_u: string, init: {signal?: AbortSignal}) => new Promise((_res, rej) => {
      init.signal?.addEventListener('abort', () => rej(new Error('aborted')));
    }));
    const r = await asyncRefusal(decryptIntegrityTokenViaRelay('t', {baseUrl: BASE, fetchImpl: never as never, timeoutMs: 10}));
    expect(r.code).toBe('E3008');
  });

  it('refuses an empty token without calling the relay, and a base URL with a path or plain http', async () => {
    const f = answer(200, tokens.good.relay);
    expect((await asyncRefusal(decryptIntegrityTokenViaRelay('', {baseUrl: BASE, fetchImpl: f as never}))).code).toBe('E2016');
    await expect(decryptIntegrityTokenViaRelay('t', {baseUrl: `${BASE}/api`, fetchImpl: f as never})).rejects.toThrow(/https:\/\/host/);
    await expect(decryptIntegrityTokenViaRelay('t', {baseUrl: 'http://relay.zkproofport.app', fetchImpl: f as never})).rejects.toThrow(/https:\/\/host/);
    expect(f).not.toHaveBeenCalled();
  });
});
