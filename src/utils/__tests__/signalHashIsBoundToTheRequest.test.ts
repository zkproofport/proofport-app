/**
 * signal_hash without the wallet: keccak256(scope ++ circuitId ++ requestId)
 * (@zkproofport-app/core's computeSignalHash, re-exported by utils/signalHash.ts),
 * and the request binding around it.
 *
 * Matrix, written before the code:
 *  - shared vectors (byte-identical copy of the SDK's; oracle: solidityKeccak256)
 *  - the address is not in the preimage: no wallet-prefixed preimage matches,
 *    and the App Attest statement digest does not change with the wallet
 *  - same request -> same hash; another requestId / scope / circuit -> another
 *  - scope: empty, whitespace, null, undefined, number, unpaired surrogates,
 *    4096 bytes accepted, 4097 refused, multibyte across the cap
 *  - requestId: empty, null, 128 accepted, 129 refused, '_', space, non-ASCII
 *  - circuit: unknown id, hyphenated alias and OIDC refused by name
 *  - action present: zero signal_hash, the wallet signs the EIP-712 digest
 *  - the statement digest uses the request id
 */
jest.mock('react-native', () => ({NativeModules: {}, Platform: {OS: 'android'}}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {getItem: async () => null, setItem: async () => undefined, removeItem: async () => undefined},
}));

import fs from 'fs';
import path from 'path';
import {ethers} from 'ethers';
import vectors from './fixtures/signal-hash-vectors.json';
import {
  SIGNAL_HASH_CIRCUIT_IDS,
  computeSignalHash,
  signalHashBytes,
} from '../signalHash';
import {coinbaseRequestDigest, coinbaseRequestDigestFor} from '../../appAttest/coinbaseKycStatement';
import {ALL_CIRCUIT_IDS, type TypedAction} from '../../config/circuitIds';

const REQ = '3f2b8c1e-9d4a-4f6b-8e2c-1a7d5b9c0e4f';
const OTHER_REQ = '9a1c7e3b-2f5d-4c8a-b6e1-0d4f2a8c6b19';
const WALLET = '0xD6C714247037E5201B7e3dEC97a3ab59a9d2F739';
const OTHER_WALLET = '0x2222222222222222222222222222222222222222';

