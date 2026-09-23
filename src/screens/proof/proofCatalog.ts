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
    groupKey: 'host.proof.laboratory.giwa.sectionTitle',
    badgeKey: 'host.proof.laboratory.poc',
    open: navigation => navigation.navigate('ArcActionInput', {circuit: 'giwa_attestation'}),
  },
  arc_eligibility: {
    surface: 'laboratory', purpose: 'identity', icon: 'document',
    titleKey: 'host.proof.laboratory.arc.title',
    descriptionKey: 'host.proof.laboratory.arc.description',
    providerKey: 'host.proof.laboratory.arc.provider',
    groupKey: 'host.proof.laboratory.arc.sectionTitle',
    badgeKey: 'host.proof.laboratory.poc',
    open: navigation => navigation.navigate('ArcActionInput', {circuit: 'arc_eligibility'}),
  },
  mdl_kr_ownership: {
    surface: 'laboratory', purpose: 'identity', icon: 'id-card',
    titleKey: 'host.proof.laboratory.ownership.title',
    descriptionKey: 'host.proof.laboratory.ownership.description',
    providerKey: 'host.proof.laboratory.ownership.provider',
    groupKey: 'host.proof.laboratory.mobileId',
    open: navigation => navigation.navigate('MdlKrInput', {variant: 'ownership'}),
  },
  mdl_kr_age: {
    surface: 'laboratory', purpose: 'identity', icon: 'age',
    titleKey: 'host.proof.laboratory.age.title',
    descriptionKey: 'host.proof.laboratory.age.description',
    providerKey: 'host.proof.laboratory.age.provider',
    groupKey: 'host.proof.laboratory.mobileId',
    open: navigation => navigation.navigate('MdlKrInput', {variant: 'age'}),
  },
  mdl_kr_region: {
    surface: 'laboratory', purpose: 'country', icon: 'region',
    titleKey: 'host.proof.laboratory.region.title',
    descriptionKey: 'host.proof.laboratory.region.description',
    providerKey: 'host.proof.laboratory.region.provider',
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
