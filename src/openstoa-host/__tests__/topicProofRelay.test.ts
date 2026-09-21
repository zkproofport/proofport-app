/** Real proof-only transport, verified scope metadata, and deadlines. Only HTTP and
 * native handoff/navigation are doubled; fixtures never leave this process. */
import {ethers} from 'ethers';
import {
  COINBASE_ATTESTATION_PUBLIC_INPUT_LAYOUT,
  COINBASE_COUNTRY_PUBLIC_INPUT_LAYOUT,
  OIDC_DOMAIN_ATTESTATION_PUBLIC_INPUT_LAYOUT,
} from '@zkproofport-app/sdk';
import type {ProofInputs} from '@openstoa/miniapp-bridge';
import {requestTopicProof, TOPIC_PROOF_TIMEOUT_MS, TOPIC_PROOF_POLL_MS} from '../topicProofRelay';

const scope = 'zkproofport-community:topic:alice';
const input: ProofInputs = {circuit: 'coinbase_attestation', scope};
const layouts = {
  coinbase_attestation: COINBASE_ATTESTATION_PUBLIC_INPUT_LAYOUT,
  coinbase_country_attestation: COINBASE_COUNTRY_PUBLIC_INPUT_LAYOUT,
  oidc_domain_attestation: OIDC_DOMAIN_ATTESTATION_PUBLIC_INPUT_LAYOUT,
};
function result(circuit: ProofInputs['circuit'] = input.circuit, resultScope = scope) {
  const layout = layouts[circuit];
  const publicInputs = Array.from({length: layout.NULLIFIER_END + 1}, () => '0x00');
  ethers.utils.arrayify(ethers.utils.keccak256(ethers.utils.toUtf8Bytes(resultScope)))
    .forEach((byte, index) => { publicInputs[layout.SCOPE_START + index] = ethers.utils.hexlify(byte); });
  return {status: 'completed', circuit, proof: '0xaabb', publicInputs, scopeHash: ethers.utils.keccak256(ethers.utils.toUtf8Bytes(resultScope))};
}
const response = (body: unknown, status = 200) => ({ok: status >= 200 && status < 300, status, json: async () => body} as Response);
function harness(inputs = input) {
  const fetchImpl = jest.fn(async (_url: string, init?: RequestInit) => response(init?.method === 'POST'
    ? {requestId: 'request/id', deepLink: 'zkproofport://proof-request?test=1', scope, circuitType: inputs.circuit}
    : result(inputs.circuit)));
  return {
    baseUrl: 'https://openstoa.test',
    getToken: jest.fn(async () => 'session-token'),
    isProofActive: jest.fn(() => false),
    triggerDeepLink: jest.fn(),
    returnToOpenStoa: jest.fn(),
    showError: jest.fn(),
    fetchImpl: fetchImpl as jest.Mock & typeof fetch,
  };
}
async function settle(promise: Promise<unknown>) {
  await jest.advanceTimersByTimeAsync(TOPIC_PROOF_POLL_MS);
  return promise;
}
beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

it.each<ProofInputs>([
  input,
  {circuit: 'coinbase_country_attestation', scope, countryList: ['KR'], isIncluded: true},
  {circuit: 'oidc_domain_attestation', scope, provider: 'google'},
  {circuit: 'oidc_domain_attestation', scope, provider: 'microsoft', domain: 'example.com'},
])('returns the $circuit proof using authenticated proof-only flow', async inputs => {
  const deps = harness(inputs);
  const promise = requestTopicProof(inputs, deps);
  const proof = await settle(promise);
  expect(proof).toEqual({proof: '0xaabb', publicInputs: result(inputs.circuit).publicInputs});
  expect(deps.fetchImpl.mock.calls[0][0]).toBe('https://openstoa.test/api/auth/proof-request');
  expect(deps.fetchImpl.mock.calls[0][1]).toMatchObject({method: 'POST', credentials: 'omit', headers: {Authorization: 'Bearer session-token'}});
  const {circuit, ...rest} = inputs;
  expect(JSON.parse(String(deps.fetchImpl.mock.calls[0][1].body))).toEqual({circuitType: circuit, mode: 'proof', ...rest});
  expect(deps.fetchImpl.mock.calls[1][0]).toBe('https://openstoa.test/api/auth/poll/request%2Fid?mode=proof');
  expect(deps.fetchImpl.mock.calls[1][1]).toMatchObject({credentials: 'omit', headers: {Authorization: 'Bearer session-token'}});
  expect(deps.triggerDeepLink).toHaveBeenCalledWith('zkproofport://proof-request?test=1', 'self');
  expect(deps.returnToOpenStoa).toHaveBeenCalledTimes(1);
  expect(deps.showError).not.toHaveBeenCalled();
  // Only a read capability is supplied; transport has no session-write API.
  expect(deps.getToken).toHaveBeenCalledTimes(2);
});

