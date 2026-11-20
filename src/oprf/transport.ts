/**
 * Talking to the OPRF nodes: one WebSocket per node, two rounds, threshold
 * combination. A port of taceo-oprf-client 0.10.8 (lib.rs `distributed_oprf_core`,
 * sessions.rs, ws/native.rs):
 *
 *   1. Open `wss://<node>/api/<module>/oprf?version=<client>&request_id=<id>`
 *      on every node at once and send the CBOR `OprfRequest`.
 *   2. Each node answers its commitments, party id, public key and epoch.
 *      The first `threshold` answers that share one epoch (and distinct
 *      party ids) are kept, sorted by party id; the other sockets are closed.
 *   3. The kept nodes must agree on the public key. Their commitments are
 *      combined (src/oprf/shamir.ts) and sent back to each.
 *   4. Each answers its proof share. The shares become (e, s), which must
 *      verify before anything is returned.
 *
 * A node refuses with a WebSocket close frame: 4500-4999 is the auth module
 * (the request proof, the API key), 4001-4010 the protocol. A refusal is
 * returned as such, so the screen can say "refused" rather than "offline".
 * Every wait has a deadline; nothing waits on a node forever.
 */
import {verifyOprfDlogEquality} from '@zkproofport-app/core';
import {isIdentity, type Point} from './curve/babyjubjub';
import {combineCommitments, combineProofs} from './shamir';
import {
  decodeOprfResponse,
  decodeProofShare,
  encodeChallenge,
  encodeOprfRequest,
  type CborValue,
  type NodeCommitments,
} from './wire';

/** One event from a node's socket. */
export type NodeEvent =
  | {kind: 'binary'; bytes: Uint8Array}
  | {kind: 'close'; code: number; reason: string}
  | {kind: 'error'; message: string};

/** One open conversation with a node. */
export interface NodeSession {
  send(bytes: Uint8Array): void;
  /** The next event; the session buffers events that arrive before it is asked. */
  next(): Promise<NodeEvent>;
  close(): void;
}

/** Opens a session to a URL. Tests pass an in-memory one; the app passes {@link webSocketConnector}. */
export type NodeConnector = (url: string) => NodeSession;

/** Why the nodes did not produce an answer. */
export type OprfTransportFailureKind =
  | 'refused' // threshold-many nodes closed with one auth code (4500-4999)
  | 'protocol' // nodes refused for a protocol reason, or sent something malformed
  | 'unreachable' // too few nodes answered at all
  | 'timeout' // the deadline passed first
  | 'inconsistent-keys' // the chosen nodes named different public keys
  | 'bad-proof'; // the combined Chaum-Pedersen proof does not verify

export class OprfTransportError extends Error {
  constructor(readonly kind: OprfTransportFailureKind, message: string, readonly closeCode?: number) {
    super(message);
    this.name = 'OprfTransportError';
  }
}

export interface OprfNodesAnswer {
  publicKey: Point;
  epoch: number;
  blindedResponse: Point;
  e: bigint;
  s: bigint;
  /** Party ids of the nodes that answered, ascending. */
  partyIds: number[];
}

export interface DistributedOprfArgs {
  /** Node base URLs (https://...); each must be distinct. */
  nodes: readonly string[];
  threshold: number;
  /** The auth module's path segment (`/api/<module>/oprf`). */
  module: string;
  /** Sent as `version=` (the nodes check client compatibility). */
  clientVersion: string;
  requestId: string;
  blindedQuery: Point;
  auth: {[key: string]: CborValue};
  connect: NodeConnector;
  /** Deadline for each round, in milliseconds. */
  roundTimeoutMs: number;
  log?: (m: string) => void;
}

/** `https://host` -> `wss://host/api/<module>/oprf?version=..&request_id=..`. */
export function nodeSocketUrl(base: string, module: string, clientVersion: string, requestId: string): string {
  let u: URL;
  try {
    u = new URL(base);
  } catch {
    throw new Error(`OPRF node URL ${JSON.stringify(base)} is not a URL.`);
  }
  const scheme = ({'https:': 'wss:', 'http:': 'ws:', 'wss:': 'wss:', 'ws:': 'ws:'} as Record<string, string>)[u.protocol];
  if (!scheme) throw new Error(`OPRF node URL ${base} has scheme ${u.protocol}; expected https or wss.`);
  if (!/^[A-Za-z0-9_-]+$/.test(module)) throw new Error(`OPRF module ${JSON.stringify(module)} is not a path segment.`);
  const path = u.pathname.replace(/\/+$/, '');
  return `${scheme}//${u.host}${path}/api/${module}/oprf?version=${encodeURIComponent(clientVersion)}&request_id=${requestId}`;
}

const hostOf = (base: string): string => {
  try {
    return new URL(base).host;
  } catch {
    return base;
  }
};

function withDeadline<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new OprfTransportError('timeout', `${what} did not answer within ${ms} ms.`)), ms);
    p.then(v => { clearTimeout(t); resolve(v); }, e => { clearTimeout(t); reject(e); });
  });
}

