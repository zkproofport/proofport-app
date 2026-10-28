/**
 * useOidcDomain hands the prover v2 inputs: the request's nonce as
 * nonce_binding (mode 1) and `now` from the phone's clock inside the token's
 * iat..exp. A circuit file set that is not v2 (148 public inputs) is refused
 * by name before proving, instead of failing inside the prover.
 *
 * Provider-key statement: the circuit files are always checked through
 * downloadCircuitFiles (cache key = pinned ref + data version), a file set
 * whose count or ABI is not this circuit's is refused BEFORE the statement is
 * signed, the signed inputs follow signature_limbs, and an App Attest or
 * key-list failure reaches the screen with its own code.
 */
// Coinbase KYC v2 and OIDC read per-platform circuit files; this test is the iPhone's.
jest.mock('react-native', () => ({NativeModules: {}, Platform: {OS: 'ios'}}));
import * as crypto from 'node:crypto';
import React from 'react';
import {act, create} from 'react-test-renderer';
import {ethers} from 'ethers';

const mockGenerate = jest.fn();
let mockCircuitInputs = 214;
const mockDownload = jest.fn(async () => ({}));
let mockAbi: string[] = [];
jest.mock('mopro-ffi', () => ({
  generateNoirProof: (...a: unknown[]) => mockGenerate(...a),
  getNumPublicInputsFromCircuit: () => mockCircuitInputs,
  parseProofWithPublicInputs: () => ({proof: new ArrayBuffer(4), publicInputs: [new ArrayBuffer(32)]}),
}));
jest.mock('../../utils/proofVerification', () => ({
  verifyProofOffChainWithMopro: jest.fn(),
  verifyProofOnChainWithCore: jest.fn(),
}));
jest.mock('../../utils', () => ({
  getAssetPath: async (f: string) => `/docs/circuits/${f}`,
  arrayBufferToHex: () => 'ab',
  clearProofCache: async () => {},
  ensureStorageAvailable: async () => true,
  loadVkFromAssets: async () => new ArrayBuffer(8),
  downloadCircuitFiles: (...a: unknown[]) => (mockDownload as (...x: unknown[]) => Promise<unknown>)(...a),
  allCircuitFilesExist: async () => true,
  circuitAbiParameterNames: async () => mockAbi,
}));
jest.mock('../../config', () => ({getEnvironment: () => 'development'}));

import {useOidcDomain} from '../useOidcDomain';
import {deriveOidcNonce} from '../../oidc/oidcNonce';
import {OIDC_ABI_PARAMETERS, OIDC_FLAT_INPUT_COUNT} from '../../utils/oidcDomain';
import {AppAttestError} from '../../appAttest/appAttestError';
import type {ProviderKeySigner} from '../../oidc/oidcAppSigner';

const SIGNED = {
  signer_kind: 1,
  statement_sig: new Uint8Array(64).fill(7),
  credential_tbs: new Uint8Array(1000),
  credential_tbs_len: 600,
  credential_sig: new Uint8Array(96),
  att_auth_data: new Uint8Array(256),
  att_auth_data_len: 232,
  att_client_data_hash: new Uint8Array(32),
  assertion_auth_data: new Uint8Array(128),
  assertion_auth_data_len: 37,
};
const mockSigner = jest.fn<ReturnType<ProviderKeySigner>, Parameters<ProviderKeySigner>>(async () => SIGNED);

const {privateKey, publicKey} = crypto.generateKeyPairSync('rsa', {modulusLength: 2048});
const N = (publicKey.export({format: 'jwk'}) as {n: string}).n;
const SCOPE = 'scope';
const NONCE = deriveOidcNonce(SCOPE, '7f3c2a10-5b6e-4d8f-9a1b-2c3d4e5f6a7b');
const NOW = Math.floor(Date.now() / 1000);

