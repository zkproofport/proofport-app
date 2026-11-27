/**
 * The GIWA KYC v2 and Dojang Playground v2 input vectors, segment by segment,
 * against the six compiled packages' own ABI (fixtures/giwaV2Abi.json: each
 * `fn main` parameter's name, flattened size and visibility, read from
 * each package's target JSON in circuits (giwa-attestation-v2, dojang-playground-v2
 * and their two Android packages), built
 * 2026-11-27 with nargo 1.0.0). bb reads the vector positionally, so a value
 * in the wrong place fails on the phone with nothing naming it; here every
 * segment must hold exactly the value meant for that parameter.
 */
jest.mock('react-native', () => ({NativeModules: {}, Platform: {OS: 'ios'}}));
jest.mock('@react-native-async-storage/async-storage', () => ({__esModule: true, default: {}}));

const APP_SIGNER_SIZES: Record<string, number> = {
  statement_sig: 64, credential_tbs: 1000, credential_sig: 96, att_auth_data: 256, att_client_data_hash: 32, assertion_auth_data: 128,
};
// Each byte field filled with its own byte, so its segment is recognisable.
const APP_SIGNER_BYTE: Record<string, number> = {
  statement_sig: 0xa1, credential_tbs: 0xa2, credential_sig: 0xa3, att_auth_data: 0xa4, att_client_data_hash: 0xa5, assertion_auth_data: 0xa6,
};
jest.mock('../../appAttest/appSignerInputs', () => ({
  appSignerInputs: () => {
    const fill = (k: string) => new Array(APP_SIGNER_SIZES[k]).fill(APP_SIGNER_BYTE[k]);
    return {
      signer_kind: 7, statement_sig: fill('statement_sig'), credential_tbs: fill('credential_tbs'), credential_tbs_len: 901,
      credential_sig: fill('credential_sig'), att_auth_data: fill('att_auth_data'), att_auth_data_len: 902,
      att_client_data_hash: fill('att_client_data_hash'), assertion_auth_data: fill('assertion_auth_data'), assertion_auth_data_len: 903,
    };
  },
}));
let mockAndroidSignerLength = 0;
jest.mock('../../androidAttest/androidSignerInputs', () => ({
  ...jest.requireActual('../../androidAttest/androidSignerInputs'),
  flattenAnyAndroidSigner: () => Array.from({length: mockAndroidSignerLength}, (_, i) => `android_signer:${i}`),
}));

import abi from './fixtures/giwaV2Abi.json';
import {flattenDojangV2Inputs, flattenGiwaKycV2Inputs, type GiwaStatementVectorRequest} from '../giwaStatementInputs';
import {buildGiwaStatement, type GiwaStatementCircuit} from '../../appAttest/giwaStatement';
import {oprfScopeBytesOf} from '../../oprf/circuitInputs';
import {bytesToNoirInput, type AttesterCircuitInputs} from '../circuitHelpers';
import type {DojangPlaygroundCircuitInputs} from '../dojangPlayground';
import type {StatementSignerVariant} from '../../config/signerPlatform';

type AbiRow = [name: string, size: number, visibility: string];
const PACKAGES = abi as unknown as Record<string, AbiRow[]>;
const WALLET = '0x5A3E649208Ae15ec52496c1Ae23b2Ff89Ac02f0c';
const SCOPE = oprfScopeBytesOf('vote-2026');
const DIGEST = '0x' + '44'.repeat(32);
const ATTESTED_AT = 1_795_000_000;
const tag = (name: string, n: number) => Array.from({length: n}, (_, i) => `${name}:${i}`);

const statementFor = (circuit: GiwaStatementCircuit) =>
  buildGiwaStatement(circuit, {wallet: WALLET, attestedAt: ATTESTED_AT, attestationUid: '0x' + 'ab'.repeat(32), requestDigest: DIGEST, scope: SCOPE, expirationTime: 0});

