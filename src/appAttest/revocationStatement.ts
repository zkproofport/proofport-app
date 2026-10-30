/**
 * "Right before proving, the genuine app saw this wallet's Coinbase
 * verification unrevoked" -- looked up, written into clientData, and signed
 * with the App Attest key.
 *
 * Decided 2026-10-23 (.claude/agents/circuits-dev.md, "Decisions"): the
 * circuit verifies Apple's credential certificate and this assertion, so a
 * proof can only be made from a statement the app produced after an
 * unrevoked lookup. Nothing is signed for a revoked, missing or mismatched
 * attestation; the person sees why instead.
 *
 * The lookup is fresh on purpose. `findAttestationTransaction` caches its
 * answer for ten minutes, which is fine for finding the transaction (it never
 * changes) and wrong for revocation (it can change at any moment). This asks
 * the indexer about the one attestation uid, with no cache, every time.
 */
import {ethers} from 'ethers';
import {STATIC_CONFIGS} from '../config/contracts';
import {AppAttestError} from './appAttestError';
import {assertClientData, ensureAttestedKey, type AppAttestDeps} from './appAttestKey';
import type {CircuitAssertion, CircuitCredential} from './appAttestObjects';
import {buildCoinbaseClientData, COINBASE_ATTESTER} from './clientData';
import {COUNTRY_CODE, coinbaseStatementKind, type CoinbaseStatementCircuit, type LookupReasons} from './coinbaseStatementKinds';

// Coinbase attestations live on Base mainnet whatever the build environment
// (src/utils/attestationSearch.ts says the same and reads the same row).
const EAS_GRAPHQL_ENDPOINT = STATIC_CONFIGS.production.attestation.easGraphqlEndpoint;
const LOOKUP_TIMEOUT_MS = 8000;

export interface AttestationStatus {
  uid: string;
  schemaId: string;
  attester: string;
  recipient: string;
  revoked: boolean;
  /**
   * The attestation's ABI-encoded data, as the indexer returns it (hex);
   * null when the answer left it out. Only Country v2 reads it, and refuses
   * a record without it (recordCountry).
   */
  data?: string | null;
}

type FetchLike = (url: string, init: {method: string; headers: Record<string, string>; body: string; signal?: AbortSignal}) =>
  Promise<{ok: boolean; status: number; json(): Promise<unknown>}>;

/**
 * The indexer's current record for one attestation uid. A failed request is
 * E3002 (the lookup did not finish -- not the same as "revoked"); a uid the
 * indexer does not know is E2005.
 */
