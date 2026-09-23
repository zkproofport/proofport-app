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
    expect(presentations).toHaveLength(8);
    expect(new Set(presentations.map(p => p.title)).size).toBe(8);
    expect(presentations.every(p => p.conditions.length > 0 && p.shared && p.private)).toBe(true);
    expect(present('oidc_domain_attestation').icon).toBe('organization');
    expect(present('coinbase_attestation').icon).toBe('identity');
    expect(present('coinbase_country_attestation').icon).toBe('country');
    expect(present('mdl_kr_ownership').icon).toBe('id-card');
    expect(present('mdl_kr_age').icon).toBe('age');
    expect(present('mdl_kr_region').icon).toBe('region');
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

  it('keeps zero age/year and precise large strings rather than applying defaults', () => {
    const precise = '90071992547409931234';
    expect(present('mdl_kr_age', {ageThreshold: 0, currentYear: 0}).conditions).toEqual([
      {label: 'fields.ageThreshold', value: 0}, {label: 'fields.currentYear', value: 0},
    ]);
    expect(present('mdl_kr_age', {ageThreshold: precise}).conditions[0].value).toBe(precise);
    expect(present('mdl_kr_age', {ageThreshold: null}).conditions[0].value).toBe('values.null');
  });

  it('distinguishes the region predicate from ownership and preserves its exact region', () => {
    expect(present('mdl_kr_region', {targetRegion: '서울특별시'}).conditions).toEqual([
      {label: 'fields.targetRegion', value: '서울특별시'},
    ]);
    expect(present('mdl_kr_region', {targetRegion: ''}).conditions[0].value).toBe('values.empty');
  });

  it('explains every selected mDL commitment flag and anonymous zero without masking unknown bits', () => {
    const selected = present('mdl_kr_ownership', {discloseFlags: 15}).conditions;
    expect(selected).toContainEqual({label: 'fields.disclosures', value: 'attributes.name · attributes.birth · attributes.sex · attributes.telno'});
    expect(present('mdl_kr_ownership', {discloseFlags: 0}).conditions)
      .toContainEqual({label: 'fields.disclosures', value: 'values.noAttributes'});
    expect(present('mdl_kr_ownership', {discloseFlags: 16}).conditions)
      .toContainEqual({label: 'fields.disclosures', value: 16});
    expect(present('mdl_kr_ownership', {discloseFlags: '8'}).conditions)
      .toContainEqual({label: 'fields.disclosures', value: '8'});
  });

  it('labels supplied comparison values as requested values without asserting they are proof outputs', () => {
    const result = present('mdl_kr_ownership', {discloseFlags: 9, expectedName: '홍길동', expectedTelno: '01012345678'});
    expect(result.conditions).toContainEqual({label: 'Additional condition: expectedName', value: '홍길동'});
    expect(result.conditions).toContainEqual({label: 'Additional condition: expectedTelno', value: '01012345678'});
    expect(result.shared).toBe('ownership.shared');
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
    expect(result.conditions.find(row => row.label.endsWith('unknownObject'))?.value).toBe(nested);
  });

  it.each(['not-a-circuit', '__proto__', 'constructor'])('refuses unknown circuit %s', circuit => {
    expect(() => present(circuit as ProofRequest['circuit'])).toThrow(circuit);
  });
});
