/**
 * Human Passport score (`human_passport_score`): find the wallet's signed score
 * on Base and build the circuit's inputs.
 *
 * What the circuit proves (circuits human-passport-score/src/main.nr): a
 * scoreV2 attestation request signed (EIP-712) by Human Passport's issuer
 * names this wallet, scores it at least `min_score` by scorer 335, and has not
 * expired at `now`. The signed request is not stored in the attestation; it
 * is the calldata of the transaction that created it (GitcoinVerifier
 * `verifyAndAttest`), so the lookup is: EAS record -> its transaction -> the
 * verifyAndAttest call inside it -> the issuer's signature.
 *
 * A person records their score on the chain THEY choose (Base, OP Mainnet,
 * Arbitrum One, Linea, Scroll, Shape, zkSync Era), so the lookup runs per
 * chain, on the chain's mainnet whatever the app environment: Human Passport
 * attests production scores nowhere else.
 */
import {ethers} from 'ethers';
import {
  HUMAN_PASSPORT_CHAIN_IDS,
  HUMAN_PASSPORT_ISSUER,
  HUMAN_PASSPORT_ISSUER_LEAVES,
  HUMAN_PASSPORT_MAX_DATA_BYTES,
  HUMAN_PASSPORT_SCORE_DECIMALS,
  humanPassportChain,
} from '../config/circuitIds';
import {computeScope, computeWalletNullifier} from './circuitHelpers';

export const HUMAN_PASSPORT_CIRCUIT = 'human_passport_score';

const LOOKUP_TIMEOUT_MS = 10_000;

/** EAS on OP-stack chains (Shape) is the predeploy. */
const EAS_PREDEPLOY = '0x4200000000000000000000000000000000000021';

/**
 * Where each chain's scores are found. An indexer (EAS Scan GraphQL) where
 * one exists; Shape has none, so its explorer's log search finds the
 * attestation and the chain itself answers what it holds. Keyed by chain id;
 * an id without a row is an error, never another chain's endpoint.
 */
type ChainLookup =
  | {kind: 'easscan'; graphql: string; rpcUrls: readonly string[]}
  | {kind: 'blockscout'; api: string; rpcUrls: readonly string[]};
const CHAIN_LOOKUP: Readonly<Record<number, ChainLookup>> = Object.freeze({
  8453: {kind: 'easscan', graphql: 'https://base.easscan.org/graphql', rpcUrls: ['https://base-rpc.publicnode.com', 'https://mainnet.base.org', 'https://base.drpc.org']},
  10: {kind: 'easscan', graphql: 'https://optimism.easscan.org/graphql', rpcUrls: ['https://mainnet.optimism.io', 'https://optimism-rpc.publicnode.com']},
  42161: {kind: 'easscan', graphql: 'https://arbitrum.easscan.org/graphql', rpcUrls: ['https://arb1.arbitrum.io/rpc', 'https://arbitrum-one-rpc.publicnode.com']},
  59144: {kind: 'easscan', graphql: 'https://linea.easscan.org/graphql', rpcUrls: ['https://rpc.linea.build', 'https://linea-rpc.publicnode.com']},
  534352: {kind: 'easscan', graphql: 'https://scroll.easscan.org/graphql', rpcUrls: ['https://rpc.scroll.io', 'https://scroll-rpc.publicnode.com']},
  360: {kind: 'blockscout', api: 'https://shapescan.xyz/api', rpcUrls: ['https://mainnet.shape.network']},
  324: {kind: 'easscan', graphql: 'https://zksync.easscan.org/graphql', rpcUrls: ['https://mainnet.era.zksync.io']},
});

export function chainLookup(chainId: number): ChainLookup {
  humanPassportChain(chainId);
  if (!Object.prototype.hasOwnProperty.call(CHAIN_LOOKUP, chainId)) {
    throw new Error(`No score lookup for Human Passport chain ${chainId}. Known: ${Object.keys(CHAIN_LOOKUP).join(', ')}.`);
  }
  return CHAIN_LOOKUP[chainId];
}

/** verifyAndAttest(PassportAttestationRequest,uint8,bytes32,bytes32) */
const VERIFY_AND_ATTEST =
  'function verifyAndAttest(((bytes32 schema,(address recipient,uint64 expirationTime,bool revocable,bytes32 refUID,bytes data,uint256 value)[] data)[] multiAttestationRequest,uint256 nonce,uint256 fee) attestationRequest,uint8 v,bytes32 r,bytes32 s) payable returns (bytes32[])';
