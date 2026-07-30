/**
 * OpenStoa notification TAP bridge (design §13, P-O gap 5) — the host half of
 * push tap routing.
 *
 * The behaviour under test is the promise that a tap is never dropped for want
 * of an audience: the mini-app is unmounted on every host tab except OpenStoa,
 * and on a cold start it does not exist for several seconds after the tap.
 *
 * Edge-case matrix rows covered here:
 *   cold start      — `COLD START:` (launch response replayed to a subscriber
 *                     that attaches later; host jumped to the OpenStoa tab)
 *   warm            — `WARM:` (OS listener with a subscriber already attached)
 *   inactive tab    — `INACTIVE TAB:` (no subscriber → latch + jump)
 *   boundary/empty  — malformed responses (null, no notification, no request,
 *                     data missing / non-object / array / string)
 *   contract        — the notifications API is invoked exactly once; a second
 *                     start is a no-op; unsubscribe detaches (listener leak)
 *   race            — remount attaching before the old teardown runs
 *   failure         — API that throws on start, promise rejection, subscriber
 *                     that throws (tap is re-latched, not lost)
 */
import {
  __resetPushTapBridge,
  setOpenStoaTabNavigation,
  startPushTapBridge,
  subscribeHostPushTap,
  toHostPushTap,
  type HostPushTap,
  type PushTapNotificationsApi,
} from '../pushTapBridge';

const TOPIC = '11111111-2222-4333-8444-555555555555';

function response(data: unknown, identifier = 'n-1'): unknown {
  return { notification: { request: { identifier, content: { data } } } };
}

/** An expo-notifications stand-in the test drives by hand. */
function fakeApi(launchResponse: unknown = null) {
  const state = {
    listeners: [] as Array<(r: unknown) => void>,
    addCalls: 0,
    lastCalls: 0,
    removed: 0,
  };
  const api: PushTapNotificationsApi = {
    addNotificationResponseReceivedListener: (listener) => {
      state.addCalls += 1;
      state.listeners.push(listener);
      return {
        remove: () => {
          state.removed += 1;
        },
      };
    },
    getLastNotificationResponseAsync: async () => {
      state.lastCalls += 1;
      return launchResponse;
    },
  };
  return {
    api,
    state,
    emit: (r: unknown) => state.listeners.forEach((l) => l(r)),
  };
}

/** Let the `getLastNotificationResponseAsync` promise chain settle. */
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

beforeEach(() => {
  __resetPushTapBridge();
  jest.useRealTimers();
});

describe('toHostPushTap', () => {
  it('lifts the identifier and the data payload', () => {
    expect(toHostPushTap(response({ topicId: TOPIC }, 'abc'))).toEqual({
      id: 'abc',
      data: { topicId: TOPIC },
    });
  });

  it('passes nested `body` through untouched — unwrapping is the mini-app\'s job', () => {
    // Expo does not splice `data` into the top level; whichever shape arrives
    // must survive this hop unmodified or the mini-app cannot recognise it.
    expect(toHostPushTap(response({ body: { topicId: TOPIC } }))?.data).toEqual({
      body: { topicId: TOPIC },
    });
  });

  it('EMPTY: a response with no notification/request is null, not a fake tap', () => {
    expect(toHostPushTap(null)).toBeNull();
    expect(toHostPushTap(undefined)).toBeNull();
    expect(toHostPushTap({})).toBeNull();
    expect(toHostPushTap({ notification: {} })).toBeNull();
    expect(toHostPushTap('a string')).toBeNull();
  });

  it('BOUNDARY: non-object data degrades to {} rather than propagating junk', () => {
    for (const data of [undefined, null, 0, 'str', ['x'], true]) {
      expect(toHostPushTap(response(data))?.data).toEqual({});
    }
  });

  it('a non-string identifier is dropped rather than passed on as an id', () => {
    expect(toHostPushTap(response({ topicId: TOPIC }, 7 as unknown as string))?.id).toBeUndefined();
  });
});

describe('startPushTapBridge', () => {
  it('CONTRACT: registers exactly one OS listener and asks for the launch response once', async () => {
    const { api, state } = fakeApi();
    startPushTapBridge(api);
    startPushTapBridge(api); // idempotent — a second call must not double-register
    await flush();
    expect(state.addCalls).toBe(1);
    expect(state.lastCalls).toBe(1);
  });

  it('FAILURE: an API that throws leaves the host usable, tap routing simply off', () => {
    const api = {
      addNotificationResponseReceivedListener: () => {
        throw new Error('native module missing');
      },
      getLastNotificationResponseAsync: async () => null,
    } as unknown as PushTapNotificationsApi;
    expect(() => startPushTapBridge(api)).not.toThrow();
  });

  it('FAILURE: a rejected launch-response query is swallowed', async () => {
    const api: PushTapNotificationsApi = {
      addNotificationResponseReceivedListener: () => ({ remove: () => {} }),
      getLastNotificationResponseAsync: async () => {
        throw new Error('no permission');
      },
    };
    startPushTapBridge(api);
    await expect(flush()).resolves.toBeUndefined();
  });
});

