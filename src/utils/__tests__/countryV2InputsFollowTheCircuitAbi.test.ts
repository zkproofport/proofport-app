/**
 * Coinbase Country v2's input vectors, held to the three packages' compiled
 * ABIs (fixtures/countryV2CircuitAbis.json, read off the circuits' own
 * target/*.json by scripts/export-country-v2-abis.js), and what the app
 * refuses before the device statement and the wallet signature.
 *
 * bb reads the vector positionally: every parameter at its own offset, the
 * 215 public inputs in the circuit's order (Coinbase KYC v2's first 128, the
 * country list 128-149, scope, nullifier, attested_at 214), and the total.
 */
jest.mock('react-native', () => ({NativeModules: {}, Platform: {OS: 'ios'}}));
jest.mock('@react-native-async-storage/async-storage', () => ({__esModule: true, default: {}}));

import {ethers} from 'ethers';
import abis from './fixtures/countryV2CircuitAbis.json';
import vectors from './fixtures/androidChainVectors.json';
import {androidChainInputs, GOOGLE_KEY_ATTESTATION_CA1} from '../androidKeyAttestation';
import {buildCoinbaseClientData, COINBASE_ATTESTER} from '../../appAttest/clientData';
import {COINBASE_COUNTRY_SCHEMA_UID} from '../../appAttest/coinbaseStatementKinds';
import {bytesToNoirInput, computeScope, computeWalletNullifier, type AttesterCircuitInputs} from '../circuitHelpers';
import {
  COUNTRY_ANDROID_FACTORY_FLAT_INPUT_COUNT,
  COUNTRY_ANDROID_FLAT_INPUT_COUNT,
  countryListInputs,
  countryRequestRefusal,
  COUNTRY_V2_ATTESTED_AT_INDEX,
  COUNTRY_V2_PUBLIC_INPUT_COUNT,
  flattenCoinbaseAndroidInputs,
  flattenCoinbaseAppAttestInputs,
  prepareCoinbaseAndroidInputs,
  type CoinbaseAppAttestInputs,
} from '../coinbaseAppAttestInputs';
import {ATTEST_COUNTRY_SELECTOR, attestedCountryOfTx} from '../attestCountryTx';
import {artifactSourceFor} from '../../config/circuitArtifacts';
import type {AndroidSignerInputs} from '../../androidAttest/androidSignerInputs';

type Abi = {parameters: Array<{name: string; visibility: string; size: number}>};
const VARIANTS = ['app_attest', 'android', 'android_factory'] as const;

function layout(abi: Abi): Record<string, [number, number]> {
  const out: Record<string, [number, number]> = {};
  let at = 0;
  for (const p of abi.parameters) {
    out[p.name] = [at, p.size];
    at += p.size;
  }
  return out;
}
const total = (abi: Abi) => abi.parameters.reduce((n, p) => n + p.size, 0);
const publicCount = (abi: Abi) => abi.parameters.filter(p => p.visibility === 'public').reduce((n, p) => n + p.size, 0);

// The real attestCountry transaction of the E2E wallet on Base (from circuits
// coinbase-country-attestation/Prover.toml, built by proofport-ai
// scripts/gen-prover-toml.ts); EAS record 0xed8a...6dae names it as txid
// 0x99baebd2...327a and its country as "KR" (base.easscan.org, 2026-10-30).
const REAL_TX =
  '0x02f8928221058304a5dc827530841a2477ae830927c094357458739f90461b99789350868cd7cf330dd7ee80a40a2252480000000000000000' +
  '00004b52d6c714247037e5201b7e3dec97a3ab59a9d2f739c001a082618adedb0564ec194a296d1959b3d8d8a78b384b782e376356c0780012a2' +
  '1ba023c0e530b1ca49f43d57d0f2048eb550c1570a22db4f5bc6e313898b41f5520b';
const WALLET = '0xD6C714247037E5201B7e3dEC97a3ab59a9d2F739';
const ATTESTER = '0x357458739F90461b99789350868CD7CF330Dd7EE';