const request = (circuit: GiwaStatementCircuit): GiwaStatementVectorRequest => ({
  circuit, userAddress: WALLET, scope: SCOPE, signedDigest: DIGEST, pinnedCaKeyHash: '0x' + '00'.repeat(32),
});

const witnessFor = (circuit: GiwaStatementCircuit, variant: StatementSignerVariant) => {
  const clientData = statementFor(circuit);
  if (variant === 'app_attest') return {clientData, attestedAt: ATTESTED_AT, credential: {} as never, assertion: {} as never};
  return {variant, clientData, attestedAt: ATTESTED_AT, signer: {variant} as never};
};

// The EIP-712 mode (what every request now signs): signal_hash zero, both hashes present.
const ZERO32 = bytesToNoirInput(new Array(32).fill(0));
const giwaBase = (): AttesterCircuitInputs => ({
  signal_hash: ZERO32, domain_separator: tag('domain_separator', 32), action_hash: tag('action_hash', 32),
  signer_list_merkle_root: tag('signer_list_merkle_root', 32), oprf_public: ['oprf_key_hash', 'domain', 'scope', 'nullifier'],
  user_address: tag('user_address', 20), user_signature: tag('user_signature', 64), user_pubkey_x: tag('user_pubkey_x', 32),
  user_pubkey_y: tag('user_pubkey_y', 32), raw_transaction: tag('raw_transaction', 300), tx_length: 'tx_length',
  coinbase_attester_pubkey_x: tag('coinbase_attester_pubkey_x', 32), coinbase_attester_pubkey_y: tag('coinbase_attester_pubkey_y', 32),
  coinbase_signer_merkle_proof: tag('coinbase_signer_merkle_proof', 256), coinbase_signer_leaf_index: 'coinbase_signer_leaf_index',
  merkle_proof_depth: 'merkle_proof_depth',
  oprf_private: ['oprf_public_key_x', 'oprf_public_key_y', 'oprf_beta', 'oprf_dlog_e', 'oprf_dlog_s', 'oprf_response_x', 'oprf_response_y'],
} as AttesterCircuitInputs);
const dojangBase = (): DojangPlaygroundCircuitInputs => {
  const g = giwaBase();
  return {
    signal_hash: g.signal_hash, domain_separator: g.domain_separator!, action_hash: g.action_hash!, oprf_public: g.oprf_public,
    user_address: g.user_address, user_signature: g.user_signature, user_pubkey_x: g.user_pubkey_x, user_pubkey_y: g.user_pubkey_y,
    raw_transaction: g.raw_transaction, tx_length: g.tx_length, oprf_private: g.oprf_private,
  };
};

/** What each named parameter must hold, for the ones whose source is the base inputs or the statement. */
function expected(name: string, size: number, circuit: GiwaStatementCircuit, variant: StatementSignerVariant): string[] | undefined {
  const single = ['oprf_key_hash', 'domain', 'scope', 'nullifier', 'tx_length', 'coinbase_signer_leaf_index', 'merkle_proof_depth',
    'oprf_public_key_x', 'oprf_public_key_y', 'oprf_beta', 'oprf_dlog_e', 'oprf_dlog_s', 'oprf_response_x', 'oprf_response_y'];
  if (single.includes(name)) return [name];
  if (name === 'signal_hash') return ZERO32;
  if (name === 'attested_at') return [String(ATTESTED_AT)];
  if (name === 'client_data') return bytesToNoirInput(Array.from(statementFor(circuit)));
  // Android packages: statement_sig and the chain are the Android signer's, checked as one block.
  if (variant !== 'app_attest' && (name in APP_SIGNER_SIZES || name.endsWith('_tbs') || name.endsWith('_sig'))) return undefined;
  if (name in APP_SIGNER_SIZES) return bytesToNoirInput(new Array(size).fill(APP_SIGNER_BYTE[name]));
  if (name === 'signer_kind') return ['7'];
  if (name === 'credential_tbs_len') return ['901'];
  if (name === 'att_auth_data_len') return ['902'];
  if (name === 'assertion_auth_data_len') return ['903'];
  if (['domain_separator', 'action_hash', 'signer_list_merkle_root', 'user_address', 'user_signature', 'user_pubkey_x', 'user_pubkey_y',
    'raw_transaction', 'coinbase_attester_pubkey_x', 'coinbase_attester_pubkey_y', 'coinbase_signer_merkle_proof'].includes(name)) {
    return tag(name, size);
  }
  return undefined; // an Android signer parameter: checked as one block below
}

