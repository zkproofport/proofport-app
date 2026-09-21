import type {ProofInputs, ProofResult} from '@openstoa/miniapp-bridge';
import {CIRCUIT_IDS} from '../config/circuitIds';
import {ethers} from 'ethers';
import {fetchWithDeadline, HOST_REQUEST_TIMEOUT_MS, HostRequestTimeoutError} from './fetchWithDeadline';

export const TOPIC_PROOF_TIMEOUT_MS = 6 * 60 * 1000;
export const TOPIC_PROOF_POLL_MS = 1500;

interface TopicProofDependencies {
  baseUrl: string;
  getToken(): Promise<string | null>;
  isProofActive(): boolean;
  triggerDeepLink(url: string, origin: 'self'): void;
  returnToOpenStoa(): void;
  /** Existing ErrorModal code only; diagnostics never become unlocalized UI. */
  showError(code: string): void;
  fetchImpl?: typeof fetch;
}

class TopicProofError extends Error {
  // The mini-app must not put a second Alert over the host's ErrorModal.
  readonly kind = 'HOST_TOPIC_PROOF_REPORTED';
  constructor(readonly code: string | null, message: string) {
    super(message);
    this.name = 'TopicProofError';
  }
}

// A factory can be recreated when the host renders. The native proof screen is
// shared across those instances, so its admission guard must be shared too.
let topicProofInFlight = false;
const SUPPORTED_CIRCUITS = new Set<string>([
  CIRCUIT_IDS.COINBASE_ATTESTATION,
  CIRCUIT_IDS.COINBASE_COUNTRY_ATTESTATION,
  CIRCUIT_IDS.OIDC_DOMAIN_ATTESTATION,
]);

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TopicProofError('E1002', 'Malformed topic proof response');
  }
  return value as Record<string, unknown>;
}

/**
 * Ask this app's existing on-device flow for a topic proof. Unlike login, this
 * transport reads the session and returns proof bytes; it has no storage-write
 * capability and never calls the session-minting poll mode.
 */
