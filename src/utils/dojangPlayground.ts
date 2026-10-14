/**
 * Dojang Playground: finding the wallet's own issuance and building the
 * circuit's inputs.
 *
 * What `circuits/dojang-playground/src/main.nr` proves: the wallet signed this
 * request (a signal hash, or an EIP-712 action), and the SAME key signed a
 * GIWA Sepolia transaction to the Playground faucet whose calldata is exactly
 * `payAndIssueEAS()`. The circuit does not check that the transaction was
 * included or succeeded -- the lookup here does, before anything is proven.
 *
 * This mirrors `circuits/scripts/dojang-playground/generate-prover-toml.js`
 * (`fromChain` and the TOML it writes). The unit tests feed both recorded
 * issuances through this file and compare the result against that script's
 * output, byte for byte.
 *
 * Finding the transaction: GIWA's Blockscout explorer answers the
 * Etherscan-shaped `module=account&action=txlist` for a wallet, newest first,
 * with `to`, `input`, `isError` and `txreceipt_status` per row (checked
 * 2026-10-14 against the fixture wallet: 18 rows, the two faucet calls among
 * them, `input` exactly `0xb19e5904`). An address with no transactions answers
 * `{"status":"0","message":"No transactions found","result":[]}`, an invalid
 * one `{"status":"0","message":"Invalid address format","result":null}`. The
 * explorer is only an index: every candidate is re-read over RPC, its receipt
 * checked, its bytes re-serialized and hashed back to the hash the chain gave.
 */
import {ethers} from 'ethers';
import {getNetworkConfigForCircuit} from '../config/environment';
import {
  bytesToNoirInput,
  computeScope,
  computeWalletNullifier,
  extractPubkeyCoordinates,
  hexToByteArray,
  padArray,
} from './circuitHelpers';

const CIRCUIT_ID = 'dojang_playground';

/** GIWA Sepolia. A literal in the circuit (`GIWA_SEPOLIA_CHAIN_ID`). */
export const DOJANG_PLAYGROUND_CHAIN_ID = 91342;

/** GIWAFaucetExtension, the Playground's issuing contract. A literal in the circuit. */
export const DOJANG_PLAYGROUND_FAUCET = '0x63CCe2b569A7bC35895ee24306c1512fefc06121';

/** `payAndIssueEAS()` with no arguments: the recipient is the sender. */
export const PAY_AND_ISSUE_EAS_CALLDATA = '0xb19e5904';

/** `MAX_TX_LEN` in coinbase-libs/src/signed_tx.nr. */
export const DOJANG_PLAYGROUND_MAX_TX_LEN = 300;

/** The two transaction shapes the circuit parses. Anything else it refuses. */
const ACCEPTED_TX_TYPES: ReadonlySet<number> = new Set([0, 2]);

const TXLIST_PAGE_SIZE = 100;
const TXLIST_MAX_PAGES = 10;
const EXPLORER_TIMEOUT_MS = 15000;
const RPC_TIMEOUT_MS = 10000;

/**
 * Two outcomes a caller must tell apart.
 *
 * `none` is an answer: the wallet's whole history was read and no usable
 * issuance is in it, so the person has to go and issue one. `lookup` is not an
 * answer: the explorer or the RPC failed, or the history was too long to read
 * in full, and telling that person "you have none" would be a guess.
 */
export type DojangIssuanceFailure = 'none' | 'lookup';

export class DojangIssuanceError extends Error {
  readonly kind: DojangIssuanceFailure;
  constructor(kind: DojangIssuanceFailure, message: string) {
    super(message);
    this.name = 'DojangIssuanceError';
    this.kind = kind;
  }
}

export interface DojangIssuance {
  txHash: string;
  rawTransaction: string;
  txType: number;
  blockNumber: number;
}

function sameAddress(a: string | null | undefined, b: string): boolean {
  return typeof a === 'string' && a.toLowerCase() === b.toLowerCase();
}

