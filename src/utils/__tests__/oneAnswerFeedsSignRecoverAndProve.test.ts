/**
 * Sign, recover, and prove must agree about what was signed.
 *
 * An action-binding circuit (`giwa_attestation`) branches on ONE line,
 * depending on whether the request carried an action:
 *
 *   no action:   message_hash = create_eth_signed_message_hash(signal_hash)
 *   with action: message_hash = create_eip712_digest(domain_separator, action_hash)
 *
 * The app made that one decision in three separate places — the wallet
 * request, the key recovery, and the circuit inputs — each reading the same
 * variable and each fixed on its own. Nothing failed where they disagreed: the
 * signature succeeded, the recovery returned a well-formed key for a wallet
 * nobody controls, the vector was the right length, and the prover ended with
 * `MoproError.NoirError`.
 */
jest.mock('react-native', () => ({NativeModules: {}}));

import {ethers} from 'ethers';
import {whatTheWalletSigns, recoverSignerPubkey} from '../signedAction';

const WALLET = ethers.Wallet.createRandom();
const SIGNAL = ethers.utils.keccak256(ethers.utils.toUtf8Bytes('signal'));

const ACTION = {
  domain: {
    name: 'MyVault',
    version: '1',
    chainId: 91342,
    verifyingContract: '0x0000000000000000000000000000000000000000',
  },
  types: {Deposit: [{name: 'amount', type: 'uint256'}]},
  primaryType: 'Deposit',
  message: {amount: '1000000'},
};

/** The proof request for the demo request below; the same literal is held by SDK core's tests. */
const PROOF_REQUEST_VECTOR = {
  domainSeparator: '0xfb55791a6a9498fe44192976708e3dd8fabca9a6957d4f4a3a4046bb1f9a560f',
  actionHash: '0x769763eaeaa70539e93b7e787a806936097e39efc98701eda13e206a02e2ae77',
};

/** keccak256(0x19 ++ 0x01 ++ domainSeparator ++ actionHash) — the circuit's. */
function circuitDigest(domainSeparator: string, actionHash: string): string {
  return ethers.utils.keccak256(
    ethers.utils.concat(['0x1901', domainSeparator, actionHash]),
  );
}

