/**
 * The GIWA attestation lookup, with the network stubbed.
 *
 * WHAT THIS IS FOR. The lookup shipped a defect that no test would have caught
 * because there was no test: it searched a fixed 3M blocks back from the head,
 * so the one attestation that existed — 9.7M blocks back — read as "this wallet
 * has none". The failure was invisible from inside (a clean `null`), it got
 * worse every day as GIWA produced blocks, and it was found by a person
 * watching a screen say "no attestation" for a wallet they had just registered.
 *
 * So the cases below are mostly about the difference between "no" and "could
 * not tell". Every one of them stubs `fetch`, because a test that needs GIWA
 * Sepolia to be up is a test that goes red for reasons that are not defects.
 */

const EAS_CONTRACT = '0x4200000000000000000000000000000000000021';
const ATTESTED_TOPIC =
  '0x8bf46bf4cfd674fa735a3d63ec1c9ad4153f033c290341f3a588b75685141b35';
const SCHEMA_UID =
  '0xbda8dd64efa4c537514cfe4c96ab5d5f14a8ec0c9105b799b47a010e89c0c72d';
const ATTESTER = '0x6646d970499BBeD728636823A5A7e551E811b414';

/** The wallet that really is attested on GIWA Sepolia, 9.7M blocks back. */
const ATTESTED_WALLET = '0x5a3e649208ae15ec52496c1ae23b2ff89ac02f0c';
const UNKNOWN_WALLET = '0x000000000000000000000000000000000000dead';

const pad = (v: string) =>
  '0x' + v.replace(/^0x/, '').toLowerCase().padStart(64, '0');

/** An `attestAccount(address)` call, the shape the explorer returns it in. */
const attestCall = (wallet: string, block: number, hash: string) => ({
  hash,
  blockNumber: String(block),
  isError: '0',
  input: '0x56feed5e' + pad(wallet).slice(2),
});

const receiptFor = (wallet: string, hash: string, block: number) => ({
  blockHash: '0x' + 'bb'.repeat(32),
  blockNumber: '0x' + block.toString(16),
  logs: [
    {
      address: EAS_CONTRACT,
      blockHash: '0x' + 'bb'.repeat(32),
      blockNumber: '0x' + block.toString(16),
      data: '0x' + 'cc'.repeat(32),
      logIndex: '0x0',
      topics: [ATTESTED_TOPIC, pad(wallet), pad(ATTESTER), pad(SCHEMA_UID)],
      transactionHash: hash,
    },
  ],
});

/**
 * Stubs the two calls the fast path makes and records what was asked.
 *
 * `easLogs` is what the WIDER search would answer. Several cases assert it was
 * never reached — that is the whole point of separating "none" from "could not
 * tell", and a stub that answered both paths identically could not show it.
 */
function stubNetwork(opts: {
  txPages: unknown[][];
  receipts?: Record<string, unknown>;
  easLogs?: unknown[];
}) {
  const asked = {txListPages: 0, receipts: 0, easSearches: 0, rpcWalks: 0};

  global.fetch = jest.fn(async (url: unknown, init?: unknown) => {
    const href = String(url);

    // The JSON-RPC endpoint takes everything as a POST body.
    const body = (init as {body?: string} | undefined)?.body;
    if (body) {
      const {method, params} = JSON.parse(body);
      if (method === 'eth_getTransactionReceipt') {
        asked.receipts++;
        return json({result: opts.receipts?.[String(params[0])] ?? null});
      }
      if (method === 'eth_blockNumber') return json({result: '0x2000000'});
      if (method === 'eth_getLogs') {
        asked.rpcWalks++;
        return json({result: []});
      }
      return json({result: null});
    }

    if (href.includes('action=txlist')) {
      const page = Number(new URL(href).searchParams.get('page') ?? '1');
      asked.txListPages++;
      return json({status: '1', result: opts.txPages[page - 1] ?? []});
    }
    if (href.includes('action=getLogs')) {
      asked.easSearches++;
      return json({status: '1', result: opts.easLogs ?? []});
    }
    return json({result: []});
  }) as unknown as typeof fetch;

  return asked;
}

const json = (payload: unknown) =>
  ({ok: true, status: 200, json: async () => payload}) as Response;