export async function requestTopicProof(inputs: ProofInputs, deps: TopicProofDependencies): Promise<ProofResult> {
  if (topicProofInFlight || deps.isProofActive()) {
    deps.showError('E2001');
    throw new TopicProofError('E2001', 'A proof request is already active');
  }
  topicProofInFlight = true;
  let ended = false;
  let opened = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let pollDelay: ReturnType<typeof setTimeout> | undefined;
  const expiresAt = Date.now() + TOPIC_PROOF_TIMEOUT_MS;
  const ensureActive = () => {
    if (ended || Date.now() >= expiresAt) throw new TopicProofError('E3004', 'Topic proof timed out');
  };
  const run = async (): Promise<ProofResult> => {
    if (!SUPPORTED_CIRCUITS.has(inputs.circuit)) {
      throw new TopicProofError('E1005', `Unknown topic proof circuit: ${inputs.circuit}`);
    }
    if (typeof inputs.scope !== 'string' || !inputs.scope.trim()) {
      throw new TopicProofError('E1004', 'Missing topic proof scope');
    }
    const token = await deps.getToken();
    ensureActive();
    if (!token) throw new TopicProofError('E1002', 'Topic proof requires a session');
    const headers = {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'};
    const {circuit, ...proofInputs} = inputs;
    const request = await fetchWithDeadline(`${deps.baseUrl}/api/auth/proof-request`, {
      method: 'POST', credentials: 'omit', headers,
      body: JSON.stringify({circuitType: circuit, mode: 'proof', ...proofInputs}),
    }, {label: 'topic-proof-request', fetchImpl: deps.fetchImpl, timeoutMs: Math.min(HOST_REQUEST_TIMEOUT_MS, expiresAt - Date.now())});
    ensureActive();
    if (!request.ok) throw new TopicProofError('E3002', `Topic proof request failed (${request.status})`);
    const created = object(await request.json());
    ensureActive();
    if (created.scope !== inputs.scope || created.circuitType !== circuit ||
        typeof created.requestId !== 'string' || !created.requestId ||
        typeof created.deepLink !== 'string' || !created.deepLink.startsWith('zkproofport://')) {
      throw new TopicProofError('E1002', 'Topic proof request does not match the requested scope/circuit');
    }
    // The native pipeline validates the relay registration and drives the
    // existing wallet/OIDC + mopro screens. 'self' keeps Android in this app.
    if (deps.isProofActive()) {
      throw new TopicProofError('E2001', 'A proof request became active before native handoff');
    }
    opened = true;
    deps.triggerDeepLink(created.deepLink, 'self');
    const pollUrl = `${deps.baseUrl}/api/auth/poll/${encodeURIComponent(created.requestId)}?mode=proof`;
    while (!ended) {
      await new Promise<void>(resolve => { pollDelay = setTimeout(resolve, TOPIC_PROOF_POLL_MS); });
      ensureActive();
      let response: Response;
      try {
        response = await fetchWithDeadline(pollUrl, {credentials: 'omit', headers}, {
          label: 'topic-proof-poll', fetchImpl: deps.fetchImpl,
          timeoutMs: Math.min(HOST_REQUEST_TIMEOUT_MS, expiresAt - Date.now()),
        });
      } catch (error) {
        ensureActive();
        if (error instanceof TypeError || error instanceof HostRequestTimeoutError) continue;
        throw error;
      }
      ensureActive();
      if (response.status === 404 || response.status === 410) throw new TopicProofError('E1003', 'Topic proof request expired');
      if (response.status >= 500) continue;
      if (!response.ok) throw new TopicProofError('E2003', `Topic proof poll rejected (${response.status})`);
      const data = object(await response.json());
      ensureActive();
      if (data.status === 'pending' || data.status === 'processing') continue;
      if (data.status === 'cancelled') throw new TopicProofError(null, 'Topic proof cancelled');
      if (data.status === 'expired') throw new TopicProofError('E1003', 'Topic proof request expired');
      if (data.status === 'failed' || data.status === 'error') throw new TopicProofError('E2001', 'Topic proof generation failed');
      if (data.status !== 'completed' || data.circuit !== circuit ||
          typeof data.proof !== 'string' || !/^0x(?:[0-9a-f]{2})+$/i.test(data.proof) ||
          !Array.isArray(data.publicInputs) || data.publicInputs.length === 0 ||
          !data.publicInputs.every(field => typeof field === 'string' && /^0x[0-9a-f]{1,64}$/i.test(field))) {
        throw new TopicProofError('E1002', 'Malformed topic proof result');
      }
      const expectedScope = ethers.utils.keccak256(ethers.utils.toUtf8Bytes(inputs.scope));
      // The poll endpoint derives scopeHash from the public inputs only after
      // verification. Keep circuit ABI decoding on that existing boundary.
      if (typeof data.scopeHash !== 'string' || data.scopeHash.toLowerCase() !== expectedScope.toLowerCase()) {
        throw new TopicProofError('E2003', 'Returned proof is bound to a different scope');
      }
      const currentToken = await deps.getToken();
      ensureActive();
      if (currentToken !== token) throw new TopicProofError('E1002', 'Session changed during topic proof generation');
      return {proof: data.proof, publicInputs: data.publicInputs};
    }
    throw new TopicProofError('E3004', 'Topic proof timed out');
  };
  try {
    const deadline = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new TopicProofError('E3004', 'Topic proof timed out')), TOPIC_PROOF_TIMEOUT_MS);
    });
    return await Promise.race([run(), deadline]);
  } catch (error) {
    const failure = error instanceof TopicProofError ? error : new TopicProofError(
      error instanceof HostRequestTimeoutError ? 'E3004' : 'E3001',
      error instanceof Error ? error.message : 'Topic proof transport failed',
    );
    if (failure.code) deps.showError(failure.code);
    throw failure;
  } finally {
    ended = true;
    clearTimeout(timeout);
    clearTimeout(pollDelay);
    topicProofInFlight = false;
    if (opened) deps.returnToOpenStoa();
  }
}
