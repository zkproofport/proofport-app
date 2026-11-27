/**
 * A GIWA KYC / Dojang Playground v2 statement witness for hook tests: the real
 * 233-byte statement for the request (so the hook's digest and scope checks
 * run against true bytes), with an empty signer the hooks' mocked input
 * builders never read.
 */
import type {TypedAction} from '../../../config/circuitIds';
import {buildGiwaStatement, giwaRequestDigest, type GiwaStatementCircuit, type GiwaStatementWitness} from '../../giwaStatement';
import {oprfScopeBytesOf} from '../../../oprf/circuitInputs';
import type {AppAttestWitness} from '../../revocationStatement';

export function giwaTestWitness(p: {
  circuit: GiwaStatementCircuit;
  wallet: string;
  scope: string;
  requestId: string;
  action?: TypedAction;
  attestedAt?: number;
  expirationTime?: number;
}): GiwaStatementWitness {
  const attestedAt = p.attestedAt ?? Math.floor(Date.now() / 1000);
  const clientData = buildGiwaStatement(p.circuit, {
    wallet: p.wallet,
    attestedAt,
    attestationUid: '0x' + 'ab'.repeat(32),
    requestDigest: giwaRequestDigest(p.circuit, p.scope, p.requestId, p.action),
    scope: oprfScopeBytesOf(p.scope),
    expirationTime: p.expirationTime ?? 0,
  });
  return {clientData, attestedAt, credential: {} as AppAttestWitness['credential'], assertion: {} as AppAttestWitness['assertion']};
}
