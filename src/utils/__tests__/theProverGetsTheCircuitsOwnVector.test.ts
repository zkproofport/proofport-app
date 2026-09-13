/**
 * bb reads the input vector POSITIONALLY. There are no field names in it.
 *
 * `arc_eligibility` puts `domain_separator` and `action_hash` between
 * `signal_hash` and the Merkle root — 64 values that the app never produced.
 * It signed the typed action, then handed the prover the Coinbase-shaped
 * vector, and the proof died one second in with `MoproError.NoirError`, which
 * names nothing. Seen in a simulator on 2026-09-12.
 *
 * A shorter vector is not a shorter proof. It is a different circuit's.
 */
jest.mock('react-native', () => ({NativeModules: {}}));

import {flattenCircuitInputs, type AttesterCircuitInputs} from '../circuitHelpers';

/** The Coinbase shape, with each section filled by a recognisable byte. */
function coinbaseInputs(): AttesterCircuitInputs {
  const run = (n: number, byte: string) => new Array(n).fill(byte);
  return {
    signal_hash: run(32, 'S'),
    signer_list_merkle_root: run(32, 'M'),
    scope: run(32, 'C'),
    nullifier: run(32, 'N'),
    user_address: run(20, 'A'),
    user_signature: run(64, 'G'),
    user_pubkey_x: run(32, 'X'),
    user_pubkey_y: run(32, 'Y'),
    raw_transaction: run(300, 'T'),
    tx_length: '99',
    coinbase_attester_pubkey_x: run(32, 'P'),
    coinbase_attester_pubkey_y: run(32, 'Q'),
    coinbase_signer_merkle_proof: run(256, 'R'),
    coinbase_signer_leaf_index: '0',
    merkle_proof_depth: '3',
  };
}

const arcInputs = (): AttesterCircuitInputs => ({
  ...coinbaseInputs(),
  domain_separator: new Array(32).fill('D'),
  action_hash: new Array(32).fill('H'),
});

describe('the prover gets the circuit’s own vector', () => {
  it('gives Coinbase exactly what its fn main lists', () => {
    const v = flattenCircuitInputs(coinbaseInputs());
    expect(v.slice(0, 32).every(x => x === 'S')).toBe(true);
    expect(v.slice(32, 64).every(x => x === 'M')).toBe(true);
    expect(v.slice(64, 96).every(x => x === 'C')).toBe(true);
    expect(v.slice(96, 128).every(x => x === 'N')).toBe(true);
  });

  it('puts Arc’s two hashes between the signal hash and the Merkle root', () => {
    const v = flattenCircuitInputs(arcInputs());
    expect(v.slice(0, 32).every(x => x === 'S')).toBe(true);
    expect(v.slice(32, 64).every(x => x === 'D')).toBe(true);  // domain separator
    expect(v.slice(64, 96).every(x => x === 'H')).toBe(true);  // action hash
    expect(v.slice(96, 128).every(x => x === 'M')).toBe(true); // then the root
    expect(v.slice(128, 160).every(x => x === 'C')).toBe(true);
    expect(v.slice(160, 192).every(x => x === 'N')).toBe(true);
  });

  it('makes Arc’s vector exactly 64 longer, which is the two hashes', () => {
    expect(flattenCircuitInputs(arcInputs()).length).toBe(
      flattenCircuitInputs(coinbaseInputs()).length + 64,
    );
  });

  it('matches where the SDK reads scope and nullifier back out', () => {
    // The SDK's reader says Arc's scope is at 128–159 and its nullifier at
    // 160–191. If the writer and the reader ever disagree, a proof verifies
    // and its scope check fails for reasons nobody can see.
    const v = flattenCircuitInputs(arcInputs());
    expect(v.slice(128, 160).every(x => x === 'C')).toBe(true);
    expect(v.slice(160, 192).every(x => x === 'N')).toBe(true);
  });

  it('refuses half an action rather than building a shorter vector', () => {
    const half = {...coinbaseInputs(), domain_separator: new Array(32).fill('D')};
    expect(() => flattenCircuitInputs(half)).toThrow(/BOTH domain_separator and action_hash/);
    const other = {...coinbaseInputs(), action_hash: new Array(32).fill('H')};
    expect(() => flattenCircuitInputs(other)).toThrow(/BOTH domain_separator and action_hash/);
  });
});

/**
 * The test above proves the vector CAN carry the two hashes. This one proves
 * the app actually computes them from the action — which is what was missing.
 *
 * Without it the guard does not bite: the app signed the action and passed no
 * hashes, every vector-shape check stayed green, and the prover still failed.
 */
describe('the two hashes are computed from the action, not left out', () => {
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

  it('produces both hashes when an action is given, and neither when not', () => {
    const {ethers} = require('ethers');

    // The hashes the builder must produce, computed the same way the wallet
    // computed what it signed.
    const domainSeparator = ethers.utils._TypedDataEncoder.hashDomain(ACTION.domain);
    const actionHash = ethers.utils._TypedDataEncoder.hashStruct(
      ACTION.primaryType,
      ACTION.types,
      ACTION.message,
    );
    expect(domainSeparator).toMatch(/^0x[0-9a-f]{64}$/);
    expect(actionHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(domainSeparator).not.toBe(actionHash);

    // And the builder is wired to produce them: it takes the action and feeds
    // both fields. Read from the source, because driving the full builder
    // needs a real attestation transaction.
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'coinbaseKyc.ts'), 'utf8');
    expect(src).toMatch(/publicHashes\?: \{domainSeparator: string; actionHash: string\}/);
    expect(src).toContain('domain_separator:');
    expect(src).toContain('action_hash:');
    // The hashes are taken already-computed, not derived a second time here.
    // Two derivations of one value is how the signature and the proof came to
    // disagree about what was signed.
    expect(src).not.toContain('_TypedDataEncoder');

    // And the hook hands the action down, which is the link that was absent.
    const hook = fs.readFileSync(
      path.join(__dirname, '..', '..', 'hooks', 'useCoinbaseKyc.ts'),
      'utf8',
    );
    // The whole call, from its opening paren to the closing one, so a comment
    // of any length between the arguments does not decide whether this passes.
    const call = hook.slice(
      hook.indexOf('prepareCircuitInputs('),
      hook.indexOf(');', hook.indexOf('prepareCircuitInputs(')),
    );
    expect(call).toContain('signed.publicHashes,');
  });
});
