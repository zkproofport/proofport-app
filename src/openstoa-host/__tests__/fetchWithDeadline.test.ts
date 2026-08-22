/**
 * The host's OpenStoa requests cannot wait forever, and the poll loop is why.
 *
 * `runSelfRelayLogin` polls the server up to 240 times at 1.5s while the user
 * completes a proof. Each attempt was a bare `await fetch(...)`, and `fetch` has
 * no timeout — so one request that the server accepted and never answered
 * stopped the loop at that attempt. Not for six minutes: forever. The counter
 * never advanced, the "timed out waiting for relay" throw at the bottom was
 * never reached, and `loginToOpenStoa` never settled. A mini-app awaiting it
 * inside a `try/catch` had nothing to catch and stayed on its boot screen until
 * the app was force-quit, which is the incident this was written for.
 *
 * EDGE-CASE MATRIX (CLAUDE.md) → coverage here
 *   boundary   → answered inside the deadline succeeds; never answered rejects
 *                AT the deadline and not before
 *   contract   → the signal reaches `fetch` and is aborted, so the socket is
 *                released rather than left open behind an abandoned caller
 *   integrity  → a timeout is its own error type, distinguishable from the
 *                `TypeError` a dropped connection produces and from a Response
 *   race       → a `fetch` that ignores the abort entirely still frees the
 *                caller: the deadline is a race, not a request to stop
 *   external   → the poll's contract — a failed attempt is retried, not fatal —
 *                is what makes one timed-out attempt cost one attempt
 *   empty / hostile / UTF-8 / authz / very large → N/A: this takes a URL, a
 *                `RequestInit` and a number; it reads no user input and makes
 *                no authorization decision.
 */
import {
  fetchWithDeadline,
  HostRequestTimeoutError,
  HOST_REQUEST_TIMEOUT_MS,
} from '../fetchWithDeadline';

/** A fetch that never answers AND ignores the abort — the worst case. */
const neverAnswers = () => jest.fn(() => new Promise<Response>(() => {}));

const okResponse = () => ({ok: true, status: 200} as unknown as Response);

async function isPending(p: Promise<unknown>): Promise<boolean> {
  const marker = Symbol('pending');
  const settled = await Promise.race([
    p.then(() => 'done').catch(() => 'done'),
    Promise.resolve(marker),
  ]);
  return settled === marker;
}

describe('fetchWithDeadline', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('BOUNDARY: a request that never answers rejects at the deadline, not before', async () => {
    const p = fetchWithDeadline('https://x.test/poll', {}, {
      label: 'auth-poll',
      fetchImpl: neverAnswers() as unknown as typeof fetch,
    }).catch((e: unknown) => e);

    jest.advanceTimersByTime(HOST_REQUEST_TIMEOUT_MS - 1);
    expect(await isPending(p)).toBe(true);

    jest.advanceTimersByTime(2);
    const err = await p;
    expect(err).toBeInstanceOf(HostRequestTimeoutError);
    expect((err as HostRequestTimeoutError).label).toBe('auth-poll');
    expect((err as HostRequestTimeoutError).timeoutMs).toBe(HOST_REQUEST_TIMEOUT_MS);
  });

  it('BOUNDARY: a request answered inside the deadline succeeds', async () => {
    const fetchImpl = jest.fn(async () => okResponse());
    const res = await fetchWithDeadline('https://x.test/poll', {}, {
      label: 'auth-poll',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(res.ok).toBe(true);
  });

  it('CONTRACT: the signal reaches fetch and is aborted when the deadline passes', async () => {
    let seen: AbortSignal | null | undefined;
    const fetchImpl = jest.fn((_url: string, init: RequestInit) => {
      seen = init.signal;
      return new Promise<Response>(() => {});
    });
    const p = fetchWithDeadline('https://x.test/poll', {}, {
      label: 'auth-poll',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }).catch(() => 'timed out');

    expect(seen).toBeDefined();
    expect(seen!.aborted).toBe(false);

    jest.advanceTimersByTime(HOST_REQUEST_TIMEOUT_MS + 1);
    expect(await p).toBe('timed out');
    // Rejecting alone would leave the connection open behind a caller that has
    // already given up — on a phone, a socket and a radio kept alive for nothing.
    expect(seen!.aborted).toBe(true);
  });

  it('a fetch that honours the abort still reports a timeout, not an AbortError', async () => {
    const fetchImpl = jest.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            const e = new Error('Aborted');
            e.name = 'AbortError';
            reject(e);
          });
        }),
    );
    const p = fetchWithDeadline('https://x.test/poll', {}, {
      label: 'auth-poll',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }).catch((e: unknown) => e);

    jest.advanceTimersByTime(HOST_REQUEST_TIMEOUT_MS + 1);
    expect(await p).toBeInstanceOf(HostRequestTimeoutError);
  });

  it('INTEGRITY: a dropped connection is passed through as itself, not relabelled', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new TypeError('Network request failed');
    });
    const err = await fetchWithDeadline('https://x.test/poll', {}, {
      label: 'auth-poll',
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(TypeError);
    expect(err).not.toBeInstanceOf(HostRequestTimeoutError);
  });

  it('EXTERNAL: the poll loop retries a timed-out attempt instead of stalling on it', async () => {
    /*
     * The shape of `runSelfRelayLogin`'s loop, in miniature: one attempt that
     * never answers, then one that does. Before the deadline the first attempt
     * consumed the whole flow — with it, the first costs one iteration.
     */
    const answers = [
      () => new Promise<Response>(() => {}), // hangs
      async () => okResponse(),
    ];
    let attempt = 0;
    const fetchImpl = jest.fn(() => answers[attempt++]());

    const runPoll = async (): Promise<Response | null> => {
      for (let i = 0; i < 3; i++) {
        try {
          return await fetchWithDeadline('https://x.test/poll', {}, {
            label: 'auth-poll',
            fetchImpl: fetchImpl as unknown as typeof fetch,
          });
        } catch {
          continue; // the real loop's behaviour: a failed attempt is not fatal
        }
      }
      return null;
    };

    const p = runPoll();
    await Promise.resolve();
    jest.advanceTimersByTime(HOST_REQUEST_TIMEOUT_MS + 1);

    const res = await p;
    expect(res?.ok).toBe(true);
    expect(attempt).toBe(2);
  });

  it('DIAGNOSTICS: a timeout leaves a log line naming the request and the limit', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const p = fetchWithDeadline('https://x.test/api/auth/poll/abc', {}, {
      label: 'auth-poll',
      fetchImpl: neverAnswers() as unknown as typeof fetch,
    }).catch(() => null);

    jest.advanceTimersByTime(HOST_REQUEST_TIMEOUT_MS + 1);
    await p;

    const line = warn.mock.calls.map(c => String(c[0])).find(m => m.includes('timed out'));
    expect(line).toBeDefined();
    expect(line).toContain('auth-poll');
    expect(line).toContain('/api/auth/poll/abc');
    expect(line).toContain(String(HOST_REQUEST_TIMEOUT_MS));
  });
});