function token(payload: Record<string, unknown>): string {
  const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url');
  const header = b64(JSON.stringify({alg: 'RS256', kid: 'k1', typ: 'JWT'}));
  const body = b64(JSON.stringify(payload));
  const sig = crypto.sign('sha256', Buffer.from(`${header}.${body}`), privateKey).toString('base64url');
  return `${header}.${body}.${sig}`;
}

const PAYLOAD = {
  iss: 'https://accounts.google.com',
  aud: 'web.apps.googleusercontent.com',
  email: 'alice@corp.example',
  email_verified: true,
  nonce: NONCE,
  iat: NOW - 60,
  exp: NOW + 3540,
};

function hook() {
  let value!: ReturnType<typeof useOidcDomain>;
  const Probe = () => {
    value = useOidcDomain();
    return null;
  };
  act(() => {
    create(React.createElement(Probe));
  });
  return () => value;
}

beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  mockGenerate.mockReset().mockReturnValue(new ArrayBuffer(16));
  mockCircuitInputs = 214;
  mockAbi = [...OIDC_ABI_PARAMETERS];
  mockDownload.mockClear();
  mockSigner.mockReset().mockImplementation(async () => SIGNED);
  (globalThis as {fetch?: unknown}).fetch = jest.fn(async (url: string) => {
    if (url === 'https://accounts.google.com/.well-known/openid-configuration') {
      return {ok: true, json: async () => ({jwks_uri: 'https://www.googleapis.com/oauth2/v3/certs'})};
    }
    if (url === 'https://www.googleapis.com/oauth2/v3/certs') {
      return {ok: true, json: async () => ({keys: [{kid: 'k1', kty: 'RSA', n: N, e: 'AQAB'}]})};
    }
    return {ok: false, status: 404, json: async () => ({})};
  });
});

async function prove(payload: Record<string, unknown>, nonce = NONCE) {
  const get = hook();
  const logs: string[] = [];
  await act(async () => {
    await get().generateProofWithSteps(
      {jwtToken: token(payload), scopeString: SCOPE, nonce, providerKeySigner: mockSigner},
      m => logs.push(m),
    );
  });
  return {logs, steps: get().proofSteps};
}

it('binds the request nonce and a `now` inside iat..exp', async () => {
  const before = Math.floor(Date.now() / 1000);
  await prove(PAYLOAD);
  const after = Math.floor(Date.now() / 1000);
  expect(mockGenerate).toHaveBeenCalledTimes(1);
  const flat = mockGenerate.mock.calls[0][2] as string[];
  expect(flat[180]).toBe('1');
  expect(flat.slice(181, 213)).toEqual(Array.from(ethers.utils.arrayify(`0x${NONCE}`), String));
  const now = Number(flat[213]);
  expect(now).toBeGreaterThanOrEqual(before);
  expect(now).toBeLessThanOrEqual(after);
  expect(now).toBeGreaterThanOrEqual(PAYLOAD.iat);
  expect(now).toBeLessThan(PAYLOAD.exp);
});

it('refuses a token that does not carry the nonce it was given, without proving', async () => {
  const other = deriveOidcNonce(SCOPE, '00000000-0000-4000-8000-000000000000');
  const {logs, steps} = await prove(PAYLOAD, other);
  expect(mockGenerate).not.toHaveBeenCalled();
  expect(logs.join('\n')).toContain("is not this request's nonce");
  expect(steps.some(s => s.status === 'error')).toBe(true);
});

it('refuses an expired token without proving', async () => {
  const {logs} = await prove({...PAYLOAD, iat: NOW - 7200, exp: NOW - 3600});
  expect(mockGenerate).not.toHaveBeenCalled();
  expect(logs.join('\n')).toContain('ID token expired');
});

it('refuses a v1 circuit file set (148 public inputs) by name, before signing or proving', async () => {
  mockCircuitInputs = 148;
  const {logs, steps} = await prove(PAYLOAD);
  expect(mockGenerate).not.toHaveBeenCalled();
  expect(mockSigner).not.toHaveBeenCalled();
  expect(logs.join('\n')).toContain('has 148 public inputs; this app builds inputs for 214 (OIDC v2)');
  expect(steps.find(s => s.id === 'download')?.status).toBe('error');
});

