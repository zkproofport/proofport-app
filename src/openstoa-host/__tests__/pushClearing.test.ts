/**
 * Delivered-notification clearing (see ../pushClearing).
 *
 * The property under test is NOT "some notifications were dismissed" — it is
 * WHICH ones. Every case here is written so that a clear-everything
 * implementation fails it, because clearing everything is the plausible wrong
 * answer and the one this design deliberately rejects.
 */
import {
  clearDeliveredForTopic,
  flattenPushData,
  presentedIdentifier,
  presentedTopicId,
} from '../pushClearing';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

/** One entry as `getPresentedNotificationsAsync` returns it. */
function presented(identifier: string, data: unknown) {
  return { request: { identifier, content: { data } } };
}

/**
 * Android, as `expo-notifications` really hands it over.
 *
 * The FCM payload is on `trigger.remoteMessage.data`, NOT on `content.data` —
 * and every value in it is a STRING, because that is what
 * `FirebaseRemoteMessage.data: Record<string, string>` is. Expo nests the
 * message's own data under `body`, so what arrives is a JSON string.
 */
function presentedAndroid(identifier: string, data: Record<string, unknown>) {
  return {
    request: {
      identifier,
      content: { data: undefined },
      trigger: { remoteMessage: { data: { body: JSON.stringify(data) } } },
    },
  };
}

/**
 * Android as it arrives NOW: straight from FCM, with no Expo service in front.
 *
 * The difference from `presentedAndroid` is the whole point of this shape. Going
 * through Expo's push service, the developer's data is nested under `body` as a
 * JSON string, because Expo wraps it. Sending the data message ourselves — which
 * is the only way `expo-notifications` builds the notification on Android, and
 * therefore the only way one room's notifications can be dismissed — there is no
 * wrapper: `serialiseData` writes the keys FLAT, every value a string, because
 * `FirebaseRemoteMessage.data` has no other type.
 *
 * So the payload carries `topicId` beside `tag`, `channelId` and a stringified
 * `epoch`. If that shape does not parse, the room opens and clears nothing, and
 * the failure looks exactly like a broken dismiss.
 */
function presentedDirectFcm(identifier: string, data: Record<string, unknown>) {
  const flat: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined || v === null) continue;
    flat[k] = typeof v === 'string' ? v : JSON.stringify(v);
  }
  if (flat.topicId) flat.tag = flat.topicId;
  flat.channelId = 'chat';
  return {
    request: {
      identifier,
      content: { data: undefined },
      trigger: { remoteMessage: { data: flat } },
    },
  };
}

/** iOS, where the APNs userInfo rides on `trigger.payload`. */
function presentedIos(identifier: string, data: Record<string, unknown>) {
  return {
    request: { identifier, content: { data: undefined }, trigger: { payload: { body: data } } },
  };
}

interface FakeApiOptions {
  badge?: number;
  /** Identifiers whose dismissal should reject, modelling a stubborn one. */
  failing?: string[];
  /** Make the tray read itself reject. */
  listThrows?: boolean;
}

function fakeApi(entries: unknown[], options: FakeApiOptions = {}) {
  const dismissed: string[] = [];
  let badge = options.badge ?? 0;
  const badgeWrites: number[] = [];
  /**
   * How many times the tray was READ. Counted because for a blank topic id the
   * only observable difference between "guarded" and "unguarded" is whether the
   * OS is asked at all — the match itself can never succeed either way, so an
   * assertion about `dismissed` alone passes with the guard deleted and is
   * decoration rather than a test.
   */
  let listReads = 0;
  return {
    dismissed,
    badgeWrites,
    get listReads() {
      return listReads;
    },
    get badge() {
      return badge;
    },
    api: {
      getPresentedNotificationsAsync: async () => {
        listReads += 1;
        if (options.listThrows) throw new Error('no permission');
        return entries;
      },
      dismissNotificationAsync: async (id: string) => {
        if (options.failing?.includes(id)) throw new Error('stubborn');
        dismissed.push(id);
      },
      getBadgeCountAsync: async () => badge,
      setBadgeCountAsync: async (value: number) => {
        badgeWrites.push(value);
        badge = value;
        return true;
      },
    },
  };
}

describe('flattenPushData', () => {
  it('accepts an already-flat payload', () => {
    expect(flattenPushData({ topicId: A })).toEqual({ topicId: A });
  });

  it('unwraps the Expo `body` envelope', () => {
    expect(flattenPushData({ body: { topicId: A } })).toEqual({ topicId: A });
  });

  it('unwraps a `body` that arrived as a JSON string', () => {
    expect(flattenPushData({ body: JSON.stringify({ topicId: A }) })).toEqual({ topicId: A });
  });

  it('keeps the top level when `body` is not a payload', () => {
    expect(flattenPushData({ topicId: A, body: 7 })).toEqual({ topicId: A, body: 7 });
    expect(flattenPushData({ topicId: A, body: 'not json' })).toEqual({
      topicId: A,
      body: 'not json',
    });
  });

  it('returns an empty record for anything unusable', () => {
    for (const input of [null, undefined, 42, [], 'nope']) {
      expect(flattenPushData(input)).toEqual({});
    }
  });
});

