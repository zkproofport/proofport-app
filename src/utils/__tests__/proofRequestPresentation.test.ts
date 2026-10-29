import {ALL_CIRCUIT_IDS} from '../../config/circuitIds';
import type {ProofRequest} from '../deeplink';
import {getProofRequestPresentation} from '../proofRequestPresentation';

const t = (key: string, options?: Record<string, unknown>): string => {
  const suffix = key.replace('host.proofRequest.presentation.', '');
  if (suffix === 'values.domainAccount') return `${options?.domain} account ownership`;
  if (suffix === 'fields.additional') return `Additional condition: ${options?.field}`;
  if (suffix === 'values.unknownProvider') return `Unknown provider: ${options?.provider}`;
  return suffix;
};
const request = (circuit: ProofRequest['circuit'], inputs: Record<string, unknown> = {}): ProofRequest => ({
  circuit, inputs, requestId: 'review', callbackUrl: 'https://requester.test/callback', createdAt: 1,
});
const present = (circuit: ProofRequest['circuit'], inputs?: Record<string, unknown>) =>
  getProofRequestPresentation(request(circuit, inputs), t);

describe('readable circuit-specific proof request conditions', () => {
  it('covers every published circuit with its own purpose and privacy summary', () => {
    const presentations = ALL_CIRCUIT_IDS.map(circuit => present(circuit));
    expect(presentations).toHaveLength(ALL_CIRCUIT_IDS.length);
    expect(new Set(presentations.map(p => p.title)).size).toBe(ALL_CIRCUIT_IDS.length);
    expect(presentations.every(p => p.conditions.length > 0 && p.shared && p.private)).toBe(true);
    expect(present('oidc_domain_attestation').icon).toBe('organization');
    expect(present('coinbase_attestation').icon).toBe('identity');
    expect(present('coinbase_country_attestation').icon).toBe('country');
  });

  it('gives a circuit\'s own requirement no label of its own, so it is not titled twice', () => {
    for (const [circuit, section] of [['coinbase_attestation', 'kyc'], ['giwa_attestation', 'giwa'],
      ['dojang_playground', 'dojangPlayground']] as const) {
      expect(present(circuit).conditions[0]).toEqual({value: `${section}.requirement`});
    }
    for (const circuit of ALL_CIRCUIT_IDS) {
      expect(present(circuit).conditions.some(row => row.label === 'fields.requirement')).toBe(false);
    }
  });

  it('describes the requested organization and explicit provider', () => {
    const result = present('oidc_domain_attestation', {domain: 'masselabs.com', provider: 'microsoft'});
    expect(result.conditions).toEqual([
      {label: 'fields.organization', value: 'masselabs.com account ownership'},
      {label: 'fields.provider', value: 'providers.microsoft'},
    ]);
    expect(result.shared).toBe('oidc.shared');
    expect(result.private).toBe('oidc.private');
  });

  it('never invents an OIDC provider or fills an empty domain', () => {
    expect(present('oidc_domain_attestation', {domain: '', provider: null}).conditions).toEqual([
      {label: 'fields.organization', value: 'values.empty'},
      {label: 'fields.provider', value: 'values.null'},
    ]);
    expect(present('oidc_domain_attestation').conditions.every(row => row.value === 'values.notProvided')).toBe(true);
    expect(present('oidc_domain_attestation', {provider: 'unknown-provider'}).conditions[1].value)
      .toBe('Unknown provider: unknown-provider');
  });

  it('shows exclusion for false and inclusion for true without changing countries', () => {
    const countries = Object.freeze(['KR', 'US']);
    expect(present('coinbase_country_attestation', {countryList: countries, isIncluded: false}).conditions).toEqual([
      {label: 'fields.countries', value: 'KR · US'},
      {label: 'fields.countryRule', value: 'values.countryExcluded'},
    ]);
    expect(present('coinbase_country_attestation', {countryList: countries, isIncluded: true}).conditions[1].value)
      .toBe('values.countryIncluded');
    expect(countries).toEqual(['KR', 'US']);
  });

  it('shows fields no circuit here reads as additional conditions, verbatim', () => {
    const precise = '90071992547409931234';
    const result = present('coinbase_attestation', {discloseFlags: 15, ageThreshold: precise, targetRegion: '서울특별시'});
    expect(result.conditions).toContainEqual({label: 'Additional condition: discloseFlags', value: 15});
    expect(result.conditions).toContainEqual({label: 'Additional condition: ageThreshold', value: precise});
    expect(result.conditions).toContainEqual({label: 'Additional condition: targetRegion', value: '서울특별시'});
  });

  it('keeps the authentication wallet distinct from a typed-action account and does not mutate inputs', () => {
    const action = Object.freeze({message: Object.freeze({account: 'action account', amount: '1000000000000000001'})});
    const inputs = Object.freeze({userAddress: 'authentication wallet', action, scope: 'private scope', rawTransaction: '0x1234'});
    const result = present('giwa_attestation', inputs);
    expect(result.conditions).toContainEqual({label: 'fields.userAddress', value: 'authentication wallet'});
    expect(result.conditions.some(row => row.value === action || row.value === 'private scope' || row.value === '0x1234')).toBe(false);
    expect(inputs.action.message.account).toBe('action account');
  });

  it('keeps additional requested fields reviewable without coercing false, bigints or objects', () => {
    const nested = Object.freeze({allow: false});
    const inputs = Object.freeze({unknownBoolean: false, unknownNumber: 0, unknownLarge: BigInt('9007199254740993'), unknownObject: nested});
    const result = present('coinbase_attestation', inputs);
    for (const [field, value] of Object.entries(inputs)) {
      expect(result.conditions).toContainEqual({label: `Additional condition: ${field}`, value});
    }
    expect(result.conditions.find(row => row.label?.endsWith('unknownObject'))?.value).toBe(nested);
  });

  it.each(['not-a-circuit', '__proto__', 'constructor', 'mdl_kr_ownership', 'mdl_kr_age', 'mdl_kr_region'])('refuses unknown circuit %s', circuit => {
    expect(() => present(circuit as ProofRequest['circuit'])).toThrow(circuit);
  });
});
