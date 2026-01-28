import {ethers} from 'ethers';

// EAS GraphQL endpoint for Base chain
const EAS_GRAPHQL_ENDPOINT = 'https://base.easscan.org/graphql';

// Coinbase Verification schema ID on Base
const COINBASE_SCHEMA_ID = '0xf8b05c79f090979bf4a80270aba232dff11a10d9ca55c4f88de95317970f0de9';

// Coinbase Attester Contract address
const COINBASE_ATTESTER_CONTRACT = '0x357458739F90461b99789350868CD7CF330Dd7EE';

// Base RPC endpoints (multiple fallbacks)
const BASE_RPC_URLS = [
  'https://base.llamarpc.com',
  'https://base-rpc.publicnode.com',
  'https://base.drpc.org',
  'https://mainnet.base.org',
];

export interface AttestationInfo {
  id: string;
  txHash: string;
  attester: string;
  recipient: string;
  time: number;
  rawTransaction?: string;
}

/**
 * Search for Coinbase attestations for a given wallet address using EAS GraphQL
 */
export async function searchAttestations(
  walletAddress: string,
  addLog?: (msg: string) => void,
): Promise<AttestationInfo[]> {
  const log = addLog || console.log;

  log('Searching for Coinbase attestations...');
  log(`Wallet: ${walletAddress}`);

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
    const response = await fetch(EAS_GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query,
        variables: {
          recipient: walletAddress.toLowerCase(),
          schemaId: COINBASE_SCHEMA_ID,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`GraphQL request failed: ${response.status}`);
    }

    const data = await response.json();

    if (data.errors) {
      throw new Error(data.errors[0].message);
    }

    const attestations = data.data?.attestations || [];
    log(`Found ${attestations.length} attestation(s)`);

    return attestations.map((a: any) => ({
      id: a.id,
      txHash: a.txid,
      attester: a.attester,
      recipient: a.recipient,
      time: a.time,
    }));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    log(`Error searching attestations: ${errorMessage}`);
    throw error;
  }
}

/**
 * Fetch transaction and reconstruct raw transaction data from Base chain
 */
export async function fetchRawTransaction(
  txHash: string,
  addLog?: (msg: string) => void,
): Promise<string> {
  const log = addLog || console.log;

  log(`Fetching transaction: ${txHash}`);

  let lastError: Error | null = null;

  for (const rpcUrl of BASE_RPC_URLS) {
    try {
      log(`Trying RPC: ${rpcUrl.split('/')[2]}`);

      // First try eth_getRawTransactionByHash (some nodes support it)
      let response = await fetch(rpcUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_getRawTransactionByHash',
          params: [txHash],
          id: 1,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.result && !data.error) {
          log(`Raw transaction fetched directly: ${data.result.slice(0, 20)}...`);
          return data.result;
        }
      }

      // Fallback: fetch transaction and reconstruct
      response = await fetch(rpcUrl, {
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
      });

      if (!response.ok) {
        throw new Error(`RPC request failed: ${response.status}`);
      }

      const data = await response.json();

      if (data.error) {
        throw new Error(data.error.message);
      }

      const tx = data.result;
      if (!tx) {
        throw new Error('Transaction not found');
      }

      // Reconstruct raw transaction from transaction data
      const rawTx = reconstructRawTransaction(tx);
      log(`Raw transaction reconstructed: ${rawTx.slice(0, 20)}...`);
      return rawTx;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      log(`RPC ${rpcUrl.split('/')[2]} failed: ${lastError.message}`);
      continue;
    }
  }

  throw lastError || new Error('All RPC endpoints failed');
}

/**
 * Reconstruct raw signed transaction from transaction object
 */
function reconstructRawTransaction(tx: any): string {
  // EIP-1559 transaction (type 2)
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

    // EIP-1559 uses yParity (0 or 1), not full v value
    // v from RPC is already yParity for type-2 transactions (0x0 or 0x1)
    const vValue = parseInt(tx.v, 16);
    // For EIP-1559, v should be 0 or 1 (yParity)
    // If legacy v format is returned, extract parity with modulo
    const yParity = vValue <= 1 ? vValue : vValue % 2;
    const signature = {
      r: tx.r,
      s: tx.s,
      v: yParity,
    };

    return ethers.utils.serializeTransaction(txData, signature);
  }

  // Legacy transaction (type 0)
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

/**
 * Validate that a transaction is a valid Coinbase attestation
 */
export function validateAttestationTransaction(
  rawTx: string,
  expectedRecipient: string,
  addLog?: (msg: string) => void,
): {valid: boolean; error?: string} {
  const log = addLog || console.log;

  try {
    const tx = ethers.utils.parseTransaction(rawTx);

    // Check destination is Coinbase Attester Contract
    if (tx.to?.toLowerCase() !== COINBASE_ATTESTER_CONTRACT.toLowerCase()) {
      return {valid: false, error: 'Transaction not sent to Coinbase Attester Contract'};
    }

    // Check function selector (attestAccount)
    const selector = tx.data.slice(0, 10);
    if (selector !== '0x56feed5e') {
      return {valid: false, error: 'Invalid function selector'};
    }

    // Extract address from calldata (last 20 bytes of 32-byte padded address)
    const calldataAddress = '0x' + tx.data.slice(34, 74);
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

/**
 * Full flow: Search attestation and fetch raw transaction
 */
export async function findAttestationTransaction(
  walletAddress: string,
  addLog?: (msg: string) => void,
): Promise<{attestation: AttestationInfo; rawTransaction: string} | null> {
  const log = addLog || console.log;

  // Search for attestations
  const attestations = await searchAttestations(walletAddress, log);

  if (attestations.length === 0) {
    log('No attestations found for this wallet');
    return null;
  }

  // Use the most recent attestation
  const attestation = attestations[0];
  log(`Using attestation from ${new Date(attestation.time * 1000).toLocaleString()}`);
  log(`TX Hash: ${attestation.txHash}`);

  // Fetch raw transaction
  const rawTransaction = await fetchRawTransaction(attestation.txHash, log);

  // Validate the transaction
  const validation = validateAttestationTransaction(rawTransaction, walletAddress, log);
  if (!validation.valid) {
    log(`Validation failed: ${validation.error}`);
    return null;
  }

  return {
    attestation: {...attestation, rawTransaction},
    rawTransaction,
  };
}
