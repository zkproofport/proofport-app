/**
 * The Android packages' input vectors, held to their compiled ABI
 * (fixtures/androidCircuitAbis.json, read off
 * oidc_domain_attestation_android.json and
 * coinbase_attestation_v2_android.json by
 * scripts/export-android-signer-fixtures.js).
 *
 * bb reads the vector positionally, so for each circuit: the parameter names
 * in order, every parameter's values at its own offset, the public inputs and
 * the token / Coinbase half identical to the iPhone circuit's for the same
 * request, and the total length.
 */
jest.mock('react-native', () => ({NativeModules: {}, Platform: {OS: 'ios'}}));
jest.mock('@react-native-async-storage/async-storage', () => ({__esModule: true, default: {}}));

import {ethers} from 'ethers';
import abis from '../../utils/__tests__/fixtures/androidCircuitAbis.json';
import vectors from '../../utils/__tests__/fixtures/androidChainVectors.json';
import iosVector from '../../appAttest/__tests__/fixtures/generateProverTomlVector.json';
import {coinbaseRequestDigest} from '../../appAttest/coinbaseKycStatement';
import {androidChainInputs, GOOGLE_KEY_ATTESTATION_CA1} from '../../utils/androidKeyAttestation';
import {bytesToNoirInput, computeScope, type AttesterCircuitInputs} from '../../utils/circuitHelpers';
import {
  COINBASE_ANDROID_FLAT_INPUT_COUNT,
  flattenCoinbaseAndroidInputs,
  flattenCoinbaseAppAttestInputs,
  prepareCoinbaseAndroidInputs,
  prepareCoinbaseAppAttestInputs,
} from '../../utils/coinbaseAppAttestInputs';
import {
  flattenOidcInputs,
  OIDC_ABI_PARAMETERS,
  OIDC_ANDROID_ABI_PARAMETERS,
  OIDC_ANDROID_FLAT_INPUT_COUNT,
  OIDC_FLAT_INPUT_COUNT,
  OIDC_PUBLIC_INPUT_COUNT,
  requireOidcAbi,
  type OidcCircuitInputs,
} from '../../utils/oidcDomain';
import {SIGNER_KIND_APP, type AppSignerInputs} from '../../appAttest/appSignerInputs';
import {ANDROID_SIGNER_ABI_PARAMETERS, ANDROID_SIGNER_FLAT_COUNT, type AndroidSignerInputs} from '../androidSignerInputs';

type Abi = {parameters: Array<{name: string; visibility: string; size: number}>};

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

/** Real signer inputs: the tegu chain, and a recognisable statement_sig. */
function androidSigner(): AndroidSignerInputs {
  const chain = (vectors.cases as unknown as Record<string, {chain: string[]}>)['tegu-sdk36-sb-ec-2026-root'].chain
    .map(b => Uint8Array.from(Buffer.from(b, 'base64')));
  const {leaf_key: _leafKey, ...c} = androidChainInputs(chain, GOOGLE_KEY_ATTESTATION_CA1);
  return {variant: 'android', statement_sig: Uint8Array.from({length: 64}, (_v, i) => i + 1), ...c};
}

/** The signer's values per ABI parameter, as numbers. */
function signerValues(s: AndroidSignerInputs): Record<string, number[]> {
  return {
    statement_sig: Array.from(s.statement_sig),
    ca2_tbs: Array.from(s.ca2_tbs), ca2_tbs_len: [s.ca2_tbs_len], ca2_sig: Array.from(s.ca2_sig),
    ca3_tbs: Array.from(s.ca3_tbs), ca3_tbs_len: [s.ca3_tbs_len], ca3_sig: Array.from(s.ca3_sig),
    att_tbs: Array.from(s.att_tbs), att_tbs_len: [s.att_tbs_len], att_sig: Array.from(s.att_sig),
    leaf_tbs: Array.from(s.leaf_tbs), leaf_tbs_len: [s.leaf_tbs_len], leaf_sig: Array.from(s.leaf_sig),
  };
}

describe('the fixture', () => {
  it('records both packages, from the circuits checkout', () => {
    expect(abis.oidc_domain_attestation.package).toBe('oidc_domain_attestation_android');
    expect(abis.coinbase_attestation.package).toBe('coinbase_attestation_v2_android');
    expect(abis.source.circuitsCommit).toMatch(/^[0-9a-f]{40}$/);
  });
});

