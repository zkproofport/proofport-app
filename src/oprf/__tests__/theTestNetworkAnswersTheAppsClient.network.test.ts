/**
 * OPT-IN (network): the app's own flow (src/oprf/flow.ts, transport.ts over
 * the runtime's WebSocket, the staging row of src/oprf/config.ts) against the
 * public OPRF test network. Run with:
 *
 *   OPRF_NETWORK_TEST=1 npx jest src/oprf/__tests__/theTestNetworkAnswersTheAppsClient.network.test.ts
 *
 * Skipped otherwise, so the default suite stays offline. What it proves: the
 * nodes accept the app's CBOR request (with the request-auth fields beside the
 * API key), answer both rounds, the app's Shamir combination verifies, and the
 * key is the one pinned for staging. What it does not: that a node checks the
 * request proof -- the test network's `basic` module does not, so the proof
 * here is a placeholder of the right length and public inputs (the real one is
 * proved on the phone from circuits/oprf-request-auth).
 */
import {ethers} from 'ethers';
import {webcrypto} from 'crypto';
import {obtainOprfInputs, oprfErrorCode} from '../flow';
import {runDistributedOprf, webSocketConnector} from '../transport';
import {TACEO_TESTNET_OPRF_KEY_HASH as TEST_NETWORK_OPRF_KEY_HASH} from '@zkproofport-app/core';
import {OPRF_TEST_NETWORK} from '../config';
import {expectedRequestAuthPublicInputs, REQUEST_AUTH_PROOF_BYTES} from '../requestAuth';
import {blindOprfQuery, oprfQuery, reduceOprfName} from '@zkproofport-app/core';

const run = process.env.OPRF_NETWORK_TEST === '1';
(run ? describe : describe.skip)('the public test network (OPRF_NETWORK_TEST=1)', () => {
  jest.setTimeout(120_000);
  const wallet = ethers.Wallet.createRandom();
  const names = {domainName: 'zkproofport.app', scopeName: `app-network-test 한국어 🔐 ${Date.now()}`};

  const flow = (signer = wallet) => {
    let lastBeta = '';
    return obtainOprfInputs(
      {circuit: 'coinbase_attestation', environment: 'staging', address: wallet.address, names},
      {
        signTypedData: async json => {
          const t = JSON.parse(json);
          const {EIP712Domain: _d, ...types} = t.types;
          return signer._signTypedData(t.domain, types, t.message);
        },
        proveRequestAuth: async inputs => {
          lastBeta = inputs[inputs.length - 1];
          const q = oprfQuery({address: wallet.address, domain: reduceOprfName(names.domainName), scope: reduceOprfName(names.scopeName)});
          const a = blindOprfQuery(q, lastBeta);
          const digestBytes = inputs.slice(0, 32);
          const pub = [...digestBytes.map(b => '0x' + BigInt(b).toString(16).padStart(64, '0')),
            ...expectedRequestAuthPublicInputs({...names, deadline: 0}, a).slice(32)];
          return {proof: new Uint8Array(REQUEST_AUTH_PROOF_BYTES), publicInputs: pub};
        },
        connect: webSocketConnector((globalThis as unknown as {WebSocket: Parameters<typeof webSocketConnector>[0]}).WebSocket),
        nowSeconds: () => Math.floor(Date.now() / 1000),
        randomBytes: n => webcrypto.getRandomValues(new Uint8Array(n)),
        log: m => console.log(m),
      },
    );
  };

  it('answers the app\'s request under the pinned staging key, and the same wallet gets the same nullifier twice', async () => {
    const a = await flow();
    const b = await flow();
    expect(a.oprf_key_hash).toBe(TEST_NETWORK_OPRF_KEY_HASH);
    expect(a.nullifier).toBe(b.nullifier);
    expect(a.oprf_beta).not.toBe(b.oprf_beta);
    console.log(`[network] nullifier ${a.nullifier} for a random wallet, key hash ${a.oprf_key_hash}`);
  });

  it('refuses a wrong API key with every node\'s auth code (E3012)', async () => {
    const q = oprfQuery({address: wallet.address, domain: reduceOprfName(names.domainName), scope: reduceOprfName(names.scopeName)});
    const a = blindOprfQuery(q, '0x' + '01'.padStart(64, '0'));
    let code: string | undefined;
    try {
      await runDistributedOprf({
        nodes: OPRF_TEST_NETWORK.nodes, threshold: OPRF_TEST_NETWORK.threshold, module: OPRF_TEST_NETWORK.module,
        clientVersion: OPRF_TEST_NETWORK.clientVersion, requestId: '6f1d3c2a-8b47-4e0f-9a51-0c2d7e9b4f10',
        blindedQuery: {x: BigInt(a.x), y: BigInt(a.y)}, auth: {api_key: 'not-a-key'},
        connect: webSocketConnector((globalThis as unknown as {WebSocket: Parameters<typeof webSocketConnector>[0]}).WebSocket),
        roundTimeoutMs: OPRF_TEST_NETWORK.roundTimeoutMs,
      });
    } catch (e) {
      code = oprfErrorCode(e);
      console.log(`[network] ${String(e)}`);
    }
    expect(code).toBe('E3012');
  });
});