it.each([
  ['scope changed', {scope: 'other'}],
  ['circuit changed', {circuitType: 'oidc_domain_attestation'}],
  ['missing request ID', {requestId: ''}],
  ['invalid deep link', {deepLink: 'https://attacker.test'}],
])('refuses %s before opening the native flow', async (_label, override) => {
  const deps = harness();
  deps.fetchImpl.mockResolvedValueOnce(response({requestId: 'id', deepLink: 'zkproofport://request', scope, circuitType: input.circuit, ...override}));
  await expect(requestTopicProof(input, deps)).rejects.toMatchObject({kind: 'HOST_TOPIC_PROOF_REPORTED'});
  expect(deps.triggerDeepLink).not.toHaveBeenCalled();
  expect(deps.showError).toHaveBeenCalledWith('E1002');
});

it.each([
  ['wrong scope', result(input.circuit, 'someone-else')],
  ['wrong circuit', result('oidc_domain_attestation')],
  ['empty proof', {...result(), proof: ''}],
  ['invalid proof encoding', {...result(), proof: 'not-hex'}],
  ['missing public inputs', {...result(), publicInputs: undefined}],
  ['malformed public inputs', {...result(), publicInputs: ['0xgg']}],
  ['missing committed scope', {...result(), scopeHash: undefined}],
  ['unknown status', {status: 'unexpected'}],
])('refuses %s in the relay result', async (_label, data) => {
  const deps = harness();
  deps.fetchImpl.mockResolvedValueOnce(response({requestId: 'id', deepLink: 'zkproofport://request', scope, circuitType: input.circuit}));
  deps.fetchImpl.mockResolvedValueOnce(response(data));
  const promise = requestTopicProof(input, deps).catch(error => error);
  expect(await settle(promise)).toMatchObject({kind: 'HOST_TOPIC_PROOF_REPORTED'});
  expect(deps.returnToOpenStoa).toHaveBeenCalledTimes(1);
  expect(deps.showError).toHaveBeenCalledTimes(1);
  expect(deps.showError.mock.calls[0]).toHaveLength(1); // no raw English diagnostic
});

it.each([
  ['failed', 200, {status: 'failed'}, 'E2001'],
  ['expired', 200, {status: 'expired'}, 'E1003'],
  ['not found', 404, {}, 'E1003'],
  ['verification failed', 400, {}, 'E2003'],
])('ends a %s request', async (_label, status, data, code) => {
  const deps = harness();
  deps.fetchImpl.mockResolvedValueOnce(response({requestId: 'id', deepLink: 'zkproofport://request', scope, circuitType: input.circuit}));
  deps.fetchImpl.mockResolvedValueOnce(response(data, status));
  const promise = requestTopicProof(input, deps).catch(error => error);
  expect(await settle(promise)).toMatchObject({kind: 'HOST_TOPIC_PROOF_REPORTED'});
  expect(deps.showError).toHaveBeenCalledWith(code);
});

it('returns quietly to the mini-app after cancellation', async () => {
  const deps = harness();
  deps.fetchImpl.mockResolvedValueOnce(response({requestId: 'id', deepLink: 'zkproofport://request', scope, circuitType: input.circuit}));
  deps.fetchImpl.mockResolvedValueOnce(response({status: 'cancelled'}));
  const promise = requestTopicProof(input, deps).catch(error => error);
  expect(await settle(promise)).toMatchObject({kind: 'HOST_TOPIC_PROOF_REPORTED'});
  expect(deps.returnToOpenStoa).toHaveBeenCalledTimes(1);
  expect(deps.showError).not.toHaveBeenCalled();
});

it('rejects an absent session without making a request', async () => {
  const deps = harness();
  deps.getToken.mockResolvedValue(null as never);
  await expect(requestTopicProof(input, deps)).rejects.toMatchObject({kind: 'HOST_TOPIC_PROOF_REPORTED'});
  expect(deps.fetchImpl).not.toHaveBeenCalled();
});

it('rejects a session change while proving', async () => {
  const deps = harness();
  deps.getToken.mockResolvedValueOnce('session-token').mockResolvedValueOnce('different-session');
  const promise = requestTopicProof(input, deps).catch(error => error);
  expect(await settle(promise)).toMatchObject({kind: 'HOST_TOPIC_PROOF_REPORTED'});
  expect(deps.showError).toHaveBeenCalledWith('E1002');
});

