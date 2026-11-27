/**
 * The readable request a wallet signs when a dApp bound no action
 * (src/utils/signedAction.ts) is the one @zkproofport-app/core checks a
 * proof against (core 0.4.0-beta.10+: PROOF_REQUEST_*, computeProofRequestHash).
 * The app keeps its own copy of the domain, type and statement because it
 * builds the wallet prompt; a drift in either copy would make every verifier
 * refuse the app's proofs while the phone reported success.
 */
import {
  PROOF_REQUEST_DOMAIN as CORE_DOMAIN,
  PROOF_REQUEST_DOMAIN_SEPARATOR,
  PROOF_REQUEST_STATEMENT as CORE_STATEMENT,
  PROOF_REQUEST_TYPE,
  computeProofRequestHash,
} from '@zkproofport-app/core';
import {
  PROOF_REQUEST_DOMAIN,
  PROOF_REQUEST_PRIMARY_TYPE,
  PROOF_REQUEST_STATEMENT,
  PROOF_REQUEST_TYPES,
  walletSigning,
} from '../signedAction';

describe("the app's readable proof request is core's", () => {
  it('same domain, statement and type string', () => {
    expect({...PROOF_REQUEST_DOMAIN}).toEqual({...CORE_DOMAIN});
    expect(PROOF_REQUEST_STATEMENT).toBe(CORE_STATEMENT);
    const fields = PROOF_REQUEST_TYPES.ProofRequest.map(f => `${f.type} ${f.name}`).join(',');
    expect(`${PROOF_REQUEST_PRIMARY_TYPE}(${fields})`).toBe(PROOF_REQUEST_TYPE);
  });

  it.each([
    ['coinbase_attestation', 'demo.example:kyc', 'req-1'],
    ['giwa_attestation', '기와 스코프 🙂', 'a'.repeat(128)],
    ['dojang_playground', 'line\nbreak\ttab', '0'],
  ])('%s: the app signs the domain separator and struct hash core recomputes', (circuitId, scope, requestId) => {
    const {signed, signalHash} = walletSigning({circuitId, scope, requestId} as never);
    expect(Array.from(signalHash)).toEqual(new Array(32).fill(0));
    expect(signed.publicHashes!.domainSeparator.toLowerCase()).toBe(PROOF_REQUEST_DOMAIN_SEPARATOR);
    expect(signed.publicHashes!.actionHash.toLowerCase()).toBe(computeProofRequestHash({circuitId, scope, requestId}).toLowerCase());
  });
});