/** One node's failure in a round, kept to name the cause when too few succeed. */
type NodeFailure = {host: string} & ({kind: 'close'; code: number; reason: string} | {kind: 'other'; transport: OprfTransportFailureKind; message: string});

function failureOf(host: string, e: unknown): NodeFailure {
  if (e instanceof OprfTransportError) return {host, kind: 'other', transport: e.kind, message: e.message};
  return {host, kind: 'other', transport: 'protocol', message: e instanceof Error ? e.message : String(e)};
}

async function readMessage(session: NodeSession, host: string): Promise<Uint8Array> {
  const ev = await session.next();
  if (ev.kind === 'binary') return ev.bytes;
  if (ev.kind === 'close') {
    throw Object.assign(new OprfTransportError(ev.code >= 4000 ? 'protocol' : 'unreachable', `${host} closed (${ev.code}${ev.reason ? `: ${ev.reason}` : ''}).`, ev.code), {closeFrame: ev});
  }
  throw new OprfTransportError('unreachable', `${host}: ${ev.message}`);
}

/** The cause to report when fewer than `threshold` nodes completed round 1. */
function aggregate(failures: NodeFailure[], threshold: number, answered: number): OprfTransportError {
  const codes = new Map<number, number>();
  for (const f of failures) {
    if (f.kind === 'close' && f.code >= 4000) codes.set(f.code, (codes.get(f.code) ?? 0) + 1);
  }
  const summary = failures.map(f => (f.kind === 'close' ? `${f.host} closed ${f.code}${f.reason ? ` (${f.reason})` : ''}` : `${f.host}: ${f.message}`)).join('; ');
  for (const [code, n] of codes) {
    if (n >= threshold) {
      const kind: OprfTransportFailureKind = code >= 4500 && code <= 4999 ? 'refused' : 'protocol';
      return new OprfTransportError(kind, `${n} OPRF nodes refused the request with code ${code}: ${summary}`, code);
    }
  }
  const allTimeouts = failures.length > 0 && failures.every(f => f.kind === 'other' && f.transport === 'timeout');
  return new OprfTransportError(
    allTimeouts ? 'timeout' : 'unreachable',
    `Only ${answered} of the ${threshold} OPRF nodes needed answered: ${summary || 'no answer'}`,
  );
}

/**
 * Run both rounds and return the verified combined answer. Throws
 * {@link OprfTransportError}; every socket is closed before it returns or throws.
 */
