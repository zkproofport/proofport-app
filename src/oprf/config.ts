/**
 * Which OPRF network a build talks to, which key hash its answers must carry,
 * and where each wallet credential circuit publishes the OPRF values.
 *
 * Every lookup is keyed by the app's environment or the circuit id and ends at
 * an error naming the key; nothing falls back to another environment's network
 * or key. Production has NO row: no production network or key exists for this
 * integration yet, so a production build refuses every wallet credential
 * proof by name (E3011) rather than using the test network.
 *
 * The key-hash table MIRRORS core's `OPRF_KEY_HASHES` (proofport-app-sdk
 * packages/core/src/oprfKeyHashes.ts), which the installed core
 * (0.4.0-beta.8) does not ship. Replace it with `getPinnedOprfKeyHash` from
 * `@zkproofport-app/core` after a core release that exports it, mapping this
 * app's environment names with {@link OPRF_ENVIRONMENT_OF}.
 */
import type {CircuitName, Environment} from '../config/contracts';

/** The wallet credential circuits that publish an OPRF nullifier. */
export const OPRF_CIRCUIT_IDS = Object.freeze([
  'coinbase_attestation',
  'coinbase_country_attestation',
  'giwa_attestation',
  'dojang_playground',
  'human_passport_score',
] as const);
export type OprfCircuitId = (typeof OPRF_CIRCUIT_IDS)[number];

export function isOprfCircuit(circuit: unknown): circuit is OprfCircuitId {
  return typeof circuit === 'string' && (OPRF_CIRCUIT_IDS as readonly string[]).includes(circuit);
}

function requireOprfCircuit(circuit: unknown): OprfCircuitId {
  if (!isOprfCircuit(circuit)) {
    throw new Error(`'${String(circuit)}' has no OPRF nullifier. Circuits that do: ${OPRF_CIRCUIT_IDS.join(', ')}.`);
  }
  return circuit;
}

/** This app's environment -> the environment name core's verifier uses for the same build. */
export const OPRF_ENVIRONMENT_OF: Readonly<Record<Environment, 'production' | 'staging' | 'local'>> = Object.freeze({
  development: 'local',
  staging: 'staging',
  production: 'production',
});

/** Poseidon2_t3(DS_key, D.x, D.y)[1] of the public test network's key (core oprfKeyHashes.ts). */
export const TEST_NETWORK_OPRF_KEY_HASH = '0x039ecd4ea1875bb5c7f7a1bfae692cab271e3f3f25df4e5ab691fcb17586e6d1';
/** That key, as the test nodes return it with every answer. */
export const TEST_NETWORK_OPRF_PUBLIC_KEY = Object.freeze({
  x: '0x162fc76f99b6baa49ae260bbfac6c3a5657738bdd46f387dfa820beee7ab789e',
  y: '0x0f3d63eee4a861343e2397cfe40f21dbd95a4c780bc538c82ececa1e1549558e',
});

const testNetworkKeys = (): Readonly<Record<OprfCircuitId, string>> =>
  Object.freeze({
    coinbase_attestation: TEST_NETWORK_OPRF_KEY_HASH,
    coinbase_country_attestation: TEST_NETWORK_OPRF_KEY_HASH,
    giwa_attestation: TEST_NETWORK_OPRF_KEY_HASH,
    dojang_playground: TEST_NETWORK_OPRF_KEY_HASH,
    human_passport_score: TEST_NETWORK_OPRF_KEY_HASH,
  } satisfies Record<OprfCircuitId, string>);

/** environment -> circuit -> pinned key hash. `null`: no key for that environment. */
export const OPRF_KEY_HASHES: Readonly<Record<Environment, Readonly<Record<OprfCircuitId, string>> | null>> = Object.freeze({
  development: testNetworkKeys(),
  staging: testNetworkKeys(),
  production: null,
});

/** Raised when a build has no OPRF network or key: shown as E3011. */
export class OprfUnavailableError extends Error {
  constructor(readonly environment: string, detail: string) {
    super(detail);
    this.name = 'OprfUnavailableError';
  }
}

const knownEnvironment = (env: unknown): env is Environment =>
  typeof env === 'string' && Object.prototype.hasOwnProperty.call(OPRF_KEY_HASHES, env);

/** The key hash a `circuit` proof made in `environment` must carry. */
export function pinnedOprfKeyHash(environment: unknown, circuit: unknown): string {
  if (!knownEnvironment(environment)) {
    throw new Error(`Unknown environment '${String(environment)}'. Known: ${Object.keys(OPRF_KEY_HASHES).join(', ')}.`);
  }
  const rows = OPRF_KEY_HASHES[environment];
  const id = requireOprfCircuit(circuit);
  if (rows === null) {
    throw new OprfUnavailableError(environment, `No OPRF key is registered for the '${environment}' environment.`);
  }
  return rows[id];
}

/** How a request is authorised at the nodes. */
export type OprfAuthMode =
  /** An API key only: the nodes evaluate any point. The public test network's `basic` module. */
  | {kind: 'api-key'; apiKey: string}
  /**
   * The wallet signs the EIP-712 OprfRequest and the app proves the blinded
   * query is that wallet's (circuits/oprf-request-auth-poc; checked by the
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

/**
 * Where each circuit publishes the four OPRF values (one Field each) in its
 * flat public-input vector, and the vector's length. From circuits-dev.md
 * "OPRF nullifier in every wallet credential circuit" (the same table core's
 * OPRF_PUBLIC_INPUT_LAYOUTS holds). Every Coinbase v2 package (iPhone,
 * Android, Android factory) has its circuit's layout.
 */
export const OPRF_PUBLIC_INPUT_LAYOUTS: Readonly<Record<OprfCircuitId, {count: number; keyHash: number; domain: number; scope: number; nullifier: number}>> = Object.freeze({
  coinbase_attestation: {count: 133, keyHash: 128, domain: 129, scope: 130, nullifier: 131},
  coinbase_country_attestation: {count: 155, keyHash: 150, domain: 151, scope: 152, nullifier: 153},
  giwa_attestation: {count: 132, keyHash: 128, domain: 129, scope: 130, nullifier: 131},
  dojang_playground: {count: 100, keyHash: 96, domain: 97, scope: 98, nullifier: 99},
  human_passport_score: {count: 135, keyHash: 128, domain: 129, scope: 130, nullifier: 131},
});

/** The OPRF values a proof publishes, read by the layout above. Exact count, each value below p. */
export function readOprfPublicInputs(circuit: CircuitName | string, publicInputs: readonly string[]): {
  keyHash: string; domain: string; scope: string; nullifier: string;
} {
  const id = requireOprfCircuit(circuit);
  const layout = OPRF_PUBLIC_INPUT_LAYOUTS[id];
  if (!Array.isArray(publicInputs) || publicInputs.length !== layout.count) {
    throw new Error(`${id} publishes ${layout.count} public inputs; got ${Array.isArray(publicInputs) ? publicInputs.length : typeof publicInputs}.`);
  }
  const P = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
  const at = (i: number, what: string): string => {
    const v = publicInputs[i];
    if (typeof v !== 'string' || !/^0x[0-9a-fA-F]{1,64}$/.test(v) || BigInt(v) >= P) {
      throw new Error(`${id} public input ${i} (${what}) is not a field element: ${JSON.stringify(v)}.`);
    }
    return '0x' + BigInt(v).toString(16).padStart(64, '0');
  };
  return {
    keyHash: at(layout.keyHash, 'oprf_key_hash'),
    domain: at(layout.domain, 'domain'),
    scope: at(layout.scope, 'scope'),
    nullifier: at(layout.nullifier, 'nullifier'),
  };
}