describe('the fixture', () => {
  it('records the three packages, from a circuits commit, with 215 public inputs each', () => {
    expect(abis.source.circuitsCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(abis.source.circuitsWorkingTreeChanged).toBe(false);
    for (const v of VARIANTS) {
      const abi = abis[v] as Abi;
      expect(abis[v].package).toBe(artifactSourceFor('coinbase_country_attestation', v)!.remoteFileName);
      expect([v, publicCount(abi)]).toEqual([v, COUNTRY_V2_PUBLIC_INPUT_COUNT]);
      expect([v, artifactSourceFor('coinbase_country_attestation', v)!.publicInputCount]).toEqual([v, COUNTRY_V2_PUBLIC_INPUT_COUNT]);
      const at = layout(abi);
      expect(at.attested_at).toEqual([COUNTRY_V2_ATTESTED_AT_INDEX, 1]);
      expect(at.country_list).toEqual([128, 20]);
      expect(at.country_list_length).toEqual([148, 1]);
      expect(at.is_included).toEqual([149, 1]);
      expect(at.scope).toEqual([150, 32]);
      expect(at.nullifier).toEqual([182, 32]);
      expect(at.client_data[1]).toBe(227);
    }
  });
});

describe("the attestCountry transaction's country", () => {
  it('reads KR from the real transaction, which is the EAS record\'s', () => {
    expect(ethers.utils.keccak256(REAL_TX)).toBe('0x99baebd299977567dc2e5baecfdb5f363d02d7f5c3674aabf1e97f895dad327a');
    expect(attestedCountryOfTx(REAL_TX)).toBe('KR');
  });

  const signer = ethers.Wallet.createRandom();
  const tx = async (data: string) => signer.signTransaction({type: 2, chainId: 8453, nonce: 0, to: ATTESTER, data, gasLimit: 100000, maxFeePerGas: 1, maxPriorityFeePerGas: 1});
  const word = (country: string) => '0x' + '00'.repeat(10) + country + WALLET.slice(2).toLowerCase();

  it('reads any two uppercase letters', async () => {
    expect(attestedCountryOfTx(await tx(ATTEST_COUNTRY_SELECTOR + word('5553').slice(2)))).toBe('US');
  });

  it.each([
    ['attestAccount (Coinbase KYC)', () => '0x56feed5e' + '00'.repeat(12) + WALLET.slice(2), /calls 0x56feed5e, not attestCountry/],
    ['a short calldata', () => ATTEST_COUNTRY_SELECTOR + '00'.repeat(20), /calldata is 24 bytes, not 36/],
    ['a long calldata', () => ATTEST_COUNTRY_SELECTOR + word('4b52').slice(2) + '00', /calldata is 37 bytes, not 36/],
    ['nonzero padding', () => ATTEST_COUNTRY_SELECTOR + '01' + word('4b52').slice(4), /nonzero bytes before the country/],
    ['lowercase letters', () => ATTEST_COUNTRY_SELECTOR + word('6b72').slice(2), /0x6b72, not two uppercase letters/],
    ['zero bytes', () => ATTEST_COUNTRY_SELECTOR + word('0000').slice(2), /0x0000, not two uppercase letters/],
  ])('refuses %s', async (_l, data, msg) => {
    const raw = await tx(data());
    expect(() => attestedCountryOfTx(raw)).toThrow(msg);
  });
});

describe('a request the circuit would refuse is refused first', () => {
  const ten = ['AA', 'AB', 'AC', 'AD', 'AE', 'AF', 'AG', 'AH', 'AI', 'KR'];
  it.each([
    ['an empty list', {countryList: [], isIncluded: true}, 'E2004'],
    ['11 countries', {countryList: [...ten, 'US'], isIncluded: true}, 'E2004'],
    ['a lowercase code', {countryList: ['kr'], isIncluded: true}, 'E2004'],
    ['a three-letter code', {countryList: ['KOR'], isIncluded: true}, 'E2004'],
    ['a Korean name', {countryList: ['한국'], isIncluded: true}, 'E2004'],
    ['no mode', {countryList: ['KR'], isIncluded: 'yes'}, 'E2004'],
    ['KR not in an inclusion list', {countryList: ['US', 'JP'], isIncluded: true}, 'E2005'],
    ['KR in an exclusion list', {countryList: ['US', 'KR'], isIncluded: false}, 'E2005'],
  ])('%s', (_l, c, code) => {
    const refusal = countryRequestRefusal({transactionCountry: 'KR', ...c} as never);
    expect(refusal?.code).toBe(code);
    expect(() => countryListInputs({transactionCountry: 'KR', ...c} as never)).toThrow(refusal!.error);
  });

  it.each([
    ['KR in a one-country inclusion list', ['KR'], true],
    ['KR last of ten, the maximum', ten, true],
    ['KR outside an exclusion list', ['US', 'JP'], false],
    ['a repeated country', ['KR', 'KR'], true],
  ])('accepts %s', (_l, countryList, isIncluded) => {
    expect(countryRequestRefusal({countryList, isIncluded, transactionCountry: 'KR'})).toBeNull();
    const c = countryListInputs({countryList, isIncluded, transactionCountry: 'KR'});
    expect(c.country_list).toHaveLength(20);
    expect(c.country_list_length).toBe(String(countryList.length));
    expect(c.is_included).toBe(isIncluded ? '1' : '0');
    // Codes in order, zero bytes after the length.
    const bytes = c.country_list.map(v => parseInt(v, 16));
    for (let i = 0; i < 10; i++) {
      const code = countryList[i];
      expect(bytes.slice(2 * i, 2 * i + 2)).toEqual(code ? [code.charCodeAt(0), code.charCodeAt(1)] : [0, 0]);
    }
  });
});

describe('the vectors', () => {
  const scope = computeScope('proofport');
  const digest = '0x' + '5a'.repeat(32);
  const attestedAt = 1793000000;
  // A Coinbase half with a recognisable value per field (the builder does not
  // check the transaction; the hook does, before).
  const fill = (n: number, base: number) => bytesToNoirInput(Array.from({length: n}, (_v, i) => (base + i) % 256));
  const coinbase: AttesterCircuitInputs = {
    signal_hash: fill(32, 1), signer_list_merkle_root: fill(32, 40), scope: fill(32, 0), nullifier: fill(32, 0),
    user_address: bytesToNoirInput(Array.from(ethers.utils.arrayify(WALLET))), user_signature: fill(64, 80),
    user_pubkey_x: fill(32, 90), user_pubkey_y: fill(32, 120), raw_transaction: fill(300, 7), tx_length: '149',
    coinbase_attester_pubkey_x: fill(32, 150), coinbase_attester_pubkey_y: fill(32, 180),
    coinbase_signer_merkle_proof: fill(256, 33), coinbase_signer_leaf_index: '2', merkle_proof_depth: '2',
  } as unknown as AttesterCircuitInputs;
  const country = {countryList: ['US', 'KR'], isIncluded: true, transactionCountry: 'KR'};
  const request = {circuit: 'coinbase_country_attestation' as const, userAddress: WALLET, scope, signedDigest: digest, country};
  const clientData = buildCoinbaseClientData('coinbase_country_attestation', {
    wallet: WALLET, attestedAt, schemaUid: COINBASE_COUNTRY_SCHEMA_UID, attester: COINBASE_ATTESTER,
    attestationUid: '0x' + 'ed'.repeat(32), revoked: false, requestDigest: digest, scope, country: 'KR',
  });

  function teguSigner(): AndroidSignerInputs {
    const chain = (vectors.cases as unknown as Record<string, {chain: string[]}>)['tegu-sdk36-sb-ec-2026-root'].chain
      .map(b => Uint8Array.from(Buffer.from(b, 'base64')));
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const {leaf_key: _leafKey, ...c} = androidChainInputs(chain, GOOGLE_KEY_ATTESTATION_CA1);
    return {variant: 'android', statement_sig: Uint8Array.from({length: 64}, (_v, i) => i + 1), ...c};
  }

  function checkPublicAndCommon(flat: string[], abi: Abi) {
    const at = layout(abi);
    const slice = (name: string) => flat.slice(at[name][0], at[name][0] + at[name][1]);
    expect(slice('signal_hash')).toEqual(coinbase.signal_hash);
    expect(slice('domain_separator')).toEqual(bytesToNoirInput(new Array(32).fill(0)));
    expect(slice('signer_list_merkle_root')).toEqual(coinbase.signer_list_merkle_root);
    expect(slice('country_list')).toEqual(bytesToNoirInput([85, 83, 75, 82, ...new Array(16).fill(0)]));
    expect(slice('country_list_length')).toEqual(['2']);
    expect(slice('is_included')).toEqual(['1']);
    expect(slice('scope')).toEqual(bytesToNoirInput(Array.from(scope)));
    expect(slice('nullifier')).toEqual(bytesToNoirInput(Array.from(computeWalletNullifier(WALLET, 'coinbase_country_attestation', scope))));
    expect(slice('attested_at')).toEqual([String(attestedAt)]);
    expect(slice('raw_transaction')).toEqual(coinbase.raw_transaction);
    expect(slice('merkle_proof_depth')).toEqual(['2']);
    expect(slice('client_data')).toEqual(bytesToNoirInput(Array.from(clientData)));
  }

  it('iPhone / server package: every parameter at its offset, 2,793 values', () => {
    const abi = abis.app_attest as Abi;
    const at = layout(abi);
    const inputs: CoinbaseAppAttestInputs = {
      signal_hash: coinbase.signal_hash, domain_separator: bytesToNoirInput(new Array(32).fill(0)),
      action_hash: bytesToNoirInput(new Array(32).fill(0)), signer_list_merkle_root: coinbase.signer_list_merkle_root,
      country: countryListInputs(country), scope: bytesToNoirInput(Array.from(scope)),
      nullifier: bytesToNoirInput(Array.from(computeWalletNullifier(WALLET, 'coinbase_country_attestation', scope))),
      attested_at: String(attestedAt), user_address: coinbase.user_address, user_signature: coinbase.user_signature,
      user_pubkey_x: coinbase.user_pubkey_x, user_pubkey_y: coinbase.user_pubkey_y, raw_transaction: coinbase.raw_transaction,
      tx_length: coinbase.tx_length, coinbase_attester_pubkey_x: coinbase.coinbase_attester_pubkey_x,
      coinbase_attester_pubkey_y: coinbase.coinbase_attester_pubkey_y, coinbase_signer_merkle_proof: coinbase.coinbase_signer_merkle_proof,
      coinbase_signer_leaf_index: coinbase.coinbase_signer_leaf_index, merkle_proof_depth: coinbase.merkle_proof_depth,
      client_data: bytesToNoirInput(Array.from(clientData)), signer_kind: '1', statement_sig: fill(64, 200),
      credential_tbs: fill(1000, 3), credential_tbs_len: '852', credential_sig: fill(96, 9), att_auth_data: fill(256, 11),
      att_auth_data_len: '164', att_client_data_hash: fill(32, 13), assertion_auth_data: fill(128, 17), assertion_auth_data_len: '37',
    };
    const flat = flattenCoinbaseAppAttestInputs(inputs);
    expect(flat).toHaveLength(total(abi));
    expect(total(abi)).toBe(2793);
    checkPublicAndCommon(flat, abi);
    expect(flat.slice(at.signer_kind[0], at.signer_kind[0] + 1)).toEqual(['1']);
    expect(flat.slice(at.assertion_auth_data_len[0])).toEqual(['37']);
  });

  it('Android package: the builder puts every common parameter at its offset, 4,505 values', () => {
    const abi = abis.android as Abi;
    const flat = flattenCoinbaseAndroidInputs(prepareCoinbaseAndroidInputs(coinbase, request, {variant: 'android', clientData, attestedAt, signer: teguSigner()}));
    expect(flat).toHaveLength(total(abi));
    expect(COUNTRY_ANDROID_FLAT_INPUT_COUNT).toBe(4505);
    checkPublicAndCommon(flat, abi);
  });

  it('factory package: the same common parameters, then the factory signer, 5,090 values', () => {
    /* eslint-disable-next-line @typescript-eslint/no-var-requires */
    const factory = require('./fixtures/androidFactoryVectors.json');
    const s = factory.synthetic;
    const c = s.expectedChain.inputs;
    const bytesOf = (h: string) => Uint8Array.from(Buffer.from(h, 'hex'));
    const signer = {
      variant: 'android_factory' as const,
      statement_sig: bytesOf(s.statementSigLow),
      ik_tbs: bytesOf(c.ik_tbs), ik_tbs_len: c.ik_tbs_len, ik_sig: c.ik_sig.map(BigInt),
      batch_tbs: bytesOf(c.batch_tbs), batch_tbs_len: c.batch_tbs_len, batch_sig: bytesOf(c.batch_sig),
      leaf_tbs: bytesOf(c.leaf_tbs), leaf_tbs_len: c.leaf_tbs_len, leaf_sig: bytesOf(c.leaf_sig),
      integrity_payload_b64: bytesOf(s.tokens.good.payloadB64Padded),
      integrity_payload_b64_len: s.tokens.good.payloadB64Len,
      integrity_signature: bytesOf(s.tokens.good.signatureLow),
      rsa_root_modulus: s.rsaRootParams.modulus.map(BigInt),
      rsa_root_redc: s.rsaRootParams.redc.map(BigInt),
      play_integrity_key: bytesOf(s.playKey),
    };
    const abi = abis.android_factory as Abi;
    const flat = flattenCoinbaseAndroidInputs(prepareCoinbaseAndroidInputs(coinbase, request, {variant: 'android_factory', clientData, attestedAt, signer}));
    expect(flat).toHaveLength(total(abi));
    expect(COUNTRY_ANDROID_FACTORY_FLAT_INPUT_COUNT).toBe(5090);
    checkPublicAndCommon(flat, abi);
  });

  it('the action pair goes out in place of the signal hash', () => {
    const publicHashes = {domainSeparator: '0x' + '0d'.repeat(32), actionHash: '0x' + '0a'.repeat(32)};
    const flat = flattenCoinbaseAndroidInputs(prepareCoinbaseAndroidInputs(coinbase, {...request, publicHashes}, {variant: 'android', clientData, attestedAt, signer: teguSigner()}));
    expect(flat.slice(0, 32)).toEqual(bytesToNoirInput(new Array(32).fill(0)));
    expect(flat.slice(32, 64)).toEqual(bytesToNoirInput(new Array(32).fill(0x0d)));
    expect(flat.slice(64, 96)).toEqual(bytesToNoirInput(new Array(32).fill(0x0a)));
  });

  describe('refuses a statement that does not match the request', () => {
    const w = () => ({variant: 'android' as const, clientData, attestedAt, signer: teguSigner()});
    it.each([
      ['for another country than the transaction', {country: {...country, transactionCountry: 'US', countryList: ['US']}}, /clientData names country "KR", the transaction US/],
      ['without the country list', {country: undefined}, /needs the country list/],
      ['for another wallet', {userAddress: '0x' + '33'.repeat(20)}, /clientData names wallet/],
      ['binding another request', {signedDigest: '0x' + '44'.repeat(32)}, /clientData binds request/],
      ['for another scope', {scope: computeScope('another')}, /clientData binds another scope/],
      ['a list the circuit refuses', {country: {...country, countryList: ['US']}}, /not in the inclusion list/],
    ])('%s', (_l, over, msg) => {
      expect(() => prepareCoinbaseAndroidInputs(coinbase, {...request, ...over} as never, w())).toThrow(msg);
    });

    it("a Coinbase KYC statement (225 bytes, KYC's tag) for a Country request", () => {
      const kycCd = clientData.slice(0, 225);
      expect(() => prepareCoinbaseAndroidInputs(coinbase, request, {...w(), clientData: kycCd})).toThrow(/clientData is 225 bytes; Coinbase Country v2 takes 227/);
      const kycTag = Uint8Array.from(clientData);
      kycTag.set(ethers.utils.arrayify(ethers.utils.keccak256(ethers.utils.toUtf8Bytes('coinbase_attestation'))), 16);
      expect(() => prepareCoinbaseAndroidInputs(coinbase, request, {...w(), clientData: kycTag})).toThrow(/not Coinbase Country v2's statement/);
    });

    it('a Country statement for a Coinbase KYC request', () => {
      expect(() => prepareCoinbaseAndroidInputs(coinbase, {...request, circuit: 'coinbase_attestation', country: undefined} as never, w()))
        .toThrow(/clientData is 227 bytes; Coinbase KYC v2 takes 225/);
      expect(() => prepareCoinbaseAndroidInputs(coinbase, {...request, circuit: 'coinbase_attestation'} as never, w()))
        .toThrow(/takes no country list/);
    });
  });
});