const VERIFIER_IFACE = new ethers.utils.Interface([VERIFY_AND_ATTEST]);
const SELECTOR = VERIFIER_IFACE.getSighash('verifyAndAttest').slice(2).toLowerCase();

const T = (s: string) => ethers.utils.keccak256(ethers.utils.toUtf8Bytes(s));
const STAMP_TYPEHASH = T('AttestationRequestData(address recipient,uint64 expirationTime,bool revocable,bytes32 refUID,bytes data,uint256 value)');
const MULTI_TYPEHASH = T('MultiAttestationRequest(bytes32 schema,AttestationRequestData[] data)AttestationRequestData(address recipient,uint64 expirationTime,bool revocable,bytes32 refUID,bytes data,uint256 value)');
const PASSPORT_TYPEHASH = T('PassportAttestationRequest(MultiAttestationRequest[] multiAttestationRequest,uint256 nonce,uint256 fee)AttestationRequestData(address recipient,uint64 expirationTime,bool revocable,bytes32 refUID,bytes data,uint256 value)MultiAttestationRequest(bytes32 schema,AttestationRequestData[] data)');
const abi = ethers.utils.defaultAbiCoder;

/** Why no score could be used. Each maps to the code the screen shows. */
export type HumanPassportFailure =
  | 'E2021' // no unexpired score for this wallet (or none usable)
  | 'E2022' // score below the requested threshold
  | 'E2023' // score data larger than the circuit holds
  | 'E3001'; // the lookup did not complete

export class HumanPassportError extends Error {
  constructor(readonly code: HumanPassportFailure, message: string) {
    super(message);
    this.name = 'HumanPassportError';
  }
}

/** The signed request: every field the issuer's EIP-712 signature covers. */
export interface PassportRequest {
  schema: string;
  recipient: string;
  expirationTime: number;
  revocable: boolean;
  refUID: string;
  data: string;
  value: string; // 32-byte hex
  nonce: string; // 32-byte hex
  fee: string; // 32-byte hex
}

export interface ScoreHead {
  passingScore: boolean;
  decimals: number;
  scorerId: number;
  score: number; // score x 10^decimals
  threshold: number;
}

export interface PassportIssuance {
  /** The chain the person recorded this score on. */
  chainId: number;
  txHash: string;
  attestationId: string;
  request: PassportRequest;
  /** r || s, 64 bytes, as signed. */
  issuerSignature: string;
  /** Uncompressed 0x04 || x || y, recovered from the signature. */
  issuerPubkey: string;
  /** Index into HUMAN_PASSPORT_ISSUER_LEAVES: the chain's GitcoinVerifier whose domain signed it. */
  leafIndex: number;
  domainSeparator: string;
  head: ScoreHead;
}

export function passportDigest(domainSeparator: string, r: PassportRequest): string {
  const entry = ethers.utils.keccak256(abi.encode(
    ['bytes32', 'address', 'uint64', 'bool', 'bytes32', 'bytes32', 'uint256'],
    [STAMP_TYPEHASH, r.recipient, r.expirationTime, r.revocable, r.refUID, ethers.utils.keccak256(r.data), r.value],
  ));
  const multi = ethers.utils.keccak256(abi.encode(['bytes32', 'bytes32', 'bytes32'], [MULTI_TYPEHASH, r.schema, ethers.utils.keccak256(entry)]));
  const struct = ethers.utils.keccak256(abi.encode(
    ['bytes32', 'bytes32', 'uint256', 'uint256'],
    [PASSPORT_TYPEHASH, ethers.utils.keccak256(multi), r.nonce, r.fee],
  ));
  return ethers.utils.keccak256(ethers.utils.concat(['0x1901', domainSeparator, struct]));
}

/**
 * The five static words of scoreV2 data, read as Solidity's abi.decode reads
 * them, with the checks the circuit makes (score_data.nr): a reading the
 * circuit would refuse is refused here, before the wallet is asked to sign.
 */
