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

const GIWA_EXPLORER_API = 'https://sepolia-explorer.giwa.io/api/v2';
const GIWA_RPC = 'https://sepolia-rpc.giwa.io/';

// EAS predeploy + Attested event topic
const EAS_CONTRACT = '0x4200000000000000000000000000000000000021';
const ATTESTED_TOPIC =
  '0x8bf46bf4cfd674fa735a3d63ec1c9ad4153f033c290341f3a588b75685141b35';

// Our PoC schema for `bool verifiedAccount` on GIWA Sepolia
const GIWA_VERIFIED_ACCOUNT_SCHEMA_UID =
  '0xbda8dd64efa4c537514cfe4c96ab5d5f14a8ec0c9105b799b47a010e89c0c72d';

// MockCoinbaseAttester contract — the `to` address of the attestAccount tx,
// matched against GIWA_ATTESTER_CONTRACT inside the giwa_attestation circuit.
export const GIWA_MOCK_ATTESTER_CONTRACT =
  '0x6646d970499BBeD728636823A5A7e551E811b414';

// Module-level cache (same TTL as Coinbase search)
const cache = new Map<
  string,
  {result: {attestation: AttestationInfo; rawTransaction: string}; timestamp: number}
>();
const CACHE_TTL = 10 * 60 * 1000;

interface BlockscoutLog {
  address: string;
  block_number: number;
  block_hash: string;
  data: string;
  index: number;
  topics: string[];
  transaction_hash: string;
}

async function fetchBlockscoutLogs(
  schemaUid: string,
  addLog?: (msg: string) => void,
): Promise<BlockscoutLog[]> {
  const log = addLog || console.log;
  const url = `${GIWA_EXPLORER_API}/addresses/${EAS_CONTRACT}/logs?topic=${ATTESTED_TOPIC}`;
  log('[GIWA] Searching attested events via Blockscout...');
  log(`[GIWA] URL: ${url}`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {signal: controller.signal});
    clearTimeout(timeoutId);
    if (!response.ok) {
      throw new Error(`Blockscout HTTP ${response.status}`);
    }
    const data = await response.json();
    const items: BlockscoutLog[] = data.items ?? [];

    // Filter by schema UID (Attested event has schema as topic[3])
    const matching = items.filter(
      (l) =>
        l.topics &&
        l.topics.length >= 4 &&
        l.topics[3]?.toLowerCase() === schemaUid.toLowerCase(),
    );
    log(`[GIWA] Total Attested logs: ${items.length}, schema-matched: ${matching.length}`);
    return matching;
  } catch (e) {
    clearTimeout(timeoutId);
    throw e instanceof Error ? e : new Error(String(e));
  }
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

  const logs = await fetchBlockscoutLogs(GIWA_VERIFIED_ACCOUNT_SCHEMA_UID, log);

  // Attested event topic layout (after fix in EAS spec):
  // topics[0] = event sig, topics[1] = recipient, topics[2] = attester, topics[3] = schema
  const matching = logs.filter((l) => {
    const recipient = topicToAddress(l.topics[1]);
    return recipient.toLowerCase() === walletAddress.toLowerCase();
  });

  if (matching.length === 0) {
    log(`[GIWA Search] No GIWA attestation found for wallet ${walletAddress}`);
    return null;
  }
  log(`[GIWA Search] Matching attestations: ${matching.length}`);

  // Try each candidate tx until one yields a valid raw tx
  for (const match of matching) {
    try {
      const rawTx = await reconstructRawTx(match.transaction_hash, log);

      // Sanity: tx.to must equal MockCoinbaseAttester contract
      const parsed = ethers.utils.parseTransaction(rawTx);
      if (
        parsed.to?.toLowerCase() !== GIWA_MOCK_ATTESTER_CONTRACT.toLowerCase()
      ) {
        log(
          `[GIWA Search] tx.to=${parsed.to} != ${GIWA_MOCK_ATTESTER_CONTRACT}, skipping`,
        );
        continue;
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
      log(`[GIWA Search] candidate failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  log('[GIWA Search] No usable attestation among candidates.');
  return null;
}
