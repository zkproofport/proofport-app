/**
 * Dojang Playground: the issuance lookup and the input builder.
 *
 * The fixture is written by `scripts/make-dojang-playground-fixtures.py` from
 * the circuits repository's own Prover.toml files -- the output of
 * `generate-prover-toml.js` for the fixture wallet's two real issuances -- and
 * the GIWA Sepolia RPC's answers for those two transactions. So "the inputs
 * match" below means "match what the circuit was proven with", not "match
 * what this file computed last time".
 *
 * Every network call is stubbed: a test that needs GIWA Sepolia up goes red
 * for reasons that are not defects.
 */
jest.mock('react-native', () => ({NativeModules: {}}));

import {ethers} from 'ethers';
import fixture from './fixtures/dojangPlayground.json';
import {
  DOJANG_PLAYGROUND_FAUCET,
  DojangIssuanceError,
  checkDojangIssuanceTx,
  findDojangPlaygroundIssuance,
  flattenDojangPlaygroundInputs,
  prepareDojangPlaygroundInputs,
  rawTransactionFromRpc,
  type ExplorerTxRow,
  type RpcTransaction,
} from '../dojangPlayground';

const WALLET = '0x5A3E649208Ae15ec52496c1Ae23b2Ff89Ac02f0c';
const OTHER_WALLET = '0x1111111111111111111111111111111111111234';
const LEGACY = fixture.recorded.legacy;
const EIP1559 = fixture.recorded.eip1559;
const LEGACY_TX = LEGACY.rpcTransaction as RpcTransaction;
const EIP1559_TX = EIP1559.rpcTransaction as RpcTransaction;

const bytes = (hex: string) => Array.from(ethers.utils.arrayify(hex)).map(b => '0x' + b.toString(16).padStart(2, '0'));
const noLog = () => {};