export function readScoreHead(data: string): ScoreHead {
  const bytes = ethers.utils.arrayify(data);
  if (bytes.length < 192) throw new Error(`score data is ${bytes.length} bytes, shorter than its head`);
  const word = (i: number) => ethers.BigNumber.from(bytes.slice(i * 32, i * 32 + 32));
  const fits = (i: number, bits: number) => word(i).lt(ethers.BigNumber.from(2).pow(bits));
  if (!fits(0, 1) || !fits(1, 8) || !fits(2, 128) || !fits(3, 32) || !fits(4, 32)) {
    throw new Error('score data head has non-zero padding');
  }
  if (!word(5).eq(0xc0)) throw new Error('score data stamps offset is not 0xc0');
  const head: ScoreHead = {
    passingScore: word(0).eq(1),
    decimals: word(1).toNumber(),
    scorerId: Number(word(2).toString()),
    score: word(3).toNumber(),
    threshold: word(4).toNumber(),
  };
  if (head.decimals !== HUMAN_PASSPORT_SCORE_DECIMALS) {
    throw new Error(`score data has ${head.decimals} decimals; the circuit reads ${HUMAN_PASSPORT_SCORE_DECIMALS}`);
  }
  return head;
}

/**
 * Every verifyAndAttest call inside a transaction's calldata. Most issuances
 * call GitcoinVerifier directly; some arrive through a smart account
 * (ERC-4337 EntryPoint, a batch), where the call sits ABI-encoded inside the
 * outer calldata. Each occurrence of the selector is tried as the start of a
 * call; what does not decode is skipped, and whatever decodes is still held to
 * the issuer's signature by the caller.
 */
export function findVerifyAndAttestCalls(calldata: string): ethers.utils.Result[] {
  const hex = calldata.toLowerCase().replace(/^0x/, '');
  const found: ethers.utils.Result[] = [];
  for (let at = hex.indexOf(SELECTOR); at !== -1; at = hex.indexOf(SELECTOR, at + 2)) {
    if (at % 2 !== 0) continue;
    try {
      found.push(VERIFIER_IFACE.decodeFunctionData('verifyAndAttest', '0x' + hex.slice(at)));
    } catch {
      // Not a call (or a truncated one): the bytes only happened to match.
    }
  }
  return found;
}

const word32 = (v: ethers.BigNumberish) => ethers.utils.hexZeroPad(ethers.BigNumber.from(v).toHexString(), 32);

/**
 * Turn one decoded call into the issuance this wallet can prove, or say why
 * not. `attestation` is the EAS record the call must have created.
 */
export function matchIssuance(
  call: ethers.utils.Result,
  attestation: {id: string; txid: string; recipient: string; data: string; expirationTime: number},
  wallet: string,
  chainId: number,
): PassportIssuance | {error: string} {
  const chain = humanPassportChain(chainId);
  const req = call.attestationRequest;
  if (req.multiAttestationRequest.length !== 1 || req.multiAttestationRequest[0].data.length !== 1) {
    return {error: 'the signed request does not hold exactly one attestation'};
  }
  const multi = req.multiAttestationRequest[0];
  const entry = multi.data[0];
  if (multi.schema.toLowerCase() !== chain.schema.toLowerCase()) {
    return {error: `schema ${multi.schema} is not Human Passport's score schema on ${chain.name}`};
  }
  if (entry.recipient.toLowerCase() !== wallet.toLowerCase()) {
    return {error: `the request names ${entry.recipient}, not this wallet`};
  }
  if (entry.data.toLowerCase() !== attestation.data.toLowerCase()) {
    return {error: 'the request carries other data than the attestation'};
  }
  if (Number(entry.expirationTime.toString()) !== attestation.expirationTime) {
    return {error: 'the request expires at another time than the attestation'};
  }
  const request: PassportRequest = {
    schema: multi.schema,
    recipient: entry.recipient,
    expirationTime: Number(entry.expirationTime.toString()),
    revocable: entry.revocable,
    refUID: entry.refUID,
    data: entry.data,
    value: word32(entry.value),
    nonce: word32(req.nonce),
    fee: word32(req.fee),
  };
  const signature = ethers.utils.joinSignature({r: call.r, s: call.s, v: Number(call.v.toString())});
  for (let i = 0; i < HUMAN_PASSPORT_ISSUER_LEAVES.length; i++) {
    if (HUMAN_PASSPORT_ISSUER_LEAVES[i].chainId !== chainId) continue;
    const domain = HUMAN_PASSPORT_ISSUER_LEAVES[i].domainSeparator;
    const digest = passportDigest(domain, request);
    let recovered: string;
    try {
      recovered = ethers.utils.recoverAddress(digest, signature);
    } catch {
      continue;
    }
    if (recovered.toLowerCase() !== HUMAN_PASSPORT_ISSUER.toLowerCase()) continue;
    let head: ScoreHead;
    try {
      head = readScoreHead(request.data);
    } catch (e) {
      return {error: e instanceof Error ? e.message : String(e)};
    }
    if (head.scorerId !== chain.scorerId) {
      return {error: `scorer ${head.scorerId}, not ${chain.name}'s ${chain.scorerId}`};
    }
    return {
      chainId,
      txHash: attestation.txid,
      attestationId: attestation.id,
      request,
      issuerSignature: ethers.utils.hexConcat([call.r, call.s]),
      issuerPubkey: ethers.utils.recoverPublicKey(digest, signature),
      leafIndex: i,
      domainSeparator: domain,
      head,
    };
  }
  return {error: `no ${chain.name} GitcoinVerifier domain recovers Human Passport's issuer from this signature`};
}