describe('oidc_domain_attestation_android', () => {
  const abi = abis.oidc_domain_attestation as Abi;
  const at = layout(abi);

  it('takes OIDC_ANDROID_ABI_PARAMETERS, in order, and the same public inputs as the iPhone circuit', () => {
    expect(abi.parameters.map(p => p.name)).toEqual([...OIDC_ANDROID_ABI_PARAMETERS]);
    expect(publicCount(abi)).toBe(OIDC_PUBLIC_INPUT_COUNT);
    expect(total(abi)).toBe(OIDC_ANDROID_FLAT_INPUT_COUNT);
    expect(OIDC_ANDROID_FLAT_INPUT_COUNT).toBe(5601);
    // Everything before the signer is the iPhone circuit's.
    expect(OIDC_ANDROID_ABI_PARAMETERS.slice(0, OIDC_ABI_PARAMETERS.indexOf('signer_kind')))
      .toEqual(OIDC_ABI_PARAMETERS.slice(0, OIDC_ABI_PARAMETERS.indexOf('signer_kind')));
  });

  it('requireOidcAbi accepts each platform its own ABI only, and an unknown variant throws', () => {
    expect(() => requireOidcAbi(abi.parameters.map(p => p.name), 'android')).not.toThrow();
    expect(() => requireOidcAbi(abi.parameters.map(p => p.name), 'app_attest')).toThrow(/this app builds/);
    expect(() => requireOidcAbi([...OIDC_ABI_PARAMETERS], 'android')).toThrow(/this app builds/);
    expect(() => requireOidcAbi([...OIDC_ABI_PARAMETERS], 'web' as never)).toThrow(/No OIDC circuit ABI for signer 'web'\. Known: app_attest, android/);
  });

  // A token half with every value distinct per field, so a misplaced block shows.
  const token: Omit<OidcCircuitInputs, 'signer'> = {
    pubkey_modulus_limbs: Array.from({length: 18}, (_v, i) => String(1000 + i)),
    domain: {storage: Array.from({length: 64}, (_v, i) => (i < 10 ? 97 + i : 0)), len: 10},
    scope: Array.from({length: 32}, (_v, i) => i),
    nullifier: Array.from({length: 32}, (_v, i) => 100 + i),
    provider: 1,
    aud_hash: Array.from({length: 32}, (_v, i) => 50 + i),
    nonce_mode: 1,
    nonce_binding: Array.from({length: 32}, (_v, i) => 200 + (i % 50)),
    now: '1793000000',
    partial_data: {storage: Array.from({length: 2048}, (_v, i) => i % 251), len: 1900},
    partial_hash: [1, 2, 3, 4, 5, 6, 7, 8],
    full_data_length: 1964,
    base64_decode_offset: 39,
    redc_params_limbs: Array.from({length: 18}, (_v, i) => String(2000 + i)),
    signature_limbs: Array.from({length: 18}, (_v, i) => String(3000 + i)),
  };
  const appSigner: AppSignerInputs = {
    signer_kind: SIGNER_KIND_APP,
    statement_sig: new Uint8Array(64),
    credential_tbs: new Uint8Array(1000),
    credential_tbs_len: 0,
    credential_sig: new Uint8Array(96),
    att_auth_data: new Uint8Array(256),
    att_auth_data_len: 0,
    att_client_data_hash: new Uint8Array(32),
    assertion_auth_data: new Uint8Array(128),
    assertion_auth_data_len: 0,
  };

  it('flattens every parameter at its ABI offset, the token half identical to the iPhone vector', () => {
    const signer = androidSigner();
    const flat = flattenOidcInputs({...token, signer});
    const ios = flattenOidcInputs({...token, signer: appSigner});
    expect(flat).toHaveLength(total(abi));
    expect(ios).toHaveLength(OIDC_FLAT_INPUT_COUNT);
    const [signerAt] = at.statement_sig;
    expect(signerAt).toBe(OIDC_PUBLIC_INPUT_COUNT + 2095);
    expect(flat.slice(0, signerAt)).toEqual(ios.slice(0, signerAt));
    expect(flat.length - signerAt).toBe(ANDROID_SIGNER_FLAT_COUNT);
    for (const [name, values] of Object.entries(signerValues(signer))) {
      const [start, size] = at[name];
      expect([name, flat.slice(start, start + size)]).toEqual([name, values.map(String)]);
    }
    expect(flat.slice(at.now[0], at.now[0] + 1)).toEqual(['1793000000']);
  });

  it('refuses signer inputs that are neither kind, naming them', () => {
    expect(() => flattenOidcInputs({...token, signer: {...appSigner, signer_kind: 2}})).toThrow(/neither App Attest \(signer_kind 1\) nor Android/);
    expect(() => flattenOidcInputs({...token, signer: undefined as never})).toThrow(/neither App Attest/);
  });

  it('refuses an Android signer with a wrong-sized field', () => {
    expect(() => flattenOidcInputs({...token, signer: {...androidSigner(), leaf_tbs: new Uint8Array(1023)}})).toThrow(/leaf_tbs is 1023 bytes; the circuit takes 1024/);
  });
});

