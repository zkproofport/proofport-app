/**
 * A revoked Coinbase verification must not be proved.
 *
 * Coinbase revokes a Verified Account by setting revocationTime on the EAS
 * record. The original attestAccount transaction stays on chain and still
 * satisfies the circuit, so the only thing standing between a revoked user
 * and a valid proof in this app is which attestation the search returns.
 * Until 2026-10-23 it returned the newest one, revoked or not.
 */
import {searchAttestations, findAttestationTransaction, SELECTOR_ATTEST_ACCOUNT} from '../attestationSearch';

const WALLET = '0x75cdcce0aa0c4a2b1b2c6e2c1b6a0c9b0e1d833f';

type Row = {id: string; txid: string; revoked?: boolean};

function easAnswers(rows: Row[]) {
  const fetchMock = jest.fn(async (url: string, init?: {body?: string}) => {
    const body = JSON.parse(init?.body ?? '{}');
    if (body.query) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            attestations: rows.map(r => ({
              id: r.id, txid: r.txid, attester: '0x357458739f90461b99789350868cd7cf330dd7ee',
              recipient: WALLET, time: 1758043299,
              ...(r.revoked === undefined ? {} : {revoked: r.revoked}),
            })),
          },
        }),
      };
    }
    // eth_getTransactionByHash: answer "not found" so no candidate validates.
    return {ok: true, status: 200, json: async () => ({jsonrpc: '2.0', id: 1, result: null})};
  });
  (global as any).fetch = fetchMock;
  return fetchMock;
}

const quiet = () => {};

afterEach(() => {
  delete (global as any).fetch;
});

describe('the EAS search leaves revoked attestations out', () => {
  it('asks the indexer for unrevoked attestations only, and for the revoked flag', async () => {
    const fetchMock = easAnswers([]);
    await searchAttestations(WALLET, quiet);
    const {query} = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(query).toMatch(/revoked:\s*\{\s*equals:\s*false\s*\}/);
    expect(query).toMatch(/\n\s*revoked\n/);
  });

  it('drops a revoked row even if the indexer returns one', async () => {
    easAnswers([
      {id: '0xrevoked', txid: '0xaaa', revoked: true},
      {id: '0xlive', txid: '0xbbb', revoked: false},
    ]);
    const found = await searchAttestations(WALLET, quiet);
    expect(found.map(a => a.id)).toEqual(['0xlive']);
  });

  it('drops a row that does not say whether it is revoked', async () => {
    easAnswers([{id: '0xunknown', txid: '0xccc'}]);
    await expect(searchAttestations(WALLET, quiet)).resolves.toEqual([]);
  });

  it('finds nothing to prove when every attestation is revoked, without fetching a transaction', async () => {
    const fetchMock = easAnswers([
      {id: '0xold', txid: '0xddd', revoked: true},
      {id: '0xolder', txid: '0xeee', revoked: true},
    ]);
    await expect(findAttestationTransaction(`${WALLET}-all-revoked`, quiet, SELECTOR_ATTEST_ACCOUNT)).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fetches only the unrevoked transaction when revoked and live attestations are mixed', async () => {
    const fetchMock = easAnswers([
      {id: '0xrevoked', txid: '0xfff', revoked: true},
      {id: '0xlive', txid: '0x111', revoked: false},
    ]);
    await findAttestationTransaction(`${WALLET}-mixed`, quiet, SELECTOR_ATTEST_ACCOUNT);
    const txLookups = fetchMock.mock.calls
      .map(([, init]) => JSON.parse(init.body))
      .filter(b => b.method === 'eth_getTransactionByHash')
      .map(b => b.params[0]);
    expect(txLookups.length).toBeGreaterThan(0);
    expect(new Set(txLookups)).toEqual(new Set(['0x111']));
  });
});