function network() {
  const net = getNetworkConfigForCircuit(CIRCUIT_ID);
  if (net.chainId !== DOJANG_PLAYGROUND_CHAIN_ID) {
    throw new Error(
      `dojang_playground is pinned to chain ${net.chainId} in CIRCUIT_NETWORKS, but the circuit only accepts ${DOJANG_PLAYGROUND_CHAIN_ID}.`,
    );
  }
  if (!net.explorerUrl) {
    throw new Error('CIRCUIT_NETWORKS.dojang_playground.explorerUrl is missing; the issuance lookup reads it.');
  }
  return {rpcUrl: net.rpcUrl, explorerUrl: net.explorerUrl.replace(/\/+$/, '')};
}

/**
 * Everything the circuit asserts about the issuance, checked before proving.
 *
 * Throws with the reason. Each check is one of the circuit's own, so a
 * transaction that passes here is one the circuit accepts, and one that fails
 * here would otherwise surface as an opaque prover error.
 */
export function checkDojangIssuanceTx(rawTx: string, expectedUser: string): {txType: number} {
  const length = ethers.utils.hexDataLength(rawTx);
  if (length > DOJANG_PLAYGROUND_MAX_TX_LEN) {
    throw new Error(
      `The issuance transaction is ${length} bytes; the circuit takes at most ${DOJANG_PLAYGROUND_MAX_TX_LEN}.`,
    );
  }
  let tx: ethers.Transaction;
  try {
    tx = ethers.utils.parseTransaction(rawTx);
  } catch (e) {
    throw new Error(`The issuance transaction does not parse: ${e instanceof Error ? e.message : String(e)}`);
  }
  const txType = tx.type ?? 0;
  if (!ACCEPTED_TX_TYPES.has(txType)) {
    throw new Error(`Transaction type ${txType} is not accepted; the circuit takes legacy (0) or EIP-1559 (2).`);
  }
  if (tx.chainId !== DOJANG_PLAYGROUND_CHAIN_ID) {
    throw new Error(
      `The issuance transaction is for chain ${tx.chainId}; the circuit takes GIWA Sepolia (${DOJANG_PLAYGROUND_CHAIN_ID}).`,
    );
  }
  if (!sameAddress(tx.to, DOJANG_PLAYGROUND_FAUCET)) {
    throw new Error(`The transaction is to ${tx.to}, not the Playground faucet ${DOJANG_PLAYGROUND_FAUCET}.`);
  }
  if (tx.data.toLowerCase() !== PAY_AND_ISSUE_EAS_CALLDATA) {
    throw new Error(`The calldata is ${tx.data}, not a bare payAndIssueEAS() call (${PAY_AND_ISSUE_EAS_CALLDATA}).`);
  }
  if (!sameAddress(tx.from, expectedUser)) {
    throw new Error(`The transaction was signed by ${tx.from}, not by the connected wallet ${expectedUser}.`);
  }
  return {txType};
}

/** The fields `eth_getTransactionByHash` answers with, as GIWA's RPC sends them. */
export interface RpcTransaction {
  hash: string;
  type: string;
  chainId?: string;
  nonce: string;
  gas: string;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  accessList?: ethers.utils.AccessListish;
  to: string | null;
  value: string;
  input: string;
  v: string;
  r: string;
  s: string;
  yParity?: string;
}

/**
 * The legacy transaction's recovery bit, from its EIP-155 `v`.
 *
 * A `v` of 27/28 means no chain id is in the signature, which the circuit
 * refuses: such a transaction could be replayed on any chain.
 */
function legacyRecoveryBit(v: ethers.BigNumber, chainId: number): number {
  const bit = v.sub(35).sub(chainId * 2);
  if (!bit.eq(0) && !bit.eq(1)) {
    throw new Error(
      `Legacy transaction v=${v.toString()} does not carry chain ${chainId} (EIP-155); the circuit refuses it.`,
    );
  }
  return bit.toNumber();
}

/**
 * The exact signed bytes of a transaction the chain holds -- `fromChain` in
 * generate-prover-toml.js. Re-serialized from the RPC's fields and hashed
 * back: if the hash differs, the bytes are not the chain's and are refused.
 *
 * `r` and `s` are padded to 32 bytes before signing back in. RLP drops a
 * leading zero byte and the circuit pads it back, so a short scalar must
 * still serialize to the bytes the chain hashed.
 */
