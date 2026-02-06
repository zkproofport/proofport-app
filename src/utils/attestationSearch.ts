import {ethers} from 'ethers';
import {STATIC_CONFIGS} from '../config/contracts';

// Coinbase attestations are issued on Base Mainnet regardless of app environment.
// Always use production config for attestation search.
const PRODUCTION_CONFIG = STATIC_CONFIGS.production;
const EAS_GRAPHQL_ENDPOINT = PRODUCTION_CONFIG.attestation.easGraphqlEndpoint;
const COINBASE_KYC_SCHEMA_ID = '0xf8b05c79f090979bf4a80270aba232dff11a10d9ca55c4f88de95317970f0de9';
const COINBASE_COUNTRY_SCHEMA_ID = '0x1801901fabd0e6189356b4fb52bb0ab855276d84f7ec140839fbd1f6801ca065';
const COINBASE_ATTESTER_CONTRACT = PRODUCTION_CONFIG.attestation.coinbaseAttester;

const BASE_RPC_URLS = PRODUCTION_CONFIG.rpcUrls.base;

// In-memory session cache for attestation results
const attestationCache = new Map<string, {result: {attestation: AttestationInfo; rawTransaction: string}; timestamp: number}>();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

export interface AttestationInfo {
  id: string;
  txHash: string;
  attester: string;
  recipient: string;
  time: number;
  rawTransaction?: string;
}

export async function searchAttestations(
  walletAddress: string,
  addLog?: (msg: string) => void,
  schemaId?: string,
): Promise<AttestationInfo[]> {
  const log = addLog || console.log;
  const targetSchema = schemaId || COINBASE_KYC_SCHEMA_ID;

  log('Searching for Coinbase attestations...');
  log(`[EAS] Endpoint: ${EAS_GRAPHQL_ENDPOINT}`);
  log(`[EAS] Schema: ${targetSchema}`);
  log(`[EAS] Wallet: ${walletAddress}`);

  const query = `
    query GetAttestations($recipient: String!, $schemaId: String!) {
      attestations(
        where: {
          recipient: { equals: $recipient }
          schemaId: { equals: $schemaId }
        }
        orderBy: { time: desc }
        take: 10
      ) {
        id
        txid
        attester
        recipient
        time
      }
    }
  `;

  try {
    log('[EAS] Connecting to EAS GraphQL endpoint...');
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(EAS_GRAPHQL_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          query,
          variables: {
            recipient: walletAddress.toLowerCase(),
            schemaId: targetSchema,
          },
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      log('[EAS] Query sent, awaiting response...');

      if (!response.ok) {
        throw new Error(`GraphQL request failed: ${response.status}`);
      }
      log(`[EAS] Response received (HTTP ${response.status})`);

      const data = await response.json();
      log('[EAS] Response parsed successfully');

      if (data.errors) {
        throw new Error(data.errors[0].message);
      }

      const attestations = data.data?.attestations || [];
      log(`Found ${attestations.length} attestation(s)`);
      attestations.forEach((a: any, i: number) => {
        log(`[EAS] Attestation #${i + 1}: ID=${a.id}, attester=${a.attester}`);
      });

      return attestations.map((a: any) => ({
        id: a.id,
        txHash: a.txid,
        attester: a.attester,
        recipient: a.recipient,
        time: a.time,
      }));
    } catch (fetchError) {
      clearTimeout(timeoutId);
      throw fetchError;
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`Error searching attestations: ${errorMessage}`);
    throw error;
  }
}

async function fetchFromSingleRpc(txHash: string, rpcUrl: string, addLog?: (msg: string) => void): Promise<string> {
  const log = addLog || console.log;

  log(`[TX] Connecting to ${rpcUrl.split('/')[2]}...`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_getTransactionByHash',
        params: [txHash],
        id: 1,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`RPC request failed: ${response.status}`);
    }

    const data = await response.json();
    log('[TX] Transaction data received');

    if (data.error) {
      throw new Error(data.error.message);
    }

    const tx = data.result;
    if (!tx) {
      throw new Error('Transaction not found');
    }

    log(`[TX] Type: ${tx.type === '0x2' ? 'EIP-1559 (Type 2)' : 'Legacy'}`);
    log(`[TX] To: ${tx.to}`);
    log(`[TX] Chain: ${parseInt(tx.chainId, 16)} (${parseInt(tx.chainId, 16) === 8453 ? 'Base' : 'Unknown'})`);

    const rawTx = reconstructRawTransaction(tx);
    log(`[TX] Raw transaction reconstructed: ${rawTx.length} chars`);
    return rawTx;
  } catch (error) {
    clearTimeout(timeoutId);
    throw error instanceof Error ? error : new Error(String(error));
  }
}

export async function fetchRawTransaction(
  txHash: string,
  addLog?: (msg: string) => void,
): Promise<string> {
  const log = addLog || console.log;

  log('[TX] Fetching raw transaction data...');
  log(`[TX] TX Hash: ${txHash}`);

  try {
    const result = await Promise.any(
      BASE_RPC_URLS.map(rpcUrl => fetchFromSingleRpc(txHash, rpcUrl, log))
    );
    return result;
  } catch (aggregateError) {
    throw new Error(`Failed to fetch raw transaction from all RPCs: ${txHash}`);
  }
}

