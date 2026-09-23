import {ALL_CIRCUIT_IDS, type CircuitName} from '../config/circuitIds';
import {getProofRequestPresentation} from '../utils/proofRequestPresentation';
import type {ProofRequest} from '../utils/deeplink';

/** The outline describes the predicate, without inventing an issuer country. */
const expectedIcons: Record<CircuitName, string> = {
  oidc_domain_attestation: 'organization',
  coinbase_attestation: 'identity',
  coinbase_country_attestation: 'country',
  arc_eligibility: 'document',
  giwa_attestation: 'identity',
  mdl_kr_ownership: 'id-card',
  mdl_kr_age: 'age',
  mdl_kr_region: 'region',
};

describe('a circuit icon does not claim a country', () => {
  it('covers every canonical circuit without an emoji fallback', () => {
    expect(Object.keys(expectedIcons).sort()).toEqual([...ALL_CIRCUIT_IDS].sort());
  });

  it.each(ALL_CIRCUIT_IDS)('%s uses its semantic outline icon', circuit => {
    const request: ProofRequest = {
      requestId: 'icon-review', circuit, inputs: {scope: 'app', provider: 'google'},
      callbackUrl: 'https://relay.example/callback', createdAt: 1,
    };
    const presentation = getProofRequestPresentation(request, key => key);
    expect(presentation.icon).toBe(expectedIcons[circuit]);
  });
});
