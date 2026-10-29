import {ALL_CIRCUIT_IDS, isCircuitId, type CircuitName} from '../config/circuitIds';
import type {ProofRequest} from './deeplink';

export type ProofRequestPresentationIcon =
  | 'organization' | 'identity' | 'country' | 'document';
export interface ProofRequestPresentation {
  icon: ProofRequestPresentationIcon;
  title: string;
  /** A row without a label is the circuit's own requirement: the section heading already names it. */
  conditions: {label?: string; value: unknown}[];
  shared: string;
  private: string;
}
type Translate = (key: string, options?: Record<string, unknown>) => string;
type ConditionField = 'domain' | 'provider' | 'countryList' | 'isIncluded';
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
  giwa_attestation: {icon: 'identity', section: 'giwa', fields: [], requirement: 'giwa.requirement'},
  dojang_playground: {icon: 'identity', section: 'dojangPlayground', fields: [], requirement: 'dojangPlayground.requirement'},
} satisfies Record<CircuitName, PresentationDefinition>;

const FIELD_LABELS: Record<ConditionField, string> = {
  domain: 'organization', provider: 'provider', countryList: 'countries', isIncluded: 'countryRule',
};
// These remain available in the original-input/typed-action review cards.
const TECHNICAL_FIELDS = new Set(['scope', 'scopeString', 'action', 'rawTransaction', 'signalHash', 'metadata']);
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
  // Display unexpected types verbatim. This module does not validate, coerce,
  // infer missing values, or change a request.
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
    conditions.push({value: t(PREFIX + definition.requirement)});
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