function reconstructRawTransaction(tx: any): string {
  if (tx.type === '0x2') {
    const txData: ethers.utils.UnsignedTransaction = {
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
    const signature = {
      r: tx.r,
      s: tx.s,
      v: yParity,
    };

    return ethers.utils.serializeTransaction(txData, signature);
  }

  const txData: ethers.utils.UnsignedTransaction = {
    nonce: parseInt(tx.nonce, 16),
    gasPrice: ethers.BigNumber.from(tx.gasPrice),
    gasLimit: ethers.BigNumber.from(tx.gas),
    to: tx.to,
    value: ethers.BigNumber.from(tx.value),
    data: tx.input,
    chainId: parseInt(tx.chainId, 16),
  };

  const signature = {
    r: tx.r,
    s: tx.s,
    v: parseInt(tx.v, 16),
  };

  return ethers.utils.serializeTransaction(txData, signature);
}

export const SELECTOR_ATTEST_ACCOUNT = '0x56feed5e';
export const SELECTOR_ATTEST_COUNTRY = '0x0a225248';
const ALL_VALID_SELECTORS = [SELECTOR_ATTEST_ACCOUNT, SELECTOR_ATTEST_COUNTRY];

export function validateAttestationTransaction(
  rawTx: string,
  expectedRecipient: string,
  addLog?: (msg: string) => void,
  expectedSelector?: string,
): {valid: boolean; error?: string} {
  const log = addLog || console.log;

  try {
    log('[Validate] Parsing raw transaction...');
    const tx = ethers.utils.parseTransaction(rawTx);

    log(`[Validate] To address: ${tx.to}`);
    log(`[Validate] Expected: ${COINBASE_ATTESTER_CONTRACT}`);
    if (tx.to?.toLowerCase() !== COINBASE_ATTESTER_CONTRACT.toLowerCase()) {
      return {valid: false, error: 'Transaction not sent to Coinbase Attester Contract'};
    }

    const selector = tx.data.slice(0, 10);
    log(`[Validate] Function selector: ${selector}`);

    if (expectedSelector) {
      log(`[Validate] Expected selector: ${expectedSelector}`);
      if (selector !== expectedSelector) {
        return {valid: false, error: `Selector mismatch: got ${selector}, expected ${expectedSelector}`};
      }
    } else {
      log('[Validate] Expected selectors: 0x56feed5e (attestAccount) or 0x0a225248 (attestCountry)');
      if (!ALL_VALID_SELECTORS.includes(selector)) {
        return {valid: false, error: 'Invalid function selector'};
      }
    }

    const calldataAddress = '0x' + tx.data.slice(34, 74);
    log(`[Validate] Calldata address: ${calldataAddress}`);
    log(`[Validate] Match: ${calldataAddress.toLowerCase() === expectedRecipient.toLowerCase() ? 'YES' : 'NO'}`);
    if (calldataAddress.toLowerCase() !== expectedRecipient.toLowerCase()) {
      return {
        valid: false,
        error: `Calldata address (${calldataAddress}) does not match expected (${expectedRecipient})`,
      };
    }

    log('Transaction validated successfully');
    return {valid: true};
  } catch (error) {
    return {
      valid: false,
      error: error instanceof Error ? error.message : 'Failed to parse transaction',
    };
  }
}

export async function findAttestationTransaction(
  walletAddress: string,
  addLog?: (msg: string) => void,
  expectedSelector?: string,
): Promise<{attestation: AttestationInfo; rawTransaction: string} | null> {
  const log = addLog || console.log;

  const isCountry = expectedSelector === SELECTOR_ATTEST_COUNTRY;
  const schemaId = isCountry ? COINBASE_COUNTRY_SCHEMA_ID : COINBASE_KYC_SCHEMA_ID;

  // Check cache first
  const cacheKey = `${walletAddress}:${schemaId}`;
  const cached = attestationCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    log('[Cache] Returning cached attestation result');
    return cached.result;
  }

  log('[Search] Starting attestation search for wallet...');
  log(`[Search] Wallet: ${walletAddress}`);
  log(`[Search] Type: ${isCountry ? 'Verified Country' : 'Verified Account'}`);
  if (expectedSelector) {
    log(`[Search] Expected selector: ${expectedSelector}`);
  }
  const attestations = await searchAttestations(walletAddress, log, schemaId);

  if (attestations.length === 0) {
    log('No attestations found for this wallet');
    return null;
  }

  // Deduplicate attestations by txHash to avoid fetching the same transaction multiple times
  const uniqueTxHashes = new Set<string>();
  const uniqueAttestations = attestations.filter(a => {
    if (uniqueTxHashes.has(a.txHash)) {
      return false;
    }
    uniqueTxHashes.add(a.txHash);
    return true;
  });

  log(`[Search] Found ${attestations.length} attestation(s) (${uniqueAttestations.length} unique tx), checking in parallel...`);

  // Check all attestations in parallel — first valid one wins
  try {
    const result = await Promise.any(
      uniqueAttestations.map(async (attestation, i) => {
        log(`[Search] [#${i + 1}] Fetching tx ${attestation.txHash}`);
        const rawTransaction = await fetchRawTransaction(attestation.txHash);
        const validation = validateAttestationTransaction(rawTransaction, walletAddress, undefined, expectedSelector);
        if (!validation.valid) {
          throw new Error(validation.error || 'Validation failed');
        }
        log(`[Search] [#${i + 1}] Valid attestation found!`);
        return {
          attestation: {...attestation, rawTransaction},
          rawTransaction,
        };
      }),
    );
    log('[Search] Validation passed! Transaction is authentic.');

    // Cache the result
    attestationCache.set(cacheKey, {result, timestamp: Date.now()});

    return result;
  } catch {
    // Promise.any rejects only when ALL promises reject (AggregateError)
    log('No matching attestation found after checking all candidates');
    return null;
  }
}