describe('GIWA attestation lookup', () => {
  let search: typeof import('../giwaAttestationSearch');
  const realFetch = global.fetch;

  beforeEach(() => {
    jest.resetModules();
    search = require('../giwaAttestationSearch');
  });

  afterEach(() => {
    global.fetch = realFetch;
  });

  it('finds the attestation from the attester call, without the wide search', async () => {
    const hash = '0x' + 'a1'.repeat(32);
    const asked = stubNetwork({
      txPages: [[attestCall(ATTESTED_WALLET, 25424198, hash)]],
      receipts: {[hash]: receiptFor(ATTESTED_WALLET, hash, 25424198)},
    });

    const found = await search.findAttestationLog(SCHEMA_UID, ATTESTED_WALLET, () => {});

    expect(found).not.toBeNull();
    expect(found!.transaction_hash).toBe(hash);
    expect(found!.block_number).toBe(25424198);
    expect(asked.receipts).toBe(1);
    // The wide search costs 26 seconds and was not needed.
    expect(asked.easSearches).toBe(0);
    expect(asked.rpcWalks).toBe(0);
  });

  it('a wallet the attester never registered is answered NO, not searched for 26 seconds', async () => {
    // A short page means the whole history was read, so "not in it" is a real
    // answer. This is the case that makes the fast path worth having: it is the
    // common one, and before this change every miss paid the full wide search.
    const asked = stubNetwork({
      txPages: [[attestCall(ATTESTED_WALLET, 25424198, '0x' + 'a1'.repeat(32))]],
      easLogs: [],
    });

    const found = await search.findAttestationLog(SCHEMA_UID, UNKNOWN_WALLET, () => {});

    expect(found).toBeNull();
    expect(asked.easSearches).toBe(0);
    expect(asked.rpcWalks).toBe(0);
  });

  it('a search that stopped early does NOT answer no — it widens', async () => {
    // Ten full pages and no match: the history was not read to its end, so the
    // only honest state is "could not tell". Answering `null` here is precisely
    // the shipped defect, in a new place.
    const fullPage = Array.from({length: 100}, (_, i) =>
      attestCall(ATTESTED_WALLET, 100 + i, '0x' + i.toString(16).padStart(64, '0')),
    );
    const asked = stubNetwork({
      txPages: Array.from({length: 10}, () => fullPage),
      easLogs: [],
    });

    await search.findAttestationLog(SCHEMA_UID, UNKNOWN_WALLET, () => {});

    expect(asked.txListPages).toBe(10);
    expect(asked.easSearches).toBe(1);
  });

  it('says so in the log when it stops early, instead of going quiet', async () => {
    const fullPage = Array.from({length: 100}, (_, i) =>
      attestCall(ATTESTED_WALLET, 100 + i, '0x' + i.toString(16).padStart(64, '0')),
    );
    stubNetwork({txPages: Array.from({length: 10}, () => fullPage), easLogs: []});

    const lines: string[] = [];
    await search.findAttestationLog(SCHEMA_UID, UNKNOWN_WALLET, m => lines.push(m));

    expect(lines.join('\n')).toMatch(/cap without a match/);
    expect(lines.join('\n')).toMatch(/NOT concluding/);
  });

  it('an explorer outage widens instead of reporting no attestation', async () => {
    const asked = {easSearches: 0};
    global.fetch = jest.fn(async (url: unknown, init?: unknown) => {
      const body = (init as {body?: string} | undefined)?.body;
      if (body) return json({result: JSON.parse(body).method === 'eth_blockNumber' ? '0x10' : []});
      if (String(url).includes('action=txlist')) {
        return {ok: false, status: 503, json: async () => ({})} as Response;
      }
      asked.easSearches++;
      return json({status: '1', result: []});
    }) as unknown as typeof fetch;

    const found = await search.findAttestationLog(SCHEMA_UID, UNKNOWN_WALLET, () => {});

    expect(found).toBeNull();
    expect(asked.easSearches).toBe(1);
  });

  it('ignores a reverted attest call', async () => {
    // A failed transaction is in the list and its input looks identical. Its
    // receipt carries no Attested log, so treating it as a hit would turn a
    // clean answer into a confusing one.
    const hash = '0x' + 'ff'.repeat(32);
    const reverted = {...attestCall(UNKNOWN_WALLET, 500, hash), isError: '1'};
    const asked = stubNetwork({txPages: [[reverted]], easLogs: []});

    const found = await search.findAttestationLog(SCHEMA_UID, UNKNOWN_WALLET, () => {});

    expect(found).toBeNull();
    expect(asked.receipts).toBe(0);
  });

  it('matches the wallet case-insensitively', async () => {
    // The explorer returns call data lowercased; a wallet arrives from the
    // connect step checksummed. A case-sensitive compare would miss every time
    // and look exactly like "no attestation".
    const hash = '0x' + 'b2'.repeat(32);
    stubNetwork({
      txPages: [[attestCall(ATTESTED_WALLET, 25424198, hash)]],
      receipts: {[hash]: receiptFor(ATTESTED_WALLET, hash, 25424198)},
    });

    const checksummed = '0x5A3E649208ae15EC52496c1AE23b2Ff89aC02f0c';
    const found = await search.findAttestationLog(SCHEMA_UID, checksummed, () => {});

    expect(found).not.toBeNull();
  });

  it('a call on a different schema widens rather than answering no', async () => {
    // The receipt has an Attested log, but for another schema UID. Our schema
    // could have been rotated, so the wider search still gets its turn.
    const hash = '0x' + 'c3'.repeat(32);
    const otherSchema = receiptFor(ATTESTED_WALLET, hash, 25424198);
    otherSchema.logs[0].topics[3] = pad('0x' + '99'.repeat(32));
    const asked = stubNetwork({
      txPages: [[attestCall(ATTESTED_WALLET, 25424198, hash)]],
      receipts: {[hash]: otherSchema},
      easLogs: [],
    });

    const found = await search.findAttestationLog(SCHEMA_UID, ATTESTED_WALLET, () => {});

    expect(found).toBeNull();
    expect(asked.easSearches).toBe(1);
  });
});
