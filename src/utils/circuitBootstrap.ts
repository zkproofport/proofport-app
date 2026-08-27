/**
 * Entering the app while circuits download, and saying so when they fail.
 *
 * THE DEFECT THIS EXISTS FOR, measured on a phone 2026-08-27 with the radios
 * off. The loading screen raced "all downloads settled" against "we have waited
 * long enough", and the code that inspected the results lived INSIDE the second
 * branch. Offline, the downloads reject in well under a second, so the first
 * branch won — and that branch called `finishLoading()` without ever looking at
 * what it was finishing. Three rejections, no log, no notice, no retry: the app
 * opened on the main screen with zero circuit files and the person was told
 * nothing until a proof failed later for no stated reason.
 *
 * So the report hangs off the downloads themselves. Whoever wins the race, the
 * results are read exactly once, and there is no branch left that can skip it.
 */
export interface CircuitBootstrapDeps {
  /** Already running — `Promise.allSettled` over every circuit. */
  downloads: Promise<Array<PromiseSettledResult<unknown>>>;
  /** How long to hold the loading screen before entering anyway. */
  maxLoadingMs: number;
  /** Injected so the wait is testable without the clock. */
  wait: (ms: number) => Promise<void>;
  /** Leave the loading screen. */
  finishLoading: () => void;
  /** Report failures. Called once, and only when something actually failed. */
  onFailed: (reasons: string[]) => void;
  log?: (message: string) => void;
}

export function failureReasons(
  results: Array<PromiseSettledResult<unknown>>,
): string[] {
  return results
    .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    .map((r) => {
      const reason = r.reason as {message?: unknown} | undefined;
      const message = typeof reason?.message === 'string' ? reason.message : '';
      return message || 'Unknown error';
    });
}

export async function bootstrapCircuits(deps: CircuitBootstrapDeps): Promise<void> {
  const {downloads, maxLoadingMs, wait, finishLoading, onFailed} = deps;
  const log = deps.log ?? (() => {});

  // Attached BEFORE the race, so it cannot be skipped by whichever side wins.
  const reported = downloads.then((results) => {
    const reasons = failureReasons(results);
    if (reasons.length === 0) {
      log('Background circuit downloads completed successfully.');
      return;
    }
    log(`Circuit download failed: ${reasons.join('; ')}`);
    onFailed(reasons);
  });

  const outcome = await Promise.race([
    downloads.then(() => 'done' as const),
    wait(maxLoadingMs).then(() => 'timeout' as const),
  ]);

  if (outcome === 'timeout') {
    log('Loading timeout reached, entering app. Downloads continue in background.');
  }
  finishLoading();

  // Returned so a caller — and a test — can wait for the report. The loading
  // screen is already gone by here, so this delays nothing a person sees.
  await reported;
}