describe('tap delivery', () => {
  it('WARM: a tap reaches a subscriber that is already attached', async () => {
    const { api, emit } = fakeApi();
    startPushTapBridge(api);
    await flush();
    const seen: HostPushTap[] = [];
    subscribeHostPushTap((tap) => seen.push(tap));
    emit(response({ topicId: TOPIC }, 'n-warm'));
    expect(seen).toEqual([{ id: 'n-warm', data: { topicId: TOPIC } }]);
  });

  it('COLD START: the launch response is replayed to a subscriber that attaches later', async () => {
    const { api } = fakeApi(response({ topicId: TOPIC }, 'n-cold'));
    startPushTapBridge(api);
    await flush(); // the tap lands with nobody listening — the app is still booting
    const seen: HostPushTap[] = [];
    subscribeHostPushTap((tap) => seen.push(tap));
    expect(seen).toEqual([{ id: 'n-cold', data: { topicId: TOPIC } }]);
  });

  it('COLD START: the replay happens once — a later subscriber gets nothing', async () => {
    const { api } = fakeApi(response({ topicId: TOPIC }, 'n-cold'));
    startPushTapBridge(api);
    await flush();
    subscribeHostPushTap(() => {})();
    const second: HostPushTap[] = [];
    subscribeHostPushTap((tap) => second.push(tap));
    expect(second).toEqual([]);
  });

  it('INACTIVE TAB: with no subscriber, the tap is latched and the host is sent to OpenStoa', async () => {
    const { api, emit } = fakeApi();
    const navigate = jest.fn();
    startPushTapBridge(api);
    await flush();
    setOpenStoaTabNavigation({ navigate });

    emit(response({ topicId: TOPIC }, 'n-1'));
    expect(navigate).toHaveBeenCalledWith('OpenStoaTab');

    // …and the mini-app that mounts as a result still receives it.
    const seen: HostPushTap[] = [];
    subscribeHostPushTap((tap) => seen.push(tap));
    expect(seen).toEqual([{ id: 'n-1', data: { topicId: TOPIC } }]);
  });

  it('COLD START: a tap latched before any navigation exists jumps once the navigator publishes', async () => {
    jest.useFakeTimers();
    const { api } = fakeApi(response({ topicId: TOPIC }, 'n-cold'));
    startPushTapBridge(api);
    await Promise.resolve();
    await Promise.resolve();
    const navigate = jest.fn();
    // The host TabNavigator renders and publishes its navigation object.
    setOpenStoaTabNavigation({ navigate });
    // Deferred a tick on purpose — dispatching during render is a state update
    // during render, so nothing may have happened yet.
    expect(navigate).not.toHaveBeenCalled();
    jest.runOnlyPendingTimers();
    expect(navigate).toHaveBeenCalledWith('OpenStoaTab');
  });

  it('re-renders of the navigator do not queue the jump more than once', async () => {
    jest.useFakeTimers();
    const { api } = fakeApi(response({ topicId: TOPIC }, 'n-cold'));
    startPushTapBridge(api);
    await Promise.resolve();
    await Promise.resolve();
    const navigate = jest.fn();
    for (let i = 0; i < 5; i++) setOpenStoaTabNavigation({ navigate });
    jest.runOnlyPendingTimers();
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('a navigation object that throws does not stop the tap from being delivered', async () => {
    const { api, emit } = fakeApi();
    startPushTapBridge(api);
    await flush();
    setOpenStoaTabNavigation({
      navigate: () => {
        throw new Error('navigator not ready');
      },
    });
    const seen: HostPushTap[] = [];
    subscribeHostPushTap((tap) => seen.push(tap));
    expect(() => emit(response({ topicId: TOPIC }))).not.toThrow();
    expect(seen).toHaveLength(1);
  });

  it('FAILURE: a subscriber that throws re-latches the tap so a remount can retry', async () => {
    const { api, emit } = fakeApi();
    startPushTapBridge(api);
    await flush();
    const unsubscribe = subscribeHostPushTap(() => {
      throw new Error('mini-app blew up');
    });
    expect(() => emit(response({ topicId: TOPIC }, 'n-1'))).not.toThrow();
    unsubscribe();

    const seen: HostPushTap[] = [];
    subscribeHostPushTap((tap) => seen.push(tap));
    expect(seen).toEqual([{ id: 'n-1', data: { topicId: TOPIC } }]);
  });

  it('CLEANUP: after unsubscribe the tap is latched instead of delivered (no leak)', async () => {
    const { api, emit } = fakeApi();
    startPushTapBridge(api);
    await flush();
    const seen: HostPushTap[] = [];
    const unsubscribe = subscribeHostPushTap((tap) => seen.push(tap));
    unsubscribe();
    emit(response({ topicId: TOPIC }, 'n-1'));
    expect(seen).toEqual([]);
  });

  it('RACE: a remount that subscribes before the old teardown keeps the new subscriber', async () => {
    const { api, emit } = fakeApi();
    startPushTapBridge(api);
    await flush();
    const first: HostPushTap[] = [];
    const second: HostPushTap[] = [];
    const unsubscribeFirst = subscribeHostPushTap((tap) => first.push(tap));
    subscribeHostPushTap((tap) => second.push(tap));
    // React runs the new effect before the previous cleanup in some orders.
    unsubscribeFirst();
    emit(response({ topicId: TOPIC }, 'n-1'));
    expect(first).toEqual([]);
    expect(second).toHaveLength(1);
  });

  it('a malformed OS response is ignored — no tap, no navigation', async () => {
    const { api, emit } = fakeApi();
    const navigate = jest.fn();
    startPushTapBridge(api);
    await flush();
    setOpenStoaTabNavigation({ navigate });
    const seen: HostPushTap[] = [];
    subscribeHostPushTap((tap) => seen.push(tap));
    for (const bad of [null, undefined, {}, { notification: {} }, 'x']) {
      expect(() => emit(bad)).not.toThrow();
    }
    expect(seen).toEqual([]);
    expect(navigate).not.toHaveBeenCalled();
  });
});