describe('the recorded issuances re-serialize to the bytes the chain hashed', () => {
  it.each([
    ['legacy (type 0)', LEGACY_TX, LEGACY.expected],
    ['EIP-1559 (type 2)', EIP1559_TX, EIP1559.expected],
  ])('%s matches generate-prover-toml.js', (_label, tx, expected) => {
    const {raw} = rawTransactionFromRpc(tx);
    expect(raw).toBe(expected.raw);
    expect(ethers.utils.hexDataLength(raw)).toBe(expected.tx_length);
    expect(ethers.utils.keccak256(raw)).toBe(tx.hash);
    expect(checkDojangIssuanceTx(raw, WALLET)).toEqual({txType: Number.parseInt(tx.type, 16)});
  });

  it('refuses bytes that do not hash back to the hash the RPC gave', () => {
    expect(() => rawTransactionFromRpc({...EIP1559_TX, nonce: '0xf'})).toThrow(/hashes to .*not the chain's/);
  });

  it('refuses a type-1 transaction before serializing it', () => {
    expect(() => rawTransactionFromRpc({...EIP1559_TX, type: '0x1'})).toThrow(/type 0x1/);
  });

  it('refuses a legacy transaction whose v carries no chain id (pre-EIP-155)', () => {
    expect(() => rawTransactionFromRpc({...LEGACY_TX, v: '0x1b'})).toThrow(/EIP-155/);
  });

  it('refuses a legacy transaction whose v names another chain', () => {
    expect(() => rawTransactionFromRpc({...LEGACY_TX, v: ethers.BigNumber.from(84532 * 2 + 35).toHexString()})).toThrow(/EIP-155/);
  });

  it('keeps an r or s with a leading zero byte, as the chain encodes it', () => {
    const raw = fixture.shortScalar.raw;
    const tx = ethers.utils.parseTransaction(raw);
    const r = ethers.utils.hexStripZeros(tx.r!);
    const s = ethers.utils.hexStripZeros(tx.s!);
    // The fixture really is the short-scalar case.
    expect(r.length < 66 || s.length < 66).toBe(true);
    const parity = ethers.utils.splitSignature({r: tx.r!, s: tx.s!, v: tx.v!}).recoveryParam;
    const rpcShape: RpcTransaction = {
      hash: ethers.utils.keccak256(raw),
      type: '0x2',
      chainId: '0x164ce',
      nonce: ethers.BigNumber.from(tx.nonce).toHexString(),
      gas: tx.gasLimit.toHexString(),
      maxFeePerGas: tx.maxFeePerGas!.toHexString(),
      maxPriorityFeePerGas: tx.maxPriorityFeePerGas!.toHexString(),
      accessList: [],
      to: tx.to!,
      value: tx.value.toHexString(),
      input: tx.data,
      v: '0x' + parity.toString(16),
      yParity: '0x' + parity.toString(16),
      r,
      s,
    };
    expect(rawTransactionFromRpc(rpcShape).raw).toBe(raw);
    expect(checkDojangIssuanceTx(raw, fixture.shortScalar.user_address)).toEqual({txType: 2});
  });
});

describe('the circuit\'s refusals are refused here first', () => {
  it.each([
    ['tx_wrong_contract', /not the Playground faucet/],
    ['tx_wrong_selector', /not a bare payAndIssueEAS/],
    ['tx_extra_calldata', /not a bare payAndIssueEAS/],
    ['tx_wrong_chain', /chain 84532/],
    ['tx_no_chain', /chain 0/],
    ['tx_type_1', /type 1 is not accepted/],
    ['tx_other_signer', /not by the connected wallet/],
  ] as const)('%s', (name, reason) => {
    const raw = (fixture.refused as Record<string, string>)[name];
    expect(() => checkDojangIssuanceTx(raw, WALLET)).toThrow(reason);
  });

  it('refuses a real issuance when the connected wallet is another one', () => {
    expect(() => checkDojangIssuanceTx(EIP1559.expected.raw, OTHER_WALLET)).toThrow(/not by the connected wallet/);
  });

  it('refuses a transaction longer than the circuit\'s 300 bytes before parsing it', () => {
    const wallet = ethers.Wallet.createRandom();
    const unsigned = {
      type: 2, chainId: 91342, nonce: 1, gasLimit: 1, maxFeePerGas: 1, maxPriorityFeePerGas: 1,
      to: DOJANG_PLAYGROUND_FAUCET, value: 0, data: '0xb19e5904' + '00'.repeat(260),
    };
    const sig = wallet._signingKey().signDigest(ethers.utils.keccak256(ethers.utils.serializeTransaction(unsigned)));
    const raw = ethers.utils.serializeTransaction(unsigned, sig);
    expect(ethers.utils.hexDataLength(raw)).toBeGreaterThan(300);
    expect(() => checkDojangIssuanceTx(raw, wallet.address)).toThrow(/takes at most 300/);
  });
});

/** The full signature string for the TOML's r||s, with the v that recovers its pubkey. */
function signatureFor(expected: typeof LEGACY.expected, digest: string): {signature: string; pubkey: string} {
  const pubkey = '0x04' + expected.user_pubkey_x.slice(2) + expected.user_pubkey_y.slice(2);
  for (const v of [27, 28]) {
    const signature = ethers.utils.joinSignature({
      r: '0x' + expected.user_signature.slice(2, 66),
      s: '0x' + expected.user_signature.slice(66, 130),
      v,
    });
    if (ethers.utils.recoverPublicKey(digest, signature) === pubkey) return {signature, pubkey};
  }
  throw new Error('the fixture signature recovers to neither parity');
}

describe('the inputs equal what generate-prover-toml.js wrote', () => {
  it('EIP-1559 issuance, signal-hash mode (Prover.no-action.toml)', () => {
    const e = EIP1559.expected;
    const {signature, pubkey} = signatureFor(e, ethers.utils.hashMessage(ethers.utils.arrayify(e.signal_hash)));
    const inputs = prepareDojangPlaygroundInputs({
      signalHash: ethers.utils.arrayify(e.signal_hash),
      userAddress: WALLET,
      userSignature: signature,
      userPubkey: pubkey,
      rawTransaction: rawTransactionFromRpc(EIP1559_TX).raw,
      scopeString: 'dojang-playground-scope',
    });
    for (const field of ['signal_hash', 'domain_separator', 'action_hash', 'scope', 'nullifier', 'user_address',
      'user_signature', 'user_pubkey_x', 'user_pubkey_y', 'raw_transaction'] as const) {
      expect([field, inputs[field]]).toEqual([field, bytes(e[field])]);
    }
    expect(inputs.tx_length).toBe(String(e.tx_length));
  });

  it('legacy issuance, EIP-712 action mode (Prover.toml)', () => {
    const e = LEGACY.expected;
    const digest = ethers.utils.keccak256(ethers.utils.concat(['0x1901', e.domain_separator, e.action_hash]));
    const {signature, pubkey} = signatureFor(e, digest);
    const inputs = prepareDojangPlaygroundInputs({
      // Whatever arrives here, action mode sends zeros: the circuit asserts it.
      signalHash: ethers.utils.arrayify('0x' + 'ab'.repeat(32)),
      userAddress: WALLET,
      userSignature: signature,
      userPubkey: pubkey,
      rawTransaction: rawTransactionFromRpc(LEGACY_TX).raw,
      scopeString: 'dojang-playground-scope',
      action: {domainSeparator: e.domain_separator, actionHash: e.action_hash},
    });
    for (const field of ['signal_hash', 'domain_separator', 'action_hash', 'scope', 'nullifier', 'user_address',
      'user_signature', 'user_pubkey_x', 'user_pubkey_y', 'raw_transaction'] as const) {
      expect([field, inputs[field]]).toEqual([field, bytes(e[field])]);
    }
    expect(inputs.tx_length).toBe(String(e.tx_length));
  });

  it('flattens in fn main order: 160 public fields, then 20 + 64 + 32 + 32 + 300 + 1', () => {
    const e = EIP1559.expected;
    const {signature, pubkey} = signatureFor(e, ethers.utils.hashMessage(ethers.utils.arrayify(e.signal_hash)));
    const flat = flattenDojangPlaygroundInputs(prepareDojangPlaygroundInputs({
      signalHash: ethers.utils.arrayify(e.signal_hash), userAddress: WALLET, userSignature: signature,
      userPubkey: pubkey, rawTransaction: e.raw, scopeString: 'dojang-playground-scope',
    }));
    expect(flat).toHaveLength(609);
    const order = ['signal_hash', 'domain_separator', 'action_hash', 'scope', 'nullifier', 'user_address',
      'user_signature', 'user_pubkey_x', 'user_pubkey_y', 'raw_transaction'] as const;
    expect(flat.slice(0, 608)).toEqual(order.flatMap(f => bytes(e[f])));
    expect(flat[608]).toBe(String(e.tx_length));
  });

  it('takes exactly 300 bytes and refuses 301', () => {
    const base = {signalHash: new Uint8Array(32), userAddress: WALLET, userSignature: '0x' + '11'.repeat(64) + '1b',
      userPubkey: '0x04' + '22'.repeat(64), scopeString: 's'};
    const at300 = prepareDojangPlaygroundInputs({...base, rawTransaction: '0x' + 'aa'.repeat(300)});
    expect(at300.tx_length).toBe('300');
    expect(at300.raw_transaction.every(b => b === '0xaa')).toBe(true);
    expect(() => prepareDojangPlaygroundInputs({...base, rawTransaction: '0x' + 'aa'.repeat(301)})).toThrow(/at most 300/);
  });

  it('the nullifier is per wallet and scope, not per signal', () => {
    const base = {userAddress: WALLET, userSignature: '0x' + '11'.repeat(64) + '1b', userPubkey: '0x04' + '22'.repeat(64),
      rawTransaction: EIP1559.expected.raw, scopeString: 'dojang-playground-scope'};
    const a = prepareDojangPlaygroundInputs({...base, signalHash: new Uint8Array(32).fill(1)});
    const b = prepareDojangPlaygroundInputs({...base, signalHash: new Uint8Array(32).fill(2)});
    const c = prepareDojangPlaygroundInputs({...base, signalHash: new Uint8Array(32).fill(1), scopeString: 'other'});
    expect(a.nullifier).toEqual(b.nullifier);
    expect(a.nullifier).not.toEqual(c.nullifier);
  });
});

// ---------------------------------------------------------------- the lookup

const row = (over: Partial<ExplorerTxRow>): ExplorerTxRow => ({
  hash: '0x' + '00'.repeat(32), from: WALLET.toLowerCase(), to: DOJANG_PLAYGROUND_FAUCET.toLowerCase(),
  input: '0xb19e5904', isError: '0', txreceipt_status: '1', blockNumber: '1', transactionIndex: '0', ...over,
});
const LEGACY_ROW = row({hash: LEGACY_TX.hash, blockNumber: '38562326', transactionIndex: '12'});
const EIP1559_ROW = row({hash: EIP1559_TX.hash, blockNumber: '38562330', transactionIndex: '27'});
const DEPLOY_ROW = row({hash: '0x' + 'de'.repeat(32), to: '', input: '0x60e06040', blockNumber: '38596625'});

interface Stub {
  pages?: unknown[];          // explorer JSON per page, in order
  explorer?: 'down' | number; // network error, or an HTTP status
  rpc?: 'down';
  txs?: Record<string, RpcTransaction | null>;
  receipts?: Record<string, string>;
}
let calls: string[];
function stub(s: Stub) {
  calls = [];
  const txs = s.txs ?? {[LEGACY_TX.hash]: LEGACY_TX, [EIP1559_TX.hash]: EIP1559_TX};
  const receipts = s.receipts ?? {[LEGACY_TX.hash]: '0x1', [EIP1559_TX.hash]: '0x1'};
  global.fetch = jest.fn(async (url: string, init?: {body?: string}) => {
    if (url.includes('/api?module=account&action=txlist')) {
      calls.push(url);
      if (s.explorer === 'down') throw new Error('Network request failed');
      if (typeof s.explorer === 'number') return {ok: false, status: s.explorer, json: async () => ({})};
      const page = Number(new URL(url).searchParams.get('page'));
      const body = s.pages?.[page - 1] ?? {status: '0', message: 'No transactions found', result: []};
      return {ok: true, status: 200, json: async () => body};
    }
    const req = JSON.parse(init!.body!);
    calls.push(req.method);
    if (s.rpc === 'down') throw new Error('Network request failed');
    const [hash] = req.params;
    const result = req.method === 'eth_getTransactionByHash'
      ? txs[hash] ?? null
      : receipts[hash] === undefined ? null : {status: receipts[hash]};
    return {ok: true, status: 200, json: async () => ({jsonrpc: '2.0', id: 1, result})};
  }) as unknown as typeof fetch;
}
const ok = (rows: ExplorerTxRow[]) => ({status: '1', message: 'OK', result: rows});

async function failure(promise: Promise<unknown>): Promise<DojangIssuanceError> {
  try {
    await promise;
  } catch (e) {
    expect(e).toBeInstanceOf(DojangIssuanceError);
    return e as DojangIssuanceError;
  }
  throw new Error('expected the lookup to fail');
}

describe('finding the wallet\'s issuance', () => {
  it('reads the wallet\'s own history from the explorer, newest first', async () => {
    stub({pages: [ok([DEPLOY_ROW, EIP1559_ROW, LEGACY_ROW])]});
    await findDojangPlaygroundIssuance(WALLET, noLog);
    const url = new URL(calls[0]);
    expect(url.origin + url.pathname).toBe('https://sepolia-explorer.giwa.io/api');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      module: 'account', action: 'txlist', address: WALLET, sort: 'desc', page: '1', offset: '100',
    });
  });

  it('several issuances: the most recent successful one, as the chain\'s bytes', async () => {
    // Order on the wire deliberately reversed; the pick must not depend on it.
    stub({pages: [ok([LEGACY_ROW, DEPLOY_ROW, EIP1559_ROW])]});
    const found = await findDojangPlaygroundIssuance(WALLET, noLog);
    expect(found).toEqual({txHash: EIP1559_TX.hash, rawTransaction: EIP1559.expected.raw, txType: 2, blockNumber: 38562330});
    expect(calls).toEqual([expect.stringContaining('txlist'), 'eth_getTransactionByHash', 'eth_getTransactionReceipt']);
  });

  it('the newest failed on chain per its receipt: falls back to the older successful one', async () => {
    stub({pages: [ok([EIP1559_ROW, LEGACY_ROW])], receipts: {[EIP1559_TX.hash]: '0x0', [LEGACY_TX.hash]: '0x1'}});
    const found = await findDojangPlaygroundIssuance(WALLET, noLog);
    expect(found.txHash).toBe(LEGACY_TX.hash);
    expect(found.rawTransaction).toBe(LEGACY.expected.raw);
  });

  it('the RPC answers with bytes that do not hash back: skipped, not used', async () => {
    stub({pages: [ok([EIP1559_ROW])], txs: {[EIP1559_TX.hash]: {...EIP1559_TX, value: '0x1'}}});
    const e = await failure(findDojangPlaygroundIssuance(WALLET, noLog));
    expect(e.kind).toBe('none');
    expect(e.message).toMatch(/not the chain's/);
  });

  it('the RPC reports a type the circuit does not parse: skipped', async () => {
    stub({pages: [ok([EIP1559_ROW])], txs: {[EIP1559_TX.hash]: {...EIP1559_TX, type: '0x1'}}});
    expect((await failure(findDojangPlaygroundIssuance(WALLET, noLog))).kind).toBe('none');
  });

  it('the RPC does not know the transaction: skipped', async () => {
    stub({pages: [ok([EIP1559_ROW])], txs: {}});
    expect((await failure(findDojangPlaygroundIssuance(WALLET, noLog))).kind).toBe('none');
  });

  it.each([
    ['a wallet with no transactions at all', {status: '0', message: 'No transactions found', result: []}],
    ['no faucet transaction', ok([DEPLOY_ROW, row({to: '0x6646d970499bbed728636823a5a7e551e811b414', input: '0x56feed5e'})])],
    ['a faucet call to another selector', ok([row({input: '0x12345678'})])],
    ['a faucet call with extra calldata', ok([row({input: '0xb19e5904' + '11'.repeat(32)})])],
    ['a faucet call that reverted', ok([row({isError: '1', txreceipt_status: '0'})])],
    ['a faucet call sent by another wallet', ok([row({from: OTHER_WALLET.toLowerCase()})])],
  ])('%s: "none", and nothing read over RPC', async (_label, page) => {
    stub({pages: [page]});
    const e = await failure(findDojangPlaygroundIssuance(WALLET, noLog));
    expect(e.kind).toBe('none');
    expect(calls.filter(c => c.startsWith('eth_'))).toEqual([]);
  });

  it.each([
    ['the explorer is unreachable', {explorer: 'down' as const}],
    ['the explorer answers HTTP 502', {explorer: 502}],
    ['the explorer answers without a list', {pages: [{status: '0', message: 'Invalid address format', result: null}]}],
  ])('%s: "lookup", never "none"', async (_label, s) => {
    stub(s);
    const e = await failure(findDojangPlaygroundIssuance(WALLET, noLog));
    expect(e.kind).toBe('lookup');
  });

  it('the RPC is down: "lookup", never "none"', async () => {
    stub({pages: [ok([EIP1559_ROW])], rpc: 'down'});
    const e = await failure(findDojangPlaygroundIssuance(WALLET, noLog));
    expect(e.kind).toBe('lookup');
    expect(e.message).toMatch(/RPC did not answer/);
  });

  it('reads past a full first page to find an older issuance', async () => {
    const filler = Array.from({length: 100}, (_, i) => row({hash: '0x' + i.toString(16).padStart(64, '0'), to: OTHER_WALLET, blockNumber: String(40000000 - i)}));
    stub({pages: [ok(filler), ok([EIP1559_ROW])]});
    expect((await findDojangPlaygroundIssuance(WALLET, noLog)).txHash).toBe(EIP1559_TX.hash);
    expect(calls.filter(c => c.includes('txlist'))).toHaveLength(2);
  });

  it('a history longer than the page cap is "lookup", not "none"', async () => {
    const filler = Array.from({length: 100}, () => row({to: OTHER_WALLET}));
    stub({pages: Array.from({length: 10}, () => ok(filler))});
    const e = await failure(findDojangPlaygroundIssuance(WALLET, noLog));
    expect(e.kind).toBe('lookup');
    expect(e.message).toMatch(/more than 1000 transactions/);
  });

  it.each(['', 'not-an-address', '0x1234'])('refuses %j as a wallet before asking anyone', async wallet => {
    stub({});
    await expect(findDojangPlaygroundIssuance(wallet, noLog)).rejects.toThrow(/is not a wallet address/);
    expect(calls).toEqual([]);
  });
});