export async function runDistributedOprf(args: DistributedOprfArgs): Promise<OprfNodesAnswer> {
  const log = args.log ?? (() => {});
  if (!Number.isInteger(args.threshold) || args.threshold < 1 || args.threshold > args.nodes.length) {
    throw new Error(`OPRF threshold ${args.threshold} does not fit ${args.nodes.length} nodes.`);
  }
  if (new Set(args.nodes).size !== args.nodes.length) throw new Error(`OPRF node list repeats a node: ${args.nodes.join(', ')}.`);
  if (isIdentity(args.blindedQuery)) throw new Error('Refusing to send the identity as a blinded query.');
  const request = encodeOprfRequest(args.requestId, args.blindedQuery, args.auth);
  const sessions: {host: string; session: NodeSession}[] = args.nodes.map(base => ({
    host: hostOf(base),
    session: args.connect(nodeSocketUrl(base, args.module, args.clientVersion, args.requestId)),
  }));
  const closeAll = () => sessions.forEach(s => { try { s.session.close(); } catch { /* already closed */ } });

  try {
    // ---- round 1
    const chosen = await withDeadline(new Promise<{host: string; session: NodeSession; resp: NodeCommitments}[]>((resolve, reject) => {
      const byEpoch = new Map<number, {host: string; session: NodeSession; resp: NodeCommitments}[]>();
      const failures: NodeFailure[] = [];
      let pending = sessions.length;
      let done = false;
      const settleOne = () => {
        pending--;
        if (!done && pending === 0) {
          done = true;
          const best = Math.max(0, ...[...byEpoch.values()].map(g => g.length));
          if (byEpoch.size > 1) {
            failures.push(...[...byEpoch.entries()].map(([ep, g]) => ({host: g.map(x => x.host).join(','), kind: 'other' as const, transport: 'protocol' as const, message: `epoch ${ep}`})));
          }
          reject(aggregate(failures, args.threshold, best));
        }
      };
      for (const s of sessions) {
        (async () => {
          s.session.send(request);
          const resp = decodeOprfResponse(await readMessage(s.session, s.host));
          return resp;
        })().then(resp => {
          if (done) return;
          const group = byEpoch.get(resp.epoch) ?? [];
          if (group.some(g => g.resp.partyId === resp.partyId)) {
            log(`[OPRF] ${s.host} repeats party id ${resp.partyId}; ignored`);
            failures.push({host: s.host, kind: 'other', transport: 'protocol', message: `repeated party id ${resp.partyId}`});
            settleOne();
            return;
          }
          group.push({...s, resp});
          byEpoch.set(resp.epoch, group);
          if (group.length === args.threshold) {
            done = true;
            resolve([...group].sort((a, b) => a.resp.partyId - b.resp.partyId));
            return;
          }
          settleOne();
        }, e => {
          const frame = (e as {closeFrame?: {code: number; reason: string}}).closeFrame;
          failures.push(frame ? {host: s.host, kind: 'close', code: frame.code, reason: frame.reason} : failureOf(s.host, e));
          settleOne();
        });
      }
    }), args.roundTimeoutMs, 'The OPRF nodes (first round)');

    for (const s of sessions) {
      if (!chosen.some(c => c.session === s.session)) { try { s.session.close(); } catch { /* ignore */ } }
    }
    const publicKey = chosen[0].resp.publicKey;
    if (!chosen.every(c => c.resp.publicKey.x === publicKey.x && c.resp.publicKey.y === publicKey.y)) {
      throw new OprfTransportError('inconsistent-keys', `The OPRF nodes ${chosen.map(c => c.host).join(', ')} named different public keys.`);
    }
    const challenge = combineCommitments(chosen.map(c => c.resp));
    const challengeBytes = encodeChallenge(challenge);
    log(`[OPRF] first round: parties ${chosen.map(c => c.resp.partyId).join(', ')}, epoch ${chosen[0].resp.epoch}`);

    // ---- round 2
    const shares = await withDeadline(Promise.all(chosen.map(async c => {
      c.session.send(challengeBytes);
      try {
        return decodeProofShare(await readMessage(c.session, c.host));
      } catch (e) {
        if (e instanceof OprfTransportError) throw e;
        throw new OprfTransportError('protocol', `${c.host}: ${e instanceof Error ? e.message : String(e)}`);
      }
    })), args.roundTimeoutMs, 'The OPRF nodes (second round)');

    const {e, s} = combineProofs({requestId: args.requestId, publicKey, blindedQuery: args.blindedQuery, challenge, shares});
    if (!verifyOprfDlogEquality({publicKey, blindedQuery: args.blindedQuery, blindedResponse: challenge.c, e, s})) {
      throw new OprfTransportError('bad-proof', 'The OPRF nodes\' combined Chaum-Pedersen proof does not verify.');
    }
    return {publicKey, epoch: chosen[0].resp.epoch, blindedResponse: challenge.c, e, s, partyIds: chosen.map(c => c.resp.partyId)};
  } finally {
    closeAll();
  }
}

/**
 * A {@link NodeConnector} over the runtime's WebSocket (React Native's, or
 * Node's global one in the network test). Binary frames only; a text frame is
 * an error, as in the reference client.
 */
export function webSocketConnector(
  WebSocketImpl: new (url: string) => {
    binaryType: string;
    onmessage: ((ev: {data: unknown}) => void) | null;
    onclose: ((ev: {code: number; reason: string}) => void) | null;
    onerror: ((ev: unknown) => void) | null;
    onopen: (() => void) | null;
    readyState: number;
    send(data: ArrayBuffer | Uint8Array): void;
    close(): void;
  },
): NodeConnector {
  return (url: string) => {
    const ws = new WebSocketImpl(url);
    ws.binaryType = 'arraybuffer';
    const queue: NodeEvent[] = [];
    const waiters: ((ev: NodeEvent) => void)[] = [];
    let ended = false;
    const push = (ev: NodeEvent) => {
      if (ended) return;
      if (ev.kind !== 'binary') ended = true;
      const w = waiters.shift();
      if (w) w(ev);
      else queue.push(ev);
    };
    const outbox: Uint8Array[] = [];
    ws.onopen = () => {
      for (const b of outbox.splice(0)) ws.send(b);
    };
    ws.onmessage = ev => {
      const d = ev.data;
      if (d instanceof ArrayBuffer) push({kind: 'binary', bytes: new Uint8Array(d)});
      else if (ArrayBuffer.isView(d)) push({kind: 'binary', bytes: new Uint8Array(d.buffer, d.byteOffset, d.byteLength)});
      else push({kind: 'error', message: 'text frame received'});
    };
    ws.onclose = ev => push({kind: 'close', code: ev.code, reason: ev.reason ?? ''});
    ws.onerror = ev => push({kind: 'error', message: `socket error${(ev as {message?: string})?.message ? `: ${(ev as {message: string}).message}` : ''}`});
    return {
      send(bytes) {
        if (ws.readyState === 1) ws.send(bytes);
        else outbox.push(bytes);
      },
      next() {
        const ev = queue.shift();
        if (ev) return Promise.resolve(ev);
        if (ended) return Promise.resolve({kind: 'error', message: 'session already ended'});
        return new Promise(resolve => waiters.push(resolve));
      },
      close() {
        ended = true;
        try { ws.close(); } catch { /* ignore */ }
      },
    };
  };
}
