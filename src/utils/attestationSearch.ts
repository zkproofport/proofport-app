import {ethers} from 'ethers';

const EAS_GRAPHQL_ENDPOINT = 'https://base.easscan.org/graphql';
const COINBASE_SCHEMA_ID = '0xf8b05c79f090979bf4a80270aba232dff11a10d9ca55c4f88de95317970f0de9';
const COINBASE_ATTESTER_CONTRACT = '0x357458739F90461b99789350868CD7CF330Dd7EE';

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

export function validateAttestationTransaction(
  rawTx: string,
  expectedRecipient: string,
  addLog?: (msg: string) => void,
): {valid: boolean; error?: string} {
  const log = addLog || console.log;

  try {
    const tx = ethers.utils.parseTransaction(rawTx);

    if (tx.to?.toLowerCase() !== COINBASE_ATTESTER_CONTRACT.toLowerCase()) {
      return {valid: false, error: 'Transaction not sent to Coinbase Attester Contract'};
    }

    // Check function selector (attestAccount)
    const selector = tx.data.slice(0, 10);
    if (selector !== '0x56feed5e') {
      return {valid: false, error: 'Invalid function selector'};
    }

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

export async function findAttestationTransaction(
  walletAddress: string,
  addLog?: (msg: string) => void,
): Promise<{attestation: AttestationInfo; rawTransaction: string} | null> {
  const log = addLog || console.log;

  const attestations = await searchAttestations(walletAddress, log);

  if (attestations.length === 0) {
    log('No attestations found for this wallet');
    return null;
  }

  const attestation = attestations[0];
  log(`Using attestation from ${new Date(attestation.time * 1000).toLocaleString()}`);
  log(`TX Hash: ${attestation.txHash}`);

  const rawTransaction = await fetchRawTransaction(attestation.txHash, log);

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