describe('computeSignalHash', () => {
  it.each(vectors.vectors.map(v => [v.note, v] as const))('matches the shared vector: %s', (_n, v) => {
    expect(computeSignalHash({scope: v.scope, circuitId: v.circuitId, requestId: v.requestId})).toBe(v.signalHash);
    expect(ethers.utils.hexlify(signalHashBytes(v))).toBe(v.signalHash);
  });

  it('no wallet-prefixed preimage reproduces a vector (the address is gone)', () => {
    for (const v of vectors.vectors) {
      const oldRule = ethers.utils.solidityKeccak256(['address', 'string', 'string'], [WALLET, v.scope, v.circuitId]);
      const withAddress = ethers.utils.solidityKeccak256(
        ['address', 'string', 'string', 'string'],
        [WALLET, v.scope, v.circuitId, v.requestId],
      );
      expect(v.signalHash).not.toBe(oldRule);
      expect(v.signalHash).not.toBe(withAddress);
    }
  });

  it('the statement digest the wallet signs does not change with the wallet', () => {
    for (const circuit of ['coinbase_attestation', 'coinbase_country_attestation'] as const) {
      expect(coinbaseRequestDigestFor(circuit, WALLET, 'scope', REQ)).toBe(coinbaseRequestDigestFor(circuit, OTHER_WALLET, 'scope', REQ));
    }
  });

  it('the statement digest is the EIP-712 digest of this request as a readable ProofRequest, not personal_sign over signal_hash', () => {
    // Since 2026-11-23 a request with no dApp action signs the ProofRequest
    // (utils/signedAction walletSigning); the wallet showed personal_sign's
    // 32 bytes as unreadable text.
    const signal = computeSignalHash({scope: 'scope', circuitId: 'coinbase_attestation', requestId: REQ});
    const typed = ethers.utils._TypedDataEncoder.hash(
      {name: 'ZKProofport', version: '1'},
      {ProofRequest: [{name: 'statement', type: 'string'}, {name: 'scope', type: 'string'}, {name: 'proof', type: 'string'}, {name: 'requestId', type: 'string'}]},
      {statement: 'Approve this proof request in ZKProofport', scope: 'scope', proof: 'coinbase_attestation', requestId: REQ},
    );
    expect(coinbaseRequestDigest(WALLET, 'scope', REQ)).toBe(typed);
    expect(coinbaseRequestDigest(WALLET, 'scope', REQ)).not.toBe(ethers.utils.hashMessage(ethers.utils.arrayify(signal)));
    expect(coinbaseRequestDigest(WALLET, 'scope', OTHER_REQ)).not.toBe(coinbaseRequestDigest(WALLET, 'scope', REQ));
  });

  it('is the same for the same request and differs per request, scope and circuit', () => {
    const base = {scope: 'myapp.com', circuitId: 'coinbase_attestation', requestId: REQ};
    const h = computeSignalHash(base);
    expect(computeSignalHash({...base})).toBe(h);
    expect(computeSignalHash({...base, requestId: OTHER_REQ})).not.toBe(h);
    expect(computeSignalHash({...base, scope: 'myapp.co'})).not.toBe(h);
    expect(computeSignalHash({...base, circuitId: 'giwa_attestation'})).not.toBe(h);
  });

  it('covers every circuit except OIDC', () => {
    expect([...SIGNAL_HASH_CIRCUIT_IDS].sort()).toEqual(ALL_CIRCUIT_IDS.filter(id => id !== 'oidc_domain_attestation').sort());
  });

  it.each([
    ['unknown id', 'coinbase_kyc', /Unknown circuit 'coinbase_kyc'\. Known: coinbase_attestation/],
    ['hyphenated route name', 'coinbase-attestation', /Unknown circuit 'coinbase-attestation'/],
    ['OIDC', 'oidc_domain_attestation', /oidc_domain_attestation has no signal_hash/],
  ])('refuses the circuit: %s', (_n, circuitId, msg) => {
    expect(() => computeSignalHash({scope: 's', circuitId, requestId: REQ})).toThrow(msg);
  });

  it.each([
    ['empty', '', /scope is empty/],
    ['whitespace only', ' \t\n', /scope is empty/],
    ['null', null, /got null/],
    ['undefined', undefined, /got undefined/],
    ['a number', 7, /got number/],
    ['an unpaired high surrogate', 'ab\uD800c', /unpaired surrogate at index 2/],
    ['an unpaired low surrogate', '\uDC00', /unpaired surrogate at index 0/],
    ['4097 bytes', 'a'.repeat(4097), /scope is 4097 bytes; the limit is 4096/],
    ['1366 Korean characters (4098 bytes)', '가'.repeat(1366), /scope is 4098 bytes/],
  ])('refuses the scope: %s', (_n, scope, msg) => {
    expect(() => computeSignalHash({scope: scope as string, circuitId: 'coinbase_attestation', requestId: REQ})).toThrow(msg);
  });

  it('accepts 4096 bytes and emoji pairs', () => {
    expect(() => computeSignalHash({scope: 'a'.repeat(4096), circuitId: 'coinbase_attestation', requestId: REQ})).not.toThrow();
    expect(() => computeSignalHash({scope: '🔐', circuitId: 'coinbase_attestation', requestId: REQ})).not.toThrow();
  });

  it.each([
    ['empty', '', /requestId is empty/],
    ['null', null, /got null/],
    ['129 characters', 'x'.repeat(129), /requestId is 129 characters; the limit is 128/],
    ['an underscore', 'req_1', /only ASCII letters, digits and '-'/],
    ['a space', 'req 1', /only ASCII/],
    ['non-ASCII', '요청-1', /only ASCII/],
  ])('refuses the requestId: %s', (_n, requestId, msg) => {
    expect(() => computeSignalHash({scope: 's', circuitId: 'coinbase_attestation', requestId: requestId as string})).toThrow(msg);
  });
});

describe('with an action', () => {
  const action: TypedAction = {
    domain: {name: 'App', version: '1', chainId: 8453, verifyingContract: '0x0000000000000000000000000000000000000001'},
    types: {Deposit: [{name: 'amount', type: 'uint256'}]},
    primaryType: 'Deposit',
    message: {amount: '1000000'},
  };

  it('signal_hash is zero and the wallet signs the EIP-712 digest', () => {
    const digest = coinbaseRequestDigest(WALLET, 'scope', REQ, action);
    expect(digest).toBe(ethers.utils._TypedDataEncoder.hash(action.domain, action.types, action.message));
    // ...independent of the request id: the action is the binding.
    expect(coinbaseRequestDigest(WALLET, 'scope', OTHER_REQ, action)).toBe(digest);
  });

});

describe('the proof screen', () => {
  const screen = fs.readFileSync(path.join(__dirname, '..', '..', 'screens', 'proof', 'ProofGenerationScreen.tsx'), 'utf8');

  it('fixes one request id per attempt: the relay request\'s, else one minted', () => {
    expect(screen).toContain('attemptRequestId = proofRequest ? proofRequest.requestId : newStandaloneRequestId();');
    expect(screen).toContain('oidcBindingFor(oidcInputs?.scope, proofRequest?.requestId, () => attemptRequestId)');
    expect(screen).toContain('requestId: attemptRequestId,\n          review');
  });

  it('passes that id to every wallet circuit and every device statement', () => {
    // History, then Dojang (statement + hook), Human Passport, Country (statement + hook),
    // GIWA (statement + hook), KYC (statement + hook).
    expect(screen.split('requestId: attemptRequestId,').length - 1).toBe(10);
  });

});
