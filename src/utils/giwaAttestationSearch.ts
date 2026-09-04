/**
 * GIWA Sepolia attestation search via Blockscout API.
 *
 * GIWA has no easscan endpoint, so we query the explorer's REST API for
 * `Attested` events emitted by the EAS predeploy and filter by schema UID
 * and recipient. Then we fetch the issuing transaction via eth_getTransactionByHash
 * and re-serialize it into raw RLP bytes (the format the circuit expects).
 */
import {ethers} from 'ethers';
import type {AttestationInfo} from './attestationSearch';
import {CIRCUIT_NETWORK_OVERRIDES} from '../config/contracts';

// Single source of truth for the GIWA Sepolia endpoints — same struct
// the proof-generation pipeline uses (CIRCUIT_NETWORK_OVERRIDES). Add a
// future GIWA network by editing that map only.
const GIWA_NET = CIRCUIT_NETWORK_OVERRIDES.giwa_attestation;
if (!GIWA_NET) {
  throw new Error('CIRCUIT_NETWORK_OVERRIDES.giwa_attestation missing — required for attestation search');
}
const GIWA_RPC = GIWA_NET.rpcUrl;
const GIWA_EXPLORER = GIWA_NET.explorerUrl;
if (!GIWA_EXPLORER) {
  throw new Error('CIRCUIT_NETWORK_OVERRIDES.giwa_attestation.explorerUrl missing — the attestation search reads its log index');
}

// EAS predeploy + Attested event topic
const EAS_CONTRACT = '0x4200000000000000000000000000000000000021';
const ATTESTED_TOPIC =
  '0x8bf46bf4cfd674fa735a3d63ec1c9ad4153f033c290341f3a588b75685141b35';

// Our PoC schema for `bool verifiedAccount` on GIWA Sepolia
const GIWA_VERIFIED_ACCOUNT_SCHEMA_UID =
  '0xbda8dd64efa4c537514cfe4c96ab5d5f14a8ec0c9105b799b47a010e89c0c72d';

// MockGiwaAttester contract — the `to` address of the attestAccount tx,
// matched against GIWA_ATTESTER_CONTRACT inside the giwa_attestation circuit.
export const GIWA_MOCK_ATTESTER_CONTRACT =
  '0x6646d970499BBeD728636823A5A7e551E811b414';

// Module-level cache (same TTL as Coinbase search)
const cache = new Map<
  string,
  {result: {attestation: AttestationInfo; rawTransaction: string}; timestamp: number}
>();
const CACHE_TTL = 10 * 60 * 1000;

// Normalized log shape returned by findAttestationLog (matches the
// historical Blockscout snake_case so the rest of this module stays
// unchanged when the source switches from REST to RPC).
interface BlockscoutLog {
  address: string;
  block_number: number;
  block_hash: string;
  data: string;
  index: number;
  topics: string[];
  transaction_hash: string;
}

// HOW THIS LOOKUP FINDS THE ATTESTATION, AND WHY IT CHANGED (2026-09-04).
//
// The wallet is the INDEXED `recipient` on the EAS `Attested` event, so the
// question "does this wallet hold an attestation" is one filtered log query —
// if something will answer it over the whole chain. Three things were measured
// against GIWA Sepolia before picking:
//
//   explorer, one query filtered by recipient   1s for a fresh attestation,
//                                               26s for one 9.7M blocks back
//   RPC, walking back in 100k chunks            126 seconds, 98 calls
//   RPC, one wide query                         WRONG ANSWER — see below
//
// So the explorer answers it, and the RPC cannot. The chunked walk is kept only
// as a fallback for a JUST-REGISTERED attestation, which sits within the first
// chunk or two of the head.
//
// WHAT WAS BROKEN. This walked back `MAX_CHUNKS` × `CHUNK_SIZE` = 3M blocks and
// stopped. The one attestation that existed sat 9.7M blocks back, so the lookup
// returned "no attestation" for a wallet that has one, and every day made it
// worse. The old comment called 3M "plenty for a fresh PoC" — true when written,
// and silently expired as GIWA produced blocks.
//
// AND THE RPC LIES ABOUT WIDE RANGES. Ask sepolia-rpc.giwa.io for more than
// 100,000 blocks in one `eth_getLogs` and it returns an EMPTY LIST rather than
// an error — measured on a range that provably contains the event. So widening
// the chunk is not an option, and an empty result from a wide query must never
// be read as "there is none".
const CHUNK_SIZE = 99_999; // hard cap: 100,001 blocks returns [] instead of erroring
const MAX_CHUNKS = 3; // fallback only — a fresh attestation is near the head
const PAD = (v: string) =>
  '0x' + v.replace(/^0x/, '').toLowerCase().padStart(64, '0');
