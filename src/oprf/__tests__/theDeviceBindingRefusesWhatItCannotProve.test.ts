/**
 * src/oprf/device.ts and the request circuit's download entry: a build with
 * no OPRF network is refused before anything is fetched (E3011); cached
 * credential files from before the OPRF change are refused by name (E2002);
 * the request circuit is downloaded like a pinned credential circuit from
 * OPRF_CIRCUITS_REF, and an empty ref ends every attempt at an error naming it.
 */
let mockEnv = 'staging';
jest.mock('../../config/environment', () => ({getEnvironment: () => mockEnv}));
let mockAbi: string[] = [];
jest.mock('../../utils/circuitAbi', () => ({circuitAbiParameterNames: async () => mockAbi}));
jest.mock('react-native', () => ({NativeModules: {}, Platform: {OS: 'ios', select: (o: Record<string, unknown>) => o.ios}}));
jest.mock('react-native-fs', () => ({DocumentDirectoryPath: '/tmp/documents', exists: async () => false}));
jest.mock('@react-native-async-storage/async-storage', () => ({__esModule: true, default: {getItem: async () => null, setItem: async () => {}}}));

import {assertOprfAvailable, credentialAbiCheck, oprfStepCode, requireAbi, REQUEST_AUTH_CIRCUIT} from '../device';
import {OprfError} from '../flow';
import {OprfUnavailableError} from '../config';
import {REQUEST_AUTH_ABI} from '../requestAuth';
import {OPRF_PRIVATE_INPUT_NAMES} from '../circuitInputs';
import {__setOprfCircuitsRefForTests, artifactSourceFor, isAuxiliaryCircuitId, OPRF_CIRCUITS_REF} from '../../config/circuitArtifacts';
import {circuitBaseUrl, circuitDataVersion} from '../../utils/circuitDownload';

describe('a build without an OPRF network', () => {
  it('production is refused for every wallet credential circuit, by name, with E3011', () => {
    mockEnv = 'production';
    for (const c of ['coinbase_attestation', 'coinbase_country_attestation', 'giwa_attestation', 'dojang_playground', 'human_passport_score']) {
      let err: unknown;
      try { assertOprfAvailable(c); } catch (e) { err = e; }
      expect(err).toBeInstanceOf(OprfUnavailableError);
      expect(oprfStepCode(err)).toEqual({code: 'E3011'});
    }
  });

  it('staging and development are not', () => {
    for (const env of ['staging', 'development']) {
      mockEnv = env;
      expect(() => assertOprfAvailable('giwa_attestation')).not.toThrow();
    }
  });

  it('an unknown environment is an error naming it', () => {
    mockEnv = 'prod';
    expect(() => assertOprfAvailable('giwa_attestation')).toThrow(/Unknown environment 'prod'/);
  });

  it('a step failure that is not the OPRF\'s carries no code of its own', () => {
    expect(oprfStepCode(new Error('x'))).toEqual({});
  });
});

describe('cached files from before the OPRF change', () => {
  const tail = [...OPRF_PRIVATE_INPUT_NAMES];
  it('a credential circuit whose ABI ends in the seven OPRF inputs is accepted', async () => {
    mockAbi = ['signal_hash', 'user_address', ...tail];
    await expect(requireAbi('giwa_attestation', credentialAbiCheck)).resolves.toBeUndefined();
  });

  it.each([
    ['the keccak-nullifier circuit', ['signal_hash', 'scope', 'nullifier', 'user_address', 'merkle_proof_depth']],
    ['the OPRF inputs out of order', ['signal_hash', ...[...tail].reverse()]],
    ['one OPRF input missing', ['signal_hash', ...tail.slice(1)]],
    ['nothing', []],
  ])('%s is refused by name (E2002)', async (_l, abi) => {
    mockAbi = abi;
    let err: unknown;
    try { await requireAbi('giwa_attestation', credentialAbiCheck); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(OprfError);
    expect((err as OprfError).code).toBe('E2002');
    expect(String(err)).toMatch(/giwa_attestation files are not the expected circuit/);
  });

  it('the request circuit must have exactly its own parameters', async () => {
    mockAbi = [...REQUEST_AUTH_ABI];
    const check = (names: string[]) => (names.join(',') === REQUEST_AUTH_ABI.join(',') ? null : 'other');
    await expect(requireAbi(REQUEST_AUTH_CIRCUIT, check)).resolves.toBeUndefined();
    mockAbi = [...REQUEST_AUTH_ABI, 'extra'];
    await expect(requireAbi(REQUEST_AUTH_CIRCUIT, check)).rejects.toThrow(OprfError);
  });
});

describe('the request circuit\'s download entry', () => {
  it('is an auxiliary circuit with its own pinned row: 36 public inputs, one .srs, data version 1', () => {
    expect(isAuxiliaryCircuitId(REQUEST_AUTH_CIRCUIT)).toBe(true);
    expect(isAuxiliaryCircuitId('coinbase_attestation')).toBe(false);
    const row = artifactSourceFor(REQUEST_AUTH_CIRCUIT, 'android')!;
    expect(row).toBe(artifactSourceFor(REQUEST_AUTH_CIRCUIT, 'app_attest'));
    expect(row).toMatchObject({refName: 'OPRF_CIRCUITS_REF', basePath: 'oprf-request-auth-poc/target', remoteFileName: 'oprf_request_auth_poc', publicInputCount: 36, srsParts: null});
    expect(circuitDataVersion(REQUEST_AUTH_CIRCUIT)).toBe(1);
  });

  it.each(['development', 'staging', 'production'] as const)('in %s is read from OPRF_CIRCUITS_REF, the full commit carrying the OPRF circuits', async env => {
    expect(OPRF_CIRCUITS_REF).toMatch(/^[0-9a-f]{40}$/);
    await expect(circuitBaseUrl(REQUEST_AUTH_CIRCUIT, env)).resolves.toBe(`https://raw.githubusercontent.com/zkproofport/circuits/${OPRF_CIRCUITS_REF}`);
  });

  it.each(['development', 'staging', 'production'] as const)('in %s ends at an error naming OPRF_CIRCUITS_REF when it is empty', async env => {
    __setOprfCircuitsRefForTests('');
    try {
      await expect(circuitBaseUrl(REQUEST_AUTH_CIRCUIT, env)).rejects.toThrow(/OPRF_CIRCUITS_REF is empty/);
    } finally {
      __setOprfCircuitsRefForTests(null);
    }
  });

  it('an id that is neither a circuit nor an auxiliary circuit is still an error naming both lists', async () => {
    await expect(circuitBaseUrl('oprf_request_auth_v2', 'staging')).rejects.toThrow(/Unknown circuit 'oprf_request_auth_v2'.*oprf_request_auth/);
  });
});
