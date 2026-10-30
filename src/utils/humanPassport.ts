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
 * Score data is read on Base whatever the app environment, like Coinbase's:
 * Human Passport attests nowhere else we accept.
 */
import {ethers} from 'ethers';
import {STATIC_CONFIGS} from '../config/contracts';
import {
  HUMAN_PASSPORT_ISSUER,
  HUMAN_PASSPORT_ISSUER_LEAVES,
  HUMAN_PASSPORT_MAX_DATA_BYTES,
  HUMAN_PASSPORT_SCORER_ID,
  HUMAN_PASSPORT_SCORE_DECIMALS,
  HUMAN_PASSPORT_SCORE_SCHEMA,
} from '../config/circuitIds';
import {computeScope, computeWalletNullifier} from './circuitHelpers';

export const HUMAN_PASSPORT_CIRCUIT = 'human_passport_score';

const PRODUCTION = STATIC_CONFIGS.production;
const EAS_GRAPHQL = PRODUCTION.attestation.easGraphqlEndpoint;
const BASE_RPC_URLS = PRODUCTION.rpcUrls.base;
const LOOKUP_TIMEOUT_MS = 10_000;

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
  txHash: string;
  attestationId: string;
  request: PassportRequest;
  /** r || s, 64 bytes, as signed. */
  issuerSignature: string;
  /** Uncompressed 0x04 || x || y, recovered from the signature. */
  issuerPubkey: string;
  /** Index into HUMAN_PASSPORT_ISSUER_LEAVES: the GitcoinVerifier whose domain signed it. */
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
): PassportIssuance | {error: string} {
  const req = call.attestationRequest;
  if (req.multiAttestationRequest.length !== 1 || req.multiAttestationRequest[0].data.length !== 1) {
    return {error: 'the signed request does not hold exactly one attestation'};
  }
  const multi = req.multiAttestationRequest[0];
  const entry = multi.data[0];
  if (multi.schema.toLowerCase() !== HUMAN_PASSPORT_SCORE_SCHEMA.toLowerCase()) {
    return {error: `schema ${multi.schema} is not Human Passport's score schema`};
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
    return {
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
  return {error: "no Base GitcoinVerifier domain recovers Human Passport's issuer from this signature"};
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

async function easScores(wallet: string, nowSeconds: number, log: (m: string) => void): Promise<EasRecord[]> {
  const query = `query HumanPassportScores($recipient: String!, $schemaId: String!, $now: Int!) {
    attestations(
      where: { recipient: { equals: $recipient }, schemaId: { equals: $schemaId }, revoked: { equals: false }, expirationTime: { gt: $now } }
      orderBy: { time: desc }
      take: 5
    ) { id txid recipient data expirationTime revoked }
  }`;
  log(`[HumanPassport] EAS lookup on Base for ${wallet}`);
  const body = await withTimeout('The score lookup', async signal => {
    const res = await fetch(EAS_GRAPHQL, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({query, variables: {recipient: ethers.utils.getAddress(wallet), schemaId: HUMAN_PASSPORT_SCORE_SCHEMA, now: nowSeconds}}),
      signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json.errors) throw new Error(String(json.errors[0]?.message));
    return json;
  });
  const rows: EasRecord[] = (body?.data?.attestations ?? []).filter(
    (a: EasRecord) => a.revoked === false && Number(a.expirationTime) > nowSeconds && a.recipient.toLowerCase() === wallet.toLowerCase(),
  ).map((a: EasRecord) => ({...a, expirationTime: Number(a.expirationTime)}));
  log(`[HumanPassport] ${rows.length} unexpired score(s)`);
  return rows;
}

async function transactionInput(txHash: string, log: (m: string) => void): Promise<string> {
  let last: unknown;
  for (const url of BASE_RPC_URLS) {
    try {
      const input = await withTimeout(`Reading ${txHash}`, async signal => {
        const res = await fetch(url, {
          method: 'POST',
          headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'eth_getTransactionByHash', params: [txHash]}),
          signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!json.result?.input) throw new Error(json.error?.message ?? 'no transaction');
        return json.result.input as string;
      });
      return input;
    } catch (e) {
      last = e;
      log(`[HumanPassport] ${url}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  throw last instanceof HumanPassportError ? last : new HumanPassportError('E3001', `No Base RPC answered for ${txHash}`);
}

/**
 * The wallet's newest unexpired Human Passport score that the circuit can
 * prove, checked against `minScoreUnits` before anything is signed.
 */
export async function findHumanPassportScore(
  wallet: string,
  minScoreUnits: number,
  nowSeconds: number,
  log: (m: string) => void,
): Promise<PassportIssuance> {
  const records = await easScores(wallet, nowSeconds, log);
  if (records.length === 0) {
    throw new HumanPassportError('E2021', `No unexpired Human Passport score on Base for ${wallet}`);
  }
  const refusals: string[] = [];
  for (const record of records) {
    const input = await transactionInput(record.txid, log);
    const calls = findVerifyAndAttestCalls(input);
    for (const call of calls) {
      const matched = matchIssuance(call, record, wallet);
      if ('error' in matched) {
        refusals.push(`${record.id}: ${matched.error}`);
        continue;
      }
      if (matched.head.scorerId !== HUMAN_PASSPORT_SCORER_ID) {
        refusals.push(`${record.id}: scorer ${matched.head.scorerId}, not ${HUMAN_PASSPORT_SCORER_ID}`);
        continue;
      }
      const dataBytes = ethers.utils.hexDataLength(matched.request.data);
      if (dataBytes > HUMAN_PASSPORT_MAX_DATA_BYTES) {
        throw new HumanPassportError('E2023', `Score data is ${dataBytes} bytes; the proof holds ${HUMAN_PASSPORT_MAX_DATA_BYTES}`);
      }
      if (matched.head.score < minScoreUnits) {
        throw new HumanPassportError('E2022', `Score ${matched.head.score / 1e4} is below the requested ${minScoreUnits / 1e4}`);
      }
      log(`[HumanPassport] Using ${record.id} (tx ${record.txid}), verifier leaf ${matched.leafIndex}, ${dataBytes} data bytes`);
      return matched;
    }
    if (calls.length === 0) refusals.push(`${record.id}: no verifyAndAttest call in ${record.txid}`);
  }
  throw new HumanPassportError('E2021', `No usable Human Passport score: ${refusals.join('; ')}`);
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
  issuance: Pick<PassportIssuance, 'request' | 'issuerSignature' | 'issuerPubkey' | 'leafIndex' | 'domainSeparator'>;
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
    HUMAN_PASSPORT_SCORER_ID.toString(),
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