const toHex = (n: number) => '0x' + n.toString(16);

interface RpcLog {
  address: string;
  blockHash: string;
  blockNumber: string;
  data: string;
  logIndex: string;
  topics: string[];
  transactionHash: string;
}

async function rpcCall<T>(method: string, params: unknown[]): Promise<T> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), 8000);
  try {
    const resp = await fetch(GIWA_RPC, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({jsonrpc: '2.0', id: 1, method, params}),
      signal: controller.signal,
    });
    if (!resp.ok) throw new Error(`RPC HTTP ${resp.status}`);
    const j = await resp.json();
    if (j.error) throw new Error(j.error.message);
    return j.result as T;
  } finally {
    clearTimeout(t);
  }
}

/**
 * The whole chain in one request, filtered by the wallet.
 *
 * Blockscout's log search takes the same indexed topics `eth_getLogs` does, but
 * answers over an unbounded block range because it reads its own index instead
 * of walking the chain. That is the entire difference between 1 second and 126.
 *
 * Only the event and the recipient are filtered server-side; the schema is
 * checked here. Blockscout wants a pairwise operator for every extra topic
 * (`topic0_1_opr`, `topic1_3_opr`, …) and getting one wrong drops the filter
 * silently rather than erroring, which is a bad trade for a check that costs
 * nothing locally.
 */
