/**
 * Every wallet credential hook asks the OPRF for its nullifier, once, with
 * the request's own domain and scope, and builds its circuit inputs from
 * that answer; an OPRF failure marks the step with the OPRF's own ErrorModal
 * code and nothing is proved.
 *
 * The GIWA hook is driven end to end (mocked wallet, device binding and
 * builder); the other four are held to the same wiring by their source.
 */
import React from 'react';
import TestRenderer, {act} from 'react-test-renderer';
import * as fs from 'fs';
import * as path from 'path';

const mockOprf = jest.fn();
const mockAssert = jest.fn();
jest.mock('../../oprf/device', () => ({
  oprfInputsForProof: (...a: unknown[]) => mockOprf(...a),
  assertOprfAvailable: (...a: unknown[]) => mockAssert(...a),
  oprfStepCode: (e: unknown) => {
    const {oprfErrorCode} = jest.requireActual('../../oprf/flow');
    const code = oprfErrorCode(e);
    return code ? {code} : {};
  },
}));
jest.mock('react-native', () => ({NativeModules: {}, Platform: {OS: 'ios'}}));
jest.mock('../../utils', () => ({
  ...jest.requireActual('../../utils/signedAction'),
  ...jest.requireActual('../../utils/walletChain'),
  loadVkFromAssets: async () => new ArrayBuffer(0),
  getAssetPath: async (f: string) => `/tmp/${f}`,
  arrayBufferToHex: () => '',
  recoverSignerPubkey: () => '0x04' + '22'.repeat(64),
  clearProofCache: async () => {},
  ensureStorageAvailable: async () => true,
}));
const mockProve = jest.fn(async () => new ArrayBuffer(0));
jest.mock('../../utils/proofRun', () => ({
  circuitFilesForProof: async () => ({}),
  proveCircuit: () => mockProve(),
}));
jest.mock('mopro-ffi', () => ({parseProofWithPublicInputs: () => ({proof: new ArrayBuffer(0), publicInputs: []})}));
jest.mock('../../utils/circuitPublicInputs', () => ({publicInputCountOf: async () => 132}));
jest.mock('../../utils/proofVerification', () => ({}));
const mockPrepare = jest.fn((..._a: unknown[]) => ({}));
jest.mock('../../utils/giwaKyc', () => ({
  GIWA_AUTHORIZED_SIGNERS: ['0x1111111111111111111111111111111111111111'],
  verifyGiwaAttestationTx: () => ({valid: true, signerAddress: '0x1111111111111111111111111111111111111111'}),
  prepareGiwaCircuitInputs: (...a: unknown[]) => mockPrepare(...a),
}));
jest.mock('../../utils/giwaStatementInputs', () => ({flattenGiwaKycV2Inputs: () => ['0x01']}));

import {useGiwaKyc, type UseGiwaKycReturn} from '../useGiwaKyc';
import {OprfTransportError} from '../../oprf/transport';
import {vectorOprf} from '../../oprf/__tests__/helpers/oprfFixture';
import {giwaTestWitness} from '../../appAttest/__tests__/helpers/giwaWitness';

const WALLET = '0x2222222222222222222222222222222222222222';
const REQUEST_ID = '3f2b8c1e-9d4a-4f6b-8e2c-1a7d5b9c0e4f';
const inputs = {
  userAddress: WALLET, rawTransaction: 'validated', signerIndex: 0, scopeString: 'vote-2026', requestId: REQUEST_ID, oprfDomain: 'vote.example',
  appAttest: {witness: giwaTestWitness({circuit: 'giwa_attestation', wallet: WALLET, scope: 'vote-2026', requestId: REQUEST_ID})},
};
const wallet = {request: async () => '0x' + '11'.repeat(65), getSelectedAddress: async () => WALLET};

let hook!: UseGiwaKycReturn;
async function mountHook() {
  function Harness() { hook = useGiwaKyc(); return null; }
  await act(async () => { TestRenderer.create(React.createElement(Harness)); });
}

