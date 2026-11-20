/**
 * One OPRF evaluation for one proof, from the request's names to the eleven
 * values the credential circuit takes.
 *
 *   names checked -> network + pinned key hash for this build -> query, beta,
 *   blinded query -> (request-auth-v1) wallet signs the EIP-712 OprfRequest,
 *   the app proves the request -> both rounds at the nodes -> the combined
 *   Chaum-Pedersen proof and the key hash checked -> unblinded -> nullifier
 *
 * Every failure is an {@link OprfError} carrying the ErrorModal code the
 * screen shows; nothing here substitutes a value for one it could not get.
 * Everything outside the device (wallet, prover, nodes, clock, randomness) is
 * passed in, so the whole flow is tested without any of them.
 */
import type {ErrorCode} from '../constants/errorCodes';
import type {Environment} from '../config/contracts';
import {
  OPRF_MAX_VALIDITY_SECONDS,
  blindOprfQuery,
  finalizeOprf,
  oprfAddressField,
  oprfQuery,
  oprfRequestEip712Json,
  oprfRequestTypedData,
  randomOprfBeta,
  reduceOprfName,
  type OprfCircuitInputs,
} from './core/client';
import {OprfUnavailableError, oprfNetworkFor, pinnedOprfKeyHash, isOprfCircuit, OPRF_CIRCUIT_IDS, type OprfNetwork} from './config';
import {OprfNameRefusedError, type OprfRequestNames} from './requestNames';
import {
  REQUEST_AUTH_VERSION,
  checkRequestAuthProof,
  expectedRequestAuthPublicInputs,
  requestAuthInputs,
} from './requestAuth';
import {OprfTransportError, runDistributedOprf, type NodeConnector} from './transport';
import {randomUuidV4, type CborValue} from './wire';

/**
 * How long the signed request stays valid: below the node's 600 s limit by a
 * minute, so a phone clock that runs ahead of the node's is not refused as
 * "too far ahead" (4503).
 */
export const OPRF_REQUEST_LIFETIME_SECONDS = OPRF_MAX_VALIDITY_SECONDS - 60;
/** The least validity left when the request is sent; less is refused here (E3004). */
export const OPRF_MIN_REMAINING_SECONDS = 30;

export class OprfError extends Error {
  constructor(readonly code: ErrorCode, readonly reason: string, message: string) {
    super(message);
    this.name = 'OprfError';
  }
}

export interface OprfFlowDeps {
  /** eth_signTypedData_v4 with the JSON payload; resolves to the 65-byte signature. */
  signTypedData: (eip712Json: string) => Promise<string>;
  /** Prove circuits/oprf-request-auth-poc on these inputs; bare proof + its public inputs. */
  proveRequestAuth: (inputs: string[]) => Promise<{proof: Uint8Array; publicInputs: string[]}>;
  connect: NodeConnector;
  nowSeconds: () => number;
  /** Secure random bytes (request id). The blinding factor uses core's own Web Crypto source. */
  randomBytes: (n: number) => Uint8Array;
  log: (m: string) => void;
}

export interface OprfFlowArgs {
  circuit: string;
  environment: Environment | string;
  address: string;
  names: OprfRequestNames;
}

/** The ErrorModal code for a transport failure. */
const TRANSPORT_CODE: Readonly<Record<OprfTransportError['kind'], ErrorCode>> = Object.freeze({
  refused: 'E3012',
  protocol: 'E3010',
  unreachable: 'E3010',
  timeout: 'E3010',
  'inconsistent-keys': 'E2024',
  'bad-proof': 'E2024',
});

