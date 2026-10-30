/**
 * The input vector for Coinbase KYC v2 (`coinbase_attestation`; circuits
 * `coinbase-attestation-v2/src/main.nr`, package `coinbase_attestation_v2`,
 * pre-release tag v2.0.0-rc.1), in its `fn main` order, as the APP signer kind.
 *
 * bb reads the vector positionally, so the order below IS the contract:
 *
 *   public   signal_hash 32, domain_separator 32, action_hash 32,
 *            signer_list_merkle_root 32, scope 32, nullifier 32, attested_at 1
 *            -> 193 field elements
 *   private  user_address 20, user_signature 64, user_pubkey_x 32, user_pubkey_y 32,
 *            raw_transaction 300, tx_length 1, coinbase_attester_pubkey_x 32,
 *            coinbase_attester_pubkey_y 32, coinbase_signer_merkle_proof 256,
 *            coinbase_signer_leaf_index 1, merkle_proof_depth 1,
 *            client_data 225, signer_kind 1 (app = 1), statement_sig 64 (the
 *            App Attest assertion signature, r || s, low s),
 *            credential_tbs 1000, credential_tbs_len 1, credential_sig 96,
 *            att_auth_data 256, att_auth_data_len 1, att_client_data_hash 32,
 *            assertion_auth_data 128, assertion_auth_data_len 1
 *            -> 2,769 values in all
 *
 * The circuit pins Apple's intermediate ("Apple App Attestation CA 1") and the
 * production AAGUID as constants, so neither the CA key, its hash nor an
 * environment flag is an input any more (the 2026-10-23 build had all three). This
 * builder refuses a credential the circuit would refuse for either reason:
 * an intermediate other than the pinned one, or a development-environment key.
 *
 * `theAppBuildsTheCircuitsOwnVector.test.ts` holds this against a vector the
 * circuit's own fixture generator produced (circuits
 * scripts/coinbase-attestation-v2/export-app-vector.js), and its ABI.
 *
 * ANDROID. The same id is proved on Android by `coinbase_attestation_v2_android`
 * (circuits coinbase-attestation-v2-android): the same 193 public inputs and
 * private inputs through client_data, then the Android signer instead of
 * signer_kind and the App Attest values -- statement_sig 64, ca2_tbs 600,
 * ca2_tbs_len 1, ca2_sig 96, ca3_tbs 768, ca3_tbs_len 1, ca3_sig 96, att_tbs
 * 512, att_tbs_len 1, att_sig 64, leaf_tbs 1024, leaf_tbs_len 1, leaf_sig 64
 * -> 4,481 values (prepareCoinbaseAndroidInputs). Held to that package's
 * compiled ABI by `theAndroidInputsFollowTheCircuitAbi.test.ts`.
 *
 * COINBASE COUNTRY v2 (`coinbase_country_attestation`; circuits
 * `coinbase-country-attestation-v2*`): the same vector with v1's country
 * fields after the signer root -- country_list 20 (10 x 2 bytes),
 * country_list_length 1, is_included 1 -- and a 227-byte client_data (the
 * statement plus the country), so 215 public inputs and 24 more values in
 * all; the nullifier tag is keccak256("coinbase_country_attestation"). The
 * request names its circuit and, for Country, carries `country`.
 */
import {ethers} from 'ethers';
import type {AppAttestWitness} from '../appAttest/revocationStatement';
import {
  ANDROID_FACTORY_SIGNER_FLAT_COUNT,
  ANDROID_SIGNER_FLAT_COUNT,
  flattenAnyAndroidSigner,
  isAndroidFactorySignerInputs,
  isAndroidSignerInputs,
  type AnyAndroidSignerInputs,
  type AndroidStatementWitness,
} from '../androidAttest/androidSignerInputs';
import {appSignerInputs} from '../appAttest/appSignerInputs';
import {coinbaseStatementKind, type CoinbaseStatementCircuit} from '../appAttest/coinbaseStatementKinds';
import {bytesToNoirInput, nullifierForCircuit, type AttesterCircuitInputs} from './circuitHelpers';

const ZERO32 = new Array(32).fill(0);

export interface CoinbaseAppAttestInputs {
  signal_hash: string[];
  domain_separator: string[];
  action_hash: string[];
  signer_list_merkle_root: string[];
  /** Coinbase Country v2 only: 20 bytes, 1 length, 1 inclusion flag. */
  country?: {country_list: string[]; country_list_length: string; is_included: string};
  scope: string[];
  nullifier: string[];
  attested_at: string;