export function rawTransactionFromRpc(t: RpcTransaction): {raw: string; txType: number} {
  const txType = Number.parseInt(t.type, 16);
  if (!ACCEPTED_TX_TYPES.has(txType)) {
    throw new Error(`Transaction ${t.hash} is type ${t.type}; the circuit takes legacy (0) or EIP-1559 (2).`);
  }
  if (!t.chainId) {
    throw new Error(`Transaction ${t.hash} carries no chain id; the circuit takes GIWA Sepolia only.`);
  }
  const chainId = Number.parseInt(t.chainId, 16);
  const common = {
    type: txType,
    chainId,
    nonce: ethers.BigNumber.from(t.nonce).toNumber(),
    gasLimit: ethers.BigNumber.from(t.gas),
    to: t.to ?? undefined,
    value: ethers.BigNumber.from(t.value),
    data: t.input,
  };
  const r = ethers.utils.hexZeroPad(t.r, 32);
  const s = ethers.utils.hexZeroPad(t.s, 32);

  let unsigned: ethers.utils.UnsignedTransaction;
  let recoveryBit: number;
  if (txType === 2) {
    if (t.maxFeePerGas === undefined || t.maxPriorityFeePerGas === undefined) {
      throw new Error(`EIP-1559 transaction ${t.hash} is missing its fee fields.`);
    }
    unsigned = {
      ...common,
      maxFeePerGas: ethers.BigNumber.from(t.maxFeePerGas),
      maxPriorityFeePerGas: ethers.BigNumber.from(t.maxPriorityFeePerGas),
      accessList: t.accessList ?? [],
    };
    recoveryBit = ethers.BigNumber.from(t.yParity ?? t.v).toNumber();
    if (recoveryBit !== 0 && recoveryBit !== 1) {
      throw new Error(`EIP-1559 transaction ${t.hash} has y-parity ${recoveryBit}.`);
    }
  } else {
    if (t.gasPrice === undefined) {
      throw new Error(`Legacy transaction ${t.hash} is missing gasPrice.`);
    }
    unsigned = {...common, gasPrice: ethers.BigNumber.from(t.gasPrice)};
    recoveryBit = legacyRecoveryBit(ethers.BigNumber.from(t.v), chainId);
  }

  const raw = ethers.utils.serializeTransaction(unsigned, {r, s, v: 27 + recoveryBit});
  const hash = ethers.utils.keccak256(raw);
  if (hash.toLowerCase() !== t.hash.toLowerCase()) {
    throw new Error(`Re-serialized ${t.hash} hashes to ${hash}; the bytes are not the chain's.`);
  }
  return {raw, txType};
}

async function fetchJson(url: string, init: RequestInit | undefined, timeoutMs: number): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {...init, signal: controller.signal});
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return await resp.json();
  } finally {
    clearTimeout(timer);
  }
}

async function rpc<T>(rpcUrl: string, method: string, params: unknown[]): Promise<T> {
  const json = await fetchJson(
    rpcUrl,
    {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params}),
    },
    RPC_TIMEOUT_MS,
  );
  if (json.error) throw new Error(json.error.message ?? JSON.stringify(json.error));
  return json.result as T;
}

/** One row of the explorer's `txlist`, the fields this lookup reads. */
export interface ExplorerTxRow {
  hash: string;
  from: string;
  to: string;
  input: string;
  isError: string;
  txreceipt_status: string;
  blockNumber: string;
  transactionIndex: string;
}

/** A faucet call worth re-reading over RPC, or the reason it is not. */
function rowRejection(row: ExplorerTxRow, wallet: string): string | null {
  if (!sameAddress(row.to, DOJANG_PLAYGROUND_FAUCET)) return 'not to the faucet';
  if (!sameAddress(row.from, wallet)) return `sent by ${row.from}, not this wallet`;
  if ((row.input || '').toLowerCase() !== PAY_AND_ISSUE_EAS_CALLDATA) {
    return `calldata ${row.input} is not a bare payAndIssueEAS()`;
  }
  if (row.isError !== '0' || row.txreceipt_status !== '1') return 'failed on chain';
  return null;
}