beforeEach(() => {
  (globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
  mockOprf.mockReset(); mockAssert.mockReset(); mockPrepare.mockClear(); mockProve.mockClear();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

describe('the GIWA hook', () => {
  it('asks the OPRF once with the request\'s domain and scope, after the wallet signed, and builds from its answer', async () => {
    const oprf = vectorOprf();
    mockOprf.mockResolvedValue(oprf);
    await mountHook();
    await act(async () => hook.generateProofWithSteps(inputs, wallet, () => {}));
    expect(mockAssert).toHaveBeenCalledWith('giwa_attestation');
    expect(mockOprf).toHaveBeenCalledTimes(1);
    expect(mockOprf.mock.calls[0][0]).toMatchObject({circuit: 'giwa_attestation', address: WALLET, from: WALLET, domainName: 'vote.example', scopeName: 'vote-2026'});
    expect(mockPrepare.mock.calls[0][6]).toBe(oprf);
    expect(hook.proofSteps.find(s => s.id === 'scope')).toMatchObject({status: 'completed'});
  });

  it('an OPRF failure marks the step with the OPRF\'s code, and nothing is built or proved', async () => {
    mockOprf.mockRejectedValue(new OprfTransportError('refused', '3 OPRF nodes refused the request with code 4500', 4500));
    await mountHook();
    await act(async () => hook.generateProofWithSteps(inputs, wallet, () => {}));
    expect(hook.proofSteps.find(s => s.id === 'scope')).toMatchObject({status: 'error', code: 'E3012'});
    expect(mockPrepare).not.toHaveBeenCalled();
    expect(mockProve).not.toHaveBeenCalled();
  });

  it('a build with no OPRF network fails the first step with E3011 before anything is signed', async () => {
    const {OprfUnavailableError} = jest.requireActual('../../oprf/config');
    mockAssert.mockImplementation(() => { throw new OprfUnavailableError('production', 'No OPRF network'); });
    const request = jest.fn(wallet.request);
    await mountHook();
    await act(async () => hook.generateProofWithSteps(inputs, {...wallet, request}, () => {}));
    expect(hook.proofSteps.find(s => s.id === 'vk')).toMatchObject({status: 'error', code: 'E3011'});
    expect(request).not.toHaveBeenCalled();
    expect(mockOprf).not.toHaveBeenCalled();
  });
});

describe.each([
  ['useCoinbaseKyc.ts', 'circuitName', /prepareCircuitInputs\([\s\S]*?\boprf,\n/],
  ['useCoinbaseCountry.ts', 'circuitName', /prepareCircuitInputs\([\s\S]*?\boprf,\n/],
  ['useDojangPlayground.ts', 'CIRCUIT_NAME', /prepareDojangPlaygroundInputs\(\{[\s\S]*?\boprf,/],
  ['useHumanPassport.ts', 'CIRCUIT_NAME', /prepareHumanPassportInputs\(\{[\s\S]*?\boprf,/],
  ['useGiwaKyc.ts', 'CIRCUIT_NAME', /prepareGiwaCircuitInputs\([\s\S]*?\boprf,/],
] as const)('%s', (file, circuitVar, builderTakesOprf) => {
  const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  it('refuses a build without an OPRF network first, asks the OPRF with the request\'s names, builds from the answer, and codes the failure', () => {
    expect(src).toMatch(new RegExp(`assertOprfAvailable\\(${circuitVar}\\)`));
    expect(src.match(/oprfInputsForProof\(/g)).toHaveLength(1);
    expect(src).toMatch(/domainName: inputs\.oprfDomain,\s*\n\s*scopeName: inputs\.scopeString,/);
    expect(src).toMatch(builderTakesOprf);
    expect(src).toMatch(/oprfStepCode\(error\)/);
    expect(src).toMatch(/oprfDomain: string;/);
    expect(src).not.toMatch(/computeScope|nullifierForCircuit|computeWalletNullifier/);
  });
});