  user_address: string[];
  user_signature: string[];
  user_pubkey_x: string[];
  user_pubkey_y: string[];
  raw_transaction: string[];
  tx_length: string;
  coinbase_attester_pubkey_x: string[];
  coinbase_attester_pubkey_y: string[];
  coinbase_signer_merkle_proof: string[];
  coinbase_signer_leaf_index: string;
  merkle_proof_depth: string;

  client_data: string[];
  signer_kind: string;
  statement_sig: string[];
  credential_tbs: string[];
  credential_tbs_len: string;
  credential_sig: string[];
  att_auth_data: string[];
  att_auth_data_len: string;
  att_client_data_hash: string[];
  assertion_auth_data: string[];
  assertion_auth_data_len: string;
}

function fixed(bytes: Uint8Array, length: number, what: string): string[] {
  if (bytes.length !== length) throw new Error(`${what} is ${bytes.length} bytes; the circuit takes ${length}`);
  return bytesToNoirInput(Array.from(bytes));
}

const hexOfBytes = (b: Uint8Array): string[] => bytesToNoirInput(Array.from(b));

/**
 * Build the v2 vector from the Coinbase half (as `prepareCircuitInputs`
 * builds it for the shipped circuit) and the App Attest witness.
 *
 * Takes over three things from the Coinbase half rather than trusting them:
 *   - the request pair: personal_sign mode sends `signal_hash` and two zero
 *     hashes; EIP-712 mode sends a zero `signal_hash` and the two hashes. The
 *     circuit refuses a request with both or neither.
 *   - the nullifier, recomputed by v2's own rule (wallet +
 *     keccak256("coinbase_attestation") + scope), never signal_hash's.
 *   - the clientData's wallet, digest and scope, compared with what is being
 *     proved, so a mismatch is reported here and not by the prover.
 */
/** Everything but the signer: the Coinbase half and the statement, as both circuits take them. */
type CoinbaseCommonInputs = Omit<
  CoinbaseAppAttestInputs,
  | 'signer_kind' | 'statement_sig' | 'credential_tbs' | 'credential_tbs_len' | 'credential_sig'
  | 'att_auth_data' | 'att_auth_data_len' | 'att_client_data_hash' | 'assertion_auth_data' | 'assertion_auth_data_len'
>;

export interface CoinbaseStatementRequest {
  /**
   * Which circuit the vector is for: Coinbase KYC v2 or Coinbase Country v2.
   * Required; `country` must be present exactly when it is Country.
   */
  circuit: CoinbaseStatementCircuit;
  userAddress: string;
  scope: Uint8Array;
  /** The digest the wallet signed. */
  signedDigest: string;
  /** Present in EIP-712 action mode. */
  publicHashes?: {domainSeparator: string; actionHash: string};
  /**
   * Coinbase Country v2 only, and what makes the vector Country's: the public
   * list, its mode, and the country of the transaction being proved (the
   * statement must name it at offset 225).
   */
  country?: CountryListRequest;
}

export interface CountryListRequest {
  /** 1 to 10 ISO 3166-1 alpha-2 codes, two uppercase letters each. */
  countryList: string[];
  isIncluded: boolean;
  /** The attestCountry transaction's country (attestedCountryOfTx). */
  transactionCountry: string;
}

/** Coinbase Country v2's public input count and where attested_at sits (circuits coinbase-country-attestation-v2). */
export const COUNTRY_V2_PUBLIC_INPUT_COUNT = 215;
export const COUNTRY_V2_ATTESTED_AT_INDEX = 214;

/** The public list's capacity in the circuit. */
export const COUNTRY_LIST_MAX = 10;

/**
 * The circuit's country fields for a list, refusing what it would refuse and
 * what it cannot represent: an empty list or more than 10 entries, an entry
 * that is not two uppercase letters, and a list whose mode the transaction's
 * country does not satisfy (the circuit refuses that proof only after the
 * wallet has signed and the phone has proved).
 */
/**
 * Why a country request cannot be proved, or null: E2004 for a list the
 * circuit cannot take (empty, more than 10, an entry that is not two
 * uppercase letters, no mode), E2005 when the wallet's attested country does
 * not meet the list (the attestation this wallet holds is not one this
 * request accepts). The proof screen asks before the device statement and the
 * wallet signature, so neither is spent on a proof the circuit refuses.
 */
