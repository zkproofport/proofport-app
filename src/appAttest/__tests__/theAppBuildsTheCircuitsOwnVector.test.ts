/**
 * The app's clientData and input vector, byte for byte against what the
 * circuit's own fixture generator produced.
 *
 * fixtures/generateProverTomlVector.json was made by running
 * circuits/scripts/coinbase-app-attest-poc/generate-prover-toml.js (circuits
 * b281485) with a throwaway random wallet and an all-zero Coinbase half, then
 * reading both Prover.toml files and the compiled circuit's ABI. Its
 * clientData is the one the circuit's acceptance run proves with, so if the
 * app builds a different byte anywhere the proof fails -- this catches it
 * without a phone.
 */
jest.mock('react-native', () => ({NativeModules: {}, Platform: {OS: 'ios'}}));
jest.mock('@react-native-async-storage/async-storage', () => ({__esModule: true, default: {}}));

import {ethers} from 'ethers';
import {buildClientData, COINBASE_ATTESTER, COINBASE_KYC_SCHEMA_UID, CLIENT_DATA_LEN} from '../clientData';
import {AppAttestError} from '../appAttestError';
import {coinbaseRequestDigest} from '../coinbaseKycStatement';
import {
  flattenCoinbaseAppAttestInputs,
  prepareCoinbaseAppAttestInputs,
} from '../../utils/coinbaseAppAttestInputs';
import {bytesToNoirInput, computeScope, type AttesterCircuitInputs} from '../../utils/circuitHelpers';
import {coinbaseKycArtifact} from '../../config/circuitArtifacts';
import type {TypedAction} from '../../config/circuitIds';
import vector from './fixtures/generateProverTomlVector.json';

type Mode = 'action' | 'noAction';
type Toml = Record<string, string | string[]>;
const toml = (m: Mode) => vector[m] as unknown as Toml;
const bytesOf = (h: string) => ethers.utils.arrayify(h);
const str = (v: string | string[]) => v as string;

const wallet = ethers.utils.getAddress(str(toml('action').user_address));
const action: TypedAction = {
  domain: vector.eip712.domain,
  types: vector.eip712.types,
  primaryType: vector.eip712.primaryType,
  message: {member: wallet, nonce: vector.eip712.messageNonce},
} as TypedAction;
const actionOf = (m: Mode) => (m === 'action' ? action : undefined);

function clientDataFor(m: Mode, overrides: Partial<Parameters<typeof buildClientData>[0]> = {}) {
  const cd = bytesOf(str(toml(m).client_data));
  return buildClientData({
    wallet,
    attestedAt: Number(toml(m).attested_at),
    schemaUid: COINBASE_KYC_SCHEMA_UID,
    attester: COINBASE_ATTESTER,
    attestationUid: ethers.utils.hexlify(cd.slice(128, 160)),
    revoked: false,
    requestDigest: coinbaseRequestDigest(wallet, vector.scopeString, actionOf(m)),
    scope: computeScope(vector.scopeString),
    ...overrides,
  });
}

describe.each(['noAction', 'action'] as Mode[])('%s mode', m => {
  it('builds the same 225 clientData bytes the circuit fixture carries', () => {
    const built = clientDataFor(m);
    expect(built.length).toBe(CLIENT_DATA_LEN);
    expect(ethers.utils.hexlify(built)).toBe(str(toml(m).client_data));
  });

  it('builds the same 2,897-value vector, in fn main order', () => {
    const t = toml(m);
    const b = (k: string) => bytesToNoirInput(Array.from(bytesOf(str(t[k]))));
    const coinbase: AttesterCircuitInputs = {
      signal_hash: b('signal_hash'),
      signer_list_merkle_root: b('signer_list_merkle_root'),
      scope: b('scope'),
      nullifier: bytesToNoirInput(new Array(32).fill(0)), // replaced by the builder's own rule
      user_address: b('user_address'),
      user_signature: b('user_signature'),
      user_pubkey_x: b('user_pubkey_x'),
      user_pubkey_y: b('user_pubkey_y'),
      raw_transaction: b('raw_transaction'),
      tx_length: str(t.tx_length),
      coinbase_attester_pubkey_x: b('coinbase_attester_pubkey_x'),
      coinbase_attester_pubkey_y: b('coinbase_attester_pubkey_y'),
      coinbase_signer_merkle_proof: (t.coinbase_signer_merkle_proof as string[]).flatMap(r => bytesToNoirInput(Array.from(bytesOf(r)))),
      coinbase_signer_leaf_index: str(t.coinbase_signer_leaf_index),
      merkle_proof_depth: str(t.merkle_proof_depth),
    };
    const cut = (k: string, lenKey: string) => bytesOf(str(t[k])).slice(0, Number(t[lenKey]));
    const flat = flattenCoinbaseAppAttestInputs(
      prepareCoinbaseAppAttestInputs(
        coinbase,
        {
          userAddress: wallet,
          scope: computeScope(vector.scopeString),
          signedDigest: coinbaseRequestDigest(wallet, vector.scopeString, actionOf(m)),
          publicHashes: m === 'action'
            ? {domainSeparator: str(t.domain_separator), actionHash: str(t.action_hash)}
            : undefined,
        },
        {
          clientData: bytesOf(str(t.client_data)),
          attestedAt: Number(t.attested_at),
          credential: {
            caKey: bytesOf(str(t.app_attest_ca_key)),
            caKeyHash: str(t.app_attest_ca_key_hash),
            credentialTbs: cut('credential_tbs', 'credential_tbs_len'),
            credentialSig: bytesOf(str(t.credential_sig)),
            attAuthData: cut('att_auth_data', 'att_auth_data_len'),
            attClientDataHash: bytesOf(str(t.att_client_data_hash)),
            credentialKey: new Uint8Array(64),
            production: t.app_attest_production === 'true',
          },
          assertion: {
            authenticatorData: cut('assertion_auth_data', 'assertion_auth_data_len'),
            signature: bytesOf(str(t.assertion_sig)),
            counter: 1,
          },
        },
      ),
    );

    // The expected vector, read off the ABI: each parameter's values in turn.
    const expected = vector.abi.flatMap(p => {
      const v = t[p.name];
      if (Array.isArray(v)) return v.flatMap(r => Array.from(bytesOf(r)).map(BigInt));
      if (v === 'true' || v === 'false') return [v === 'true' ? 1n : 0n];
      if (/^0x/.test(v)) return Array.from(bytesOf(v)).map(BigInt);
      return [BigInt(v)];
    });
    expect(expected.length).toBe(2897);
    expect(flat.length).toBe(expected.length);
    expect(flat.map(x => BigInt(x))).toEqual(expected);
  });
});