export async function fetchAttestationStatus(
  uid: string,
  log: (m: string) => void,
  /** Whose reasons a refusal carries: the circuit the statement is for. Required. */
  reasons: LookupReasons,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<AttestationStatus> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(uid)) {
    throw new AppAttestError(reasons.uidMalformed, `Attestation uid is not 32 bytes of hex: ${uid}`);
  }
  log(`[Revocation] Asking ${EAS_GRAPHQL_ENDPOINT} about attestation ${uid}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  let body: any;
  try {
    const res = await fetchImpl(EAS_GRAPHQL_ENDPOINT, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        query: 'query($id:String!){attestation(where:{id:$id}){id schemaId attester recipient revoked data}}',
        variables: {id: uid},
      }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    body = await res.json();
  } catch (e) {
    throw new AppAttestError(
      reasons.unreachable,
      `The revocation lookup for ${uid} did not complete: ${e instanceof Error ? e.message : String(e)}`,
    );
  } finally {
    clearTimeout(timer);
  }
  if (body?.errors) {
    throw new AppAttestError(reasons.errors, `EAS answered with errors: ${JSON.stringify(body.errors)}`);
  }
  const a = body?.data?.attestation;
  if (a === null) {
    throw new AppAttestError(reasons.missing, `EAS has no attestation ${uid}`);
  }
  if (!a || typeof a.revoked !== 'boolean' || typeof a.schemaId !== 'string'
    || typeof a.attester !== 'string' || typeof a.recipient !== 'string') {
    // A record that does not say whether it is revoked is not "unrevoked".
    throw new AppAttestError(reasons.incomplete, `EAS answered without a complete record for ${uid}: ${JSON.stringify(a)}`);
  }
  return {uid: String(a.id ?? uid), schemaId: a.schemaId, attester: a.attester, recipient: a.recipient, revoked: a.revoked, data: typeof a.data === 'string' ? a.data : null};
}

/**
 * How old a statement may be when its proof starts. The circuit cannot know
 * the time; a verifier enforces freshness on `attested_at` (the circuit's
 * README suggests a 10-minute window), so a statement already older than that
 * would only produce a proof nobody accepts. A statement from the future
 * beyond clock skew means the phone's clock is wrong, which a verifier would
 * also refuse.
 */
export const STATEMENT_MAX_AGE_SECONDS = 600;
export const STATEMENT_MAX_SKEW_SECONDS = 60;

export function checkStatementAge(attestedAt: number, nowSeconds: number): void {
  const age = nowSeconds - attestedAt;
  if (!Number.isFinite(age) || age > STATEMENT_MAX_AGE_SECONDS || age < -STATEMENT_MAX_SKEW_SECONDS) {
    throw new Error(
      `The App Attest statement is ${age}s old; a verifier accepts at most ${STATEMENT_MAX_AGE_SECONDS}s. Start the proof again.`,
    );
  }
}

export interface RevocationStatementRequest {
  /** Which statement: Coinbase KYC v2 or Coinbase Country v2. Required. */
  circuit: CoinbaseStatementCircuit;
  wallet: string;
  /** The EAS uid of the attestation whose transaction is being proved. */
  attestationUid: string;
  /** The 32 bytes the wallet will sign for this request. */
  requestDigest: string;
  /** keccak256(scope string). */
  scope: Uint8Array;
  /**
   * Country v2 only, and required there: the country of the attestCountry
   * transaction being proved (attestedCountryOfTx). The record's country must
   * equal it, or nothing is signed (E2020).
   */
  transactionCountry?: string;
}

/** Everything the circuit takes from App Attest for one proof. */
export interface AppAttestWitness {
  clientData: Uint8Array;
  attestedAt: number;
  credential: CircuitCredential;
  assertion: CircuitAssertion;
}

export interface RevocationDeps {
  appAttest: AppAttestDeps;
  fetchStatus?: typeof fetchAttestationStatus;
  /** Unix seconds; injectable for tests. */
  now?: () => number;
}

/**
 * The circuit (circuits coinbase-attestation-v2, `APP_ATTEST_PRODUCTION`)
 * accepts production App Attest keys only. A development (sandbox) key --
 * what an Xcode-signed build without the
 * `com.apple.developer.devicecheck.appattest-environment = production`
 * entitlement gets -- would make a proof the prover refuses with "App Attest
 * environment does not match", after the wallet signed. Refused here instead,
 * with the App Attest code (E2014), before anything is signed.
 */
export function requireProductionCredential(credential: CircuitCredential, proof = 'Coinbase KYC v2'): void {
  if (!credential.production) {
    throw new AppAttestError(
      'ios_key_dev_environment',
      `This build's App Attest key is a development (sandbox) key; ${proof} accepts production keys only ` +
        '(TestFlight and App Store builds use production).',
    );
  }
}

/**
 * The lookup half of a statement, shared by both device signers: a fresh EAS
 * record for the uid, checked against the wallet, schema and attester, and
 * the 225-byte clientData built from it (buildClientData refuses a revoked
 * attestation, E2011, before anything is signed).
 */
