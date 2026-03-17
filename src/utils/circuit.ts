const CIRCUIT_ICONS: Record<string, string> = {
  'coinbase-kyc': 'user',
  'coinbase_attestation': 'user',
  'coinbase-country': 'globe',
  'coinbase_country_attestation': 'globe',
  'oidc_domain_attestation': 'shield',
};

const CIRCUIT_DISPLAY_NAMES: Record<string, string> = {
  'coinbase-kyc': 'Coinbase KYC',
  'coinbase_attestation': 'Coinbase KYC',
  'coinbase-country': 'Coinbase Country',
  'coinbase_country_attestation': 'Coinbase Country',
  'oidc_domain_attestation': 'OIDC Domain',
};

export function getCircuitIcon(circuitId: string): string {
  return CIRCUIT_ICONS[circuitId] || 'shield';
}

export function getCircuitDisplayName(circuitId: string): string {
  return CIRCUIT_DISPLAY_NAMES[circuitId] || circuitId;
}