it('does not overwrite an active request with a concurrent request', async () => {
  const first = harness();
  const firstPromise = requestTopicProof(input, first);
  const second = harness();
  await expect(requestTopicProof(input, second)).rejects.toMatchObject({kind: 'HOST_TOPIC_PROOF_REPORTED'});
  expect(second.fetchImpl).not.toHaveBeenCalled();
  expect(second.returnToOpenStoa).not.toHaveBeenCalled();
  await settle(firstPromise);
  await settle(requestTopicProof(input, second));
});

it('does not interrupt a proof started elsewhere in the host', async () => {
  const deps = harness();
  deps.isProofActive.mockReturnValue(true);
  await expect(requestTopicProof(input, deps)).rejects.toMatchObject({kind: 'HOST_TOPIC_PROOF_REPORTED'});
  expect(deps.fetchImpl).not.toHaveBeenCalled();
});

it('does not interrupt a proof that starts while the creation request is pending', async () => {
  const deps = harness();
  let resolveRequest!: (value: Response) => void;
  deps.fetchImpl.mockImplementationOnce(() => new Promise(resolve => { resolveRequest = resolve; }));
  const promise = requestTopicProof(input, deps).catch(error => error);
  await jest.advanceTimersByTimeAsync(0);
  expect(deps.isProofActive).toHaveBeenCalledTimes(1);
  expect(deps.fetchImpl).toHaveBeenCalledTimes(1);
  deps.isProofActive.mockReturnValue(true);
  resolveRequest(response({requestId: 'id', deepLink: 'zkproofport://request', scope, circuitType: input.circuit}));
  expect(await settle(promise)).toMatchObject({kind: 'HOST_TOPIC_PROOF_REPORTED', code: 'E2001'});
  expect(deps.triggerDeepLink).not.toHaveBeenCalled();
  expect(deps.returnToOpenStoa).not.toHaveBeenCalled();
  expect(deps.fetchImpl).toHaveBeenCalledTimes(1);
  expect(deps.showError).toHaveBeenCalledWith('E2001');
});

it('times out pending requests and releases the concurrency guard', async () => {
  const deps = harness();
  deps.fetchImpl.mockResolvedValueOnce(response({requestId: 'id', deepLink: 'zkproofport://request', scope, circuitType: input.circuit}));
  deps.fetchImpl.mockResolvedValue(response({status: 'pending'}));
  const promise = requestTopicProof(input, deps).catch(error => error);
  await jest.advanceTimersByTimeAsync(TOPIC_PROOF_TIMEOUT_MS);
  expect(await promise).toMatchObject({kind: 'HOST_TOPIC_PROOF_REPORTED'});
  expect(deps.showError).toHaveBeenCalledWith('E3004');
  expect(deps.returnToOpenStoa).toHaveBeenCalledTimes(1);
  await settle(requestTopicProof(input, harness()));
});

it('a stalled response body cannot outlive the overall deadline or open a late native flow', async () => {
  const deps = harness();
  let resolveBody!: (value: unknown) => void;
  deps.fetchImpl.mockResolvedValueOnce({ok: true, status: 200, json: () => new Promise(resolve => {resolveBody = resolve;})} as Response);
  const promise = requestTopicProof(input, deps).catch(error => error);
  await jest.advanceTimersByTimeAsync(TOPIC_PROOF_TIMEOUT_MS);
  expect(await promise).toMatchObject({kind: 'HOST_TOPIC_PROOF_REPORTED'});
  resolveBody({requestId: 'id', deepLink: 'zkproofport://request', scope, circuitType: input.circuit});
  await jest.advanceTimersByTimeAsync(0);
  expect(deps.triggerDeepLink).not.toHaveBeenCalled();
});

it('bounds a creation request that never answers', async () => {
  const deps = harness();
  deps.fetchImpl.mockImplementationOnce(() => new Promise(() => {}));
  const promise = requestTopicProof(input, deps).catch(error => error);
  await jest.advanceTimersByTimeAsync(15_000);
  expect(await promise).toMatchObject({kind: 'HOST_TOPIC_PROOF_REPORTED'});
  expect(deps.showError).toHaveBeenCalledWith('E3004');
  expect(deps.triggerDeepLink).not.toHaveBeenCalled();
});

it('retries a transient poll failure inside the overall deadline', async () => {
  const deps = harness();
  deps.fetchImpl.mockResolvedValueOnce(response({requestId: 'id', deepLink: 'zkproofport://request', scope, circuitType: input.circuit}));
  deps.fetchImpl.mockRejectedValueOnce(new TypeError('Offline'));
  const promise = requestTopicProof(input, deps);
  await jest.advanceTimersByTimeAsync(TOPIC_PROOF_POLL_MS * 2);
  expect(await promise).toMatchObject({proof: '0xaabb'});
  expect(deps.showError).not.toHaveBeenCalled();
});