describe('one answer feeds sign, recover and prove', () => {
  it('asks for typed data and carries the two public hashes, with an action', () => {
    const s = whatTheWalletSigns(SIGNAL, ACTION);
    expect(s.method).toBe('eth_signTypedData_v4');
    expect(s.prefixed).toBe(false);
    expect(s.publicHashes?.domainSeparator).toMatch(/^0x[0-9a-f]{64}$/);
    expect(s.publicHashes?.actionHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('asks for personal_sign and carries no public hashes, without one', () => {
    const s = whatTheWalletSigns(SIGNAL);
    expect(s.method).toBe('personal_sign');
    expect(s.prefixed).toBe(true);
    expect(s.digest).toBe(SIGNAL);
    expect(s.publicHashes).toBeUndefined();
  });

  /**
   * The check that would have caught the whole thing: the digest the app signs
   * over must be the one the CIRCUIT rebuilds from the two public inputs it
   * was given. If these ever differ, the proof is of a signature over
   * something the circuit does not recompute, and it simply fails.
   */
  it('signs the digest the circuit rebuilds from those same two hashes', () => {
    const s = whatTheWalletSigns(SIGNAL, ACTION);
    expect(s.digest).toBe(
      circuitDigest(s.publicHashes!.domainSeparator, s.publicHashes!.actionHash),
    );
  });

  it('recovers the real signer from a typed-data signature', async () => {
    const s = whatTheWalletSigns(SIGNAL, ACTION);
    const sig = await WALLET._signTypedData(ACTION.domain, ACTION.types, ACTION.message);
    expect(ethers.utils.computeAddress(recoverSignerPubkey(s, sig))).toBe(WALLET.address);
  });

  it('recovers the real signer from a personal_sign signature', async () => {
    const s = whatTheWalletSigns(SIGNAL);
    const sig = await WALLET.signMessage(ethers.utils.arrayify(SIGNAL));
    expect(ethers.utils.computeAddress(recoverSignerPubkey(s, sig))).toBe(WALLET.address);
  });

  it('keeps EIP712Domain out of the hash and in the wallet request', () => {
    // A wallet rejects the request without it; ethers must not see it or the
    // digest changes and the circuit rebuilds a different one.
    const s = whatTheWalletSigns(SIGNAL, ACTION);
    const payload = JSON.parse(s.params[0] as string);
    expect(Object.keys(payload.types)).toContain('EIP712Domain');
    expect(s.digest).toBe(
      ethers.utils._TypedDataEncoder.hash(ACTION.domain, ACTION.types, ACTION.message),
    );
  });

  it.each(['useGiwaKyc.ts', 'useDojangPlayground.ts', 'useHumanPassport.ts', 'useCoinbaseKyc.ts', 'useCoinbaseCountry.ts'])('%s reads it in the wallet request, the recovery and the inputs — all three', file => {
    const fs = require('fs');
    const path = require('path');
    const hook = fs.readFileSync(
      path.join(__dirname, '..', '..', 'hooks', file),
      'utf8',
    );
    // One answer for both kinds of request (utils/signedAction walletSigning).
    expect(hook).toMatch(/const signing = walletSigning\(\{scope: inputs\.scopeString, circuitId: CIRCUIT_NAME, requestId: inputs\.requestId\}, /);
    expect(hook).toContain('const signed = signing.signed;');
    expect(hook).not.toContain('whatTheWalletSigns(');
    expect(hook).not.toContain('signalHashBytes(');
    expect(hook).toContain('method: signed.method');            // the request
    expect(hook).toContain('recoverSignerPubkey(signed, userSignature)'); // the recovery
    expect(hook).toContain('signed.publicHashes,');             // the inputs
    // And no place decides again off the raw action.
    expect(hook).not.toContain('inputs.action\n            ? await ethereum.request');
  });
});

describe('a request with no dApp action', () => {
  const {walletSigning, signedDigestOf} = require('../signedAction');
  const REQUEST = {scope: 'zkproofport-demo:common:kyc', circuitId: 'coinbase_attestation', requestId: 'dfc6f61c-fa7d-400e-b0f7-e9e302b9defc'};

  it('asks the wallet for readable typed data, with signal_hash zero and the two public hashes', () => {
    const {signalHash, signed} = walletSigning(REQUEST);
    expect(Array.from(signalHash)).toEqual(new Array(32).fill(0));
    expect(signed.method).toBe('eth_signTypedData_v4');
    expect(signed.prefixed).toBe(false);
    const wire = JSON.parse(signed.params[0]);
    expect(wire.primaryType).toBe('ProofRequest');
    expect(wire.domain).toEqual({name: 'ZKProofport', version: '1'});
    // The wire domain type lists exactly the domain's fields, or the wallet hashes another domain.
    expect(wire.types.EIP712Domain).toEqual([{name: 'name', type: 'string'}, {name: 'version', type: 'string'}]);
    expect(wire.message).toEqual({statement: 'Approve this proof request in ZKProofport', scope: REQUEST.scope, proof: REQUEST.circuitId, requestId: REQUEST.requestId});
    expect(signed.digest).toBe(circuitDigest(signed.publicHashes.domainSeparator, signed.publicHashes.actionHash));
    expect(signedDigestOf(signed)).toBe(signed.digest);
  });

  it('a wallet signing the wire payload signs the digest the circuit rebuilds, and the signer recovers', async () => {
    const {signed} = walletSigning(REQUEST);
    const wire = JSON.parse(signed.params[0]);
    const {EIP712Domain: _omit, ...types} = wire.types;
    const sig = await WALLET._signTypedData(wire.domain, types, wire.message);
    expect(ethers.utils.computeAddress(recoverSignerPubkey(signed, sig))).toBe(WALLET.address);
  });

  it('differs per request, scope and circuit, and refuses what signal_hash refuses', () => {
    const base = walletSigning(REQUEST).signed.publicHashes.actionHash;
    expect(walletSigning({...REQUEST, requestId: 'other-1'}).signed.publicHashes.actionHash).not.toBe(base);
    expect(walletSigning({...REQUEST, scope: 'other'}).signed.publicHashes.actionHash).not.toBe(base);
    expect(walletSigning({...REQUEST, circuitId: 'coinbase_country_attestation'}).signed.publicHashes.actionHash).not.toBe(base);
    for (const bad of [{...REQUEST, scope: ''}, {...REQUEST, scope: '   '}, {...REQUEST, requestId: 'has space'}, {...REQUEST, requestId: ''}, {...REQUEST, circuitId: 'nope'}, {...REQUEST, circuitId: 'oidc_domain_attestation'}]) {
      expect(() => walletSigning(bad)).toThrow();
    }
  });

  it('a dApp action still wins over the proof request', () => {
    const {signed} = walletSigning(REQUEST, ACTION);
    expect(JSON.parse(signed.params[0]).primaryType).toBe('Deposit');
  });

  it('the struct hash matches the SDK core value for the shared vector', () => {
    // core's computeProofRequestHash (packages/core/src/signalHash.ts) builds
    // the same hash by hand; this literal is the value both must produce.
    expect(walletSigning(REQUEST).signed.publicHashes.actionHash).toBe(PROOF_REQUEST_VECTOR.actionHash);
    expect(walletSigning(REQUEST).signed.publicHashes.domainSeparator).toBe(PROOF_REQUEST_VECTOR.domainSeparator);
  });
});

