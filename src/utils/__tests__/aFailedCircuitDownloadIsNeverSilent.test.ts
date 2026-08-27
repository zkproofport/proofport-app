/**
 * A circuit download that fails must SAY SO — whichever way the launch went.
 *
 * The defect these lock down happened on a phone with the radios off: the
 * downloads rejected in under a second, the loading screen's "we are done"
 * branch won the race, and that branch never looked at the results. The app
 * opened with no circuit files and told nobody.
 *
 * So every case here asks the same question from a different launch shape, and
 * the repetition cases ask it of MANY launches — one silent launch in twenty is
 * still the bug.
 */
import {bootstrapCircuits, failureReasons} from '../circuitBootstrap';

const ok = (): PromiseSettledResult<unknown> => ({status: 'fulfilled', value: 1});
const bad = (m: string): PromiseSettledResult<unknown> => ({
  status: 'rejected',
  reason: new Error(m),
});

/** Downloads that settle immediately — the offline shape. */
const settleNow = (results: Array<PromiseSettledResult<unknown>>) =>
  Promise.resolve(results);

/** Downloads that settle only after the loading wait has already resolved. */
const settleLate = (results: Array<PromiseSettledResult<unknown>>) =>
  new Promise<Array<PromiseSettledResult<unknown>>>((resolve) =>
    setTimeout(() => resolve(results), 30),
  );

function run(
  downloads: Promise<Array<PromiseSettledResult<unknown>>>,
  waitMs = 0,
) {
  const failures: string[][] = [];
  let finished = 0;
  const done = bootstrapCircuits({
    downloads,
    maxLoadingMs: waitMs,
    /*
     * `waitMs === 0` means "the loading window is already over"; anything else
     * means "it has not elapsed", expressed as a promise that never settles so
     * the test leaves no timer running behind it.
     */
    wait: (ms) => (ms === 0 ? Promise.resolve() : new Promise<void>(() => {})),
    finishLoading: () => {
      finished += 1;
    },
    onFailed: (reasons) => failures.push(reasons),
  });
  return {done, failures, finishedCount: () => finished};
}

describe('a failed circuit download is never silent', () => {
  it('THE DEFECT: downloads that fail INSTANTLY are still reported', async () => {
    // The offline launch. Nothing waits; the race is over before it starts.
    const r = run(settleNow([bad('offline'), bad('offline'), bad('offline')]), 5000);
    await r.done;
    expect(r.failures).toEqual([['offline', 'offline', 'offline']]);
  });

  it('downloads that fail SLOWLY are reported too', async () => {
    const r = run(settleLate([bad('slow')]), 0);
    await r.done;
    expect(r.failures).toEqual([['slow']]);
  });

  it('a launch with nothing wrong reports nothing', async () => {
    const r = run(settleNow([ok(), ok()]), 5000);
    await r.done;
    expect(r.failures).toEqual([]);
  });

  it('a partial failure is reported, not rounded down to success', async () => {
    const r = run(settleNow([ok(), bad('one of three'), ok()]), 5000);
    await r.done;
    expect(r.failures).toEqual([['one of three']]);
  });

  it('REPETITION: twenty instant-failure launches report twenty times', async () => {
    let reported = 0;
    for (let i = 0; i < 20; i += 1) {
      const r = run(settleNow([bad(`launch ${i}`)]), 5000);
      await r.done;
      reported += r.failures.length;
    }
    expect(reported).toBe(20);
  });

  it('REPETITION: twenty clean launches report zero times', async () => {
    let reported = 0;
    for (let i = 0; i < 20; i += 1) {
      const r = run(settleNow([ok()]), 5000);
      await r.done;
      reported += r.failures.length;
    }
    expect(reported).toBe(0);
  });

  it('CONTRACT: the report happens ONCE per launch, not once per branch', async () => {
    const r = run(settleLate([bad('once')]), 0);
    await r.done;
    expect(r.failures).toHaveLength(1);
  });

  it('CONTRACT: the app is entered exactly once either way', async () => {
    const fast = run(settleNow([bad('x')]), 5000);
    await fast.done;
    expect(fast.finishedCount()).toBe(1);

    const slow = run(settleLate([bad('x')]), 0);
    await slow.done;
    expect(slow.finishedCount()).toBe(1);
  });

  it('BOUNDARY: no circuits at all is not a failure', async () => {
    const r = run(settleNow([]), 5000);
    await r.done;
    expect(r.failures).toEqual([]);
  });

  it('a rejection with no message still carries a reason', () => {
    expect(failureReasons([{status: 'rejected', reason: undefined}])).toEqual([
      'Unknown error',
    ]);
    expect(failureReasons([{status: 'rejected', reason: new Error('')}])).toEqual([
      'Unknown error',
    ]);
  });
});
