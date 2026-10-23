import type {NativeStackNavigationProp} from '@react-navigation/native-stack';
import type {CircuitName} from '../../config/circuitIds';
import type {ProofStackParamList} from '../../navigation/types';

export const PROOF_PURPOSES = ['all', 'organization', 'identity', 'country'] as const;
export type ProofPurpose = typeof PROOF_PURPOSES[number];
export type ProofSurface = 'home' | 'laboratory';
type CatalogNavigation = Pick<NativeStackNavigationProp<ProofStackParamList>, 'navigate'>;

type CatalogDetails = {
  surface: ProofSurface;
  purpose: Exclude<ProofPurpose, 'all'>;
  icon: 'organization' | 'identity' | 'country' | 'document' | 'id-card' | 'age' | 'region';
  titleKey: string;
  descriptionKey: string;
  providerKey: string;
  groupKey?: string;
  badgeKey?: string;
  open: (navigation: CatalogNavigation) => void;
};
export type ProofCatalogEntry = CatalogDetails & {id: CircuitName};

// This is presentation metadata, independent of the SDK's download tiers.
// Every laboratory entry is active, including the three Korea Mobile ID proofs.
const CATALOG: Readonly<Record<CircuitName, CatalogDetails>> = {
  oidc_domain_attestation: {
    surface: 'home', purpose: 'organization', icon: 'organization',
    titleKey: 'host.proof.home.organization.title',
    descriptionKey: 'host.proof.home.organization.description',
    providerKey: 'host.proof.home.organization.provider',
    open: navigation => navigation.navigate('DomainInput'),
  },
  coinbase_attestation: {
    surface: 'home', purpose: 'identity', icon: 'identity',
    titleKey: 'host.proof.home.identity.title',
    descriptionKey: 'host.proof.home.identity.description',
    providerKey: 'host.proof.home.identity.provider',
    open: navigation => navigation.navigate('ProofGeneration', {circuitId: 'coinbase_attestation'}),
  },
  coinbase_country_attestation: {
    surface: 'home', purpose: 'country', icon: 'country',
    titleKey: 'host.proof.home.country.title',
    descriptionKey: 'host.proof.home.country.description',
    providerKey: 'host.proof.home.country.provider',
    open: navigation => navigation.navigate('CountryInput'),
  },
  giwa_attestation: {
    surface: 'laboratory', purpose: 'identity', icon: 'document',
    titleKey: 'host.proof.laboratory.giwa.title',
    descriptionKey: 'host.proof.laboratory.giwa.description',
    providerKey: 'host.proof.laboratory.giwa.provider',
    badgeKey: 'host.proof.laboratory.beta',
    groupKey: 'host.proof.laboratory.giwa.sectionTitle',
    open: navigation => navigation.navigate('ActionInput', {circuit: 'giwa_attestation'}),
  },
  dojang_playground: {
    surface: 'laboratory', purpose: 'identity', icon: 'document',
    titleKey: 'host.proof.laboratory.dojangPlayground.title',
    descriptionKey: 'host.proof.laboratory.dojangPlayground.description',
    providerKey: 'host.proof.laboratory.dojangPlayground.provider',
    badgeKey: 'host.proof.laboratory.beta',
    groupKey: 'host.proof.laboratory.giwa.sectionTitle',
    open: navigation => navigation.navigate('ActionInput', {circuit: 'dojang_playground'}),
  },
  mdl_kr_ownership: {
    surface: 'laboratory', purpose: 'identity', icon: 'id-card',
    titleKey: 'host.proof.laboratory.ownership.title',
    descriptionKey: 'host.proof.laboratory.ownership.description',
    providerKey: 'host.proof.laboratory.ownership.provider',
    badgeKey: 'host.proof.laboratory.beta',
    groupKey: 'host.proof.laboratory.mobileId',
    open: navigation => navigation.navigate('MdlKrInput', {variant: 'ownership'}),
  },
  mdl_kr_age: {
    surface: 'laboratory', purpose: 'identity', icon: 'age',
    titleKey: 'host.proof.laboratory.age.title',
    descriptionKey: 'host.proof.laboratory.age.description',
    providerKey: 'host.proof.laboratory.age.provider',
    badgeKey: 'host.proof.laboratory.beta',
    groupKey: 'host.proof.laboratory.mobileId',
    open: navigation => navigation.navigate('MdlKrInput', {variant: 'age'}),
  },
  mdl_kr_region: {
    surface: 'laboratory', purpose: 'country', icon: 'region',
    titleKey: 'host.proof.laboratory.region.title',
    descriptionKey: 'host.proof.laboratory.region.description',
    providerKey: 'host.proof.laboratory.region.provider',
    badgeKey: 'host.proof.laboratory.beta',
    groupKey: 'host.proof.laboratory.mobileId',
    open: navigation => navigation.navigate('MdlKrInput', {variant: 'region'}),
  },
};

const normalizeSearch = (value: string) => value.normalize('NFKC').toLowerCase();

export function filterProofCatalog(
  surface: ProofSurface,
  purpose: ProofPurpose,
  query: string,
  translate: (key: string) => string,
): ProofCatalogEntry[] {
  if (surface !== 'home' && surface !== 'laboratory') {
    throw new Error(`Unknown proof surface '${surface}'.`);
  }
  if (!PROOF_PURPOSES.includes(purpose)) {
    throw new Error(`Unknown proof purpose '${purpose}'.`);
  }
  if (typeof query !== 'string') {
    throw new Error('Proof search must be a string.');
  }
  const terms = normalizeSearch(query).trim().split(/\s+/).filter(Boolean);
  return (Object.entries(CATALOG) as [CircuitName, CatalogDetails][])
    .filter(([, entry]) => {
      if (entry.surface !== surface || (purpose !== 'all' && entry.purpose !== purpose)) return false;
      const words = normalizeSearch([
        translate(entry.titleKey), translate(entry.descriptionKey), translate(entry.providerKey),
        translate(`host.proof.home.purposes.${entry.purpose}`),
      ].join(' '));
      return terms.every(term => words.includes(term));
    })
    .map(([id, entry]) => ({id, ...entry}));
}

/**
 * Whether a circuit lives in the Laboratory, answered by this catalog and
 * nowhere else -- the Proof tab, the startup download, the wallet rows and the
 * deep-link gate all ask here, so they cannot disagree about which proofs the
 * Laboratory switch covers. An id the catalog does not hold is an error, never
 * "not a lab proof": `hasOwnProperty`, so `__proto__` is not a circuit either.
 */
export function isLaboratoryCircuit(id: string): boolean {
  if (!Object.prototype.hasOwnProperty.call(CATALOG, id)) {
    throw new Error(`Unknown circuit '${id}' in the proof catalog. Known: ${Object.keys(CATALOG).join(', ')}.`);
  }
  return CATALOG[id as CircuitName].surface === 'laboratory';
}
