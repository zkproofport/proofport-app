/**
 * The OPRF flow (./flow.ts) wired to this phone: the build's environment, the
 * connected wallet (eth_signTypedData_v4 over WalletConnect), the on-device
 * prover for the request proof, the runtime's WebSocket, Web Crypto and the
 * clock. Each wallet credential hook calls {@link oprfInputsForProof} once per
 * attempt, before it builds its circuit inputs.
 */
import {getEnvironment} from '../config/environment';
import type {OprfCircuitInputs} from './core/client';
import {obtainOprfInputs, oprfErrorCode, OprfError} from './flow';
import {oprfNetworkFor, pinnedOprfKeyHash} from './config';
import type {ErrorCode} from '../constants/errorCodes';
import {REQUEST_AUTH_ABI, REQUEST_AUTH_PUBLIC_INPUTS} from './requestAuth';
import {OPRF_PRIVATE_INPUT_NAMES} from './circuitInputs';
import {webSocketConnector} from './transport';

/** The auxiliary circuit id of the request proof (src/config/circuitArtifacts.ts). */
export const REQUEST_AUTH_CIRCUIT = 'oprf_request_auth';

interface WalletProvider {
  request: (args: {method: string; params?: unknown[]}) => Promise<unknown>;
}

function secureRandomBytes(n: number): Uint8Array {
  const c = (globalThis as {crypto?: {getRandomValues?: (a: Uint8Array) => Uint8Array}}).crypto;
  if (!c || typeof c.getRandomValues !== 'function') {
    throw new Error('No crypto.getRandomValues in this runtime; refusing to make an OPRF request without a secure random source.');
  }
  const b = new Uint8Array(n);
  c.getRandomValues(b);
  return b;
}

const toHex = (b: ArrayBuffer): string => '0x' + Array.from(new Uint8Array(b), x => x.toString(16).padStart(2, '0')).join('');

/** Refuse a downloaded file set whose ABI is not `expected`: a cached file from before a circuit change. */
export async function requireAbi(circuit: string, check: (names: string[]) => string | null): Promise<void> {
  // Native file access, loaded when a proof runs (the hooks import this module).
  const {circuitAbiParameterNames} = require('../utils/circuitAbi') as typeof import('../utils/circuitAbi');
  const names = await circuitAbiParameterNames(circuit);
  const why = check(names);
  if (why !== null) throw new OprfError('E2002', 'stale-circuit-files', `The downloaded ${circuit} files are not the expected circuit: ${why}.`);
}

/** The credential circuit's files must take the seven OPRF private inputs, last, in order. */
export const credentialAbiCheck = (names: string[]): string | null => {
  const tail = names.slice(-OPRF_PRIVATE_INPUT_NAMES.length);
  return tail.join(',') === OPRF_PRIVATE_INPUT_NAMES.join(',') ? null : `its last parameters are ${tail.join(', ')}, not the OPRF inputs`;
};

async function proveRequestAuthOnDevice(inputs: string[], log: (m: string) => void): Promise<{proof: Uint8Array; publicInputs: string[]}> {
  const {circuitFilesForProof, proveCircuit} = require('../utils/proofRun') as typeof import('../utils/proofRun');
  const {getAssetPath, loadVkFromAssets} = require('../utils/asset') as typeof import('../utils/asset');
  const {parseProofWithPublicInputs} = require('mopro-ffi') as typeof import('mopro-ffi');
  // Throws, naming OPRF_CIRCUITS_REF, while the request circuit is not published.
  await circuitFilesForProof(REQUEST_AUTH_CIRCUIT, log);
  await requireAbi(REQUEST_AUTH_CIRCUIT, names =>
    names.join(',') === REQUEST_AUTH_ABI.join(',') ? null : `parameters ${names.join(', ')}`);
  const vk = await loadVkFromAssets(REQUEST_AUTH_CIRCUIT, log);
  const circuitPath = await getAssetPath(`${REQUEST_AUTH_CIRCUIT}.json`);
  const srsPath = await getAssetPath(`${REQUEST_AUTH_CIRCUIT}.srs`);
  const full = await proveCircuit({circuit: REQUEST_AUTH_CIRCUIT, variant: 'standard', circuitPath, srsPath, inputs, vk, log});
  const parsed = parseProofWithPublicInputs(full, REQUEST_AUTH_PUBLIC_INPUTS);
  return {proof: new Uint8Array(parsed.proof), publicInputs: parsed.publicInputs.map(toHex)};
}

/**
 * The eleven OPRF values for one proof of `circuit` by `address`, keyed by
 * (domainName, scopeName). The wallet is asked to sign the OPRF request (when
 * the network checks requests). Throws OprfError / a named error; the hook
 * puts `oprfErrorCode(e)` on its failed step.
 */
export async function oprfInputsForProof(args: {
  circuit: string;
  address: string;
  /** The address the wallet signs from (the session's selected account). */
  from: string;
  domainName: string;
  scopeName: string;
  ethereum: WalletProvider;
  log: (m: string) => void;
}): Promise<OprfCircuitInputs> {
  await requireAbi(args.circuit, credentialAbiCheck);
  const WS = (globalThis as {WebSocket?: unknown}).WebSocket;
  if (typeof WS !== 'function') throw new OprfError('E3010', 'no-websocket', 'This runtime has no WebSocket.');
  return obtainOprfInputs(
    {circuit: args.circuit, environment: getEnvironment(), address: args.address, names: {domainName: args.domainName, scopeName: args.scopeName}},
    {
      signTypedData: async json => {
        args.log('[OPRF] Asking the wallet to sign the OPRF request');
        return (await args.ethereum.request({method: 'eth_signTypedData_v4', params: [args.from, json]})) as string;
      },
      proveRequestAuth: inputs => proveRequestAuthOnDevice(inputs, args.log),
      connect: webSocketConnector(WS as Parameters<typeof webSocketConnector>[0]),
      nowSeconds: () => Math.floor(Date.now() / 1000),
      randomBytes: secureRandomBytes,
      log: args.log,
    },
  );
}

/**
 * Refuse, before anything is downloaded or signed, a proof this build cannot
 * key: no OPRF network or key for its environment (production today, E3011),
 * or a circuit without an OPRF nullifier.
 */
export function assertOprfAvailable(circuit: string): void {
  oprfNetworkFor(getEnvironment());
  pinnedOprfKeyHash(getEnvironment(), circuit);
}

/** The step fields a hook sets when a step fails: the ErrorModal code of an OPRF failure, if it is one. */
export function oprfStepCode(error: unknown): {code: ErrorCode} | Record<string, never> {
  const code = oprfErrorCode(error);
  return code ? {code} : {};
}