const CASES: Array<[pkg: string, circuit: GiwaStatementCircuit, variant: StatementSignerVariant]> = [
  ['giwa_attestation_v2', 'giwa_attestation', 'app_attest'],
  ['giwa_attestation_v2_android', 'giwa_attestation', 'android'],
  ['giwa_attestation_v2_android_factory', 'giwa_attestation', 'android_factory'],
  ['dojang_playground_v2', 'dojang_playground', 'app_attest'],
  ['dojang_playground_v2_android', 'dojang_playground', 'android'],
  ['dojang_playground_v2_android_factory', 'dojang_playground', 'android_factory'],
];

describe.each(CASES)('%s', (pkg, circuit, variant) => {
  const rows = PACKAGES[pkg];
  const total = rows.reduce((n, r) => n + r[1], 0);
  const androidRows = rows.filter(([name]) => expected(name, 0, circuit, variant) === undefined);
  const build = () => {
    mockAndroidSignerLength = androidRows.reduce((n, r) => n + r[1], 0);
    return circuit === 'giwa_attestation'
      ? flattenGiwaKycV2Inputs(variant, giwaBase(), request(circuit), witnessFor(circuit, variant) as never)
      : flattenDojangV2Inputs(variant, dojangBase(), request(circuit), witnessFor(circuit, variant) as never);
  };

  it('fills exactly the ABI length, with attested_at the last public input', () => {
    const v = build();
    expect(v.length).toBe(total);
    const publicRows = rows.filter(r => r[2] === 'public');
    expect(publicRows[publicRows.length - 1][0]).toBe('attested_at');
    expect(publicRows.reduce((n, r) => n + r[1], 0)).toBe(circuit === 'giwa_attestation' ? 133 : 101);
  });

  it('puts every parameter where the ABI has it', () => {
    const v = build();
    let at = 0;
    for (const [name, size] of rows) {
      const want = expected(name, size, circuit, variant);
      if (want !== undefined) {
        expect({name, got: v.slice(at, at + size)}).toEqual({name, got: want});
      }
      at += size;
    }
  });

  it('the Android signer (if any) fills the run of parameters between the statement and the OPRF private inputs', () => {
    const v = build();
    if (variant === 'app_attest') {
      expect(androidRows).toEqual([]);
      return;
    }
    const names = rows.map(r => r[0]);
    const start = rows.slice(0, names.indexOf('client_data') + 1).reduce((n, r) => n + r[1], 0);
    const end = rows.slice(0, names.indexOf('oprf_public_key_x')).reduce((n, r) => n + r[1], 0);
    expect(v.slice(start, end)).toEqual(Array.from({length: end - start}, (_, i) => `android_signer:${i}`));
  });
});

