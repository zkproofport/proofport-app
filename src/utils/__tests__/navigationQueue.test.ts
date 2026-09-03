import {createNavigationQueue} from '../navigationQueue';

type Action = {name: string};

function harness(initialReady: boolean) {
  const dispatched: Action[] = [];
  const claimed: string[] = [];
  let ready = initialReady;
  const queue = createNavigationQueue<Action>({
    dispatch: (a) => dispatched.push(a),
    claimRequest: (id) => claimed.push(id),
    isReady: () => ready,
  });
  return {
    queue,
    dispatched,
    claimed,
    setReady: (v: boolean) => {
      ready = v;
    },
  };
}

const GO_PROOF: Action = {name: 'ProofGeneration'};
const GO_CHAT: Action = {name: 'ChatRoom'};

describe('createNavigationQueue', () => {
  it('dispatches immediately and claims the request when the navigator is up', () => {
    const h = harness(true);
    h.queue.navigate(GO_PROOF, 'req-1');
    expect(h.dispatched).toEqual([GO_PROOF]);
    expect(h.claimed).toEqual(['req-1']);
    expect(h.queue.hasPending()).toBe(false);
  });

  it('drops nothing when the navigator is not up yet — and claims nothing', () => {
    const h = harness(false);
    h.queue.navigate(GO_PROOF, 'req-1');
    // This is the cold-start window. Nothing may reach the navigator...
    expect(h.dispatched).toEqual([]);
    // ...and the request must stay unclaimed, or reopening the same link is
    // skipped as "already being processed" and the user can never recover.
    expect(h.claimed).toEqual([]);
    expect(h.queue.hasPending()).toBe(true);
  });

  it('replays the parked navigation once the navigator reports ready', () => {
    const h = harness(false);
    h.queue.navigate(GO_PROOF, 'req-1');
    h.setReady(true);
    expect(h.queue.flush()).toBe(true);
    expect(h.dispatched).toEqual([GO_PROOF]);
    expect(h.claimed).toEqual(['req-1']);
    expect(h.queue.hasPending()).toBe(false);
  });

  it('does not replay the same navigation twice', () => {
    const h = harness(false);
    h.queue.navigate(GO_PROOF, 'req-1');
    h.setReady(true);
    h.queue.flush();
    expect(h.queue.flush()).toBe(false);
    expect(h.dispatched).toEqual([GO_PROOF]);
    expect(h.claimed).toEqual(['req-1']);
  });

  it('flushing with nothing parked dispatches nothing', () => {
    const h = harness(true);
    expect(h.queue.flush()).toBe(false);
    expect(h.dispatched).toEqual([]);
    expect(h.claimed).toEqual([]);
  });

  it('keeps only the newest destination when several arrive before ready', () => {
    const h = harness(false);
    h.queue.navigate(GO_PROOF, 'req-1');
    h.queue.navigate(GO_CHAT, 'req-2');
    h.setReady(true);
    h.queue.flush();
    expect(h.dispatched).toEqual([GO_CHAT]);
    expect(h.claimed).toEqual(['req-2']);
  });

  it('navigates without claiming when there is no request to claim', () => {
    const h = harness(true);
    h.queue.navigate(GO_CHAT, null);
    expect(h.dispatched).toEqual([GO_CHAT]);
    expect(h.claimed).toEqual([]);
  });

  it('parks without claiming when there is no request and the navigator is down', () => {
    const h = harness(false);
    h.queue.navigate(GO_CHAT, null);
    expect(h.dispatched).toEqual([]);
    h.setReady(true);
    h.queue.flush();
    expect(h.dispatched).toEqual([GO_CHAT]);
    expect(h.claimed).toEqual([]);
  });

  it('a throwing dispatch does not leave the entry parked for a later replay', () => {
    const claimed: string[] = [];
    let ready = false;
    const queue = createNavigationQueue<Action>({
      dispatch: () => {
        throw new Error('navigator rejected the action');
      },
      claimRequest: (id) => claimed.push(id),
      isReady: () => ready,
    });
    queue.navigate(GO_PROOF, 'req-1');
    ready = true;
    expect(() => queue.flush()).toThrow('navigator rejected the action');
    expect(queue.hasPending()).toBe(false);
    // The dispatch never landed, so the request stays unclaimed and the link
    // can be opened again.
    expect(claimed).toEqual([]);
  });

  it('reports readiness on every navigate, not just the first', () => {
    const h = harness(true);
    h.queue.navigate(GO_PROOF, 'req-1');
    h.setReady(false);
    h.queue.navigate(GO_CHAT, 'req-2');
    expect(h.dispatched).toEqual([GO_PROOF]);
    expect(h.claimed).toEqual(['req-1']);
    expect(h.queue.hasPending()).toBe(true);
  });

  it('passes the log messages through when a logger is supplied', () => {
    const messages: string[] = [];
    let ready = false;
    const queue = createNavigationQueue<Action>({
      dispatch: () => {},
      claimRequest: () => {},
      isReady: () => ready,
      log: (m) => messages.push(m),
    });
    queue.navigate(GO_PROOF, 'req-1');
    ready = true;
    queue.flush();
    expect(messages).toHaveLength(2);
    expect(messages[0]).toContain('not ready');
    expect(messages[1]).toContain('replaying');
  });
});