describe('presentedIdentifier / presentedTopicId', () => {
  it('reads both fields off a well-formed entry', () => {
    const entry = presented('n1', { topicId: A });
    expect(presentedIdentifier(entry)).toBe('n1');
    expect(presentedTopicId(entry)).toBe(A);
  });

  it('reads a topic id nested under the Expo envelope', () => {
    expect(presentedTopicId(presented('n1', { body: { topicId: A } }))).toBe(A);
  });

  it('DIRECT FCM: reads the topic from the FLAT string map, with no body wrapper', () => {
    /*
     * The shape the server sends today. Through Expo the data was nested under
     * `body`; sending the data message ourselves there is no wrapper at all, and
     * a reader that only understood the nested form would find no topic and
     * clear nothing.
     */
    const entry = presentedDirectFcm('n1', { topicId: A, title: 'OpenStoa', message: 'New message' });
    expect(presentedTopicId(entry)).toBe(A);
  });

  it('DIRECT FCM: a stringified number beside the topic does not confuse it', () => {
    // Phase B carries `epoch`, which is a NUMBER in the payload type and a
    // string on the wire — `FirebaseRemoteMessage.data` has no other type.
    const entry = presentedDirectFcm('n1', {
      topicId: A,
      messageId: '9f0a1b2c-0000-4000-8000-000000000000',
      epoch: 7,
      kind: 'key-needed',
    });
    expect(presentedTopicId(entry)).toBe(A);
  });

  it('DIRECT FCM: the tag mirrors the topic, which is what makes dismissal possible', () => {
    // `expo-notifications` uses `data["tag"]` as the notification identifier,
    // so a payload whose tag disagreed with its topic would be dismissible only
    // by a name nothing on this side knows.
    const entry = presentedDirectFcm('n1', { topicId: A });
    const data = (entry.request.trigger.remoteMessage as { data: Record<string, string> }).data;
    expect(data.tag).toBe(A);
    expect(presentedTopicId(entry)).toBe(data.tag);
  });

  it('ANDROID: reads the topic off trigger.remoteMessage.data', () => {
    // THE DEFECT. Only `content.data` was read, which on Android is empty for a
    // pushed notification — so nothing ever matched, the tray never emptied,
    // and iOS working made it look like nothing was wrong.
    expect(presentedTopicId(presentedAndroid('n1', { topicId: A }))).toBe(A);
  });

  it('IOS: reads the topic off trigger.payload', () => {
    expect(presentedTopicId(presentedIos('n1', { topicId: A }))).toBe(A);
  });

  it('INTEGRITY: an Android notification for another room is not matched', () => {
    // The widened read must not turn into "match anything with a topicId".
    expect(presentedTopicId(presentedAndroid('n1', { topicId: B }))).toBe(B);
    expect(presentedTopicId(presentedAndroid('n1', {}))).toBeNull();
  });

  it('returns null rather than throwing on junk', () => {
    for (const entry of [null, undefined, {}, { request: {} }, 5]) {
      expect(presentedIdentifier(entry)).toBeNull();
      expect(presentedTopicId(entry)).toBeNull();
    }
    expect(presentedIdentifier(presented('', { topicId: A }))).toBeNull();
    expect(presentedTopicId(presented('n1', { topicId: '   ' }))).toBeNull();
    expect(presentedTopicId(presented('n1', { topicId: 42 }))).toBeNull();
  });

  it('a trigger that names no topic is null, not a wildcard', () => {
    // These all have a perfectly good IDENTIFIER — only the topic is missing.
    // A null here means "not this conversation"; anything else would let one
    // room's notification be dismissed by opening another.
    for (const entry of [
      { request: { identifier: 'n1', trigger: {} } },
      { request: { identifier: 'n1', trigger: { remoteMessage: {} } } },
      { request: { identifier: 'n1', trigger: { remoteMessage: { data: 'not json' } } } },
      { request: { identifier: 'n1', trigger: { payload: { body: { other: 'field' } } } } },
    ]) {
      expect(presentedIdentifier(entry)).toBe('n1');
      expect(presentedTopicId(entry)).toBeNull();
    }
  });
});