async function readWalletTxList(
  explorerUrl: string,
  wallet: string,
  addLog: (msg: string) => void,
): Promise<ExplorerTxRow[]> {
  const rows: ExplorerTxRow[] = [];
  for (let page = 1; page <= TXLIST_MAX_PAGES; page++) {
    const url =
      `${explorerUrl}/api?module=account&action=txlist&address=${wallet}` +
      `&sort=desc&page=${page}&offset=${TXLIST_PAGE_SIZE}`;
    let json: any;
    try {
      json = await fetchJson(url, undefined, EXPLORER_TIMEOUT_MS);
    } catch (e) {
      throw new DojangIssuanceError(
        'lookup',
        `The GIWA explorer did not answer (${e instanceof Error ? e.message : String(e)}).`,
      );
    }
    const result = json?.result;
    if (json?.status === '0' && Array.isArray(result) && result.length === 0) {
      // "No transactions found" -- the end of the history, or no history.
      return rows;
    }
    if (!Array.isArray(result)) {
      throw new DojangIssuanceError(
        'lookup',
        `The GIWA explorer answered without a transaction list: ${JSON.stringify(json)}`,
      );
    }
    rows.push(...(result as ExplorerTxRow[]));
    if (result.length < TXLIST_PAGE_SIZE) return rows;
    addLog(`[Dojang] read page ${page} of the wallet's history (${rows.length} transactions so far)`);
  }
  throw new DojangIssuanceError(
    'lookup',
    `This wallet has more than ${TXLIST_MAX_PAGES * TXLIST_PAGE_SIZE} transactions; ` +
      'its history was not read to the end, so "no issuance" cannot be concluded.',
  );
}

/**
 * The wallet's most recent successful Playground issuance, as the exact bytes
 * the chain holds.
 *
 * Several issuances: newest first by block, then by position in the block --
 * the explorer's own order, re-sorted here so it does not depend on the
 * explorer keeping it. The first candidate that survives every check wins.
 */
export async function findDojangPlaygroundIssuance(
  wallet: string,
  addLog: (msg: string) => void,
): Promise<DojangIssuance> {
  if (!ethers.utils.isAddress(wallet)) {
    throw new Error(`'${wallet}' is not a wallet address.`);
  }
  const {rpcUrl, explorerUrl} = network();
  addLog(`[Dojang] looking up Playground issuances by ${wallet}`);

  const rows = await readWalletTxList(explorerUrl, wallet, addLog);
  const rejected: string[] = [];
  const candidates = rows.filter(row => {
    const why = rowRejection(row, wallet);
    if (why === null) return true;
    if (why !== 'not to the faucet') rejected.push(`${row.hash}: ${why}`);
    return false;
  });
  candidates.sort(
    (a, b) =>
      Number(b.blockNumber) - Number(a.blockNumber) ||
      Number(b.transactionIndex) - Number(a.transactionIndex),
  );
  addLog(
    `[Dojang] ${rows.length} transactions read, ${candidates.length} faucet issuance(s) to check` +
      (rejected.length ? `, ${rejected.length} faucet call(s) refused: ${rejected.join('; ')}` : ''),
  );

  for (const row of candidates) {
    let tx: RpcTransaction | null;
    let receipt: {status?: string} | null;
    try {
      tx = await rpc<RpcTransaction | null>(rpcUrl, 'eth_getTransactionByHash', [row.hash]);
      receipt = await rpc<{status?: string} | null>(rpcUrl, 'eth_getTransactionReceipt', [row.hash]);
    } catch (e) {
      throw new DojangIssuanceError(
        'lookup',
        `The GIWA RPC did not answer for ${row.hash} (${e instanceof Error ? e.message : String(e)}).`,
      );
    }
    try {
      if (!tx) throw new Error('the RPC does not know this transaction');
      if (!receipt || receipt.status !== '0x1') throw new Error('its receipt does not show success');
      const {raw, txType} = rawTransactionFromRpc(tx);
      checkDojangIssuanceTx(raw, wallet);
      addLog(`[Dojang] using issuance ${row.hash} (type ${txType}, block ${row.blockNumber})`);
      return {txHash: row.hash, rawTransaction: raw, txType, blockNumber: Number(row.blockNumber)};
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      rejected.push(`${row.hash}: ${why}`);
      addLog(`[Dojang] skipping ${row.hash}: ${why}`);
    }
  }

  throw new DojangIssuanceError(
    'none',
    `No usable Dojang Playground issuance by ${wallet}.` +
      (rejected.length ? ` Refused: ${rejected.join('; ')}` : ''),
  );
}