it('refuses the 214-input circuit from before the provider-key statement by its ABI, before signing', async () => {
  // The ABI of circuits oidc-signature 30b2749's target/, read 2026-10-28.
  mockAbi = OIDC_ABI_PARAMETERS.slice(0, OIDC_ABI_PARAMETERS.indexOf('signature_limbs') + 1);
  const {logs, steps} = await prove(PAYLOAD);
  expect(mockSigner).not.toHaveBeenCalled();
  expect(mockGenerate).not.toHaveBeenCalled();
  expect(logs.join('\n')).toContain('this app builds (pubkey_modulus_limbs');
  expect(steps.find(s => s.id === 'download')?.status).toBe('error');
});

it('refuses an ABI with the signer inputs in another order', async () => {
  const swapped = [...OIDC_ABI_PARAMETERS];
  [swapped[16], swapped[17]] = [swapped[17], swapped[16]];
  mockAbi = swapped;
  await prove(PAYLOAD);
  expect(mockSigner).not.toHaveBeenCalled();
  expect(mockGenerate).not.toHaveBeenCalled();
});

it('always lets downloadCircuitFiles check the cache, even when files are on disk', async () => {
  await prove(PAYLOAD);
  expect(mockDownload).toHaveBeenCalledTimes(1);
  expect(mockDownload.mock.calls[0]).toEqual(expect.arrayContaining(['oidc_domain_attestation']));
});

it('hands the prover the signed statement after signature_limbs, 3,889 values in all', async () => {
  await prove(PAYLOAD);
  expect(mockSigner).toHaveBeenCalledTimes(1);
  const req = mockSigner.mock.calls[0][0];
  const flat = mockGenerate.mock.calls[0][2] as string[];
  expect(flat).toHaveLength(OIDC_FLAT_INPUT_COUNT);
  expect(req.provider).toBe(0);
  expect(String(req.now)).toBe(flat[213]);
  expect(Buffer.from(req.modulus).toString('base64url')).toBe(N);
  expect(flat[2309]).toBe('1');
  expect(flat.slice(2310, 2374)).toEqual(new Array(64).fill('7'));
  expect(flat[2374 + 1000]).toBe('600');
  expect(flat[flat.length - 1]).toBe('37');
});

it.each([
  ['a development key', new AppAttestError('E2014', 'development key'), 'E2014'],
  ['Apple unreachable', new AppAttestError('E3006', 'server unavailable'), 'E3006'],
])('passes %s to the screen with its own code, without proving', async (_l, err, code) => {
  mockSigner.mockImplementation(async () => {
    throw err;
  });
  const {steps} = await prove(PAYLOAD);
  expect(mockGenerate).not.toHaveBeenCalled();
  expect(steps.find(s => s.id === 'jwks')).toMatchObject({status: 'error', code});
});

it('passes a failed key-list fetch to the screen as E3002, without signing', async () => {
  (globalThis as {fetch?: unknown}).fetch = jest.fn(async () => ({ok: false, status: 503, json: async () => ({})}));
  const {steps} = await prove(PAYLOAD);
  expect(mockSigner).not.toHaveBeenCalled();
  expect(steps.find(s => s.id === 'jwks')).toMatchObject({status: 'error', code: 'E3002'});
});

it('does nothing without a provider-key signer', async () => {
  const get = hook();
  const logs: string[] = [];
  await act(async () => {
    await get().generateProofWithSteps(
      {jwtToken: token(PAYLOAD), scopeString: SCOPE, nonce: NONCE} as never,
      m => logs.push(m),
    );
  });
  expect(mockGenerate).not.toHaveBeenCalled();
  expect(logs).toContain('The provider-key signer is required');
});

it('does nothing without a nonce', async () => {
  const {logs} = await prove(PAYLOAD, '');
  expect(mockGenerate).not.toHaveBeenCalled();
  expect(logs).toContain('The request nonce is required');
});
