/**
 * Clearing DELIVERED notifications from Notification Center.
 *
 * There was no clearing at all. A chat push stayed in Notification Center
 * forever unless the person tapped that exact banner — opening the app did
 * nothing, and neither did reading the conversation it came from. The tray
 * therefore accumulated notifications for messages the user had already read,
 * which is the state every messenger exists to avoid.
 *
 * WHAT IS CLEARED, AND WHY IT IS NOT "EVERYTHING ON FOREGROUND":
 * clearing is per CONVERSATION, keyed on the `topicId` every OpenStoa push
 * already carries (`openstoa/src/lib/push.ts` — `data: { topicId }` is the
 * only routing field the server sends). Opening room A must not silently
 * discard room B's unread banner: that banner is the only record the user has
 * that B has something waiting, and Notification Center is where they expect
 * to find it. Signal draws the same line — `cancelNotifications(threadId:)`,
 * called from `ConversationViewController` — and keeps a whole-tray sweep as a
 * separate, category-filtered operation rather than the default.
 *
 * Structured like `./pushTapBridge` and `./pushRegistration`: the OS API is
 * INJECTED, and this module imports nothing from expo or react-native, so the
 * host's plain-node jest environment can exercise it. Everything here is
 * best-effort and never throws — it runs from navigation callbacks and from an
 * AppState listener, where a rejection has nowhere to go.
 */

/**
 * The slice of `expo-notifications` this module uses.
 *
 * `getPresentedNotificationsAsync` + `dismissNotificationAsync` are Expo's
 * wrappers over `UNUserNotificationCenter.getDeliveredNotifications` and
 * `removeDeliveredNotifications(withIdentifiers:)`. The badge members are
 * optional so a host build with an older expo-notifications degrades to
 * dismissal only.
 */
/**
 * The Android notification channel every chat push is delivered on.
 *
 * It has to exist BEFORE a message arrives, or Firebase displays that message
 * itself on its own fallback channel — and a Firebase-built notification
 * carries none of the extras expo-notifications stamps, so
 * `getPresentedNotificationsAsync()` returns an empty list for it and nothing
 * below can ever match or dismiss it. The server names the same string in its
 * push payload (`openstoa/src/lib/pushProvider.ts`); a disagreement between the
 * two is silent, because a mismatch just puts the notification back on the
 * fallback channel and the tray stops clearing again.
 */
export const CHAT_CHANNEL_ID = 'chat';

export interface PushClearingApi {
  getPresentedNotificationsAsync(): Promise<unknown[]>;
  dismissNotificationAsync(identifier: string): Promise<void>;
  getBadgeCountAsync?(): Promise<number>;
  setBadgeCountAsync?(count: number): Promise<boolean>;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

function parseJson(value: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return null;
  }
}

/**
 * Unwrap the Expo push envelope.
 *
 * Deliberately a COPY of `flattenPushData` in the mini-app's
 * `packages/mobile/src/hooks/pushTapRouting.ts` rather than an import: that
 * module is internal to `openstoa-mobile` and is not on its public entry
 * point, and this file's whole reason for existing is that it must load in a
 * plain-node jest run where the `file:` mini-app packages do not resolve.
 * The rule it encodes is the same one `toHostPushTap` documents — Expo nests
 * the message's `data` under a `body` key rather than splicing it into the top
 * level of the APNs payload, and by the time a notification reaches JS one
 * level may or may not already have been unwrapped, so both shapes occur.
 */
export function flattenPushData(data: unknown): Record<string, unknown> {
  const top = asRecord(data) ?? (typeof data === 'string' ? parseJson(data) : null);
  if (!top) return {};
  const body = top.body;
  if (body === undefined) return top;
  const nested = asRecord(body) ?? (typeof body === 'string' ? parseJson(body) : null);
  return nested ?? top;
}

