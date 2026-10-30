/**
 * The two Coinbase circuits whose revocation is bound by a device statement,
 * and what differs between their statements. One table; an id it does not
 * hold is an error, never the other circuit's row.
 *
 *   coinbase_attestation          Coinbase KYC v2 (circuits
 *                                 coinbase-attestation-v2*): 225 bytes, the
 *                                 Coinbase Verified Account schema.
 *   coinbase_country_attestation  Coinbase Country v2 (circuits
 *                                 coinbase-country-attestation-v2*): the same
 *                                 225 bytes with its own tag and the Coinbase
 *                                 Verified Country schema, then the two ASCII
 *                                 bytes of the country the lookup found
 *                                 (offset 225, 227 bytes in all). The circuit
 *                                 requires them to equal the attestCountry
 *                                 transaction's country, so a statement about
 *                                 a wallet's current country cannot vouch for
 *                                 an older transaction naming another.
 *
 * Each row also names the device-check reasons its lookup raises
 * (src/appAttest/deviceCheckReasons.ts): a dApp's report names the circuit's
 * record, not the other one's.
 */
import type {DeviceCheckReason} from './deviceCheckReasons';

export type CoinbaseStatementCircuit = 'coinbase_attestation' | 'coinbase_country_attestation';

export interface LookupReasons {
  revoked: DeviceCheckReason;
  uidMalformed: DeviceCheckReason;
  missing: DeviceCheckReason;
  wrongSchema: DeviceCheckReason;
  wrongIssuer: DeviceCheckReason;
  otherWallet: DeviceCheckReason;
  unreachable: DeviceCheckReason;
  errors: DeviceCheckReason;
  incomplete: DeviceCheckReason;
}

export interface CoinbaseStatementKind {
  circuit: CoinbaseStatementCircuit;
  /** Name for messages. */
  label: string;
  schemaUid: string;
  schemaName: string;
  clientDataLength: number;
  /** Whether the statement carries the attestation's country at offset 225. */
  carriesCountry: boolean;
  reasons: LookupReasons;
}

export const COINBASE_KYC_SCHEMA_UID =
  '0xf8b05c79f090979bf4a80270aba232dff11a10d9ca55c4f88de95317970f0de9';
export const COINBASE_COUNTRY_SCHEMA_UID =
  '0x1801901fabd0e6189356b4fb52bb0ab855276d84f7ec140839fbd1f6801ca065';

export const COINBASE_STATEMENT_KINDS: Readonly<Record<CoinbaseStatementCircuit, CoinbaseStatementKind>> = Object.freeze({
  coinbase_attestation: Object.freeze({
    circuit: 'coinbase_attestation',
    label: 'Coinbase KYC v2',
    schemaUid: COINBASE_KYC_SCHEMA_UID,
    schemaName: 'Coinbase Verified Account',
    clientDataLength: 225,
    carriesCountry: false,
    reasons: Object.freeze({
      revoked: 'kyc_record_revoked',
      uidMalformed: 'kyc_record_uid_malformed',
      missing: 'kyc_record_missing',
      wrongSchema: 'kyc_record_wrong_schema',
      wrongIssuer: 'kyc_record_wrong_issuer',
      otherWallet: 'kyc_record_other_wallet',
      unreachable: 'kyc_lookup_unreachable',
      errors: 'kyc_lookup_errors',
      incomplete: 'kyc_lookup_incomplete',
    }),
  }),
  coinbase_country_attestation: Object.freeze({
    circuit: 'coinbase_country_attestation',
    label: 'Coinbase Country v2',
    schemaUid: COINBASE_COUNTRY_SCHEMA_UID,
    schemaName: 'Coinbase Verified Country',
    clientDataLength: 227,
    carriesCountry: true,
    reasons: Object.freeze({
      revoked: 'country_record_revoked',
      uidMalformed: 'country_record_uid_malformed',
      missing: 'country_record_missing',
      wrongSchema: 'country_record_wrong_schema',
      wrongIssuer: 'country_record_wrong_issuer',
      otherWallet: 'country_record_other_wallet',
      unreachable: 'country_lookup_unreachable',
      errors: 'country_lookup_errors',
      incomplete: 'country_lookup_incomplete',
    }),
  }),
});

/** The statement kind of `circuit`. Any other id is an error, by name. */
export function coinbaseStatementKind(circuit: string): CoinbaseStatementKind {
  if (!Object.prototype.hasOwnProperty.call(COINBASE_STATEMENT_KINDS, circuit)) {
    throw new Error(
      `No Coinbase device statement for circuit '${circuit}'. Known: ${Object.keys(COINBASE_STATEMENT_KINDS).join(', ')}.`,
    );
  }
  return COINBASE_STATEMENT_KINDS[circuit as CoinbaseStatementCircuit];
}

/** Two uppercase ASCII letters: an ISO 3166-1 alpha-2 code as Coinbase writes it. */
export const COUNTRY_CODE = /^[A-Z]{2}$/;
