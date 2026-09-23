import {ALL_CIRCUIT_IDS, isCircuitId, type CircuitName} from '../config/circuitIds';
import type {ProofRequest} from './deeplink';

export type ProofRequestPresentationIcon =
  | 'organization' | 'identity' | 'country' | 'document' | 'id-card' | 'age' | 'region';
export interface ProofRequestPresentation {
  icon: ProofRequestPresentationIcon;
  title: string;
  conditions: {label: string; value: unknown}[];
  shared: string;
  private: string;
}
type Translate = (key: string, options?: Record<string, unknown>) => string;
type ConditionField = 'domain' | 'provider' | 'countryList' | 'isIncluded'
  | 'discloseFlags' | 'ageThreshold' | 'currentYear' | 'targetRegion';
interface PresentationDefinition {
  icon: ProofRequestPresentationIcon;
  section: string;
  fields: readonly ConditionField[];
  requirement?: string;
}

// Public/private claims follow each circuit's main.nr public inputs, not the
// original request: useDeepLink also returns that already-known request data.
const PRESENTATIONS = {
  oidc_domain_attestation: {icon: 'organization', section: 'oidc', fields: ['domain', 'provider']},
  coinbase_attestation: {icon: 'identity', section: 'kyc', fields: [], requirement: 'kyc.requirement'},
  coinbase_country_attestation: {icon: 'country', section: 'country', fields: ['countryList', 'isIncluded']},
  arc_eligibility: {icon: 'document', section: 'arc', fields: [], requirement: 'arc.requirement'},
  giwa_attestation: {icon: 'identity', section: 'giwa', fields: [], requirement: 'giwa.requirement'},
  mdl_kr_ownership: {icon: 'id-card', section: 'ownership', fields: ['discloseFlags'], requirement: 'ownership.requirement'},
  mdl_kr_age: {icon: 'age', section: 'age', fields: ['ageThreshold', 'currentYear']},
  mdl_kr_region: {icon: 'region', section: 'region', fields: ['targetRegion']},
} satisfies Record<CircuitName, PresentationDefinition>;

const FIELD_LABELS: Record<ConditionField, string> = {
  domain: 'organization', provider: 'provider', countryList: 'countries', isIncluded: 'countryRule',
  discloseFlags: 'disclosures', ageThreshold: 'ageThreshold', currentYear: 'currentYear', targetRegion: 'targetRegion',
};
// These remain available in the original-input/typed-action review cards.
const TECHNICAL_FIELDS = new Set(['scope', 'scopeString', 'action', 'rawTransaction', 'signalHash', 'metadata']);
// The circuit uses these exact NAME/BIRTH/SEX/TELNO bits; do not import mdlKr's
// prover/crypto dependency graph into a presentation-only module.
const DISCLOSURES = [[1, 'name'], [2, 'birth'], [4, 'sex'], [8, 'telno']] as const;
const PROVIDERS: Readonly<Record<string, string>> = Object.freeze({google: 'google', microsoft: 'microsoft'});
const PREFIX = 'host.proofRequest.presentation.';

function suppliedValue(value: unknown, t: Translate): unknown {
  if (value === undefined) return t(PREFIX + 'values.notProvided');
  if (value === null) return t(PREFIX + 'values.null');
  if (value === '') return t(PREFIX + 'values.empty');
  return value;
}

function conditionValue(field: ConditionField, value: unknown, t: Translate): unknown {
  if (value === undefined || value === null || value === '') return suppliedValue(value, t);
  if (field === 'domain' && typeof value === 'string') return t(PREFIX + 'values.domainAccount', {domain: value});
  if (field === 'provider' && typeof value === 'string') {
    if (!Object.prototype.hasOwnProperty.call(PROVIDERS, value)) {
      return t(PREFIX + 'values.unknownProvider', {provider: value});
    }
    return t(PREFIX + 'providers.' + PROVIDERS[value]);
  }
  if (field === 'countryList' && Array.isArray(value)) {
    if (value.length === 0) return t(PREFIX + 'values.emptyList');
    if (value.every(country => typeof country === 'string' && country.length > 0)) return value.join(' · ');
  }
  if (field === 'isIncluded' && typeof value === 'boolean') {
    return t(PREFIX + (value ? 'values.countryIncluded' : 'values.countryExcluded'));
  }
  if (field === 'discloseFlags' && typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 15) {
    if (value === 0) return t(PREFIX + 'values.noAttributes');
    return DISCLOSURES.filter(([bit]) => (value & bit) !== 0)
      .map(([, attribute]) => t(PREFIX + 'attributes.' + attribute)).join(' · ');
  }
  // Display unexpected types and out-of-range flags verbatim. This module does
  // not validate, coerce, mask flags, infer missing values, or change a request.
  return value;
}

export function getProofRequestPresentation(request: Pick<ProofRequest, 'circuit' | 'inputs'> & Partial<Omit<ProofRequest, 'circuit' | 'inputs'>>, t: Translate): ProofRequestPresentation {
  if (!isCircuitId(request.circuit)) {
    throw new Error(`Unknown circuit '${request.circuit}'. Known: ${ALL_CIRCUIT_IDS.join(', ')}`);
  }
  const definition: PresentationDefinition = PRESENTATIONS[request.circuit];
  if (!definition) throw new Error(`No presentation for circuit '${request.circuit}'`);
  const inputs: Record<string, unknown> = request.inputs !== null && typeof request.inputs === 'object' && !Array.isArray(request.inputs)
    ? request.inputs as Record<string, unknown> : {};
  const conditions: ProofRequestPresentation['conditions'] = [];
  if (definition.requirement) {
    conditions.push({label: t(PREFIX + 'fields.requirement'), value: t(PREFIX + definition.requirement)});
  }
  for (const field of definition.fields) {
    conditions.push({label: t(PREFIX + 'fields.' + FIELD_LABELS[field]), value: conditionValue(field, inputs[field], t)});
  }
  if (Object.prototype.hasOwnProperty.call(inputs, 'userAddress')) {
    conditions.push({label: t(PREFIX + 'fields.userAddress'), value: suppliedValue(inputs.userAddress, t)});
  }
  const presentedFields = new Set<string>([...definition.fields, 'userAddress']);
  for (const [field, value] of Object.entries(inputs)) {
    if (presentedFields.has(field) || TECHNICAL_FIELDS.has(field)) continue;
    // Extra keys are request data, not supported predicates. Keep the exact
    // key/value reviewable without promising that this circuit enforces them.
    conditions.push({label: t(PREFIX + 'fields.additional', {field}), value});
  }
  return {
    icon: definition.icon,
    title: t(PREFIX + definition.section + '.title'),
    conditions,
    shared: t(PREFIX + definition.section + '.shared'),
    private: t(PREFIX + definition.section + '.private'),
  };
}