export function countryRequestRefusal(c: CountryListRequest): {code: 'E2004' | 'E2005'; error: string} | null {
  if (!Array.isArray(c.countryList) || c.countryList.length === 0) {
    return {code: 'E2004', error: 'Country list must not be empty'};
  }
  if (c.countryList.length > COUNTRY_LIST_MAX) {
    return {code: 'E2004', error: `Country list has ${c.countryList.length} entries; the circuit holds ${COUNTRY_LIST_MAX}`};
  }
  for (const code of c.countryList) {
    if (typeof code !== 'string' || !/^[A-Z]{2}$/.test(code)) {
      return {code: 'E2004', error: `Country list entry ${JSON.stringify(code)} is not two uppercase letters`};
    }
  }
  if (typeof c.isIncluded !== 'boolean') return {code: 'E2004', error: 'isIncluded must be true or false'};
  if (typeof c.transactionCountry !== 'string' || !/^[A-Z]{2}$/.test(c.transactionCountry)) {
    return {code: 'E2005', error: `The transaction's country ${JSON.stringify(c.transactionCountry)} is not two uppercase letters`};
  }
  const found = c.countryList.includes(c.transactionCountry);
  if (c.isIncluded && !found) {
    return {code: 'E2005', error: `The attested country ${c.transactionCountry} is not in the inclusion list ${c.countryList.join(', ')}`};
  }
  if (!c.isIncluded && found) {
    return {code: 'E2005', error: `The attested country ${c.transactionCountry} is in the exclusion list ${c.countryList.join(', ')}`};
  }
  return null;
}

export function countryListInputs(c: CountryListRequest): NonNullable<CoinbaseAppAttestInputs['country']> {
  const refusal = countryRequestRefusal(c);
  if (refusal) throw new Error(refusal.error);
  const bytes: number[] = [];
  for (let i = 0; i < COUNTRY_LIST_MAX; i++) {
    const code = c.countryList[i];
    bytes.push(code ? code.charCodeAt(0) : 0, code ? code.charCodeAt(1) : 0);
  }
  return {
    country_list: bytesToNoirInput(bytes),
    country_list_length: String(c.countryList.length),
    is_included: c.isIncluded ? '1' : '0',
  };
}

/**
 * The inputs both Coinbase KYC v2 circuits share (the iPhone one and the
 * Android package), from the Coinbase half and the statement.
 *
 * Takes over three things from the Coinbase half rather than trusting them:
 *   - the request pair: personal_sign mode sends `signal_hash` and two zero
 *     hashes; EIP-712 mode sends a zero `signal_hash` and the two hashes. The
 *     circuit refuses a request with both or neither.
 *   - the nullifier, recomputed by v2's own rule (wallet +
 *     keccak256("coinbase_attestation") + scope), never signal_hash's.
 *   - the clientData's wallet, digest and scope, compared with what is being
 *     proved, so a mismatch is reported here and not by the prover.
 */
