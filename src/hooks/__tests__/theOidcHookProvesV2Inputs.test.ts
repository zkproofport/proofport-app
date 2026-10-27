/**
 * useOidcDomain hands the prover v2 inputs: the request's nonce as
 * nonce_binding (mode 1) and `now` from the phone's clock inside the token's
 * iat..exp. A circuit file set that is not v2 (148 public inputs) is refused
 * by name before proving, instead of failing inside the prover.
 */
import * as crypto from 'node:crypto';
import React from 'react';
import {act, create} from 'react-test-renderer';
import {ethers} from 'ethers';

const mockGenerate = jest.fn();
let mockCircuitInputs = 214;
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
  downloadCircuitFiles: async () => ({}),
  allCircuitFilesExist: async () => true,
}));
jest.mock('../../config', () => ({getEnvironment: () => 'development'}));

import {useOidcDomain} from '../useOidcDomain';
import {deriveOidcNonce} from '../../oidc/oidcNonce';

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
      {jwtToken: token(payload), scopeString: SCOPE, nonce},
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

it('refuses a v1 circuit file set (148 public inputs) by name, without proving', async () => {
  mockCircuitInputs = 148;
  const {logs, steps} = await prove(PAYLOAD);
  expect(mockGenerate).not.toHaveBeenCalled();
  expect(logs.join('\n')).toContain('has 148 public inputs; this app builds inputs for 214 (OIDC v2)');
  expect(steps.find(s => s.id === 'proof')?.status).toBe('error');
});

it('does nothing without a nonce', async () => {
  const {logs} = await prove(PAYLOAD, '');
  expect(mockGenerate).not.toHaveBeenCalled();
  expect(logs).toContain('The request nonce is required');
});
