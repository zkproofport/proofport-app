/**
 * The deep link's inputs against the relay's hashes (src/utils/inputsHash.ts).
 *
 * The expected digests are computed here with node:crypto from strings written
 * out by hand, the way proofport-relay's own inputsHash.test.ts does, so the
 * app and the relay are held to the same bytes without importing each other.
 */
import {
  MAX_INPUTS_DEPTH,
  canonicalJson,
  checkInputsHash,
  computeInputsHashV2,
  computeLegacyInputsHash,
} from '../inputsHash';

jest.mock('../../config/environment', () => ({
  getRelayConfig: () => ({trustedHosts: ['relay.zkproofport.app'], allowPrivateIps: false}),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {validateRequestWithRelay} = require('../deeplink') as typeof import('../deeplink');

// Required, not imported: an `import from 'crypto'` pulls node's global fetch
// and AbortSignal types into the whole tsc program and breaks RN's.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {createHash} = require('crypto') as {createHash(alg: string): {update(s: string): {digest(enc: 'hex'): string}}};
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

/** The giwa_attestation shape: the action is a nested object. */
const giwa = (value: string) => ({
  scope: 'dapp.example',
  userAddress: '0x1111111111111111111111111111111111111111',
  action: {kind: 'transfer', to: '0x2222222222222222222222222222222222222222', value, chainId: 91342},
});

describe('the app hashes exactly what the relay hashes', () => {
  it('canonical V2: keys sorted at every depth, arrays in order, no whitespace', () => {
    const inputs = {scope: 'demo.example', b: [3, 1, {z: true, a: null}], a: {y: '나이', x: 1.5}};
    const expected = '{"a":{"x":1.5,"y":"나이"},"b":[3,1,{"a":null,"z":true}],"scope":"demo.example"}';
    expect(canonicalJson(inputs)).toBe(expected);
    expect(computeInputsHashV2(inputs)).toBe(sha256(expected));
  });

  it('legacy: the shipped algorithm, nested objects reduced to top-level keys', () => {
    expect(computeLegacyInputsHash({scope: 'myapp.com', userAddress: '0x1234'}))
      .toBe(sha256('{"scope":"myapp.com","userAddress":"0x1234"}'));
    expect(computeLegacyInputsHash(giwa('1'))).toBe(sha256(
      '{"action":{},"scope":"dapp.example","userAddress":"0x1111111111111111111111111111111111111111"}',
    ));
  });

  it.each([
    ['empty', {}],
    ['Korean, emoji, newline, tab', {scope: '홍길동 🪪 Ωmega\n\t'}],
    ['a lone surrogate (escaped by JSON.stringify)', {scope: '\ud800x'}],
    ['wildcards and escapes', {scope: '%_\\"<script>'}],
    ['numbers', {a: 0, b: -1, c: 1e21, d: 0.1}],
  ])('%s: V2 equals node:crypto over the canonical string', (_label, inputs) => {
    expect(computeInputsHashV2(inputs)).toBe(sha256(canonicalJson(inputs)));
  });

  it('flat inputs give the same hash both ways (so the two cannot disagree)', () => {
    const flat = {scope: 's', countryList: ['KR', 'US'], isIncluded: false};
    expect(computeInputsHashV2(flat)).toBe(computeLegacyInputsHash(flat));
  });

  it('refuses input nested deeper than the relay would hash', () => {
    let deep: unknown = 1;
    for (let i = 0; i < MAX_INPUTS_DEPTH + 1; i++) deep = [deep];
    expect(() => computeInputsHashV2({deep})).toThrow(/nested more than/);
    let ok: unknown = 1;
    for (let i = 0; i < MAX_INPUTS_DEPTH - 1; i++) ok = [ok];
    expect(() => computeInputsHashV2({ok})).not.toThrow();
  });
});

describe('checkInputsHash', () => {
  const inputs = giwa('1');
  const v2 = computeInputsHashV2(inputs);
  const legacy = computeLegacyInputsHash(inputs);

  it('V2 present and matching: accepted, checked with V2', () => {
    expect(checkInputsHash({inputsHash: legacy, inputsHashV2: v2}, inputs)).toEqual({ok: true, checked: 'v2'});
  });

  it('a tampered NESTED value is refused by V2 — the legacy hash could not see it', () => {
    const tampered = giwa('1000000');
    expect(computeLegacyInputsHash(tampered)).toBe(legacy);
    expect(checkInputsHash({inputsHash: legacy, inputsHashV2: v2}, tampered)).toMatchObject({ok: false, checked: 'v2'});
  });

  it('a tampered top-level value is refused by V2', () => {
    expect(checkInputsHash({inputsHash: legacy, inputsHashV2: v2}, {...inputs, scope: 'evil.example'}))
      .toMatchObject({ok: false, checked: 'v2'});
  });

  it('when V2 is present the legacy hash is not consulted, either way', () => {
    expect(checkInputsHash({inputsHash: 'f'.repeat(64), inputsHashV2: v2}, inputs)).toEqual({ok: true, checked: 'v2'});
    expect(checkInputsHash({inputsHash: legacy, inputsHashV2: 'f'.repeat(64)}, inputs)).toMatchObject({ok: false, checked: 'v2'});
  });

  it('only the legacy hash (a relay from before V2): checked with legacy, both ways', () => {
    expect(checkInputsHash({inputsHash: legacy}, inputs)).toEqual({ok: true, checked: 'legacy'});
    expect(checkInputsHash({inputsHash: legacy}, {...inputs, scope: 'evil.example'})).toMatchObject({ok: false, checked: 'legacy'});
  });

  it.each([
    ['uppercase hex', v2.toUpperCase()],
    ['a 0x prefix', `0x${v2}`],
    ['too short', v2.slice(0, 63)],
    ['empty string', ''],
    ['a number', 12345],
    ['an object', {hash: v2}],
    ['true', true],
  ])('an unusable inputsHashV2 (%s) is a refusal, never a fall back to legacy', (_label, value) => {
    expect(checkInputsHash({inputsHash: legacy, inputsHashV2: value}, inputs)).toMatchObject({ok: false, checked: 'v2'});
  });

  it('inputs that cannot be hashed are refused, not thrown', () => {
    let deep: unknown = 1;
    for (let i = 0; i < MAX_INPUTS_DEPTH + 2; i++) deep = [deep];
    expect(checkInputsHash({inputsHashV2: v2}, {deep})).toMatchObject({ok: false, reason: expect.stringMatching(/cannot be hashed/)});
  });

  it('neither hash present, or no local inputs: nothing to compare (unchanged behaviour)', () => {
    expect(checkInputsHash({}, inputs)).toEqual({ok: true, checked: 'none'});
    expect(checkInputsHash({inputsHashV2: null}, inputs)).toEqual({ok: true, checked: 'none'});
    expect(checkInputsHash({inputsHashV2: v2}, undefined)).toEqual({ok: true, checked: 'none'});
  });
});

describe('validateRequestWithRelay uses it', () => {
  const CALLBACK = 'https://relay.zkproofport.app/api/v1/proof/callback';
  const REQUEST_ID = '7f27684b-4b8f-4f68-bd88-4d805dc3b3d2';
  const inputs = giwa('1');

  function relayAnswers(body: Record<string, unknown>) {
    (globalThis as {fetch?: unknown}).fetch = jest.fn(async () => ({ok: true, status: 200, json: async () => body}));
  }

  afterEach(() => {
    delete (globalThis as {fetch?: unknown}).fetch;
  });

  it('accepts matching V2', async () => {
    relayAnswers({status: 'pending', inputsHash: computeLegacyInputsHash(inputs), inputsHashV2: computeInputsHashV2(inputs)});
    await expect(validateRequestWithRelay(REQUEST_ID, CALLBACK, inputs)).resolves.toEqual({valid: true});
  });

  it('refuses a nested tamper that the legacy hash alone would have let through', async () => {
    relayAnswers({status: 'pending', inputsHash: computeLegacyInputsHash(inputs), inputsHashV2: computeInputsHashV2(inputs)});
    const result = await validateRequestWithRelay(REQUEST_ID, CALLBACK, giwa('1000000'));
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/integrity check failed/);
  });

  it('still checks the legacy hash from a relay that sends only that', async () => {
    relayAnswers({status: 'pending', inputsHash: computeLegacyInputsHash(inputs)});
    await expect(validateRequestWithRelay(REQUEST_ID, CALLBACK, inputs)).resolves.toEqual({valid: true});
    const result = await validateRequestWithRelay(REQUEST_ID, CALLBACK, {...inputs, scope: 'evil.example'});
    expect(result.valid).toBe(false);
  });
});