/** The circuit's inputs, by name, in `fn main`'s parameter order. */
export interface DojangPlaygroundCircuitInputs {
  signal_hash: string[];
  domain_separator: string[];
  action_hash: string[];
  scope: string[];
  nullifier: string[];
  user_address: string[];
  user_signature: string[];
  user_pubkey_x: string[];
  user_pubkey_y: string[];
  raw_transaction: string[];
  tx_length: string;
}

/** The EIP-712 hashes a request carries when it binds an action. */
export interface DojangActionHashes {
  domainSeparator: string;
  actionHash: string;
}

const ZERO_32 = new Array(32).fill(0);

export function prepareDojangPlaygroundInputs(params: {
  signalHash: Uint8Array;
  userAddress: string;
  userSignature: string;
  userPubkey: string;
  rawTransaction: string;
  scopeString: string;
  action?: DojangActionHashes;
}): DojangPlaygroundCircuitInputs {
  const {signalHash, userAddress, userSignature, userPubkey, rawTransaction, scopeString, action} = params;
  const txBytes = hexToByteArray(rawTransaction);
  if (txBytes.length > DOJANG_PLAYGROUND_MAX_TX_LEN) {
    throw new Error(
      `The issuance transaction is ${txBytes.length} bytes; the circuit takes at most ${DOJANG_PLAYGROUND_MAX_TX_LEN}.`,
    );
  }
  const sig = ethers.utils.splitSignature(userSignature);
  const pub = extractPubkeyCoordinates(userPubkey);
  const scopeBytes = computeScope(scopeString);
  // keccak(keccak(user_address ++ keccak("dojang_playground")) ++ scope), as
  // verify_wallet_nullifier recomputes it with the tag compiled in.
  const nullifierBytes = computeWalletNullifier(userAddress, CIRCUIT_ID, scopeBytes);

  // Absent is 32 zero bytes, and the two modes are exclusive: with an action
  // `signal_hash` MUST be zero, without one the EIP-712 pair must be.
  return {
    signal_hash: bytesToNoirInput(action ? ZERO_32 : Array.from(signalHash)),
    domain_separator: bytesToNoirInput(action ? hexToByteArray(action.domainSeparator) : ZERO_32),
    action_hash: bytesToNoirInput(action ? hexToByteArray(action.actionHash) : ZERO_32),
    scope: bytesToNoirInput(Array.from(scopeBytes)),
    nullifier: bytesToNoirInput(Array.from(nullifierBytes)),
    user_address: bytesToNoirInput(hexToByteArray(userAddress)),
    user_signature: bytesToNoirInput([...hexToByteArray(sig.r), ...hexToByteArray(sig.s)]),
    user_pubkey_x: bytesToNoirInput(hexToByteArray(pub.x)),
    user_pubkey_y: bytesToNoirInput(hexToByteArray(pub.y)),
    raw_transaction: bytesToNoirInput(padArray(txBytes, DOJANG_PLAYGROUND_MAX_TX_LEN)),
    tx_length: txBytes.length.toString(),
  };
}

/**
 * Positional, in the ABI's order: bb reads the vector with no field names, so
 * this order IS the contract. 5 x 32 public, then 20 + 64 + 32 + 32 + 300 + 1.
 */
export function flattenDojangPlaygroundInputs(inputs: DojangPlaygroundCircuitInputs): string[] {
  return [
    ...inputs.signal_hash,
    ...inputs.domain_separator,
    ...inputs.action_hash,
    ...inputs.scope,
    ...inputs.nullifier,
    ...inputs.user_address,
    ...inputs.user_signature,
    ...inputs.user_pubkey_x,
    ...inputs.user_pubkey_y,
    ...inputs.raw_transaction,
    inputs.tx_length,
  ];
}
