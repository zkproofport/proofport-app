/**
 * src/oprf/flow.ts + transport.ts against in-memory nodes that answer as the
 * real ones do (helpers/mockNodes.ts; their combination is held to the nodes'
 * own crates by theNodeWireAndCombinationMatchTheNodesCrates.test.ts).
 *
 * Matrix rows covered here: wallet refuses / returns garbage / signs from
 * another wallet; deadline expired before sending; production refused before
 * the wallet is asked; unknown circuit and environment; no secure random;
 * one node down (answers), two down (E3010), all silent (timeout, E3010),
 * refusal 4500 on every node (E3012), a bad proof share (E2024), another key
 * (E2024 key hash), inconsistent keys / epochs, an off-curve commitment, a
 * text frame, a repeated party id; the request-proof self-check; what the
 * nodes actually receive (auth fields, UUID v4 request id, deadline window).
 */
import {ethers} from 'ethers';
import {mockNetwork, type NodeBehaviour} from './helpers/mockNodes';
import {oprfKeyHash, oprfQuery, reduceOprfName, OPRF_MAX_VALIDITY_SECONDS} from '@zkproofport-app/core';
import {GENERATOR, scalarMul, isIdentity} from '../curve/babyjubjub';
import {expectedRequestAuthPublicInputs, REQUEST_AUTH_PROOF_BYTES} from '../requestAuth';
import {OPRF_PUBLIC_INPUT_NAMES} from '../circuitInputs';

const MOCK_KEY = 0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdn;
let mockPinned = '';
jest.mock('../config', () => {
  const actual = jest.requireActual('../config');
  return {
    ...actual,
    // The real pin is the public test network's key; these nodes hold another.
    // The pin logic itself is tested against the real table in
    // theOprfConfigRefusesWhatItDoesNotHold.test.ts.
    pinnedOprfKeyHash: (env: unknown, circuit: unknown) => {
      actual.pinnedOprfKeyHash(env, circuit);
      return mockPinned;
    },
  };
});

// eslint-disable-next-line import/first
import {obtainOprfInputs, oprfErrorCode, OPRF_REQUEST_LIFETIME_SECONDS, type OprfFlowDeps} from '../flow';

const wallet = new ethers.Wallet('0x' + '42'.repeat(32));
const NOW = 1_800_000_000;
const names = {domainName: 'vote.example', scopeName: 'community-vote-2026 🗳'};

beforeAll(() => {
  mockPinned = oprfKeyHash(scalarMul(GENERATOR, MOCK_KEY));
});

function deps(net: ReturnType<typeof mockNetwork>, over: Partial<OprfFlowDeps> = {}): OprfFlowDeps & {signed: string[]} {
  const signed: string[] = [];
  return {
    signed,
    signTypedData: async json => {
      signed.push(json);
      const t = JSON.parse(json);
      const {EIP712Domain: _d, ...types} = t.types;
      return wallet._signTypedData(t.domain, types, t.message);
    },
    proveRequestAuth: async () => { throw new Error('set by capturingProver'); },
    connect: net.connect,
    nowSeconds: () => NOW,
    randomBytes: n => Uint8Array.from({length: n}, (_, i) => (i * 37 + 11) & 0xff),
    log: () => {},
    ...over,
  };
}

let lastBlinded: {x: bigint; y: bigint} | null = null;

/** The request-auth inputs carry the blinded query only through the proof; capture it from the witness. */
function capturingProver(net: ReturnType<typeof mockNetwork>, d: OprfFlowDeps & {signed: string[]}) {
  d.proveRequestAuth = async (inputs: string[]) => {
    const req = JSON.parse(d.signed[d.signed.length - 1]).message;
    // The witness's beta (last input) and the query give the blinded point.
    const {blindOprfQuery} = jest.requireActual('@zkproofport-app/core');
    const q = oprfQuery({address: wallet.address, domain: reduceOprfName(req.domainName), scope: reduceOprfName(req.scopeName)});
    const a = blindOprfQuery(q, inputs[inputs.length - 1]);
    lastBlinded = {x: BigInt(a.x), y: BigInt(a.y)};
    return {proof: new Uint8Array(REQUEST_AUTH_PROOF_BYTES).fill(7), publicInputs: expectedRequestAuthPublicInputs(req, a)};
  };
  void net;
  return d;
}

