/**
 * THE ONE PLACE A RELAY PROOF REQUEST IS ANSWERED.
 *
 * A dApp that sends a proof request through the relay waits for exactly one
 * terminal answer: `completed`, `error` or `cancelled`. Before this module the
 * proof screen marked History "failed" on nine paths and told the relay on two,
 * so most failures (no attestation, wallet rejection, prover failure, a thrown
 * error) left the dApp waiting for its five-minute timeout
 * (zkproofport/proofport-app#2).
 *
 * Every answer — success, every error, every cancel, from the proof screen and
 * from App.tsx's review card — goes through `answerRelayRequest`. It:
 *
 *   - sends at most ONE answer per requestId for the life of the JS runtime.
 *     The claim is taken synchronously, before the first await, so a re-render,
 *     a retry, or two failure paths firing in the same tick cannot double-send;
 *   - POSTs only to a trusted relay callback (`checkRelayCallbackUrl`), because
 *     the callbackUrl of a link that failed validation was written by whoever
 *     wrote the link;
 *   - reads the relay's 409 as "already answered" (no retry) or, when it says
 *     the request timed out, tells the user the request expired (E1003);
 *   - never throws. A failed POST is logged and reported as an outcome.
 *
 * A request killed with the app cannot answer itself, so every approved-for-
 * review request is written to storage (`rememberOpenRelayRequest`) and
 * removed once the relay has a definitive reply. On the next launch
 * `answerRequestsLeftOpen` answers whatever is left — `cancelled`, or the error
 * that could not be delivered.
 *
 * App-internal proofs (Laboratory / standalone) have no request and never get
 * here.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {ErrorCodes, type ErrorCode} from '../constants/errorCodes';
import {showGlobalError} from './errorBridge';
import {
  checkRelayCallbackUrl,
  postRelayCallback,
  type ProofRequest,
  type ProofResponse,
} from './deeplink';

/** The fields of a request the answer needs. */
export type RelayRequestRef = Pick<ProofRequest, 'requestId' | 'circuit' | 'callbackUrl'>;

/** Everything a `completed` answer carries besides the envelope. */
export type CompletedFields = Omit<
  ProofResponse,
  'requestId' | 'circuit' | 'status' | 'error' | 'errorCode'
>;

export type RelayAnswer =
  | {status: 'completed'; fields: CompletedFields}
  | {status: 'error'; errorCode: ErrorCode; error: string}
  | {status: 'cancelled'; reason: string};

/**
 * - `delivered`        — the relay took it (2xx).
 * - `already-answered` — 409, not a timeout: the relay holds an answer already.
 * - `expired`          — 409 saying the relay timed the request out.
 * - `duplicate`        — this runtime already answered the request; nothing sent.
 * - `untrusted`        — callbackUrl is not a trusted relay's; nothing sent.
 * - `rejected`         — any other 4xx; definitive, not retried.
 * - `undelivered`      — 5xx or the network failed; kept for the next launch.
 * - `invalid`          — no requestId; nothing sent.
 */
export type RelayAnswerOutcome =
  | 'delivered'
  | 'already-answered'
  | 'expired'
  | 'duplicate'
  | 'untrusted'
  | 'rejected'
  | 'undelivered'
  | 'invalid';

export interface AnswerOptions {
  /**
   * Whether the person is looking at this request right now, so an outcome
   * that changes what they should believe (expired, not delivered) is shown in
   * the ErrorModal. False for answers sent at launch for a request from an
   * earlier run — nobody is waiting on that screen any more.
   */
  notifyUser?: boolean;
}

const OPEN_KEY = '@zkproofport:relay:openRequests';
/** Launches on which an undelivered answer is re-sent before it is dropped. */
const MAX_LAUNCH_ATTEMPTS = 3;

interface OpenRecord {
  requestId: string;
  circuit: ProofRequest['circuit'];
  callbackUrl: string;
  openedAt: number;
  attempts: number;
  /** An error/cancel that was claimed but did not reach the relay. */
  pending?: {status: 'error'; errorCode: ErrorCode; error: string} | {status: 'cancelled'; reason: string};
}

const answered = new Map<string, RelayAnswer['status']>();
/** Requests being re-sent on their last allowed launch; not kept again if that fails. */
const lastAttempt = new Set<string>();
let sessionStartedAt = Date.now();
let storageQueue: Promise<unknown> = Promise.resolve();

