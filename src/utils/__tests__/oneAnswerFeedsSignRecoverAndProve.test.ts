/**
 * Sign, recover, and prove must agree about what was signed.
 *
 * The Arc circuit differs from the Coinbase one in exactly ONE line — read
 * from the two `fn main` bodies on 2026-09-12, which are otherwise identical
 * through the nullifier, the Merkle check, the RLP parse and the calldata
 * link:
 *
 *   coinbase: message_hash = create_eth_signed_message_hash(signal_hash)
 *   arc:      message_hash = create_eip712_digest(domain_separator, action_hash)
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
    chainId: 5042002,
    verifyingContract: '0x0000000000000000000000000000000000000000',
  },
  types: {Deposit: [{name: 'amount', type: 'uint256'}]},
  primaryType: 'Deposit',
  message: {amount: '1000000'},
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

  it('is read by the wallet request, the recovery and the inputs — all three', () => {
    const fs = require('fs');
    const path = require('path');
    const hook = fs.readFileSync(
      path.join(__dirname, '..', '..', 'hooks', 'useCoinbaseKyc.ts'),
      'utf8',
    );
    expect(hook).toContain('const signed = whatTheWalletSigns(');
    expect(hook).toContain('method: signed.method');            // the request
    expect(hook).toContain('recoverSignerPubkey(signed, userSignature)'); // the recovery
    expect(hook).toContain('signed.publicHashes,');             // the inputs
    // And no place decides again off the raw action.
    expect(hook).not.toContain('inputs.action\n            ? await ethereum.request');
  });
});