const run = (behaviours: NodeBehaviour[], over: Partial<OprfFlowDeps> = {}, args: Partial<Parameters<typeof obtainOprfInputs>[0]> = {}) => {
  const net = mockNetwork(behaviours, {secretKey: MOCK_KEY});
  const d = capturingProver(net, deps(net, over));
  if (over.proveRequestAuth) d.proveRequestAuth = over.proveRequestAuth;
  const p = obtainOprfInputs({circuit: 'coinbase_attestation', environment: 'staging', address: wallet.address, names, ...args}, d);
  return {net, d, p};
};

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (e) {
    return oprfErrorCode(e) ?? `uncoded: ${e instanceof Error ? e.message : String(e)}`;
  }
  return 'resolved';
}

describe('a request the nodes answer', () => {
  it('gives the eleven circuit inputs, the nullifier being the key applied to this wallet\'s query', async () => {
    const {p, net, d} = run(['honest', 'honest', 'honest']);
    const out = await p;
    expect(Object.keys(out).sort()).toEqual([...OPRF_PUBLIC_INPUT_NAMES, 'oprf_public_key_x', 'oprf_public_key_y', 'oprf_beta',
      'oprf_dlog_e', 'oprf_dlog_s', 'oprf_response_x', 'oprf_response_y'].sort());
    expect(out.oprf_key_hash).toBe(mockPinned);
    expect(out.domain).toBe(reduceOprfName(names.domainName));
    expect(out.scope).toBe(reduceOprfName(names.scopeName));
    // P = k * encode(query): the same for every blinding.
    const again = await run(['honest', 'honest', 'down']).p;
    expect(again.nullifier).toBe(out.nullifier);
    expect(again.oprf_beta).not.toBe(out.oprf_beta);
    expect(d.signed).toHaveLength(1);
    expect(net.closed.length).toBeGreaterThanOrEqual(3);
  });

  it('sends the API key and the request-auth fields, a v4 request id, and a deadline inside the node\'s window', async () => {
    const {p, net, d} = run(['honest', 'honest', 'honest']);
    await p;
    const auth = net.requests[0].auth;
    expect(auth.get('api_key')).toBe('taceo_3ZfE55WkcNWRweh5rcfpUNpi');
    expect(auth.get('version')).toBe('request-auth-v1');
    expect(auth.get('domainName')).toBe(names.domainName);
    expect(auth.get('scopeName')).toBe(names.scopeName);
    const deadline = auth.get('deadline') as number;
    expect(deadline).toBe(NOW + OPRF_REQUEST_LIFETIME_SECONDS);
    expect(deadline - NOW).toBeLessThanOrEqual(OPRF_MAX_VALIDITY_SECONDS);
    expect(auth.get('proof')).toMatch(new RegExp(`^0x(07){${REQUEST_AUTH_PROOF_BYTES}}$`));
    expect(net.requests[0].requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(net.requests[0].url).toMatch(/^wss:\/\/node0\.eu\.test\.oprf\.taceo\.network\/api\/basic\/oprf\?version=0\.10\.8&request_id=/);
    expect(isIdentity(net.requests[0].blindedQuery)).toBe(false);
    // The wallet signed the EIP-712 OprfRequest of the TACEO:OPRF domain.
    const typed = JSON.parse(d.signed[0]);
    expect(typed.domain).toEqual({name: 'TACEO:OPRF', version: '1'});
    expect(typed.primaryType).toBe('OprfRequest');
    expect(typed.message).toEqual({statement: 'TACEO:OPRF Request', ...names, deadline});
  });

  it('answers with one node down (2 of 3)', async () => {
    expect(await codeOf(run(['down', 'honest', 'honest']).p)).toBe('resolved');
    expect(await codeOf(run(['honest', 'silent', 'honest']).p)).toBe('resolved');
  });
});

describe('nodes that cannot or will not answer', () => {
  it('two nodes down is E3010', async () => {
    expect(await codeOf(run(['down', 'down', 'honest']).p)).toBe('E3010');
  });

  it('every node silent is E3010 after the round deadline', async () => {
    jest.useFakeTimers({doNotFake: ['setImmediate', 'nextTick']});
    try {
      const {p} = run(['silent', 'silent', 'silent']);
      const code = codeOf(p);
      await jest.advanceTimersByTimeAsync(20_001);
      expect(await code).toBe('E3010');
    } finally {
      jest.useRealTimers();
    }
  });

  it('a refusal from the auth module on every node is E3012, naming the code', async () => {
    const refuse = {refuse: 4506, reason: 'request proof does not verify'};
    const {p} = run([refuse, refuse, refuse]);
    await expect(p).rejects.toThrow(/code 4506/);
    expect(await codeOf(run([refuse, refuse, refuse]).p)).toBe('E3012');
  });

  it('one refusal and two answers still answers', async () => {
    expect(await codeOf(run([{refuse: 4502, reason: 'deadline'}, 'honest', 'honest']).p)).toBe('resolved');
  });
});

describe('answers that do not check out', () => {
  it.each([
    ['a proof share off by one', ['bad-share', 'honest', 'down'] as NodeBehaviour[], 'E2024'],
    ['a node with another key (keys disagree)', ['other-key', 'honest', 'down'] as NodeBehaviour[], 'E2024'],
    ['an off-curve commitment, then too few', ['off-curve', 'honest', 'down'] as NodeBehaviour[], 'E3010'],
    ['a text frame, then too few', ['text-frame', 'honest', 'down'] as NodeBehaviour[], 'E3010'],
    ['another epoch, then too few', ['other-epoch', 'honest', 'down'] as NodeBehaviour[], 'E3010'],
    ['a repeated party id, then too few', ['honest', 'same-party-as-0', 'down'] as NodeBehaviour[], 'E3010'],
  ])('%s -> %s', async (_label, behaviours, code) => {
    expect(await codeOf(run(behaviours).p)).toBe(code);
  });

  it('a consistent answer under a key other than the pinned one is E2024, naming the key hash', async () => {
    const net = mockNetwork(['honest', 'honest', 'honest'], {secretKey: MOCK_KEY + 1n});
    const d = capturingProver(net, deps(net));
    const p = obtainOprfInputs({circuit: 'giwa_attestation', environment: 'staging', address: wallet.address, names}, d);
    await expect(p).rejects.toThrow(/key hash .* not the pinned/);
    expect(await codeOf(obtainOprfInputs({circuit: 'giwa_attestation', environment: 'staging', address: wallet.address, names}, capturingProver(net, deps(net))))).toBe('E2024');
  });
});

describe('the wallet', () => {
  it('refusing to sign is E4002, and nothing is sent', async () => {
    const {p, net} = run(['honest', 'honest', 'honest'], {signTypedData: async () => { throw {code: 4001, message: 'User rejected'}; }});
    expect(await codeOf(p)).toBe('E4002');
    expect(net.requests).toHaveLength(0);
  });

  it.each([
    ['an empty answer', ''],
    ['a short signature', '0x1234'],
    ['a non-string', 42 as unknown as string],
  ])('returning %s is E4002', async (_l, sig) => {
    expect(await codeOf(run(['honest', 'honest', 'honest'], {signTypedData: async () => sig}).p)).toBe('E4002');
  });

  it('a signature from another wallet is E4002 naming both', async () => {
    const other = ethers.Wallet.createRandom();
    const {p} = run(['honest', 'honest', 'honest'], {signTypedData: async json => {
      const t = JSON.parse(json);
      const {EIP712Domain: _d, ...types} = t.types;
      return other._signTypedData(t.domain, types, t.message);
    }});
    await expect(p).rejects.toThrow(new RegExp(`signed by ${other.address}`));
  });
});

describe('time, environment, randomness', () => {
  it('a request whose deadline lapsed while proving is not sent (E3004)', async () => {
    let t = NOW;
    const net = mockNetwork(['honest', 'honest', 'honest'], {secretKey: MOCK_KEY});
    const d = capturingProver(net, deps(net, {nowSeconds: () => t}));
    const prove = d.proveRequestAuth;
    d.proveRequestAuth = async inputs => {
      const out = await prove(inputs);
      t = NOW + OPRF_REQUEST_LIFETIME_SECONDS - 29;
      return out;
    };
    expect(await codeOf(obtainOprfInputs({circuit: 'coinbase_attestation', environment: 'staging', address: wallet.address, names}, d))).toBe('E3004');
    expect(net.requests).toHaveLength(0);
  });

  it('production is refused (E3011) before the wallet is asked', async () => {
    const {p, d, net} = run(['honest', 'honest', 'honest'], {}, {environment: 'production'});
    expect(await codeOf(p)).toBe('E3011');
    expect(d.signed).toHaveLength(0);
    expect(net.requests).toHaveLength(0);
  });

  it.each(['prod', '', 'Staging', undefined as unknown as string])('an unknown environment %p is an error naming it, never another row', async env => {
    const {p, d} = run(['honest', 'honest', 'honest'], {}, {environment: env});
    await expect(p).rejects.toThrow(/Unknown environment/);
    expect(d.signed).toHaveLength(0);
  });

  it.each(['oidc_domain_attestation', 'coinbase-kyc', ''])('a circuit without an OPRF nullifier (%p) is E2001', async circuit => {
    expect(await codeOf(run(['honest', 'honest', 'honest'], {}, {circuit}).p)).toBe('E2001');
  });

  it('no secure random source is E2001, never a weaker one', async () => {
    const saved = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', {value: undefined, configurable: true});
    try {
      const {p, d} = run(['honest', 'honest', 'honest']);
      await expect(p).rejects.toThrow(/secure random/);
      expect(d.signed).toHaveLength(0);
    } finally {
      if (saved) Object.defineProperty(globalThis, 'crypto', saved);
    }
  });

  it('a request proof whose public inputs differ from what the verifier rebuilds is E2001, not sent', async () => {
    const {p, net} = run(['honest', 'honest', 'honest'], {proveRequestAuth: async () => ({
      proof: new Uint8Array(REQUEST_AUTH_PROOF_BYTES), publicInputs: new Array(36).fill('0x01'),
    })});
    expect(await codeOf(p)).toBe('E2001');
    expect(net.requests).toHaveLength(0);
  });

  it('a request proof of the wrong length is E2001', async () => {
    const {p} = run(['honest', 'honest', 'honest'], {proveRequestAuth: async () => ({proof: new Uint8Array(9151), publicInputs: []})});
    expect(await codeOf(p)).toBe('E2001');
  });

  it('a malformed wallet address is E4001', async () => {
    expect(await codeOf(run(['honest', 'honest', 'honest'], {}, {address: '0x1234'}).p)).toBe('E4001');
  });
});

describe('the transport names the failure itself (not only the final check)', () => {
  const {runDistributedOprf, OprfTransportError: TE} = jest.requireActual('../transport');
  const blinded = scalarMul(GENERATOR, 987654321n);
  const go = (behaviours: NodeBehaviour[]) => {
    const net = mockNetwork(behaviours, {secretKey: MOCK_KEY});
    return runDistributedOprf({
      nodes: ['https://node0.mock', 'https://node1.mock', 'https://node2.mock'], threshold: 2, module: 'basic', clientVersion: '0.10.8',
      requestId: '6f1d3c2a-8b47-4e0f-9a51-0c2d7e9b4f10', blindedQuery: blinded, auth: {api_key: 'k'}, connect: net.connect, roundTimeoutMs: 5000,
    });
  };
  it('a bad proof share is refused by the transport as bad-proof', async () => {
    const err = await go(['bad-share', 'honest', 'down']).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TE);
    expect((err as {kind: string}).kind).toBe('bad-proof');
  });
  it('nodes naming different keys are refused as inconsistent-keys, before round 2', async () => {
    const err = await go(['other-key', 'honest', 'down']).catch((e: unknown) => e);
    expect((err as {kind: string}).kind).toBe('inconsistent-keys');
  });
  it('an honest answer is k times the blinded query', async () => {
    const ans = await go(['honest', 'down', 'honest']);
    expect(ans.blindedResponse).toEqual(scalarMul(blinded, MOCK_KEY));
    expect(ans.partyIds).toEqual([0, 2]);
  });
  it.each([[0, 3], [4, 3]])('a threshold of %i over %i nodes is refused', async (threshold) => {
    const net = mockNetwork(['honest', 'honest', 'honest'], {secretKey: MOCK_KEY});
    await expect(runDistributedOprf({nodes: ['https://node0.mock', 'https://node1.mock', 'https://node2.mock'], threshold, module: 'basic', clientVersion: 'v',
      requestId: '6f1d3c2a-8b47-4e0f-9a51-0c2d7e9b4f10', blindedQuery: blinded, auth: {}, connect: net.connect, roundTimeoutMs: 5000})).rejects.toThrow(/threshold/);
  });
  it('a repeated node URL and the identity as blinded query are refused before anything is sent', async () => {
    const net = mockNetwork(['honest', 'honest', 'honest'], {secretKey: MOCK_KEY});
    const base = {threshold: 2, module: 'basic', clientVersion: 'v', requestId: '6f1d3c2a-8b47-4e0f-9a51-0c2d7e9b4f10', auth: {}, connect: net.connect, roundTimeoutMs: 5000};
    await expect(runDistributedOprf({...base, nodes: ['https://node0.mock', 'https://node0.mock'], blindedQuery: blinded})).rejects.toThrow(/repeats/);
    await expect(runDistributedOprf({...base, nodes: ['https://node0.mock', 'https://node1.mock'], blindedQuery: {x: 0n, y: 1n}})).rejects.toThrow(/identity/);
    expect(net.requests).toHaveLength(0);
  });
});