describe('a vector that would prove the wrong thing is refused before the prover', () => {
  it("another kind's statement (a Dojang statement for GIWA KYC)", () => {
    const w = {clientData: statementFor('dojang_playground'), attestedAt: ATTESTED_AT, credential: {} as never, assertion: {} as never};
    expect(() => flattenGiwaKycV2Inputs('app_attest', giwaBase(), request('giwa_attestation'), w)).toThrow(/statement is not GIWA KYC[^']*'s \(tag 0x[0-9a-f]{64}\)/);
  });
  it('another wallet, request or scope', () => {
    const w = witnessFor('giwa_attestation', 'app_attest') as never;
    expect(() => flattenGiwaKycV2Inputs('app_attest', giwaBase(), {...request('giwa_attestation'), userAddress: '0x' + '12'.repeat(20)}, w)).toThrow(/names wallet/);
    expect(() => flattenGiwaKycV2Inputs('app_attest', giwaBase(), {...request('giwa_attestation'), signedDigest: '0x' + '55'.repeat(32)}, w)).toThrow(/binds request/);
    expect(() => flattenGiwaKycV2Inputs('app_attest', giwaBase(), {...request('giwa_attestation'), scope: oprfScopeBytesOf('other')}, w)).toThrow(/another scope/);
  });
  it('a statement of the Coinbase length (225) or one byte long', () => {
    for (const len of [225, 232, 234, 0]) {
      const w = {clientData: new Uint8Array(len), attestedAt: ATTESTED_AT, credential: {} as never, assertion: {} as never};
      expect(() => flattenDojangV2Inputs('app_attest', dojangBase(), request('dojang_playground'), w)).toThrow(/takes 233/);
    }
  });
  it("an iPhone statement for an Android package, an Android one for the iPhone package, or the other Android package's", () => {
    expect(() => flattenGiwaKycV2Inputs('android', giwaBase(), request('giwa_attestation'), witnessFor('giwa_attestation', 'app_attest') as never)).toThrow(/Only a android/);
    expect(() => flattenGiwaKycV2Inputs('app_attest', giwaBase(), request('giwa_attestation'), witnessFor('giwa_attestation', 'android') as never)).toThrow(/cannot prove the iPhone/);
    expect(() => flattenDojangV2Inputs('android_factory', dojangBase(), request('dojang_playground'), witnessFor('dojang_playground', 'android') as never)).toThrow(/Only a android_factory/);
  });
  it('an unknown variant is an error by name', () => {
    expect(() => flattenGiwaKycV2Inputs('standard' as never, giwaBase(), request('giwa_attestation'), witnessFor('giwa_attestation', 'app_attest') as never)).toThrow(/No signer inputs for variant 'standard'/);
  });
  it('a GIWA KYC request in personal_sign mode with nothing signed, or with only one EIP-712 hash', () => {
    const w = witnessFor('giwa_attestation', 'app_attest') as never;
    expect(() => flattenGiwaKycV2Inputs('app_attest', {...giwaBase(), domain_separator: undefined, action_hash: undefined}, request('giwa_attestation'), w)).toThrow(/signs nothing/);
    expect(() => flattenGiwaKycV2Inputs('app_attest', {...giwaBase(), action_hash: undefined}, request('giwa_attestation'), w)).toThrow(/Only one of the EIP-712 hashes/);
    expect(() => flattenGiwaKycV2Inputs('app_attest', {...giwaBase(), signal_hash: tag('signal', 32)}, request('giwa_attestation'), w)).toThrow(/non-zero signal_hash/);
  });
  it('the wrong number of OPRF values', () => {
    const w = witnessFor('dojang_playground', 'app_attest') as never;
    expect(() => flattenDojangV2Inputs('app_attest', {...dojangBase(), oprf_public: ['a', 'b', 'c']}, request('dojang_playground'), w)).toThrow(/3 OPRF public inputs/);
    expect(() => flattenDojangV2Inputs('app_attest', {...dojangBase(), oprf_private: ['a']}, request('dojang_playground'), w)).toThrow(/1 OPRF private inputs/);
  });
  it('each builder takes only its own circuit', () => {
    expect(() => flattenDojangV2Inputs('app_attest', dojangBase(), request('giwa_attestation'), witnessFor('giwa_attestation', 'app_attest') as never)).toThrow(/is for dojang_playground/);
    expect(() => flattenGiwaKycV2Inputs('app_attest', giwaBase(), request('dojang_playground'), witnessFor('dojang_playground', 'app_attest') as never)).toThrow(/is for giwa_attestation/);
  });
});