/** Has this runtime already answered (or started answering) the request? */
export function isRelayRequestAnswered(requestId: string): boolean {
  return answered.has(requestId);
}

/** Test seam: forget every claim and restart the session clock. */
export function resetRelayAnswersForTests(startedAt: number = Date.now()): void {
  answered.clear();
  lastAttempt.clear();
  sessionStartedAt = startedAt;
  storageQueue = Promise.resolve();
}

function payloadFor(request: RelayRequestRef, answer: RelayAnswer): ProofResponse {
  const envelope = {requestId: request.requestId, circuit: request.circuit};
  switch (answer.status) {
    case 'completed':
      return {...answer.fields, ...envelope, status: 'completed'};
    case 'error':
      return {
        ...envelope,
        status: 'error',
        errorCode: answer.errorCode,
        error: answer.error || ErrorCodes[answer.errorCode].description,
      };
    case 'cancelled':
      return {...envelope, status: 'cancelled', error: answer.reason};
  }
}

/** Read-modify-write of the open list, serialized so two writers cannot lose one. */
function mutateOpen(change: (records: OpenRecord[]) => OpenRecord[]): Promise<OpenRecord[]> {
  const next = storageQueue.then(async () => {
    try {
      const raw = await AsyncStorage.getItem(OPEN_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      const records = Array.isArray(parsed) ? (parsed as OpenRecord[]) : [];
      const updated = change(records);
      await AsyncStorage.setItem(OPEN_KEY, JSON.stringify(updated));
      return updated;
    } catch (error) {
      // Storage is the kill-recovery net only; the answer itself never waits on it.
      console.error('[RelayAnswer] Open-request storage failed:', error);
      return [];
    }
  });
  storageQueue = next;
  return next;
}

/**
 * Note a request that passed relay validation and now owes the dApp an answer,
 * so a request killed with the app is still answered on the next launch.
 */
export function rememberOpenRelayRequest(request: RelayRequestRef): Promise<void> {
  const record: OpenRecord = {
    requestId: request.requestId,
    circuit: request.circuit,
    callbackUrl: request.callbackUrl,
    openedAt: Date.now(),
    attempts: 0,
  };
  return mutateOpen(records => [
    ...records.filter(r => r.requestId !== request.requestId),
    record,
  ]).then(() => undefined);
}

function forgetOpen(requestId: string): Promise<void> {
  return mutateOpen(records => records.filter(r => r.requestId !== requestId)).then(() => undefined);
}

function pendingFor(answer: RelayAnswer): NonNullable<OpenRecord['pending']> {
  switch (answer.status) {
    case 'error':
      return {status: 'error', errorCode: answer.errorCode, error: answer.error};
    case 'cancelled':
      return {status: 'cancelled', reason: answer.reason};
    case 'completed':
      // A proof is not stored: what is re-sent later is a cancel saying the
      // proof could not be delivered, never a stale proof.
      return {status: 'cancelled', reason: 'The proof was generated but could not be delivered to the relay.'};
  }
}

function keepForNextLaunch(request: RelayRequestRef, answer: RelayAnswer): Promise<void> {
  if (lastAttempt.has(request.requestId)) {
    console.error(
      `[RelayAnswer] Giving up on ${request.requestId} after ${MAX_LAUNCH_ATTEMPTS} launches; the relay will time it out`,
    );
    return Promise.resolve();
  }
  const pending = pendingFor(answer);
  return mutateOpen(records => {
    const existing = records.find(r => r.requestId === request.requestId);
    const kept: OpenRecord = {
      requestId: request.requestId,
      circuit: request.circuit,
      callbackUrl: request.callbackUrl,
      openedAt: existing?.openedAt ?? Date.now(),
      attempts: existing?.attempts ?? 0,
      pending,
    };
    return [...records.filter(r => r.requestId !== request.requestId), kept];
  }).then(() => undefined);
}

async function deliver(
  request: RelayRequestRef,
  answer: RelayAnswer,
  notifyUser: boolean,
): Promise<RelayAnswerOutcome> {
  const id = request.requestId;
  let trust: ReturnType<typeof checkRelayCallbackUrl>;
  try {
    trust = checkRelayCallbackUrl(request.callbackUrl);
  } catch (error) {
    trust = {trusted: false, error: error instanceof Error ? error.message : String(error)};
  }
  if (!trust.trusted) {
    console.log(`[RelayAnswer] Not answering ${id} (${answer.status}): ${trust.error}`);
    await forgetOpen(id);
    return 'untrusted';
  }

  const payload = payloadFor(request, answer);
  console.log(
    `[RelayAnswer] Answering ${id}: status=${payload.status}` +
      (payload.errorCode ? ` errorCode=${payload.errorCode}` : '') +
      (payload.error ? ` error=${payload.error}` : ''),
  );
  const result = await postRelayCallback(payload, request.callbackUrl);

  switch (result.kind) {
    case 'delivered':
      await forgetOpen(id);
      return 'delivered';

    case 'conflict':
      await forgetOpen(id);
      if (result.timedOut) {
        console.log(`[RelayAnswer] Relay had already timed out ${id}: ${result.body}`);
        if (notifyUser) {
          const failed = answer.status === 'error' ? ` This attempt had failed: [${answer.errorCode}] ${answer.error}` : '';
          showGlobalError('E1003', `The requesting app stopped waiting for request ${id}.${failed}`);
        }
        return 'expired';
      }
      console.log(`[RelayAnswer] Relay already holds an answer for ${id}: ${result.body}`);
      // Only a proof the person believes was delivered needs correcting; an
      // error or a cancel is already what the screen says.
      if (notifyUser && answer.status === 'completed') {
        showGlobalError('E1007', `The relay already had an answer for request ${id}; this proof was not delivered.`);
      }
      return 'already-answered';

    case 'http-error':
      if (result.status >= 500) {
        await keepForNextLaunch(request, answer);
        if (notifyUser && answer.status === 'completed') {
          showGlobalError('E3003', `Relay answered HTTP ${result.status}: ${result.body}`);
        }
        return 'undelivered';
      }
      await forgetOpen(id);
      if (notifyUser && answer.status === 'completed') {
        showGlobalError('E3003', `Relay answered HTTP ${result.status}: ${result.body}`);
      }
      return 'rejected';

    case 'network-error':
      await keepForNextLaunch(request, answer);
      if (notifyUser && answer.status === 'completed') {
        showGlobalError('E3003', result.error);
      }
      return 'undelivered';
  }
}

/**
 * Answer a relay request. At most once per requestId; never throws.
 *
 * The second and later calls for the same request return `duplicate` without
 * sending anything — whichever path answered first is the answer.
 */
export function answerRelayRequest(
  request: RelayRequestRef | null | undefined,
  answer: RelayAnswer,
  {notifyUser = true}: AnswerOptions = {},
): Promise<RelayAnswerOutcome> {
  const id = request?.requestId;
  if (!request || typeof id !== 'string' || id.length === 0) {
    console.error('[RelayAnswer] Refusing to answer a request without a requestId:', request);
    return Promise.resolve('invalid');
  }
  const first = answered.get(id);
  if (first !== undefined) {
    console.log(`[RelayAnswer] ${id} was already answered (${first}); not sending ${answer.status}`);
    return Promise.resolve('duplicate');
  }
  // Claimed synchronously, before any await.
  answered.set(id, answer.status);
  return deliver(request, answer, notifyUser).catch(error => {
    console.error(`[RelayAnswer] Answering ${id} failed unexpectedly:`, error);
    return 'undelivered' as const;
  });
}

/**
 * On launch: answer every request an earlier run left open (killed during
 * review or generation, or whose answer did not get through). Returns how many
 * were sent. Requests opened in THIS run are left alone.
 */
export async function answerRequestsLeftOpen(): Promise<number> {
  let leftOver: OpenRecord[] = [];
  await mutateOpen(records => {
    leftOver = records.filter(r => r.openedAt < sessionStartedAt && !answered.has(r.requestId));
    const keep = records.filter(r => !leftOver.includes(r));
    // Re-added below by keepForNextLaunch if this attempt fails too.
    return [
      ...keep,
      ...leftOver
        .filter(r => r.attempts + 1 < MAX_LAUNCH_ATTEMPTS)
        .map(r => ({...r, attempts: r.attempts + 1})),
    ];
  });
  for (const record of leftOver) {
    if (record.attempts + 1 >= MAX_LAUNCH_ATTEMPTS) lastAttempt.add(record.requestId);
    const answer: RelayAnswer =
      record.pending ?? {status: 'cancelled', reason: 'The app was closed before this request was answered.'};
    console.log(`[RelayAnswer] Answering ${record.requestId} left open by an earlier run (attempt ${record.attempts + 1})`);
    await answerRelayRequest(record, answer, {notifyUser: false});
  }
  return leftOver.length;
}
