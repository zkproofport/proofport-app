/**
 * Which OPRF network a build talks to, and which key hash its answers must
 * carry.
 *
 * The key hash is core's (`getPinnedOprfKeyHash` from `@zkproofport-app/core`),
 * looked up under core's name for this build's environment
 * ({@link OPRF_ENVIRONMENT_OF}). Every lookup is keyed by the app's environment
 * or the circuit id and ends at an error naming the key; nothing falls back to
 * another environment's network or key. Production has NO network here and no
 * key in core, so a production build refuses every wallet credential proof by
 * name (E3011, {@link OprfUnavailableError}) before anything is fetched or
 * signed, rather than using the test network.
 *
 * Where a proof publishes the OPRF values is core's too
 * (`OPRF_PUBLIC_INPUT_LAYOUTS`, `readOprfPublicInputs`); import those from core.
 */
import {OPRF_CIRCUIT_IDS, OPRF_KEY_HASHES, getPinnedOprfKeyHash, type OprfCircuitId, type OprfEnvironment} from '@zkproofport-app/core';
import type {Environment} from '../config/contracts';

export {OPRF_CIRCUIT_IDS};
export type {OprfCircuitId};

export function isOprfCircuit(circuit: unknown): circuit is OprfCircuitId {
  return typeof circuit === 'string' && (OPRF_CIRCUIT_IDS as readonly string[]).includes(circuit);
}

function requireOprfCircuit(circuit: unknown): OprfCircuitId {
  if (!isOprfCircuit(circuit)) {
    throw new Error(`'${String(circuit)}' has no OPRF nullifier. Circuits that do: ${OPRF_CIRCUIT_IDS.join(', ')}.`);
  }
  return circuit;
}

/** This app's environment -> the environment name core uses for the same build. */
export const OPRF_ENVIRONMENT_OF: Readonly<Record<Environment, OprfEnvironment>> = Object.freeze({
  development: 'local',
  staging: 'staging',
  production: 'production',
});

/** Raised when a build has no OPRF network or key: shown as E3011. */
export class OprfUnavailableError extends Error {
  constructor(readonly environment: string, detail: string) {
    super(detail);
    this.name = 'OprfUnavailableError';
  }
}

const knownEnvironment = (env: unknown): env is Environment =>
  typeof env === 'string' && Object.prototype.hasOwnProperty.call(OPRF_ENVIRONMENT_OF, env);

function requireEnvironment(env: unknown): Environment {
  if (!knownEnvironment(env)) {
    throw new Error(`Unknown environment '${String(env)}'. Known: ${Object.keys(OPRF_ENVIRONMENT_OF).join(', ')}.`);
  }
  return env;
}

/**
 * The key hash a `circuit` proof made in `environment` must carry: core's
 * pinned row for {@link OPRF_ENVIRONMENT_OF}[environment]. An environment
 * whose core row is empty is refused with {@link OprfUnavailableError} naming
 * both names, before core is asked, so the screen shows E3011 rather than a
 * generic failure.
 */
export function pinnedOprfKeyHash(environment: unknown, circuit: unknown): string {
  const env = requireEnvironment(environment);
  const id = requireOprfCircuit(circuit);
  const coreEnv = OPRF_ENVIRONMENT_OF[env];
  if (OPRF_KEY_HASHES[coreEnv] === null) {
    throw new OprfUnavailableError(env, `No OPRF key is registered for the '${env}' environment (core environment '${coreEnv}').`);
  }
  return getPinnedOprfKeyHash(coreEnv, id);
}

/** How a request is authorised at the nodes. */
export type OprfAuthMode =
  /** An API key only: the nodes evaluate any point. The public test network's `basic` module. */
  | {kind: 'api-key'; apiKey: string}
  /**
   * The wallet signs the EIP-712 OprfRequest and the app proves the blinded
   * query is that wallet's (circuits/oprf-request-auth; checked by the
   * request verifier beside each node, proofport-oprf/REQUEST-VERIFIER.md).
   */
  | {kind: 'request-auth-v1'; apiKey?: string};

export interface OprfNetwork {
  /** Node base URLs, https. */
  nodes: readonly string[];
  threshold: number;
  /** The auth module's path segment. */
  module: string;
  auth: OprfAuthMode;
  /** The node client protocol version sent as `version=` (taceo-oprf-client 0.10.8). */
  clientVersion: string;
  /** Per round, milliseconds. A cold test node took 7.5 s on 2026-11-17. */
  roundTimeoutMs: number;
}

/**
 * The public test network: three nodes, any two answer. Its `basic` module
 * takes the public test API key (published in the network's own quickstart)
 * and evaluates any point; it has no module that checks our request proof.
 * The app still signs and proves every request and sends the request-auth
 * fields beside the key, so the test network runs the same flow production
 * will: measured 2026-11-20 (src/oprf/__tests__/theTestNetworkAnswersTheAppsClient.network.test.ts),
 * the `basic` module answers a request whose auth carries the extra fields,
 * and refuses a wrong key with close code 4500 on every node.
 */
export const OPRF_TEST_NETWORK: OprfNetwork = Object.freeze({
  nodes: Object.freeze([
    'https://node0.eu.test.oprf.taceo.network',
    'https://node1.eu.test.oprf.taceo.network',
    'https://node2.eu.test.oprf.taceo.network',
  ]),
  threshold: 2,
  module: 'basic',
  auth: Object.freeze({kind: 'request-auth-v1', apiKey: 'taceo_3ZfE55WkcNWRweh5rcfpUNpi'}) as OprfAuthMode,
  clientVersion: '0.10.8',
  roundTimeoutMs: 20_000,
});

/** environment -> network. `null`: none exists for that environment. */
export const OPRF_NETWORKS: Readonly<Record<Environment, OprfNetwork | null>> = Object.freeze({
  development: OPRF_TEST_NETWORK,
  staging: OPRF_TEST_NETWORK,
  production: null,
});

export function oprfNetworkFor(environment: unknown): OprfNetwork {
  if (!knownEnvironment(environment)) {
    throw new Error(`Unknown environment '${String(environment)}'. Known: ${Object.keys(OPRF_NETWORKS).join(', ')}.`);
  }
  const net = OPRF_NETWORKS[environment];
  if (net === null) {
    throw new OprfUnavailableError(environment, `No OPRF network is configured for the '${environment}' environment.`);
  }
  return net;
}