export async function revocationClientData(
  req: RevocationStatementRequest,
  deps: {fetchStatus?: typeof fetchAttestationStatus; now?: () => number; log: (m: string) => void},
): Promise<{clientData: Uint8Array; attestedAt: number}> {
  const log = deps.log;
  const kind = coinbaseStatementKind(req.circuit);
  const r = kind.reasons;
  // Country v2: the transaction's country is known before anything is asked,
  // so a request without one is a mistake in this app, said as such.
  if (kind.carriesCountry && (typeof req.transactionCountry !== 'string' || !COUNTRY_CODE.test(req.transactionCountry))) {
    throw new Error(`${kind.label} needs the transaction's country (two uppercase letters); got ${JSON.stringify(req.transactionCountry ?? null)}`);
  }
  if (!kind.carriesCountry && req.transactionCountry !== undefined) {
    throw new Error(`${kind.label}'s statement carries no country; got ${JSON.stringify(req.transactionCountry)}`);
  }
  const status = await (deps.fetchStatus ?? fetchAttestationStatus)(req.attestationUid, log, r);
  if (status.schemaId.toLowerCase() !== kind.schemaUid) {
    throw new AppAttestError(r.wrongSchema, `Attestation ${status.uid} is schema ${status.schemaId}, not ${kind.schemaName}`);
  }
  if (ethers.utils.getAddress(status.attester) !== ethers.utils.getAddress(COINBASE_ATTESTER)) {
    throw new AppAttestError(r.wrongIssuer, `Attestation ${status.uid} was issued by ${status.attester}, not Coinbase`);
  }
  if (ethers.utils.getAddress(status.recipient) !== ethers.utils.getAddress(req.wallet)) {
    throw new AppAttestError(
      r.otherWallet,
      `Attestation ${status.uid} is for ${status.recipient}, not the connected wallet ${req.wallet}`,
    );
  }
  log(`[Revocation] Attestation ${status.uid}: revoked=${status.revoked}`);

  let country: string | undefined;
  if (kind.carriesCountry && !status.revoked) {
    country = recordCountry(status);
    log(`[Revocation] Attestation ${status.uid}: country=${country}, transaction country=${req.transactionCountry}`);
    if (country !== req.transactionCountry) {
      // The circuit checks the statement's country against the transaction's;
      // a statement that disagrees would only fail in the prover.
      throw new AppAttestError(
        'country_record_differs_from_transaction',
        `Attestation ${status.uid} names country ${country}, but the transaction being proved names ${req.transactionCountry}`,
      );
    }
  }

  const attestedAt = Math.floor((deps.now ?? (() => Date.now() / 1000))());
  // Refuses a revoked attestation (E2011) before anything is signed.
  const clientData = buildCoinbaseClientData(kind.circuit, {
    wallet: req.wallet,
    attestedAt,
    schemaUid: status.schemaId,
    attester: status.attester,
    attestationUid: status.uid,
    revoked: status.revoked,
    requestDigest: req.requestDigest,
    scope: req.scope,
    ...(kind.carriesCountry ? {country} : {}),
  });
  return {clientData, attestedAt};
}

/**
 * The country a Coinbase Verified Country record holds: its data is the ABI
 * encoding of one `string verifiedCountry`, which must be exactly two
 * uppercase ASCII letters. Anything else -- data that does not decode, a
 * longer or lowercase value, letters outside ASCII -- is E2005, by name.
 */
export function recordCountry(status: Pick<AttestationStatus, 'uid' | 'data'>): string {
  if (typeof status.data !== 'string') {
    // A Country record whose country was not returned is not one we can vouch for.
    throw new AppAttestError('country_lookup_incomplete', `EAS answered without the data of attestation ${status.uid}`);
  }
  let value: unknown;
  try {
    [value] = ethers.utils.defaultAbiCoder.decode(['string'], status.data);
  } catch (e) {
    throw new AppAttestError(
      'country_record_unreadable',
      `Attestation ${status.uid} data is not one ABI string: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (typeof value !== 'string' || !COUNTRY_CODE.test(value)) {
    throw new AppAttestError(
      'country_record_unreadable',
      `Attestation ${status.uid} names country ${JSON.stringify(value)}; two uppercase letters are required`,
    );
  }
  return value;
}

export async function makeRevocationStatement(
  req: RevocationStatementRequest,
  deps: RevocationDeps,
): Promise<AppAttestWitness> {
  const log = deps.appAttest.log;
  // The key first: a device that cannot do App Attest is told so before any
  // network lookup, and a first run certifies its key here.
  const key = await ensureAttestedKey(deps.appAttest);
  const label = coinbaseStatementKind(req.circuit).label;
  requireProductionCredential(key.credential, label);

  const {clientData, attestedAt} = await revocationClientData(req, {fetchStatus: deps.fetchStatus, now: deps.now, log});
  const signed = await assertClientData(deps.appAttest, clientData);
  // assertClientData may have replaced the key; check the one that signed.
  requireProductionCredential(signed.credential, label);
  log(`[AppAttest] Assertion made with key ${signed.keyId} (counter ${signed.assertion.counter})`);
  return {clientData, attestedAt, credential: signed.credential, assertion: signed.assertion};
}
