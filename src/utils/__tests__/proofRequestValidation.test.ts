/*
 * WHY THIS EXISTS. `validateProofRequest` is what stands between a deep link
 * somebody wrote and the prover running on this phone, and `isProofportDeepLink`
 * decides whether a URL is treated as one of ours at all. Both were exported,
 * both were reachable from a link an app on the device can send, and neither
 * appeared in a single test.
 *
 * The circuit allow-list matters beyond input hygiene. CLAUDE.md pins the
 * canonical ids (`coinbase_attestation`, never `coinbase-kyc`, never
 * `CoinbaseKyc`) because the same string is the nullifier scope, the on-chain
 * lookup key and the DB column — a near-miss does not fail loudly, it fails as
 * "proof generated, nothing recognises it". So the list is asserted by name
 * here, and an invented spelling has to be refused.
 */
import {validateProofRequest, isProofportDeepLink} from '../deeplink';
import type {ProofRequest} from '../deeplink';

/** The seven ids the app accepts. Written out so a silent addition shows up. */
const CANONICAL = [
  'coinbase_attestation',
  'coinbase_country_attestation',
  'oidc_domain_attestation',
  'giwa_attestation',
  'mdl_kr_ownership',
  'mdl_kr_age',
  'mdl_kr_region',
];

const base = (over: Partial<ProofRequest> = {}): ProofRequest =>
  ({
    requestId: '7f27684b-4b8f-4f68-bd88-4d805dc3b3d2',
    circuit: 'coinbase_attestation',
    inputs: {scope: 'zkproofport'},
    callbackUrl: 'https://relay.zkproofport.app/api/v1/proof/callback',
    ...over,
  } as ProofRequest);

describe('a proof request is checked before the prover runs', () => {
  it.each([
    ['requestId', {requestId: ''}, /Missing requestId/],
    ['circuit', {circuit: ''}, /Missing circuit/],
    ['callbackUrl', {callbackUrl: ''}, /Missing callbackUrl/],
  ])('refuses a request with no %s', (_l, over, msg) => {
    const r = validateProofRequest(base(over as Partial<ProofRequest>));
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(msg);
  });

  it('accepts every canonical circuit id', () => {
    for (const circuit of CANONICAL) {
      const inputs: Record<string, unknown> = {scope: 'zkproofport'};
      if (circuit === 'coinbase_country_attestation') {
        inputs.countryList = ['US'];
        inputs.isIncluded = true;
      }
      const r = validateProofRequest(base({circuit, inputs} as Partial<ProofRequest>));
      expect({circuit, ...r}).toMatchObject({circuit, valid: true});
    }
  });

  it.each([
    'coinbase-kyc',
    'CoinbaseKyc',
    'coinbase_attestation ',
    'COINBASE_ATTESTATION',
    'coinbase_attestation_v2',
    'attestation',
    '../coinbase_attestation',
  ])('refuses the invented spelling %s', (circuit) => {
    const r = validateProofRequest(base({circuit} as Partial<ProofRequest>));
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/Invalid circuit type/);
  });

  it('coinbase_attestation needs a scope', () => {
    expect(validateProofRequest(base({inputs: {}} as Partial<ProofRequest>)).error).toMatch(
      /Missing required scope/,
    );
  });

  it.each([
    ['not hex', '0xZZZZ'],
    ['too short', '0x1234'],
    ['no prefix', 'a'.repeat(40)],
    ['too long', `0x${'a'.repeat(41)}`],
  ])('refuses a userAddress that is %s', (_l, userAddress) => {
    const r = validateProofRequest(
      base({inputs: {scope: 'zkproofport', userAddress}} as Partial<ProofRequest>),
    );
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/Invalid userAddress/);
  });

  it('accepts a well-formed userAddress, and accepts none at all', () => {
    const good = `0x${'a'.repeat(40)}`;
    expect(
      validateProofRequest(base({inputs: {scope: 'x', userAddress: good}} as Partial<ProofRequest>))
        .valid,
    ).toBe(true);
    expect(validateProofRequest(base({inputs: {scope: 'x'}} as Partial<ProofRequest>)).valid).toBe(
      true,
    );
  });

  it.each([
    ['no countryList', {isIncluded: true}, /countryList is required/],
    ['empty countryList', {countryList: [], isIncluded: true}, /countryList is required/],
    ['countryList not an array', {countryList: 'US', isIncluded: true}, /countryList is required/],
    ['no isIncluded', {countryList: ['US']}, /isIncluded is required/],
    ['isIncluded not a boolean', {countryList: ['US'], isIncluded: 'yes'}, /isIncluded is required/],
  ])('country attestation with %s is refused', (_l, inputs, msg) => {
    const r = validateProofRequest(
      base({circuit: 'coinbase_country_attestation', inputs} as Partial<ProofRequest>),
    );
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(msg);
  });

  it('oidc_domain_attestation needs a scope', () => {
    const r = validateProofRequest(
      base({circuit: 'oidc_domain_attestation', inputs: {}} as Partial<ProofRequest>),
    );
    expect(r.valid).toBe(false);
    expect(r.error).toMatch(/scope/);
  });
});

describe('only our own proof links are treated as ours', () => {
  it.each([
    'zkproofport://proof-request?data=abc',
    'ZKPROOFPORT://PROOF-REQUEST?data=abc',
    'zkproofport://proof-request',
  ])('accepts %s', (url) => {
    expect(isProofportDeepLink(url)).toBe(true);
  });

  it.each([
    ['another app entirely', 'evilapp://proof-request?data=abc'],
    ['our scheme, a different action', 'zkproofport://wallet-callback?x=1'],
    ['https, not our scheme', 'https://zkproofport.app/proof-request'],
    ['scheme as a path', 'https://evil.test/zkproofport://proof-request'],
    ['empty', ''],
  ])('refuses %s', (_l, url) => {
    expect(isProofportDeepLink(url)).toBe(false);
  });

  it('the check is a prefix, with no boundary after "proof-request"', () => {
    // Recorded as observed, not endorsed: `proof-requestXYZ` also matches.
    // Harmless today because parsing happens afterwards and rejects nonsense,
    // but if that ever stops being true, this is where the assumption lives.
    expect(isProofportDeepLink('zkproofport://proof-requestXYZ')).toBe(true);
  });
});
