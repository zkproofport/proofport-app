/**
 * The host's half of the badge: it draws, the mini-app counts.
 *
 * THE GAP THIS CLOSES. `pushClearing` could set the app-icon badge to ZERO and
 * nothing ever set it to anything else, so a push that arrived while the app
 * was closed left no trace once its notification was swiped away. The OpenStoa
 * tab had no badge either. The count had to come from the mini-app — the only
 * side that knows what has been read — and cross the bridge.
 *
 * EDGE-CASE MATRIX (CLAUDE.md) → coverage
 *   contract   → a reported count is remembered and published
 *   contract   → a subscriber is called immediately, with the current value
 *   integrity  → an unchanged count publishes nothing (no badge flicker)
 *   hostile    → NaN, Infinity, negative and fractional counts become 0
 *   external   → a throwing subscriber does not stop the others
 *   empty      → unsubscribing really stops delivery
 */
jest.mock('expo-notifications', () => ({
  // The icon is a platform side effect; this file is about the number.
  setBadgeCountAsync: jest.fn(async () => true),
}));

import {
  setUnreadBadge,
  subscribeUnreadBadge,
  unreadBadgeCount,
  __resetUnreadBadge,
} from '../unreadBadge';

beforeEach(() => {
  __resetUnreadBadge();
});

describe('the host draws what the mini-app counts', () => {
  it('CONTRACT: a reported count is remembered', () => {
    setUnreadBadge(4);
    expect(unreadBadgeCount()).toBe(4);
  });

  it('CONTRACT: a subscriber hears about changes', () => {
    const seen: number[] = [];
    subscribeUnreadBadge((n) => seen.push(n));
    setUnreadBadge(2);
    setUnreadBadge(5);
    // The leading 0 is the immediate call on subscribe — see the next case.
    expect(seen).toEqual([0, 2, 5]);
  });

  it('CONTRACT: a late subscriber is told the CURRENT value at once', () => {
    // A tab bar that mounts after the mini-app has reported must not sit blank
    // until the next change — for a count that moves only when a message
    // arrives, that could be hours.
    setUnreadBadge(7);
    const seen: number[] = [];
    subscribeUnreadBadge((n) => seen.push(n));
    expect(seen).toEqual([7]);
  });

  it('INTEGRITY: reporting the same count again publishes nothing', () => {
    // Otherwise every poll of the room list would re-draw the badge, which on
    // some launchers is a visible flicker.
    const seen: number[] = [];
    subscribeUnreadBadge((n) => seen.push(n));
    setUnreadBadge(3);
    setUnreadBadge(3);
    setUnreadBadge(3);
    expect(seen).toEqual([0, 3]);
  });

  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['negative', -2],
    ['a fraction under one', 0.4],
  ])('HOSTILE: %s becomes 0 rather than reaching the platform badge API', (_label, value) => {
    setUnreadBadge(value as number);
    expect(unreadBadgeCount()).toBe(0);
  });

  it('HOSTILE: a fractional count is floored', () => {
    setUnreadBadge(3.9);
    expect(unreadBadgeCount()).toBe(3);
  });

  it('EXTERNAL FAILURE: a subscriber that throws does not stop the others', () => {
    const seen: number[] = [];
    subscribeUnreadBadge(() => {
      throw new Error('a screen mid-unmount');
    });
    subscribeUnreadBadge((n) => seen.push(n));
    setUnreadBadge(6);
    expect(seen).toEqual([0, 6]);
  });

  it('EMPTY: unsubscribing stops delivery', () => {
    const seen: number[] = [];
    const off = subscribeUnreadBadge((n) => seen.push(n));
    off();
    setUnreadBadge(9);
    expect(seen).toEqual([0]);
  });
});
