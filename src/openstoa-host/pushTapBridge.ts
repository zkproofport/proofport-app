/**
 * Notification TAP plumbing for the OpenStoa mini-app (design §13, P-O gap 5).
 *
 * Split out of `zkProofportHostApi` and given its notifications API by
 * injection so it imports NOTHING from expo or react-native — the host's jest
 * config is a plain node environment (`jest.config.js`) with no react-native
 * preset, and this is the logic most worth pinning down: it decides whether a
 * tap survives a cold start.
 *
 * Why everything here is module-level rather than per-mini-app-instance: a chat
 * push must route even when nothing OpenStoa-related is on screen.
 *
 *  - The app can be LAUNCHED by the tap, in which case
 *    `addNotificationResponseReceivedListener` has nothing to fire at and the
 *    response is only retrievable via `getLastNotificationResponseAsync()`.
 *  - The user can be on any other host tab, in which case OpenStoaRootScreen —
 *    and with it the whole mini-app — is not mounted (the host's tab navigator
 *    is lazy and starts on ProofTab), so there is no subscriber to hand it to.
 *
 * Both resolve the same way: LATCH the tap, nudge the host over to the OpenStoa
 * tab so a subscriber appears, and replay the latch to that first subscriber.
 */

/** One notification tap, matching `PushNotificationTap` in the mini-app bridge. */
export interface HostPushTap {
  id?: string;
  data: Record<string, unknown>;
}

/** The slice of `expo-notifications` this module uses. */
export interface PushTapNotificationsApi {
  addNotificationResponseReceivedListener(
    listener: (response: unknown) => void,
  ): { remove(): void };
  getLastNotificationResponseAsync(): Promise<unknown>;
  /**
   * Notifications DELIVERED without being tapped. Optional so an older
   * expo-notifications — or a stub in a test — degrades to taps only.
   */
  addNotificationReceivedListener?(
    listener: (notification: unknown) => void,
  ): { remove(): void };
}

/** Just enough of a React Navigation navigation object to switch host tabs. */
export interface HostTabNavigation {
  navigate(name: never): void;
}

let listenerStarted = false;
/** The single live mini-app subscriber, or null while it is unmounted. */
let subscriber: ((tap: HostPushTap) => void) | null = null;
/** Most recent tap nobody was around to receive. Replayed on next subscribe. */
let latchedTap: HostPushTap | null = null;
/** The mini-app's subscriber for notifications that were NOT tapped. */
let receivedSubscriber: ((tap: HostPushTap) => void) | null = null;
/**
 * Deliveries nobody was around to receive, replayed on next subscribe.
 *
 * A QUEUE rather than the single slot taps use: taps compete for one navigation
 * so only the last matters, whereas each delivery names a different topic that
 * may need a key handed over, and dropping the earlier ones leaves those rooms
 * locked. Bounded because it is filled by a remote party.
 */
const latchedDeliveries: HostPushTap[] = [];
const MAX_LATCHED_DELIVERIES = 16;
let navigateToOpenStoa: (() => void) | null = null;
/** Guards the deferred jump below against the navigator's re-renders. */
let jumpScheduled = false;

/**
 * Normalise one OS notification response. Returns null for anything that is not
 * a response we can attribute to a notification.
 *
 * `data` is passed through UNNORMALISED on purpose: Expo push does not splice
 * the message's `data` into the top level of the APNs payload — it nests it
 * under a `body` key (`EXNotificationSerializer.m`, mirrored in
 * `ios/OpenStoaNSE/PushPayload.swift`) — and expo-notifications unwraps that on
 * most but not all transports. The mini-app accepts BOTH shapes rather than
 * either side betting on one.
 */
export function toHostPushTap(response: unknown): HostPushTap | null {
  const request = (
    response as
      | { notification?: { request?: { identifier?: unknown; content?: { data?: unknown } } } }
      | null
      | undefined
  )?.notification?.request;
  if (!request) return null;
  const data = request.content?.data;
  return {
    id: typeof request.identifier === 'string' ? request.identifier : undefined,
    data:
      typeof data === 'object' && data !== null && !Array.isArray(data)
        ? (data as Record<string, unknown>)
        : {},
  };
}

/**
 * Normalise one DELIVERED notification — the object the OS handed over without
 * the user touching it. It is the same `request` shape a tap carries, one level
 * shallower, so the tap normaliser does the work.
 */
export function toHostPushDelivery(notification: unknown): HostPushTap | null {
  return toHostPushTap({ notification });
}

/**
 * Hand a delivery to the mini-app. Deliberately does NOT navigate: nobody asked
 * to go anywhere — a notification arrived while the user was doing something
 * else, and yanking them to another tab for it would be a bug, not a feature.
 */