/**
 * One delivered notification, as `getPresentedNotificationsAsync` returns it.
 *
 * THREE places the data can be, and which one is populated depends on the
 * platform. From `expo-notifications`' own typings:
 *
 *   PushNotificationTrigger = {
 *     type: 'push';
 *     payload?: Record<string, unknown>;        // @platform ios
 *     remoteMessage?: FirebaseRemoteMessage;    // @platform android
 *   }
 *
 * `content.data` is what a notification SCHEDULED by the app carries, and on
 * iOS it is also filled in for a remote one. On Android the FCM payload lands
 * on `trigger.remoteMessage.data` instead — so reading only `content.data`
 * found nothing to match, every notification counted as "not this topic", and
 * the tray stayed full however many times the room was opened. iOS worked, so
 * nothing looked broken.
 */
interface PresentedShape {
  request?: {
    identifier?: unknown;
    content?: { data?: unknown };
    trigger?: { payload?: unknown; remoteMessage?: { data?: unknown } };
  };
}

/** The identifier `dismissNotificationAsync` needs, or null if there is none. */
export function presentedIdentifier(notification: unknown): string | null {
  const id = (notification as PresentedShape | null | undefined)?.request?.identifier;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/**
 * The topic a delivered notification belongs to, or null when it names none.
 *
 * Tries every place the payload can be, first hit wins. Order is not
 * significant — a notification only ever populates one of them — but checking
 * all three is, because which one it is depends on the platform AND on whether
 * the notification was scheduled locally or pushed.
 */
export function presentedTopicId(notification: unknown): string | null {
  const request = (notification as PresentedShape | null | undefined)?.request;
  const candidates = [
    request?.content?.data,
    request?.trigger?.remoteMessage?.data,
    request?.trigger?.payload,
  ];
  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null) continue;
    const topicId = flattenPushData(candidate).topicId;
    if (typeof topicId !== 'string') continue;
    const trimmed = topicId.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return null;
}

/**
 * Remove every delivered notification belonging to `topicId`. Resolves with how
 * many were dismissed — returned rather than logged so a test can assert the
 * branch taken; callers ignore it.
 *
 * A blank or non-string `topicId` is a no-op and NOT "match everything": the
 * id arrives from a navigation route param, and a missing one turning into a
 * whole-tray wipe is exactly the bug this per-conversation design exists to
 * avoid.
 */
export async function clearDeliveredForTopic(
  api: PushClearingApi | null | undefined,
  topicId: unknown,
): Promise<number> {
  if (!api || typeof api.getPresentedNotificationsAsync !== 'function') return 0;
  if (typeof topicId !== 'string') return 0;
  const wanted = topicId.trim();
  if (wanted.length === 0) return 0;

  let presented: unknown[];
  try {
    presented = await api.getPresentedNotificationsAsync();
  } catch {
    // No notification permission, no OS support, native module missing.
    return 0;
  }
  if (!Array.isArray(presented)) return 0;

  const doomed: string[] = [];
  let survivors = 0;
  for (const notification of presented) {
    const id = presentedIdentifier(notification);
    if (id !== null && presentedTopicId(notification) === wanted) doomed.push(id);
    else survivors += 1;
  }

  let dismissed = 0;
  for (const id of doomed) {
    try {
      await api.dismissNotificationAsync(id);
      dismissed += 1;
    } catch {
      // One stubborn notification must not strand the rest of the batch.
    }
  }

  // The badge is only ever LOWERED, and only to zero, and only once the tray is
  // empty. OpenStoa's server sends no `badge` field at all today
  // (`ExpoPushProvider.send` / `.sendCiphertext` in openstoa/src/lib/push.ts),
  // so the badge is always 0 and this is a no-op — deliberately so. Computing a
  // badge from the surviving tray count would START showing a number that has
  // never existed, which is a product change nobody asked for; clearing a stale
  // one cannot regress anything and covers the day the server does send badges.
  if (dismissed > 0 && survivors === 0) await clearBadgeIfSet(api);
  return dismissed;
}

/** Set the badge to 0, but only when it is currently non-zero. Never throws. */
async function clearBadgeIfSet(api: PushClearingApi): Promise<void> {
  if (typeof api.setBadgeCountAsync !== 'function') return;
  try {
    if (typeof api.getBadgeCountAsync === 'function') {
      const current = await api.getBadgeCountAsync();
      if (!(typeof current === 'number' && current > 0)) return;
    }
    await api.setBadgeCountAsync(0);
  } catch {
    // Badges are cosmetic; a failure here is not worth surfacing.
  }
}