describe('coinbase_attestation_v2_android', () => {
  const abi = abis.coinbase_attestation as Abi;
  const at = layout(abi);
  const t = (iosVector as unknown as {noAction: Record<string, string | string[]>}).noAction;
  const str = (v: string | string[]) => v as string;
  const bytesOf = (h: string) => ethers.utils.arrayify(h);
  const b = (k: string) => bytesToNoirInput(Array.from(bytesOf(str(t[k]))));
  const wallet = ethers.utils.getAddress(str(t.user_address));
  const coinbase: AttesterCircuitInputs = {
    signal_hash: b('signal_hash'),
    signer_list_merkle_root: b('signer_list_merkle_root'),
    scope: b('scope'),
    nullifier: b('nullifier'),
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
  const request = {
    circuit: 'coinbase_attestation' as const,
    userAddress: wallet,
    scope: computeScope((iosVector as unknown as {scopeString: string}).scopeString),
    signedDigest: coinbaseRequestDigest(wallet, (iosVector as unknown as {scopeString: string}).scopeString),
  };
  const clientData = bytesOf(str(t.client_data));
  const attestedAt = Number(t.attested_at);

  it('takes the iPhone parameters up to client_data, then the Android signer', () => {
    const names = abi.parameters.map(p => p.name);
    const cut = names.indexOf('client_data') + 1;
    expect(names.slice(cut)).toEqual([...ANDROID_SIGNER_ABI_PARAMETERS]);
    expect(publicCount(abi)).toBe(193);
    expect(total(abi)).toBe(COINBASE_ANDROID_FLAT_INPUT_COUNT);
  });

  it('flattens every parameter at its ABI offset, everything before the signer identical to the iPhone vector', () => {
    const signer = androidSigner();
    const flat = flattenCoinbaseAndroidInputs(prepareCoinbaseAndroidInputs(coinbase, request, {variant: 'android', clientData, attestedAt, signer}));
    expect(flat).toHaveLength(total(abi));

    // The iPhone builder on the same request (its own test holds it to the
    // circuit's fixture): the same values up to client_data.
    const vec = iosVector as unknown as {caKeyHash: string};
    const cutBytes = (k: string, lenKey: string) => bytesOf(str(t[k])).slice(0, Number(t[lenKey]));
    const ios = flattenCoinbaseAppAttestInputs(prepareCoinbaseAppAttestInputs(coinbase, {...request, pinnedCaKeyHash: vec.caKeyHash}, {
      clientData,
      attestedAt,
      credential: {
        caKey: new Uint8Array(96), caKeyHash: vec.caKeyHash,
        credentialTbs: cutBytes('credential_tbs', 'credential_tbs_len'), credentialSig: bytesOf(str(t.credential_sig)),
        attAuthData: cutBytes('att_auth_data', 'att_auth_data_len'), attClientDataHash: bytesOf(str(t.att_client_data_hash)),
        credentialKey: new Uint8Array(64), production: true,
      },
      assertion: {authenticatorData: cutBytes('assertion_auth_data', 'assertion_auth_data_len'), signature: bytesOf(str(t.statement_sig)), counter: 1},
    }));
    const [signerAt] = at.statement_sig;
    expect(flat.slice(0, signerAt)).toEqual(ios.slice(0, signerAt));
    expect(flat.slice(at.attested_at[0], at.attested_at[0] + 1)).toEqual([String(attestedAt)]);

    for (const [name, values] of Object.entries(signerValues(signer))) {
      const [start, size] = at[name];
      const rendered = name.endsWith('_len') ? values.map(String) : bytesToNoirInput(values);
      expect([name, flat.slice(start, start + size)]).toEqual([name, rendered]);
    }
  });

  it('refuses a statement for another wallet, digest or scope, as the iPhone builder does', () => {
    const w = {variant: 'android' as const, clientData, attestedAt, signer: androidSigner()};
    expect(() => prepareCoinbaseAndroidInputs(coinbase, {...request, userAddress: '0x' + '33'.repeat(20)}, w)).toThrow(/clientData names wallet/);
    expect(() => prepareCoinbaseAndroidInputs(coinbase, {...request, signedDigest: '0x' + '44'.repeat(32)}, w)).toThrow(/clientData binds request/);
    expect(() => prepareCoinbaseAndroidInputs(coinbase, {...request, scope: computeScope('another')}, w)).toThrow(/clientData binds another scope/);
    expect(() => prepareCoinbaseAndroidInputs(coinbase, request, {...w, signer: {} as never})).toThrow(/no Android signer inputs/);
  });
});

describe('the factory packages', () => {
  /* eslint-disable @typescript-eslint/no-var-requires */
  const factory = require('../../utils/__tests__/fixtures/androidFactoryVectors.json');
  const {OIDC_ANDROID_FACTORY_ABI_PARAMETERS, OIDC_ANDROID_FACTORY_FLAT_INPUT_COUNT} = require('../../utils/oidcDomain');
  const {COINBASE_ANDROID_FACTORY_FLAT_INPUT_COUNT} = require('../../utils/coinbaseAppAttestInputs');
  const {ANDROID_FACTORY_SIGNER_ABI_PARAMETERS, ANDROID_FACTORY_SIGNER_FLAT_COUNT} = require('../androidSignerInputs');
  /* eslint-enable @typescript-eslint/no-var-requires */
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
  const values: Record<string, string[]> = {
    statement_sig: Array.from(signer.statement_sig, String),
    ik_tbs: Array.from(signer.ik_tbs, String), ik_tbs_len: [String(signer.ik_tbs_len)], ik_sig: signer.ik_sig.map(String),
    batch_tbs: Array.from(signer.batch_tbs, String), batch_tbs_len: [String(signer.batch_tbs_len)], batch_sig: Array.from(signer.batch_sig, String),
    leaf_tbs: Array.from(signer.leaf_tbs, String), leaf_tbs_len: [String(signer.leaf_tbs_len)], leaf_sig: Array.from(signer.leaf_sig, String),
    integrity_payload_b64: Array.from(signer.integrity_payload_b64, String),
    integrity_payload_b64_len: [String(signer.integrity_payload_b64_len)],
    integrity_signature: Array.from(signer.integrity_signature, String),
    rsa_root_modulus: signer.rsa_root_modulus.map(String),
    rsa_root_redc: signer.rsa_root_redc.map(String),
    play_integrity_key: Array.from(signer.play_integrity_key, String),
  };

  it('oidc_domain_attestation_android_factory takes OIDC_ANDROID_FACTORY_ABI_PARAMETERS, 6,186 values', () => {
    const abi = abis.oidc_domain_attestation_factory as Abi;
    expect(abi.parameters.map(p => p.name)).toEqual([...OIDC_ANDROID_FACTORY_ABI_PARAMETERS]);
    expect(total(abi)).toBe(OIDC_ANDROID_FACTORY_FLAT_INPUT_COUNT);
    expect(publicCount(abi)).toBe(OIDC_PUBLIC_INPUT_COUNT);
    expect(() => requireOidcAbi(abi.parameters.map(p => p.name), 'android_factory')).not.toThrow();
    expect(() => requireOidcAbi(abi.parameters.map(p => p.name), 'android')).toThrow(/this app builds/);
  });

  it('coinbase_attestation_v2_android_factory takes the common inputs, then the factory signer, 5,066 values', () => {
    const abi = abis.coinbase_attestation_factory as Abi;
    const names = abi.parameters.map(p => p.name);
    expect(names.slice(names.indexOf('client_data') + 1)).toEqual([...ANDROID_FACTORY_SIGNER_ABI_PARAMETERS]);
    expect(total(abi)).toBe(COINBASE_ANDROID_FACTORY_FLAT_INPUT_COUNT);
    expect(publicCount(abi)).toBe(193);
  });

  it('the OIDC factory vector puts every signer value at its ABI offset (decimals)', () => {
    const abi = abis.oidc_domain_attestation_factory as Abi;
    const at = layout(abi);
    const token = {
      pubkey_modulus_limbs: Array.from({length: 18}, (_v, i) => String(1000 + i)),
      domain: {storage: new Array(64).fill(0), len: 0},
      scope: new Array(32).fill(1), nullifier: new Array(32).fill(2), provider: 0, aud_hash: new Array(32).fill(3),
      nonce_mode: 1, nonce_binding: new Array(32).fill(4), now: '1793000000',
      partial_data: {storage: new Array(2048).fill(5), len: 100}, partial_hash: [1, 2, 3, 4, 5, 6, 7, 8],
      full_data_length: 164, base64_decode_offset: 1,
      redc_params_limbs: new Array(18).fill('9'), signature_limbs: new Array(18).fill('8'),
    };
    const flat = flattenOidcInputs({...token, signer});
    expect(flat).toHaveLength(total(abi));
    expect(flat.length - at.statement_sig[0]).toBe(ANDROID_FACTORY_SIGNER_FLAT_COUNT);
    for (const [name, v] of Object.entries(values)) {
      const [start, size] = at[name];
      expect([name, flat.slice(start, start + size)]).toEqual([name, v]);
    }
  });

  it('refuses factory inputs with a wrong limb count or a limb outside 120 bits', () => {
    const {flattenAndroidFactorySigner} = jest.requireActual('../androidSignerInputs');
    expect(() => flattenAndroidFactorySigner({...signer, ik_sig: signer.ik_sig.slice(1)}, String, String, String)).toThrow(/ik_sig has 34 limbs/);
    expect(() => flattenAndroidFactorySigner({...signer, rsa_root_redc: [1n << 120n, ...signer.rsa_root_redc.slice(1)]}, String, String, String)).toThrow(/outside 120 bits/);
  });
});