function deliverReceived(tap: HostPushTap): void {
  if (receivedSubscriber) {
    try {
      receivedSubscriber(tap);
      return;
    } catch {
      // Subscriber threw — fall through and latch so a remount can retry.
    }
  }
  latchedDeliveries.push(tap);
  if (latchedDeliveries.length > MAX_LATCHED_DELIVERIES) latchedDeliveries.shift();
}

function deliver(tap: HostPushTap): void {
  // Bring the host to the OpenStoa tab FIRST: on any other tab the mini-app is
  // unmounted, so this is what creates the subscriber that consumes the latch.
  try {
    navigateToOpenStoa?.();
  } catch {
    // Navigator not ready — the tap is latched below and routes as soon as the
    // user opens OpenStoa themselves.
  }
  if (subscriber) {
    try {
      subscriber(tap);
      return;
    } catch {
      // Subscriber threw — fall through and latch so a remount can retry.
    }
  }
  latchedTap = tap;
}

/**
 * Start listening for taps. Idempotent, and safe to call before anything is
 * mounted — that is the point. Never throws: a build without a working
 * expo-notifications simply has no tap routing.
 */
export function startPushTapBridge(api: PushTapNotificationsApi): void {
  if (listenerStarted) return;
  listenerStarted = true;
  try {
    api.addNotificationResponseReceivedListener((response) => {
      const tap = toHostPushTap(response);
      if (tap) deliver(tap);
    });
    // Deliveries the user never touched. This is the whole point of the
    // key-needed notification: the device holding a topic's keys can hand them
    // over the moment it is told they are wanted, without its owner having to
    // notice the banner. Guarded because the member is optional on the API.
    api.addNotificationReceivedListener?.((notification) => {
      const tap = toHostPushDelivery(notification);
      if (tap) deliverReceived(tap);
    });
    // The tap that LAUNCHED the app. Queried once per process; overlapping with
    // the OS listener is harmless because the mini-app de-duplicates on the
    // notification identifier.
    void api
      .getLastNotificationResponseAsync()
      .then((response) => {
        const tap = toHostPushTap(response);
        if (tap) deliver(tap);
      })
      .catch(() => {
        // No launch notification, or push unavailable on this build.
      });
  } catch {
    // expo-notifications unavailable — tap routing is off for this session.
  }
}

/**
 * Publish the host tab navigator's navigation object. Called from the host's
 * TabNavigator, NOT from OpenStoaRootScreen: on the path that matters most — the
 * app launched by a tap, landing on ProofTab — the OpenStoa tab is lazy and the
 * mini-app's own navigation does not exist yet.
 */
export function setOpenStoaTabNavigation(navigation: HostTabNavigation): void {
  navigateToOpenStoa = () => navigation.navigate('OpenStoaTab' as never);
  if (!latchedTap || jumpScheduled) return;
  // Deferred by a tick on purpose: this runs while the navigator builds its
  // descriptors (render), and dispatching a navigation action from inside a
  // render is a state update during render.
  jumpScheduled = true;
  setTimeout(() => {
    jumpScheduled = false;
    if (!latchedTap) return;
    try {
      navigateToOpenStoa?.();
    } catch {
      // Navigator still not ready; the tap stays latched.
    }
  }, 0);
}

/**
 * Attach the mini-app as the tap subscriber and replay whatever was latched
 * while it was unmounted. Single subscriber by design — the mini-app mounts
 * exactly one root, and a second would double-route the same tap.
 */
export function subscribeHostPushTap(
  listener: (tap: HostPushTap) => void,
): () => void {
  subscriber = listener;
  if (latchedTap) {
    const tap = latchedTap;
    latchedTap = null;
    try {
      listener(tap);
    } catch {
      // Never let a mini-app error escape into host code.
    }
  }
  return () => {
    // Only clear if we are still the current subscriber — a remount can attach
    // the new listener before the old one tears down.
    if (subscriber === listener) subscriber = null;
  };
}

/**
 * Attach the mini-app as the DELIVERY subscriber and replay everything latched
 * while it was unmounted, oldest first. Separate from the tap subscriber
 * because the two mean different things: a tap is a request to go somewhere, a
 * delivery is only information.
 */
export function subscribeHostPushReceived(
  listener: (tap: HostPushTap) => void,
): () => void {
  receivedSubscriber = listener;
  const replay = latchedDeliveries.splice(0, latchedDeliveries.length);
  for (const tap of replay) {
    try {
      listener(tap);
    } catch {
      // Never let a mini-app error escape into host code — and never let one
      // bad payload stop the rest of the queue from being replayed.
    }
  }
  return () => {
    if (receivedSubscriber === listener) receivedSubscriber = null;
  };
}

/** Test seam: forget the listener, the latch and the published navigation. */
export function __resetPushTapBridge(): void {
  listenerStarted = false;
  subscriber = null;
  latchedTap = null;
  navigateToOpenStoa = null;
  jumpScheduled = false;
  receivedSubscriber = null;
  latchedDeliveries.length = 0;
}