function coinbaseCommonInputs(
  coinbase: AttesterCircuitInputs,
  request: CoinbaseStatementRequest,
  statement: {clientData: Uint8Array; attestedAt: number},
): CoinbaseCommonInputs {
  const kind = coinbaseStatementKind(request.circuit);
  if (kind.carriesCountry !== Boolean(request.country)) {
    throw new Error(
      kind.carriesCountry
        ? `${kind.label} needs the country list and the transaction's country`
        : `${kind.label} takes no country list`,
    );
  }
  const cd = statement.clientData;
  if (cd.length !== kind.clientDataLength) {
    throw new Error(`clientData is ${cd.length} bytes; ${kind.label} takes ${kind.clientDataLength}`);
  }
  const statementTag = ethers.utils.hexlify(cd.slice(16, 48)).toLowerCase();
  if (statementTag !== ethers.utils.keccak256(ethers.utils.toUtf8Bytes(kind.circuit)).toLowerCase()) {
    throw new Error(`clientData is not ${kind.label}'s statement (tag ${statementTag})`);
  }
  const hexOf = (from: number, len: number) => ethers.utils.hexlify(cd.slice(from, from + len)).toLowerCase();
  if (hexOf(48, 20) !== request.userAddress.toLowerCase()) {
    throw new Error(`clientData names wallet ${hexOf(48, 20)}, the proof is for ${request.userAddress}`);
  }
  if (hexOf(161, 32) !== request.signedDigest.toLowerCase()) {
    throw new Error(`clientData binds request ${hexOf(161, 32)}, the wallet signed ${request.signedDigest}`);
  }
  if (hexOf(193, 32) !== ethers.utils.hexlify(request.scope).toLowerCase()) {
    throw new Error('clientData binds another scope');
  }
  const country = request.country ? countryListInputs(request.country) : undefined;
  if (request.country) {
    const named = String.fromCharCode(cd[225], cd[226]);
    if (named !== request.country.transactionCountry) {
      throw new Error(`clientData names country ${JSON.stringify(named)}, the transaction ${request.country.transactionCountry}`);
    }
  }

  const actionMode = Boolean(request.publicHashes);
  const signal = actionMode ? bytesToNoirInput(ZERO32) : coinbase.signal_hash;
  if (!actionMode && coinbase.signal_hash.every(b => /^0x0+$/.test(b))) {
    throw new Error('signal mode with an all-zero signal_hash: the circuit refuses a request that signs nothing');
  }
  const domain = request.publicHashes
    ? fixed(ethers.utils.arrayify(request.publicHashes.domainSeparator), 32, 'domain_separator')
    : bytesToNoirInput(ZERO32);
  const action = request.publicHashes
    ? fixed(ethers.utils.arrayify(request.publicHashes.actionHash), 32, 'action_hash')
    : bytesToNoirInput(ZERO32);

  const nullifier = nullifierForCircuit(kind.circuit, request.userAddress, new Uint8Array(32), request.scope);

  return {
    signal_hash: signal,
    domain_separator: domain,
    action_hash: action,
    signer_list_merkle_root: coinbase.signer_list_merkle_root,
    ...(country ? {country} : {}),
    scope: fixed(request.scope, 32, 'scope'),
    nullifier: bytesToNoirInput(Array.from(nullifier)),
    attested_at: String(statement.attestedAt),

    user_address: coinbase.user_address,
    user_signature: coinbase.user_signature,
    user_pubkey_x: coinbase.user_pubkey_x,
    user_pubkey_y: coinbase.user_pubkey_y,
    raw_transaction: coinbase.raw_transaction,
    tx_length: coinbase.tx_length,
    coinbase_attester_pubkey_x: coinbase.coinbase_attester_pubkey_x,
    coinbase_attester_pubkey_y: coinbase.coinbase_attester_pubkey_y,
    coinbase_signer_merkle_proof: coinbase.coinbase_signer_merkle_proof,
    coinbase_signer_leaf_index: coinbase.coinbase_signer_leaf_index,
    merkle_proof_depth: coinbase.merkle_proof_depth,

    client_data: fixed(cd, kind.clientDataLength, 'client_data'),
  };
}

/** Build the v2 vector from the Coinbase half and the App Attest witness (iPhone). */
export function prepareCoinbaseAppAttestInputs(
  coinbase: AttesterCircuitInputs,
  request: CoinbaseStatementRequest & {
    /**
     * SHA256(X || Y) of the intermediate the circuit pins: Apple's CA 1
     * (APPLE_APP_ATTEST_CA1_KEY_HASH) in the app, the synthetic one in the
     * vector test. Required -- no default, so a test cannot quietly prove
     * against Apple's while the app uses another.
     */
    pinnedCaKeyHash: string;
  },
  witness: AppAttestWitness,
): CoinbaseAppAttestInputs {
  // The App Attest half, shared with the OIDC circuit: refuses (E2014) a
  // non-pinned intermediate, a development key and a high s.
  const signer = appSignerInputs(witness.credential, witness.assertion, request.pinnedCaKeyHash);
  const common = coinbaseCommonInputs(coinbase, request, witness);
  return {
    ...common,
    signer_kind: String(signer.signer_kind),
    statement_sig: hexOfBytes(signer.statement_sig),
    credential_tbs: hexOfBytes(signer.credential_tbs),
    credential_tbs_len: String(signer.credential_tbs_len),
    credential_sig: hexOfBytes(signer.credential_sig),
    att_auth_data: hexOfBytes(signer.att_auth_data),
    att_auth_data_len: String(signer.att_auth_data_len),
    att_client_data_hash: hexOfBytes(signer.att_client_data_hash),
    assertion_auth_data: hexOfBytes(signer.assertion_auth_data),
    assertion_auth_data_len: String(signer.assertion_auth_data_len),
  };
}

/**
 * The Android package's vector (`coinbase_attestation_v2_android`): the same
 * common inputs, then the Android signer (ANDROID_SIGNER_ABI_PARAMETERS)
 * where the iPhone circuit has its ten App Attest values. 4,481 values; the
 * first 193 are the public inputs, identical to the iPhone circuit's.
 */