describe('what the circuit makes public', () => {
  it('is 226 field elements, which is what the app checks after proving', () => {
    const pub = vector.abi.filter(p => p.visibility === 'public');
    expect(pub.map(p => p.name)).toEqual([
      'signal_hash', 'domain_separator', 'action_hash', 'signer_list_merkle_root', 'scope', 'nullifier',
      'app_attest_ca_key_hash', 'attested_at', 'app_attest_production',
    ]);
    expect(pub.reduce((n, p) => n + p.fields, 0)).toBe(coinbaseKycArtifact().publicInputCount);
  });
});

describe('a statement that must not be made', () => {
  const code = (f: () => unknown) => {
    try {
      f();
    } catch (e) {
      return e instanceof AppAttestError ? e.code : (e as Error).message;
    }
    return 'built';
  };

  it('is refused for a revoked attestation with E2011', () => {
    expect(code(() => clientDataFor('noAction', {revoked: true}))).toBe('E2011');
  });

  it('is refused for another schema or another attester', () => {
    expect(code(() => clientDataFor('noAction', {schemaUid: '0x' + '11'.repeat(32)}))).toMatch(/not the Coinbase Verified Account schema/);
    expect(code(() => clientDataFor('noAction', {attester: '0x' + '22'.repeat(20)}))).toMatch(/not Coinbase's attester/);
  });

  it('is refused for a field of the wrong width or a timestamp that is not whole seconds', () => {
    expect(code(() => clientDataFor('noAction', {requestDigest: '0x1234'}))).toMatch(/request digest is 2 bytes/);
    expect(code(() => clientDataFor('noAction', {attestationUid: '0x' + '00'.repeat(33)}))).toMatch(/attestation uid is 33 bytes/);
    expect(code(() => clientDataFor('noAction', {attestedAt: 1.5}))).toMatch(/whole seconds/);
    expect(code(() => clientDataFor('noAction', {attestedAt: 0}))).toMatch(/whole seconds/);
    expect(code(() => clientDataFor('noAction', {wallet: '0x1234'}))).toMatch(/not an address/);
  });

  it('writes the timestamp big-endian at offset 68', () => {
    const cd = clientDataFor('noAction', {attestedAt: 0x0102030405});
    expect(Array.from(cd.slice(68, 76))).toEqual([0, 0, 0, 1, 2, 3, 4, 5]);
  });
});

describe('the vector builder refuses a statement for another proof', () => {
  const t = toml('noAction');
  const base = () => ({
    coinbase: {
      signal_hash: bytesToNoirInput(Array.from(bytesOf(str(t.signal_hash)))),
    } as unknown as AttesterCircuitInputs,
    witness: {
      clientData: bytesOf(str(t.client_data)),
      attestedAt: Number(t.attested_at),
      credential: {caKey: new Uint8Array(96), caKeyHash: '0x' + '00'.repeat(32), credentialTbs: new Uint8Array(10),
        credentialSig: new Uint8Array(96), attAuthData: new Uint8Array(164), attClientDataHash: new Uint8Array(32),
        credentialKey: new Uint8Array(64), production: true},
      assertion: {authenticatorData: new Uint8Array(37), signature: new Uint8Array(64), counter: 1},
    },
  });
  const digest = coinbaseRequestDigest(wallet, vector.scopeString);
  const scope = computeScope(vector.scopeString);

  it('names another wallet', () => {
    const {coinbase, witness} = base();
    expect(() => prepareCoinbaseAppAttestInputs(coinbase, {userAddress: '0x' + '33'.repeat(20), scope, signedDigest: digest}, witness))
      .toThrow(/clientData names wallet/);
  });

  it('binds another request', () => {
    const {coinbase, witness} = base();
    expect(() => prepareCoinbaseAppAttestInputs(coinbase, {userAddress: wallet, scope, signedDigest: '0x' + '44'.repeat(32)}, witness))
      .toThrow(/binds request/);
  });

  it('binds another scope', () => {
    const {coinbase, witness} = base();
    expect(() => prepareCoinbaseAppAttestInputs(coinbase, {userAddress: wallet, scope: computeScope('another'), signedDigest: digest}, witness))
      .toThrow(/another scope/);
  });

  it('carries a TBS longer than the circuit holds', () => {
    const {coinbase, witness} = base();
    witness.credential.credentialTbs = new Uint8Array(1001);
    expect(() => prepareCoinbaseAppAttestInputs(coinbase, {userAddress: wallet, scope, signedDigest: digest}, witness))
      .toThrow(/the circuit holds 1000/);
  });
});
