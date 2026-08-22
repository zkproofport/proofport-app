/**
 * A deadline on the host's own OpenStoa requests.
 *
 * Its own module, rather than a helper inside `zkProofportHostApi.ts`, for the
 * same reason `pushTapBridge` and `pushRegistration` are: that file imports
 * expo-notifications, expo-secure-store and `react-native`, so nothing in it
 * can be exercised without a device. This can.
 *
 * ── Why it is needed at all ───────────────────────────────────────────────
 *
 * `runSelfRelayLogin` polls the OpenStoa server up to 240 times at 1.5s while
 * the user completes a proof. Each attempt was a bare `await fetch(...)`, and
 * `fetch` has no timeout — so ONE request that is accepted and never answered
 * stops the loop where it stands. Not for 6 minutes: forever. The attempt
 * counter never advances, the "timed out waiting for relay" error at the bottom
 * of the loop is never reached, and `loginToOpenStoa` never settles. That is
 * exactly the shape of the reported incident: a mini-app pinned on "Preparing
 * your anonymous identity…" with nothing in the log, because nothing failed.
 *
 * With a deadline the same stall becomes one wasted attempt out of 240 — the
 * poll's own `catch` already treats a failed attempt as "keep trying".
 *
 * ── The deadline is a race, not just an abort ─────────────────────────────
 *
 * Aborting alone rests the guarantee on the runtime honouring the signal, and
 * what is being defended against is a promise that never settles. The abort is
 * still sent, because leaving a socket open behind a caller that has given up
 * is waste, but the caller is freed either way.
 */

/**
 * 15 seconds. The OpenStoa API answers in tens of milliseconds warm; the slow
 * parts are a Cloud Run cold start (1–3s) and a phone's DNS/TCP/TLS on a poor
 * link (1–3s more). Three times the honest worst case for a request that was
 * going to succeed, and — for the poll loop specifically — ten attempts' worth
 * of interval, so a single slow answer costs one attempt rather than the flow.
 */
export const HOST_REQUEST_TIMEOUT_MS = 15_000;

/** The request was accepted and no answer arrived inside the deadline. */
export class HostRequestTimeoutError extends Error {
  readonly kind = 'TIMEOUT' as const;
  constructor(
    readonly label: string,
    readonly timeoutMs: number,
  ) {
    super(`${label} timed out after ${timeoutMs}ms`);
    this.name = 'HostRequestTimeoutError';
  }
}

export interface FetchWithDeadlineOptions {
  /** What this request is, for the error and the log line. */
  label: string;
  /** Milliseconds before giving up. Defaults to `HOST_REQUEST_TIMEOUT_MS`. */
  timeoutMs?: number;
  /** Injectable for tests; defaults to the global. */
  fetchImpl?: typeof fetch;
}

export async function fetchWithDeadline(
  url: string,
  init: RequestInit,
  opts: FetchWithDeadlineOptions,
): Promise<Response> {
  const { label, timeoutMs = HOST_REQUEST_TIMEOUT_MS, fetchImpl = fetch } = opts;
  const controller = new AbortController();
  let timedOut = false;
  const startedAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      try {
        controller.abort();
      } catch {
        // A runtime without abort support must not turn a timeout into a
        // different, stranger error.
      }
      // The only trace a timeout leaves. The incident that prompted this left
      // none at all, which is why its trigger is still unknown.
      console.warn(
        `[zkproofport-host] ${label} timed out after ${Date.now() - startedAt}ms ` +
          `(limit ${timeoutMs}ms): ${url}`,
      );
      reject(new HostRequestTimeoutError(label, timeoutMs));
    }, timeoutMs);
  });

  const attempt = fetchImpl(url, {...init, signal: controller.signal}).catch(e => {
    if (timedOut) throw new HostRequestTimeoutError(label, timeoutMs);
    throw e;
  });
  // The race's loser is nobody's business; without this its rejection is
  // unhandled.
  attempt.catch(() => {});

  try {
    return await Promise.race([attempt, deadline]);
  } finally {
    clearTimeout(timer);
  }
}