describe('clearDeliveredForTopic', () => {
  it('dismisses only the notifications of the named conversation', async () => {
    const f = fakeApi([
      presented('a1', { topicId: A }),
      presented('b1', { topicId: B }),
      presented('a2', { topicId: A }),
    ]);
    await expect(clearDeliveredForTopic(f.api, A)).resolves.toBe(2);
    expect(f.dismissed).toEqual(['a1', 'a2']);
  });

  it('leaves another conversation alone even when it is the only one there', async () => {
    const f = fakeApi([presented('b1', { topicId: B })]);
    await expect(clearDeliveredForTopic(f.api, A)).resolves.toBe(0);
    expect(f.dismissed).toEqual([]);
  });

  it('matches through the Expo `body` envelope', async () => {
    const f = fakeApi([presented('a1', { body: { topicId: A } })]);
    await expect(clearDeliveredForTopic(f.api, A)).resolves.toBe(1);
    expect(f.dismissed).toEqual(['a1']);
  });

  it('clears a `key-needed` notification for the same conversation too', async () => {
    // Same room, different `kind`. Being in the room is being in the room.
    const f = fakeApi([presented('k1', { topicId: A, kind: 'key-needed', epoch: 3 })]);
    await expect(clearDeliveredForTopic(f.api, A)).resolves.toBe(1);
  });

  it('trims the caller-supplied id before matching', async () => {
    const f = fakeApi([presented('a1', { topicId: A })]);
    await expect(clearDeliveredForTopic(f.api, `  ${A}  `)).resolves.toBe(1);
  });

  it('is a no-op — NOT a whole-tray wipe — for a missing or blank topic id', async () => {
    for (const bad of [undefined, null, '', '   ', 42, {}, []]) {
      const f = fakeApi([presented('a1', { topicId: A }), presented('b1', { topicId: B })]);
      await expect(clearDeliveredForTopic(f.api, bad)).resolves.toBe(0);
      expect(f.dismissed).toEqual([]);
      // Rejected before the OS is even asked — see `listReads` above.
      expect(f.listReads).toBe(0);
    }
  });

  it('never dismisses a notification carrying no topic id', async () => {
    const f = fakeApi([presented('x1', {}), presented('x2', null), presented('a1', { topicId: A })]);
    await expect(clearDeliveredForTopic(f.api, A)).resolves.toBe(1);
    expect(f.dismissed).toEqual(['a1']);
  });

  it('survives a tray read that rejects', async () => {
    const f = fakeApi([presented('a1', { topicId: A })], { listThrows: true });
    await expect(clearDeliveredForTopic(f.api, A)).resolves.toBe(0);
    expect(f.dismissed).toEqual([]);
  });

  it('keeps going when one dismissal rejects', async () => {
    const f = fakeApi([presented('a1', { topicId: A }), presented('a2', { topicId: A })], {
      failing: ['a1'],
    });
    await expect(clearDeliveredForTopic(f.api, A)).resolves.toBe(1);
    expect(f.dismissed).toEqual(['a2']);
  });

  it('degrades to a no-op on a host with no notifications API at all', async () => {
    await expect(clearDeliveredForTopic(null, A)).resolves.toBe(0);
    await expect(clearDeliveredForTopic(undefined, A)).resolves.toBe(0);
    await expect(clearDeliveredForTopic({} as never, A)).resolves.toBe(0);
  });

  it('clears a stale badge once the tray is empty', async () => {
    const f = fakeApi([presented('a1', { topicId: A })], { badge: 3 });
    await clearDeliveredForTopic(f.api, A);
    expect(f.badgeWrites).toEqual([0]);
  });

  it('leaves the badge alone while another conversation still has a notification', async () => {
    const f = fakeApi([presented('a1', { topicId: A }), presented('b1', { topicId: B })], {
      badge: 3,
    });
    await clearDeliveredForTopic(f.api, A);
    expect(f.badgeWrites).toEqual([]);
    expect(f.badge).toBe(3);
  });

  it('never WRITES a badge that was already zero', async () => {
    // The server sends no badge today, so this is the live case: one pointless
    // native call per room entry is exactly what this guard exists to avoid.
    const f = fakeApi([presented('a1', { topicId: A })], { badge: 0 });
    await clearDeliveredForTopic(f.api, A);
    expect(f.badgeWrites).toEqual([]);
  });

  it('works on an older expo-notifications with no badge members', async () => {
    const dismissed: string[] = [];
    const api = {
      getPresentedNotificationsAsync: async () => [presented('a1', { topicId: A })],
      dismissNotificationAsync: async (id: string) => {
        dismissed.push(id);
      },
    };
    await expect(clearDeliveredForTopic(api, A)).resolves.toBe(1);
    expect(dismissed).toEqual(['a1']);
  });
});