async function withTimeout<T>(what: string, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    return await run(controller.signal);
  } catch (e) {
    throw new HumanPassportError('E3001', `${what} did not complete: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    clearTimeout(timer);
  }
}

interface EasRecord {id: string; txid: string; recipient: string; data: string; expirationTime: number; revoked: boolean}

async function postJson(url: string, body: unknown, what: string): Promise<any> {
  return withTimeout(what, async signal => {
    const res = await fetch(url, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body), signal});
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  });
}

async function rpc(chainId: number, method: string, params: unknown[], log: (m: string) => void): Promise<any> {
  let last: unknown;
  for (const url of chainLookup(chainId).rpcUrls) {
    try {
      const json = await postJson(url, {jsonrpc: '2.0', id: 1, method, params}, `${method} on chain ${chainId}`);
      if (json.error) throw new Error(json.error.message ?? 'rpc error');
      return json.result;
    } catch (e) {
      last = e;
      log(`[HumanPassport] ${url}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  throw last instanceof HumanPassportError ? last : new HumanPassportError('E3001', `No RPC answered ${method} on chain ${chainId}`);
}

const EAS_IFACE = new ethers.utils.Interface([
  'function getAttestation(bytes32 uid) view returns ((bytes32 uid, bytes32 schema, uint64 time, uint64 expirationTime, uint64 revocationTime, bytes32 refUID, address recipient, address attester, bool revocable, bytes data))',
]);
const ATTESTED_TOPIC = ethers.utils.id('Attested(address,address,bytes32,bytes32)');

/** The wallet's unexpired, unrevoked scoreV2 attestations on one chain, newest first. */
async function scoresOnChain(wallet: string, chainId: number, nowSeconds: number, log: (m: string) => void): Promise<EasRecord[]> {
  const chain = humanPassportChain(chainId);
  const lookup = chainLookup(chainId);
  const recipient = ethers.utils.getAddress(wallet);
  if (lookup.kind === 'easscan') {
    const query = `query HumanPassportScores($recipient: String!, $schemaId: String!, $now: Int!) {
      attestations(
        where: { recipient: { equals: $recipient }, schemaId: { equals: $schemaId }, revoked: { equals: false }, expirationTime: { gt: $now } }
        orderBy: { time: desc }
        take: 5
      ) { id txid recipient data expirationTime revoked }
    }`;
    const body = await postJson(lookup.graphql, {query, variables: {recipient, schemaId: chain.schema, now: nowSeconds}}, `The score lookup on ${chain.name}`);
    if (body.errors) throw new HumanPassportError('E3001', `The score lookup on ${chain.name} failed: ${String(body.errors[0]?.message)}`);
    return (body?.data?.attestations ?? [])
      .filter((a: EasRecord) => a.revoked === false && Number(a.expirationTime) > nowSeconds && a.recipient.toLowerCase() === wallet.toLowerCase())
      .map((a: EasRecord) => ({...a, expirationTime: Number(a.expirationTime)}));
  }
  // No indexer: the explorer's log search names the attestations made for
  // this wallet under the chain's schema; the chain says what each holds now.
  const topic = (hex: string) => ethers.utils.hexZeroPad(hex, 32).toLowerCase();
  const url = `${lookup.api}?module=logs&action=getLogs&fromBlock=0&toBlock=latest&address=${EAS_PREDEPLOY}` +
    `&topic0=${ATTESTED_TOPIC}&topic1=${topic(recipient)}&topic3=${chain.schema}&topic0_1_opr=and&topic0_3_opr=and&topic1_3_opr=and`;
  const json = await withTimeout(`The score lookup on ${chain.name}`, async signal => {
    const res = await fetch(url, {signal});
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  });
  if (!Array.isArray(json?.result)) {
    // Blockscout answers "No logs found" with an empty or missing result.
    if (/no logs found/i.test(String(json?.message))) return [];
    throw new HumanPassportError('E3001', `The score lookup on ${chain.name} answered ${JSON.stringify(json?.message)}`);
  }
  const logs = [...json.result].sort((a: any, b: any) => Number(b.blockNumber) - Number(a.blockNumber)).slice(0, 5);
  const records: EasRecord[] = [];
  for (const entry of logs) {
    const uid = ethers.utils.hexDataSlice(entry.data, 0, 32);
    const raw = await rpc(chainId, 'eth_call', [{to: EAS_PREDEPLOY, data: EAS_IFACE.encodeFunctionData('getAttestation', [uid])}, 'latest'], log);
    const [a] = EAS_IFACE.decodeFunctionResult('getAttestation', raw);
    const expirationTime = Number(a.expirationTime.toString());
    if (a.uid.toLowerCase() !== uid.toLowerCase() || a.schema.toLowerCase() !== chain.schema.toLowerCase()) continue;
    if (a.recipient.toLowerCase() !== wallet.toLowerCase()) continue;
    if (!a.revocationTime.isZero() || !(expirationTime > nowSeconds)) continue;
    records.push({id: uid, txid: entry.transactionHash, recipient: a.recipient, data: a.data, expirationTime, revoked: false});
  }
  return records;
}

/**
 * The wallet's newest unexpired Human Passport score on `chainId` that the
 * circuit can prove, checked against `minScoreUnits` before anything is
 * signed. `chainId` must be one of HUMAN_PASSPORT_CHAINS: the person chose it.
 */
export async function findHumanPassportScore(
  wallet: string,
  chainId: number,
  minScoreUnits: number,
  nowSeconds: number,
  log: (m: string) => void,
): Promise<PassportIssuance> {
  const chain = humanPassportChain(chainId);
  log(`[HumanPassport] Looking up ${wallet} on ${chain.name} (${chainId})`);
  const records = await scoresOnChain(wallet, chainId, nowSeconds, log);
  log(`[HumanPassport] ${records.length} unexpired score(s) on ${chain.name}`);
  if (records.length === 0) {
    throw new HumanPassportError('E2021', `No unexpired Human Passport score on ${chain.name} for ${wallet}`);
  }
  const refusals: string[] = [];
  for (const record of records) {
    const tx = await rpc(chainId, 'eth_getTransactionByHash', [record.txid], log);
    if (!tx?.input) {
      refusals.push(`${record.id}: transaction ${record.txid} not found`);
      continue;
    }
    const calls = findVerifyAndAttestCalls(tx.input);
    for (const call of calls) {
      const matched = matchIssuance(call, record, wallet, chainId);
      if ('error' in matched) {
        refusals.push(`${record.id}: ${matched.error}`);
        continue;
      }
      const dataBytes = ethers.utils.hexDataLength(matched.request.data);
      if (dataBytes > HUMAN_PASSPORT_MAX_DATA_BYTES) {
        throw new HumanPassportError('E2023', `Score data is ${dataBytes} bytes; the proof holds ${HUMAN_PASSPORT_MAX_DATA_BYTES}`);
      }
      if (matched.head.score < minScoreUnits) {
        throw new HumanPassportError('E2022', `Score ${matched.head.score / 1e4} on ${chain.name} is below the requested ${minScoreUnits / 1e4}`);
      }
      log(`[HumanPassport] Using ${record.id} on ${chain.name} (tx ${record.txid}), verifier leaf ${matched.leafIndex}, ${dataBytes} data bytes`);
      return matched;
    }
    if (calls.length === 0) refusals.push(`${record.id}: no verifyAndAttest call in ${record.txid}`);
  }
  throw new HumanPassportError('E2021', `No usable Human Passport score on ${chain.name}: ${refusals.join('; ')}`);
}

/** What one chain holds for the wallet, for the chain picker. */
export type ChainScoreState =
  | {chainId: number; state: 'found'; score: number; expirationTime: number}
  | {chainId: number; state: 'none'}
  | {chainId: number; state: 'unchecked'; reason: string};

/**
 * Every Human Passport chain, looked up at once for the chain picker: where
 * the wallet holds an unexpired score (and the score), where it holds none,
 * and where the lookup did not finish -- three different answers, never one
 * read as another. The score shown is the attestation's own head; the proof
 * flow checks the issuer signature again before signing.
 */
export async function surveyHumanPassportChains(
  wallet: string,
  nowSeconds: number,
  log: (m: string) => void,
): Promise<ChainScoreState[]> {
  return Promise.all(HUMAN_PASSPORT_CHAIN_IDS.map(async (chainId): Promise<ChainScoreState> => {
    try {
      const records = await scoresOnChain(wallet, chainId, nowSeconds, log);
      if (records.length === 0) return {chainId, state: 'none'};
      const head = readScoreHead(records[0].data);
      return {chainId, state: 'found', score: head.score, expirationTime: records[0].expirationTime};
    } catch (e) {
      return {chainId, state: 'unchecked', reason: e instanceof Error ? e.message : String(e)};
    }
  }));
}

/**
 * The chain to prove from. The person's pick when there is one (it must be a
 * Human Passport chain); otherwise -- a dApp request, which has no picker --
 * every chain is looked up and the score that meets the threshold is used,
 * the newest when several do (each proves the same statement; the chain is
 * not in the proof). With none: E2022 when a score exists but is too low,
 * E3001 when a lookup did not finish (it might hold one), else E2021.
 */
export async function resolvePassportChain(
  wallet: string,
  picked: number | undefined,
  minScoreUnits: number,
  nowSeconds: number,
  log: (m: string) => void,
): Promise<number> {
  if (picked !== undefined) return humanPassportChain(picked).chainId;
  const states = await surveyHumanPassportChains(wallet, nowSeconds, log);
  for (const st of states) {
    log(`[HumanPassport] chain ${st.chainId}: ${st.state}${st.state === 'found' ? ` score ${st.score / 1e4}` : st.state === 'unchecked' ? ` (${st.reason})` : ''}`);
  }
  const meeting = states
    .filter((st): st is Extract<ChainScoreState, {state: 'found'}> => st.state === 'found' && st.score >= minScoreUnits)
    .sort((a, b) => b.expirationTime - a.expirationTime);
  if (meeting.length > 0) return meeting[0].chainId;
  if (states.some(st => st.state === 'found')) {
    throw new HumanPassportError('E2022', `No Human Passport score of at least ${minScoreUnits / 1e4} on any chain`);
  }
  if (states.some(st => st.state === 'unchecked')) {
    throw new HumanPassportError('E3001', 'The score lookup did not finish on every chain');
  }
  throw new HumanPassportError('E2021', `No unexpired Human Passport score on any chain for ${wallet}`);
}

const bytes = (hex: string) => Array.from(ethers.utils.arrayify(hex)).map(b => b.toString());
const ZERO32 = new Array(32).fill('0');

function merklePath(leaves: readonly string[], index: number): {root: string; proof: string[]} {
  if (!Number.isInteger(index) || index < 0 || index >= leaves.length) {
    throw new Error(`Issuer leaf ${index} is not in a list of ${leaves.length}`);
  }
  let level = [...leaves];
  let size = 1;
  while (size < level.length) size *= 2;
  while (level.length < size) level.push(ethers.constants.HashZero);
  const proof: string[] = [];
  let i = index;
  while (level.length > 1) {
    proof.push(level[i ^ 1]);
    const next: string[] = [];
    for (let k = 0; k < level.length; k += 2) next.push(ethers.utils.keccak256(ethers.utils.concat([level[k], level[k + 1]])));
    level = next;
    i >>= 1;
  }
  if (proof.length > 8) throw new Error(`Issuer list too deep for the circuit: ${proof.length} > 8`);
  return {root: level[0], proof};
}

export interface HumanPassportInputParams {
  signalHash: Uint8Array;
  action?: {domainSeparator: string; actionHash: string};
  userAddress: string;
  userSignature: string; // 65-byte hex
  userPubkey: string; // 0x04 || x || y
  scopeString: string;
  minScoreUnits: number;
  nowSeconds: number;
  issuance: Pick<PassportIssuance, 'request' | 'issuerSignature' | 'issuerPubkey' | 'leafIndex' | 'domainSeparator'> & {head: Pick<ScoreHead, 'scorerId'>};
  /** The issuer list the leaf index points into: HUMAN_PASSPORT_ISSUER_LEAVES' leaves in production. */
  issuerLeaves: readonly string[];
}

/** The circuit's flat input vector, in `fn main`'s parameter order (11,164 values). */
export function prepareHumanPassportInputs(p: HumanPassportInputParams): string[] {
  const r = p.issuance.request;
  if (!Number.isInteger(p.minScoreUnits) || p.minScoreUnits < 1 || p.minScoreUnits > 0xffffffff) {
    throw new Error(`min_score ${p.minScoreUnits} is not a threshold the circuit holds`);
  }
  if (!(p.nowSeconds < r.expirationTime)) {
    throw new Error(`The score expired at ${r.expirationTime}; now is ${p.nowSeconds}`);
  }
  const data = ethers.utils.arrayify(r.data);
  if (data.length > HUMAN_PASSPORT_MAX_DATA_BYTES) {
    throw new Error(`Score data is ${data.length} bytes; the proof holds ${HUMAN_PASSPORT_MAX_DATA_BYTES}`);
  }
  const {root, proof} = merklePath(p.issuerLeaves, p.issuance.leafIndex);
  const scope = computeScope(p.scopeString);
  const nullifier = computeWalletNullifier(p.userAddress, HUMAN_PASSPORT_CIRCUIT, scope);
  const sig = ethers.utils.splitSignature(p.userSignature);
  const userKey = ethers.utils.arrayify(p.userPubkey);
  const issuerKey = ethers.utils.arrayify(p.issuance.issuerPubkey);
  if (userKey.length !== 65 || issuerKey.length !== 65) throw new Error('Public keys must be uncompressed (65 bytes)');
  const paddedData = new Array(HUMAN_PASSPORT_MAX_DATA_BYTES).fill('0');
  data.forEach((b, i) => { paddedData[i] = b.toString(); });
  const paddedProof: string[] = [];
  for (let i = 0; i < 8; i++) paddedProof.push(...(i < proof.length ? bytes(proof[i]) : ZERO32));

  const out = [
    ...(p.action ? ZERO32 : Array.from(p.signalHash).map(String)),
    ...(p.action ? bytes(p.action.domainSeparator) : ZERO32),
    ...(p.action ? bytes(p.action.actionHash) : ZERO32),
    ...bytes(root),
    ...Array.from(scope).map(String),
    ...Array.from(nullifier).map(String),
    p.minScoreUnits.toString(),
    p.issuance.head.scorerId.toString(),
    p.nowSeconds.toString(),
    ...bytes(p.userAddress),
    ...bytes(sig.r), ...bytes(sig.s),
    ...Array.from(userKey.slice(1, 33)).map(String),
    ...Array.from(userKey.slice(33, 65)).map(String),
    ...bytes(p.issuance.domainSeparator),
    ...bytes(r.schema),
    r.expirationTime.toString(),
    r.revocable ? '1' : '0',
    ...bytes(r.refUID),
    ...bytes(r.value),
    ...bytes(r.nonce),
    ...bytes(r.fee),
    ...paddedData,
    data.length.toString(),
    ...bytes(p.issuance.issuerSignature),
    ...Array.from(issuerKey.slice(1, 33)).map(String),
    ...Array.from(issuerKey.slice(33, 65)).map(String),
    ...paddedProof,
    p.issuance.leafIndex.toString(),
    proof.length.toString(),
  ];
  if (out.length !== 11164) throw new Error(`Built ${out.length} inputs; human_passport_score takes 11164`);
  return out;
}

/** HUMAN_PASSPORT_ISSUER_LEAVES' leaf hashes, the production issuer list. */
export const PRODUCTION_ISSUER_LEAVES: readonly string[] = HUMAN_PASSPORT_ISSUER_LEAVES.map(l => l.leaf);
