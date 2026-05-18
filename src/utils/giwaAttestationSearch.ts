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

const GIWA_RPC = 'https://sepolia-rpc.giwa.io/';

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

// GIWA Sepolia RPC caps `eth_getLogs` at 100,000 blocks per query. EAS
// Attested has every meaningful field indexed (`recipient`, `attester`,
// `schema`), so the RPC server itself can filter — we just need to feed
// it chunked block ranges starting from the chain head and walking back.
// First match wins (newest), which is what the user wants when they
// just registered a fresh attestation.
const CHUNK_SIZE = 99_999; // RPC limit is 100k inclusive; stay just under
const MAX_CHUNKS = 30; // ≈ 3M blocks back, plenty for a fresh PoC
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

async function findAttestationLog(
  schemaUid: string,
  walletAddress: string,
  addLog: (msg: string) => void,
): Promise<BlockscoutLog | null> {
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

  // Paginated scan — Blockscout sorts logs newest-first and the wallet's
  // attestation may be buried beyond page 1 once other testers register
  // newer ones.
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