async function findAttestationViaExplorer(
  schemaUid: string,
  walletAddress: string,
  addLog: (msg: string) => void,
): Promise<BlockscoutLog | null> {
  const url =
    `${GIWA_EXPLORER}/api?module=logs&action=getLogs` +
    `&fromBlock=0&toBlock=latest&address=${EAS_CONTRACT}` +
    `&topic0=${ATTESTED_TOPIC}&topic1=${PAD(walletAddress)}&topic0_1_opr=and`;

  const controller = new AbortController();
  // Generous on purpose: an attestation far behind the head took 26s to come
  // back, against 1s for a recent one. Both beat the walk this replaced.
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    addLog('[GIWA] explorer log search over the full chain');
    const resp = await fetch(url, {signal: controller.signal});
    if (!resp.ok) throw new Error(`explorer HTTP ${resp.status}`);
    const json = await resp.json();
    const rows: RpcLog[] = Array.isArray(json.result) ? json.result : [];

    const wanted = PAD(schemaUid).toLowerCase();
    const matches = rows.filter(r => (r.topics[3] || '').toLowerCase() === wanted);
    if (matches.length === 0) {
      addLog(`[GIWA] explorer: ${rows.length} attestation(s) for this wallet, none on our schema`);
      return null;
    }
    // Newest wins, matching what the walk did when it started from the head.
    matches.sort((a, b) => Number(b.blockNumber) - Number(a.blockNumber));
    const r = matches[0];
    addLog(`[GIWA] explorer match: tx ${r.transactionHash}`);
    return {
      address: r.address,
      block_hash: r.blockHash,
      block_number: Number(r.blockNumber),
      data: r.data,
      index: Number(r.logIndex),
      topics: r.topics,
      transaction_hash: r.transactionHash,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Ask our own attester contract who it has attested, instead of asking the
 * whole chain who holds an attestation.
 *
 * WHY THIS IS THE FAST PATH.
 *
 * Every GIWA attestation this app can prove was issued by MockGiwaAttester —
 * the circuit constrains the issuing contract, so an attestation from anywhere
 * else cannot produce a valid proof no matter what the search turns up. That
 * makes the contract's own transaction list the exact right set to look in, and
 * it is tiny: one deployment plus one call per registered wallet.
 *
 * Measured against GIWA Sepolia on 2026-09-04, for the wallet whose attestation
 * sits 9.7M blocks back:
 *
 *   attester's tx list, then that tx's receipt   0.29s  (0.22 + 0.07)
 *   EAS log search by recipient                    26s
 *   RPC walk back in 100k chunks                  126s
 *
 * So this is not a shortcut around the log search — it is a narrower question
 * that the explorer can answer from an index it already has.
 *
 * `attestAccount(address)` is selector 0x56feed5e, mirroring the Coinbase
 * attester's, so the wallet is readable straight out of the call data and no
 * receipt is fetched for a wallet that was never registered.
 */
const ATTEST_ACCOUNT_SELECTOR = '0x56feed5e';
const TXLIST_PAGE_SIZE = 100;
const TXLIST_MAX_PAGES = 10; // 1,000 attestations; logged loudly if ever reached

interface ExplorerTx {
  hash: string;
  input: string;
  blockNumber: string;
  isError?: string;
}

/**
 * Three outcomes, not two.
 *
 * `none` means the attester's whole call history was read and this wallet is
 * not in it — a real answer, and the broader searches would only spend 26
 * seconds arriving at the same place. `unknown` means the read stopped early
 * (paging cap), so "no" has not been established and the search must widen.
 *
 * Collapsing those two is exactly the bug this file already shipped once: a
 * search that gave up early reported "no attestation" for a wallet that had
 * one.
 */
type AttesterLookup =
  | {status: 'found'; log: BlockscoutLog}
  | {status: 'none'}
  | {status: 'unknown'};

async function findAttestationViaAttester(
  schemaUid: string,
  walletAddress: string,
  addLog: (msg: string) => void,
): Promise<AttesterLookup> {
  const wanted =
    ATTEST_ACCOUNT_SELECTOR + PAD(walletAddress).replace(/^0x/, '');

  let match: ExplorerTx | undefined;
  let page = 1;
  for (; page <= TXLIST_MAX_PAGES; page++) {
    const url =
      `${GIWA_EXPLORER}/api?module=account&action=txlist` +
      `&address=${GIWA_MOCK_ATTESTER_CONTRACT}&sort=desc` +
      `&page=${page}&offset=${TXLIST_PAGE_SIZE}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    let rows: ExplorerTx[];
    try {
      const resp = await fetch(url, {signal: controller.signal});
      if (!resp.ok) throw new Error(`explorer HTTP ${resp.status}`);
      const json = await resp.json();
      rows = Array.isArray(json.result) ? json.result : [];
    } finally {
      clearTimeout(timeout);
    }

    // Newest first, so the first hit is the current attestation. A reverted
    // call attested nothing and its receipt carries no Attested log.
    match = rows.find(
      t =>
        t.isError !== '1' &&
        (t.input || '').toLowerCase().startsWith(wanted.toLowerCase()),
    );
    if (match) break;
    if (rows.length < TXLIST_PAGE_SIZE) {
      // Short page means the end of the list, so the history was read in full.
      const checked = rows.length + (page - 1) * TXLIST_PAGE_SIZE;
      addLog(`[GIWA] attester never registered this wallet (all ${checked} calls read)`);
      return {status: 'none'};
    }
  }

  if (!match) {
    addLog(`[GIWA] attester tx list hit the ${TXLIST_MAX_PAGES}-page cap without a match — widening, NOT concluding "none"`);
    return {status: 'unknown'};
  }

  const receipt = await rpcCall<{
    blockHash: string;
    blockNumber: string;
    logs: RpcLog[];
  }>('eth_getTransactionReceipt', [match.hash]);
  if (!receipt) throw new Error(`no receipt for ${match.hash}`);

  const paddedRecipient = PAD(walletAddress).toLowerCase();
  const paddedSchema = PAD(schemaUid).toLowerCase();
  const log = receipt.logs.find(
    l =>
      l.address.toLowerCase() === EAS_CONTRACT.toLowerCase() &&
      (l.topics[0] || '').toLowerCase() === ATTESTED_TOPIC.toLowerCase() &&
      (l.topics[1] || '').toLowerCase() === paddedRecipient &&
      (l.topics[3] || '').toLowerCase() === paddedSchema,
  );
  if (!log) {
    // The attester was called for this wallet but the receipt carries no
    // attestation on our schema. Unknown rather than none: our schema UID could
    // have been changed while older calls kept the previous one, and answering
    // "none" here would hide an attestation the wider search can still find.
    addLog(`[GIWA] attester call ${match.hash} carries no attestation on our schema — widening`);
    return {status: 'unknown'};
  }

  addLog(`[GIWA] attester match: tx ${match.hash} (page ${page})`);
  return {
    status: 'found',
    log: {
      address: log.address,
      block_hash: log.blockHash || receipt.blockHash,
      block_number: parseInt(log.blockNumber || receipt.blockNumber, 16),
      data: log.data,
      index: parseInt(log.logIndex, 16),
      topics: log.topics,
      transaction_hash: log.transactionHash || match.hash,
    },
  };
}

/**
 * Exported for its own tests. Everything past this point — fetching the issuing
 * transaction and re-serialising it to RLP — needs a real signed transaction to
 * exercise, so a test of the SEARCH through the public entry point would have
 * to fake one just to reach the part it cares about. The search is where the
 * defect was, so the search is what is reachable.
 */
export async function findAttestationLog(
  schemaUid: string,
  walletAddress: string,
  addLog: (msg: string) => void,
): Promise<BlockscoutLog | null> {
  // Narrowest question first: our attester's own calls. A confident "none"
  // ends the search — the circuit constrains the issuing contract, so a wallet
  // this contract never attested has nothing provable no matter what a wider
  // search turns up, and 26 seconds spent confirming that is 26 seconds the
  // person spends staring at a spinner.
  try {
    const viaAttester = await findAttestationViaAttester(schemaUid, walletAddress, addLog);
    if (viaAttester.status === 'found') return viaAttester.log;
    if (viaAttester.status === 'none') return null;
  } catch (e) {
    addLog(`[GIWA] attester lookup failed (${e instanceof Error ? e.message : e}) — widening to the EAS log search`);
  }

  try {
    const viaExplorer = await findAttestationViaExplorer(schemaUid, walletAddress, addLog);
    if (viaExplorer) return viaExplorer;
  } catch (e) {
    // Fall through to the RPC. A wallet with no attestation returns null above,
    // not an exception, so reaching here means the explorer itself failed.
    addLog(`[GIWA] explorer search failed (${e instanceof Error ? e.message : e}) — ` +
           `falling back to ${MAX_CHUNKS} chunks from the head`);
  }

  const paddedRecipient = PAD(walletAddress);
  const paddedSchema = PAD(schemaUid);
  const head = parseInt(await rpcCall<string>('eth_blockNumber', []), 16);
  addLog(`[GIWA] eth_getLogs walking back from head ${head} in ${CHUNK_SIZE}-block chunks`);

  let toBlock = head;
  for (let chunk = 0; chunk < MAX_CHUNKS && toBlock > 0; chunk++) {
    const fromBlock = Math.max(0, toBlock - CHUNK_SIZE);
    const result = await rpcCall<RpcLog[]>('eth_getLogs', [
      {
        address: EAS_CONTRACT,
        fromBlock: toHex(fromBlock),
        toBlock: toHex(toBlock),
        topics: [ATTESTED_TOPIC, paddedRecipient, null, paddedSchema],
      },
    ]);
    if (result.length > 0) {
      // Highest block within this chunk is the newest match.
      result.sort(
        (a, b) => parseInt(b.blockNumber, 16) - parseInt(a.blockNumber, 16),
      );
      const r = result[0];
      addLog(
        `[GIWA] Match in chunk ${chunk + 1} [${fromBlock}-${toBlock}]: tx ${r.transactionHash}`,
      );
      return {
        address: r.address,
        block_hash: r.blockHash,
        block_number: parseInt(r.blockNumber, 16),
        data: r.data,
        index: parseInt(r.logIndex, 16),
        topics: r.topics,
        transaction_hash: r.transactionHash,
      };
    }
    addLog(`[GIWA] No match in chunk ${chunk + 1} [${fromBlock}-${toBlock}]`);
    if (fromBlock === 0) break;
    toBlock = fromBlock - 1;
  }
  return null;
}

function topicToAddress(topic: string): string {
  // topics are 32-byte hex; address occupies the last 20 bytes
  return ethers.utils.getAddress('0x' + topic.slice(-40));
}

async function reconstructRawTx(
  txHash: string,
  addLog?: (msg: string) => void,
): Promise<string> {
  const log = addLog || console.log;
  log(`[GIWA] Fetching tx ${txHash}`);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6000);
  try {
    const resp = await fetch(GIWA_RPC, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_getTransactionByHash',
        params: [txHash],
        id: 1,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!resp.ok) throw new Error(`RPC HTTP ${resp.status}`);
    const json = await resp.json();
    if (json.error) throw new Error(json.error.message);
    const tx = json.result;
    if (!tx) throw new Error('Transaction not found on GIWA');

    log(`[GIWA] Tx type=${tx.type}, chainId=${parseInt(tx.chainId, 16)}, to=${tx.to}`);

    if (tx.type !== '0x2') {
      throw new Error(`Expected EIP-1559 (type 0x2), got ${tx.type}`);
    }

    const unsigned: ethers.utils.UnsignedTransaction = {
      type: 2,
      chainId: parseInt(tx.chainId, 16),
      nonce: parseInt(tx.nonce, 16),
      maxPriorityFeePerGas: ethers.BigNumber.from(tx.maxPriorityFeePerGas),
      maxFeePerGas: ethers.BigNumber.from(tx.maxFeePerGas),
      gasLimit: ethers.BigNumber.from(tx.gas),
      to: tx.to,
      value: ethers.BigNumber.from(tx.value),
      data: tx.input,
      accessList: tx.accessList || [],
    };

    const vValue = parseInt(tx.v, 16);
    const yParity = vValue <= 1 ? vValue : vValue % 2;
    const signature = {r: tx.r, s: tx.s, v: yParity};

    return ethers.utils.serializeTransaction(unsigned, signature);
  } catch (e) {
    clearTimeout(timeoutId);
    throw e instanceof Error ? e : new Error(String(e));
  }
}

/**
 * Same return shape as findAttestationTransaction in attestationSearch.ts,
 * but resolves via GIWA Blockscout instead of EAS GraphQL on Base.
 */
export async function findGiwaAttestationTransaction(
  walletAddress: string,
  addLog?: (msg: string) => void,
): Promise<{attestation: AttestationInfo; rawTransaction: string} | null> {
  const log = addLog || console.log;
  const cacheKey = `${walletAddress}:${GIWA_VERIFIED_ACCOUNT_SCHEMA_UID}`;
  const hit = cache.get(cacheKey);
  if (hit && Date.now() - hit.timestamp < CACHE_TTL) {
    log('[GIWA Cache] returning cached attestation');
    return hit.result;
  }

  log(`[GIWA Search] Wallet: ${walletAddress}`);
  log(`[GIWA Search] Schema: ${GIWA_VERIFIED_ACCOUNT_SCHEMA_UID}`);

  // Our attester's own call list first (0.29s), the explorer's EAS log search
  // second (1-26s), RPC chunks from the head last. See the note above
  // findAttestationViaAttester.
  const match = await findAttestationLog(
    GIWA_VERIFIED_ACCOUNT_SCHEMA_UID,
    walletAddress,
    log,
  );
  if (!match) {
    log(`[GIWA Search] No GIWA attestation found for wallet ${walletAddress}`);
    return null;
  }

  try {
    const rawTx = await reconstructRawTx(match.transaction_hash, log);

    // Sanity: tx.to must equal MockGiwaAttester contract
    const parsed = ethers.utils.parseTransaction(rawTx);
    if (parsed.to?.toLowerCase() !== GIWA_MOCK_ATTESTER_CONTRACT.toLowerCase()) {
      log(
        `[GIWA Search] tx.to=${parsed.to} != ${GIWA_MOCK_ATTESTER_CONTRACT}, rejecting.`,
      );
      return null;
    }

    const attestation: AttestationInfo = {
      id: match.data,
      txHash: match.transaction_hash,
      attester: topicToAddress(match.topics[2]),
      recipient: topicToAddress(match.topics[1]),
      time: match.block_number,
      rawTransaction: rawTx,
    };
    const result = {attestation, rawTransaction: rawTx};
    cache.set(cacheKey, {result, timestamp: Date.now()});
    log('[GIWA Search] Attestation accepted.');
    return result;
  } catch (e) {
    log(`[GIWA Search] Tx fetch/parse failed: ${e instanceof Error ? e.message : e}`);
    return null;
  }
}