export interface CoinbaseAndroidInputs extends CoinbaseCommonInputs {
  signer: AnyAndroidSignerInputs;
}

/** Everything up to client_data: 193 public and 996 private values, on every Coinbase KYC v2 circuit. */
const COINBASE_COMMON_FLAT_COUNT = 1189;
/** Coinbase Country v2: 22 more public values (the list) and 2 more statement bytes. */
const COUNTRY_COMMON_FLAT_COUNT = COINBASE_COMMON_FLAT_COUNT + 24;
export const COUNTRY_ANDROID_FLAT_INPUT_COUNT = COUNTRY_COMMON_FLAT_COUNT + ANDROID_SIGNER_FLAT_COUNT;
export const COUNTRY_ANDROID_FACTORY_FLAT_INPUT_COUNT = COUNTRY_COMMON_FLAT_COUNT + ANDROID_FACTORY_SIGNER_FLAT_COUNT;
export const COINBASE_ANDROID_FLAT_INPUT_COUNT = COINBASE_COMMON_FLAT_COUNT + ANDROID_SIGNER_FLAT_COUNT;
/** `coinbase_attestation_v2_android_factory`: the common inputs, then the factory signer. */
export const COINBASE_ANDROID_FACTORY_FLAT_INPUT_COUNT = COINBASE_COMMON_FLAT_COUNT + ANDROID_FACTORY_SIGNER_FLAT_COUNT;

export function prepareCoinbaseAndroidInputs(
  coinbase: AttesterCircuitInputs,
  request: CoinbaseStatementRequest,
  witness: AndroidStatementWitness,
): CoinbaseAndroidInputs {
  if (!isAndroidSignerInputs(witness.signer) && !isAndroidFactorySignerInputs(witness.signer)) {
    throw new Error('The Android statement carries no Android signer inputs');
  }
  if (witness.signer.variant !== witness.variant) {
    throw new Error(`The Android statement is ${witness.variant} but its signer inputs are ${witness.signer.variant}`);
  }
  return {...coinbaseCommonInputs(coinbase, request, witness), signer: witness.signer};
}

export function flattenCoinbaseAndroidInputs(i: CoinbaseAndroidInputs): string[] {
  const flat = [
    ...flattenCommon(i),
    ...flattenAnyAndroidSigner(
      i.signer,
      b => bytesToNoirInput([b])[0],
      n => String(n),
      v => v.toString(),
    ),
  ];
  const expected = i.country
    ? (isAndroidSignerInputs(i.signer) ? COUNTRY_ANDROID_FLAT_INPUT_COUNT : COUNTRY_ANDROID_FACTORY_FLAT_INPUT_COUNT)
    : (isAndroidSignerInputs(i.signer) ? COINBASE_ANDROID_FLAT_INPUT_COUNT : COINBASE_ANDROID_FACTORY_FLAT_INPUT_COUNT);
  if (flat.length !== expected) {
    throw new Error(`Coinbase ${i.country ? 'Country' : 'KYC'} v2 (${i.signer.variant}) inputs flattened to ${flat.length} values; the circuit takes ${expected}`);
  }
  return flat;
}

function flattenCommon(i: CoinbaseCommonInputs): string[] {
  return [
    ...i.signal_hash,
    ...i.domain_separator,
    ...i.action_hash,
    ...i.signer_list_merkle_root,
    ...(i.country ? [...i.country.country_list, i.country.country_list_length, i.country.is_included] : []),
    ...i.scope,
    ...i.nullifier,
    i.attested_at,
    ...i.user_address,
    ...i.user_signature,
    ...i.user_pubkey_x,
    ...i.user_pubkey_y,
    ...i.raw_transaction,
    i.tx_length,
    ...i.coinbase_attester_pubkey_x,
    ...i.coinbase_attester_pubkey_y,
    ...i.coinbase_signer_merkle_proof,
    i.coinbase_signer_leaf_index,
    i.merkle_proof_depth,
    ...i.client_data,
  ];
}

/** `fn main`'s order. The first 193 values (215 for Country) are the public inputs. */
export function flattenCoinbaseAppAttestInputs(i: CoinbaseAppAttestInputs): string[] {
  return [
    ...flattenCommon(i),
    i.signer_kind,
    ...i.statement_sig,
    ...i.credential_tbs,
    i.credential_tbs_len,
    ...i.credential_sig,
    ...i.att_auth_data,
    i.att_auth_data_len,
    ...i.att_client_data_hash,
    ...i.assertion_auth_data,
    i.assertion_auth_data_len,
  ];
}
