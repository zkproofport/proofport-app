/**
 * The app's clientData and input vector, byte for byte against what the
 * circuit's own fixture generator produced.
 *
 * fixtures/generateProverTomlVector.json is written by
 * circuits/scripts/coinbase-attestation-v2/export-app-vector.js (circuits
 * fb6aed3; the circuit is tag v2.0.0-rc.1's): it runs the circuit's fixture
 * generator with a throwaway random wallet and an all-zero Coinbase half and
 * records both Prover.toml files and the compiled circuit's ABI. Regenerate
 * with that script whenever the circuit changes. Its
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
import {APPLE_APP_ATTEST_CA1_KEY_HASH} from '../constants';
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

  it('builds the same 2,769-value vector, in fn main order, as the app signer kind', () => {
    expect(toml(m).signer_kind).toBe('1');
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
          // The vector's credential is signed by the generator's SYNTHETIC
          // intermediate; the app pins Apple's CA 1 in its place.
          pinnedCaKeyHash: vector.caKeyHash,
        },
        {
          clientData: bytesOf(str(t.client_data)),
          attestedAt: Number(t.attested_at),
          credential: {
            caKey: new Uint8Array(96), // not a circuit input since CA 1 is pinned in-circuit
            caKeyHash: vector.caKeyHash,
            credentialTbs: cut('credential_tbs', 'credential_tbs_len'),
            credentialSig: bytesOf(str(t.credential_sig)),
            attAuthData: cut('att_auth_data', 'att_auth_data_len'),
            attClientDataHash: bytesOf(str(t.att_client_data_hash)),
            credentialKey: new Uint8Array(64),
            production: true,
          },
          assertion: {
            authenticatorData: cut('assertion_auth_data', 'assertion_auth_data_len'),
            signature: bytesOf(str(t.statement_sig)),
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
    expect(expected.length).toBe(2769);
    expect(flat.length).toBe(expected.length);
    expect(flat.map(x => BigInt(x))).toEqual(expected);
  });
});

describe('what the circuit makes public', () => {
  it('is 193 field elements, which is what the app checks after proving', () => {
    const pub = vector.abi.filter(p => p.visibility === 'public');
    expect(pub.map(p => p.name)).toEqual([
      'signal_hash', 'domain_separator', 'action_hash', 'signer_list_merkle_root', 'scope', 'nullifier',
      'attested_at',
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
  const PINNED = '0x' + 'ab'.repeat(32);
  const t = toml('noAction');
  const base = () => ({
    coinbase: {
      signal_hash: bytesToNoirInput(Array.from(bytesOf(str(t.signal_hash)))),
    } as unknown as AttesterCircuitInputs,
    witness: {
      clientData: bytesOf(str(t.client_data)),
      attestedAt: Number(t.attested_at),
      credential: {caKey: new Uint8Array(96), caKeyHash: PINNED, credentialTbs: new Uint8Array(10),
        credentialSig: new Uint8Array(96), attAuthData: new Uint8Array(164), attClientDataHash: new Uint8Array(32),
        credentialKey: new Uint8Array(64), production: true},
      assertion: {authenticatorData: new Uint8Array(37), signature: new Uint8Array(64), counter: 1},
    },
  });
  const digest = coinbaseRequestDigest(wallet, vector.scopeString);
  const scope = computeScope(vector.scopeString);

  it('names another wallet', () => {
    const {coinbase, witness} = base();
    expect(() => prepareCoinbaseAppAttestInputs(coinbase, {userAddress: '0x' + '33'.repeat(20), scope, signedDigest: digest, pinnedCaKeyHash: PINNED}, witness))
      .toThrow(/clientData names wallet/);
  });

  it('binds another request', () => {
    const {coinbase, witness} = base();
    expect(() => prepareCoinbaseAppAttestInputs(coinbase, {userAddress: wallet, scope, signedDigest: '0x' + '44'.repeat(32), pinnedCaKeyHash: PINNED}, witness))
      .toThrow(/binds request/);
  });

  it('binds another scope', () => {
    const {coinbase, witness} = base();
    expect(() => prepareCoinbaseAppAttestInputs(coinbase, {userAddress: wallet, scope: computeScope('another'), signedDigest: digest, pinnedCaKeyHash: PINNED}, witness))
      .toThrow(/another scope/);
  });

  it('carries a TBS longer than the circuit holds', () => {
    const {coinbase, witness} = base();
    witness.credential.credentialTbs = new Uint8Array(1001);
    expect(() => prepareCoinbaseAppAttestInputs(coinbase, {userAddress: wallet, scope, signedDigest: digest, pinnedCaKeyHash: PINNED}, witness))
      .toThrow(/the circuit holds 1000/);
  });

  const codeOf = (f: () => unknown) => {
    try {
      f();
    } catch (e) {
      return e instanceof AppAttestError ? e.code : (e as Error).message;
    }
    return 'built';
  };
  const request = (o: Record<string, unknown> = {}) => ({userAddress: wallet, scope, signedDigest: digest, pinnedCaKeyHash: PINNED, ...o});

  it('refuses an intermediate the circuit does not pin with E2014, before anything else', () => {
    const {coinbase, witness} = base();
    witness.credential.caKeyHash = '0x' + 'cd'.repeat(32);
    expect(codeOf(() => prepareCoinbaseAppAttestInputs(coinbase, request(), witness))).toBe('E2014');
    // Apple's CA 1 is not the synthetic one: the app's own pin refuses the vector.
    expect(codeOf(() => prepareCoinbaseAppAttestInputs(coinbase, request({pinnedCaKeyHash: APPLE_APP_ATTEST_CA1_KEY_HASH}), witness))).toBe('E2014');
  });

  it('compares the CA hash without regard to hex case', () => {
    const {coinbase, witness} = base();
    witness.credential.caKeyHash = PINNED.toUpperCase().replace('0X', '0x');
    expect(codeOf(() => prepareCoinbaseAppAttestInputs(coinbase, request(), witness))).not.toBe('E2014');
  });

  it('refuses a development-environment key with E2014', () => {
    const {coinbase, witness} = base();
    witness.credential.production = false;
    expect(codeOf(() => prepareCoinbaseAppAttestInputs(coinbase, request(), witness))).toBe('E2014');
  });

  it('refuses an assertion signature whose s is high, and accepts n/2 exactly', () => {
    const half = (BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551') >> 1n);
    const sig = (sv: bigint) => new Uint8Array(ethers.utils.arrayify(ethers.utils.hexConcat([ethers.utils.hexZeroPad('0x01', 32), ethers.utils.hexZeroPad(ethers.BigNumber.from(sv.toString()).toHexString(), 32)])));
    const high = base();
    high.witness.assertion.signature = sig(half + 1n);
    expect(codeOf(() => prepareCoinbaseAppAttestInputs(high.coinbase, request(), high.witness))).toBe('E2014');
    const edge = base();
    edge.witness.assertion.signature = sig(half);
    expect(codeOf(() => prepareCoinbaseAppAttestInputs(edge.coinbase, request(), edge.witness))).not.toBe('E2014');
  });

  it('refuses an assertion signature of the wrong length', () => {
    const {coinbase, witness} = base();
    witness.assertion.signature = new Uint8Array(65);
    expect(codeOf(() => prepareCoinbaseAppAttestInputs(coinbase, request(), witness))).toMatch(/statement_sig is 65 bytes/);
  });

  it('refuses signal mode with an all-zero signal_hash (the circuit refuses a request that signs nothing)', () => {
    const {coinbase, witness} = base();
    coinbase.signal_hash = bytesToNoirInput(new Array(32).fill(0));
    expect(codeOf(() => prepareCoinbaseAppAttestInputs(coinbase, request(), witness))).toMatch(/all-zero signal_hash/);
  });
});
