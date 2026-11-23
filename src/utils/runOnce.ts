/**
 * Runs `run` unless a previous call through the same lock is still running.
 *
 * The proof screen starts an attempt from several places (the dApp request
 * auto-start, the retry after a wallet is connected, the buttons). On
 * 2026-11-23 two of them fired for one relay request: the second attempt
 * failed on the wallet's "Signing already in progress" and answered the dApp
 * with an error, while the first went on to prove a request that was already
 * answered. The QR scanner locks on its first read for the same reason.
 *
 * The lock is taken before the first await, so a call made in the same tick
 * is refused, and released however `run` ends, so a retry after a failure or
 * a cancel still starts.
 */
export async function runOnce(
  lock: {current: boolean},
  run: () => Promise<void>,
  onBusy: () => void,
): Promise<void> {
  if (lock.current) {
    onBusy();
    return;
  }
  lock.current = true;
  try {
    await run();
  } finally {
    lock.current = false;
  }
}
