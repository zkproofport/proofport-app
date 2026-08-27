/**
 * The waiting-messages count, held by the host and drawn in the two places the
 * mini-app cannot reach: its tab in the host's tab bar, and the app icon.
 *
 * THE GAP THIS CLOSES. There were no badges. `pushClearing` could set the icon
 * badge to ZERO and nothing ever set it to anything else — so a push that
 * arrived while the app was closed left no trace once its notification was
 * swiped away, opening the app said nothing, and even inside OpenStoa the only
 * way to find a waiting message was to open the Chat tab and look.
 *
 * WHO OWNS WHAT. The mini-app owns the NUMBER, because it is the only side that
 * knows what has been read; it pushes it over the bridge (`setUnreadBadge`).
 * This module owns the DRAWING, because the tab bar and the icon belong to the
 * host. One number, so the surfaces cannot disagree — a reader who sees 3 on
 * the icon and 1 on a tab has found a bug they can see and cannot explain.
 */

import * as Notifications from 'expo-notifications';

type Listener = (count: number) => void;

/**
 * The last count the mini-app reported.
 *
 * Module state rather than React state: the tab bar and the icon are updated
 * from different places at different times, and one of them (the icon) is not a
 * React tree at all. A subscriber that mounts later reads this immediately, so
 * a tab bar remounting does not blank a badge that is still correct.
 */
let current = 0;
const listeners = new Set<Listener>();

/** Whatever the mini-app last said, or 0 before it has said anything. */
export function unreadBadgeCount(): number {
  return current;
}

/**
 * Record the count and draw it.
 *
 * Guarded against nonsense: this ends up in `setBadgeCountAsync`, and handing a
 * platform badge API a NaN or a negative number is how a home screen ends up
 * with something absurd on it. Anything that is not a whole number ≥ 0 is
 * treated as 0, which is the state the app was in before badges existed.
 */
export function setUnreadBadge(count: number): void {
  const next =
    typeof count === 'number' && Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  if (next === current) return;
  current = next;
  for (const listener of listeners) {
    try {
      listener(next);
    } catch {
      // A subscriber that throws must not stop the others, and must not stop
      // the icon being updated below.
    }
  }
  void applyToAppIcon(next);
}

/**
 * Watch the count. Returns an unsubscribe.
 *
 * Calls back IMMEDIATELY with the current value so a component that mounts
 * after the mini-app has already reported does not sit blank until the next
 * change — which, for a count that only moves when a message arrives, could be
 * hours.
 */
export function subscribeUnreadBadge(listener: Listener): () => void {
  listeners.add(listener);
  try {
    listener(current);
  } catch {
    // As above: a throwing subscriber is its own problem.
  }
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Put the number on the home-screen icon.
 *
 * Never throws and never awaited by the caller. Badges are cosmetic: a
 * permission the user declined, a launcher that does not support them (many
 * Android launchers), or a platform module missing from an older build must
 * all end in "no badge", never in a failed message delivery.
 */
async function applyToAppIcon(count: number): Promise<void> {
  try {
    await Notifications.setBadgeCountAsync(count);
  } catch {
    // Cosmetic. See above.
  }
}

/**
 * Ask the server how many messages are waiting, and publish the answer.
 *
 * WHY THE HOST DOES THIS ITSELF. The mini-app owns the count while it is
 * RUNNING, and it only runs once someone opens the OpenStoa tab — which is
 * exactly the moment a badge is no longer needed. Verified on the device: three
 * unread on the server, the app relaunched, and the tab carried nothing until
 * the mini-app was opened. A badge that only appears after you have already
 * gone looking is not a badge.
 *
 * So the host refreshes it on its own at launch and on foreground. The two
 * writers do not fight: both funnel through `setUnreadBadge`, which ignores an
 * unchanged value, and the mini-app's number wins while it is running because
 * it is the fresher of the two — it knows about a room read a second ago that
 * the server has not been told about yet.
 *
 * ROUTING METADATA ONLY. `/api/topics` returns counts, never message content
 * (SI-1). The host never sees a plaintext message and could not decrypt one.
 *
 * Never throws. No token, no network, a 500, a body that is not what we expect
 * — all of them leave the badge exactly as it was, which is the state the app
 * shipped in before badges existed.
 */
export async function refreshUnreadBadgeFromServer(deps: {
  baseUrl: string;
  token: string | null;
  /** Injected so a test does not need a network stack. */
  fetchImpl?: typeof fetch;
}): Promise<void> {
  const { baseUrl, token } = deps;
  if (!token) return;
  const doFetch = deps.fetchImpl ?? fetch;
  try {
    const res = await doFetch(`${baseUrl.replace(/\/$/, '')}/api/topics?joined=true`, {
      headers: { Authorization: `Bearer ${token}` },
      // The host's cookie jar outlives the mini-app's token and has signed
      // people in as the wrong account before. The header is the only auth
      // source trusted here, same rule as the mini-app's own boot probe.
      credentials: 'omit',
    });
    if (!res.ok) return;
    const body: unknown = await res.json();
    const rooms = Array.isArray(body)
      ? body
      : ((body as { topics?: unknown[] } | null)?.topics ?? []);
    if (!Array.isArray(rooms)) return;
    let total = 0;
    for (const room of rooms) {
      const n = (room as { unreadCount?: unknown } | null)?.unreadCount;
      // Same guard as the mini-app's `unreadTotal`: a bad row contributes
      // zero rather than poisoning a number bound for a native badge API.
      if (typeof n === 'number' && Number.isFinite(n) && n > 0) total += Math.floor(n);
    }
    setUnreadBadge(total);
  } catch {
    // Offline, DNS, TLS, a deadline. The badge keeps whatever it had.
  }
}

/** Test seam: forget the count and every subscriber. */
export function __resetUnreadBadge(): void {
  current = 0;
  listeners.clear();
}