/** The ErrorModal code for any failure of this flow (an OprfError keeps its own). */
export function oprfErrorCode(e: unknown): ErrorCode | undefined {
  if (e instanceof OprfError) return e.code;
  if (e instanceof OprfNameRefusedError) return 'E1010';
  if (e instanceof OprfUnavailableError) return 'E3011';
  if (e instanceof OprfTransportError) return TRANSPORT_CODE[e.kind];
  return undefined;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function authFor(network: OprfNetwork, request?: {domainName: string; scopeName: string; deadline: number; proofHex: string}): {[k: string]: CborValue} {
  const auth: {[k: string]: CborValue} = {};
  if (network.auth.apiKey !== undefined) auth.api_key = network.auth.apiKey;
  if (network.auth.kind === 'request-auth-v1') {
    if (!request) throw new Error('request-auth-v1 needs the signed request and its proof.');
    auth.version = REQUEST_AUTH_VERSION;
    auth.domainName = request.domainName;
    auth.scopeName = request.scopeName;
    auth.deadline = request.deadline;
    auth.proof = request.proofHex;
  }
  return auth;
}

export async function obtainOprfInputs(args: OprfFlowArgs, deps: OprfFlowDeps): Promise<OprfCircuitInputs> {
  const {log} = deps;
  if (!isOprfCircuit(args.circuit)) {
    throw new OprfError('E2001', 'unknown-circuit', `'${args.circuit}' has no OPRF nullifier. Circuits that do: ${OPRF_CIRCUIT_IDS.join(', ')}.`);
  }
  // Production (no network, no key) is refused here, before the wallet is asked.
  const network = oprfNetworkFor(args.environment);
  const expectedKeyHash = pinnedOprfKeyHash(args.environment, args.circuit);
  try {
    oprfAddressField(args.address);
  } catch (e) {
    throw new OprfError('E4001', 'bad-address', message(e));
  }
  const {domainName, scopeName} = args.names;
  // Names are checked by the caller (oprfNamesFor); reduceOprfName re-checks them.
  let domain: string;
  let scope: string;
  try {
    domain = reduceOprfName(domainName);
    scope = reduceOprfName(scopeName);
  } catch (e) {
    throw new OprfNameRefusedError('oprfDomain', 'missing', message(e));
  }
  const query = oprfQuery({address: args.address, domain, scope});
  let beta: string;
  let requestId: string;
  try {
    beta = randomOprfBeta();
    requestId = randomUuidV4(deps.randomBytes);
  } catch (e) {
    throw new OprfError('E2001', 'no-secure-random', message(e));
  }
  const blinded = blindOprfQuery(query, beta);
  log(`[OPRF] ${args.circuit}: domain ${JSON.stringify(domainName)}, scope ${JSON.stringify(scopeName)}, request ${requestId}`);

  let signedRequest: {domainName: string; scopeName: string; deadline: number; proofHex: string} | undefined;
  if (network.auth.kind === 'request-auth-v1') {
    const now = deps.nowSeconds();
    const deadline = now + OPRF_REQUEST_LIFETIME_SECONDS;
    const typed = oprfRequestTypedData({domainName, scopeName, deadline, nowSeconds: now});
    let signature: string;
    try {
      signature = await deps.signTypedData(oprfRequestEip712Json(typed));
    } catch (e) {
      throw new OprfError('E4002', 'wallet-refused', `The wallet did not sign the OPRF request: ${message(e)}`);
    }
    if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(signature)) {
      throw new OprfError('E4002', 'bad-signature', `The wallet returned ${JSON.stringify(signature)} for the OPRF request, not a 65-byte signature.`);
    }
    let inputs: string[];
    try {
      inputs = requestAuthInputs({domainName, scopeName, deadline, signature}, args.address, beta);
    } catch (e) {
      throw new OprfError('E4002', 'wrong-signer', message(e));
    }
    const proof = await deps.proveRequestAuth(inputs);
    try {
      checkRequestAuthProof(proof, expectedRequestAuthPublicInputs({domainName, scopeName, deadline}, blinded));
    } catch (e) {
      throw new OprfError('E2001', 'request-proof-mismatch', message(e));
    }
    const left = deadline - deps.nowSeconds();
    if (left < OPRF_MIN_REMAINING_SECONDS) {
      throw new OprfError('E3004', 'request-expired', `The signed OPRF request has ${left} s left; it is not sent.`);
    }
    signedRequest = {domainName, scopeName, deadline, proofHex: '0x' + Array.from(proof.proof, b => b.toString(16).padStart(2, '0')).join('')};
  }

  const answer = await runDistributedOprf({
    nodes: network.nodes,
    threshold: network.threshold,
    module: network.module,
    clientVersion: network.clientVersion,
    requestId,
    blindedQuery: {x: BigInt(blinded.x), y: BigInt(blinded.y)},
    auth: authFor(network, signedRequest),
    connect: deps.connect,
    roundTimeoutMs: network.roundTimeoutMs,
    log,
  });

  try {
    const out = finalizeOprf({
      address: args.address,
      domain,
      scope,
      beta,
      publicKey: answer.publicKey,
      blindedResponse: answer.blindedResponse,
      dlogE: answer.e,
      dlogS: answer.s,
      expectedKeyHash,
    });
    log(`[OPRF] answered by parties ${answer.partyIds.join(', ')}, epoch ${answer.epoch}`);
    return out;
  } catch (e) {
    throw new OprfError('E2024', 'answer-refused', message(e));
  }
}
