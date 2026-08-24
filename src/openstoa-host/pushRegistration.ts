/**
 * OpenStoa push REGISTRATION (design §13, D12-D14) — the decision half of
 * `zkProofportHostApi.registerForPush`, split out for the same reason
 * `pushTapBridge` was: it imports NOTHING from expo or react-native, so the
 * host's plain-node jest config can exercise every exit it has.
 *
 * Why it exists at all: the original inline implementation returned `null` from
 * five different places and swallowed every throw, with not one log line on any
 * of those paths. A device that never registered was therefore
 * INDISTINGUISHABLE from a device that registered fine and simply had no
 * messages waiting — from the phone, from the server, and from the logs. When
 * push "stopped working" there was no artefact anywhere that could say which.
 *
 * The control flow below is byte-for-byte the control flow it replaces: same
 * order, same short-circuits, same `null` on every failure, so push registration
 * still can never break chat. The ONLY change is that each exit now names
 * itself exactly once through `reportPushRegistration`.
 *
 * Reading the logs: every line starts with `[openstoa-push]` and carries
 * `outcome=<PushRegistrationOutcome>`. `outcome=registered` at least once means
 * the device has a token; the absence of ANY `[openstoa-push]` line means
 * `registerForPush` was never called (mini-app not opened, OPENSTOA_ENABLED off,
 * or the once-per-session claim in the mini-app's `usePushRegistration` already
 * settled), which is a different bug from every `outcome=skipped-*` below.
 */

/** Every way `registerForPush` can end, one per exit. */
export type PushRegistrationOutcome =
  /** A token was obtained and is being returned to the mini-app. */
  | 'registered'
  /** Simulator / emulator — no APNs or FCM token exists at all. */
  | 'skipped-no-device'
  /** The user declined (or the OS revoked) the notification permission. */
  | 'skipped-permission-denied'
  /** No EAS projectId in app config — an Expo push token cannot be minted. */
  | 'skipped-no-project-id'
  /** Expo returned a response with no token string in it. */
  | 'skipped-empty-token'
  /** Something threw: native module missing, network, Expo credential rejection. */
  | 'failed';

export interface PushRegistration {
  routingHandle: string;
  pushToken: string;
  platform: 'ios' | 'android';
}

/** The slice of an expo-notifications permission response this module reads. */
export interface PushPermissionsLike {
  granted?: boolean;
  status?: string;
  ios?: { status?: number };
}

/**
 * Everything `registerForPush` touches, injected. Keeping expo behind this
 * interface is what makes the failure paths testable — they are precisely the
 * paths that are impossible to reach on a simulator.
 */
export interface PushRegistrationDeps {
  /** `Device.isDevice`. */
  isDevice: boolean;
  /** `Notifications.getPermissionsAsync`. */
  getPermissions(): Promise<PushPermissionsLike>;
  /** `Notifications.requestPermissionsAsync`. */
  requestPermissions(): Promise<PushPermissionsLike>;
  /**
   * `Notifications.IosAuthorizationStatus.PROVISIONAL`. Injected rather than
   * hardcoded because it is an enum member of the native module; `undefined`
   * (an expo-notifications without it) simply means no provisional match.
   */
  provisionalIosStatus?: number;
  /** `expo.extra.eas.projectId`, or undefined when the build has none. */
  projectId?: string;
  /** `Notifications.getExpoPushTokenAsync`. */
  getExpoPushToken(projectId: string): Promise<{ data?: string }>;
  /**
   * `Notifications.getDevicePushTokenAsync` — the RAW OS token.
   *
   * Android only, and it is what lets the server talk to FCM directly instead
   * of through Expo's push service. That indirection is what broke per-room
   * dismissal and the lock-screen preview: measured on a device, an Expo push
   * to Android arrives as an FCM *notification* message, so Firebase displays
   * it itself and `expo-notifications` never sees it — its `onMessageReceived`
   * does not log a single line even in a debug build. A notification Firebase
   * built carries none of the extras expo stamps, so the app can neither tell
   * which room it belongs to nor rewrite its body.
   *
   * iOS stays on the Expo token: it works there, Expo holds the APNs key, and
   * moving it would mean signing our own APNs JWTs for no present gain.
   */
  getDevicePushToken?(): Promise<{ type?: string; data?: unknown }>;
  /** Persisted routing handle, or null on first run. */
  readHandle(): Promise<string | null>;
  /** Persist a freshly minted routing handle. */
  writeHandle(handle: string): Promise<void>;
  /** `Crypto.randomUUID`. */
  newUuid(): string;
  /** `Platform.OS === 'android' ? 'android' : 'ios'`. */
  platform: 'ios' | 'android';
}

/** Greppable prefix shared by every line this module writes. */
export const PUSH_LOG_PREFIX = '[openstoa-push]';

/**
 * Emit exactly one diagnostic per `registerForPush` call.
 *
 * Deliberately unconditional — not gated on `__DEV__`. The whole point is that
 * a release build on a real device (the only place most of these outcomes are
 * reachable) leaves a trace in the device console / Console.app, which is the
 * only artefact anyone had to work with when push went dark.
 *
 * `registered` goes to `console.log` and everything else to `console.warn`, so
 * a log filter set to warnings shows only the outcomes worth chasing. Never
 * throws: a broken console must not be able to fail a registration.
 */
export function reportPushRegistration(
  outcome: PushRegistrationOutcome,
  detail?: Record<string, unknown>,
): void {
  try {
    const line = `${PUSH_LOG_PREFIX} registerForPush outcome=${outcome}`;
    const payload = detail ?? {};
    if (outcome === 'registered') console.log(line, payload);
    else console.warn(line, payload);
  } catch {
    // A logging failure is never allowed to change the caller's result.
  }
}

/** iOS "provisional" delivers quietly but DOES deliver, so it counts as granted. */
function isGranted(perms: PushPermissionsLike, provisionalIosStatus?: number): boolean {
  if (perms.granted === true) return true;
  return (
    provisionalIosStatus !== undefined && perms.ios?.status === provisionalIosStatus
  );
}

/**
 * Register this device for OpenStoa chat notifications, or explain in the log
 * why it could not. Returns `null` — never throws — on every failure, so push
 * registration cannot disrupt chat (the contract the mini-app relies on).
 */
export async function registerForPushWithDeps(
  deps: PushRegistrationDeps,
): Promise<PushRegistration | null> {
  try {
    /*
     * ANDROID DOES NOT SKIP ON `isDevice`, and that is a correction.
     *
     * This used to return here for anything `expo-device` calls a non-device,
     * on the stated grounds that "a real APNs/FCM token only exists on a
     * physical device". For APNs that holds — an iOS simulator has no APNs
     * registration to give. For FCM it does not: an Android emulator with
     * Google Play services mints a perfectly ordinary registration token, and
     * this was verified rather than assumed. On a Play-enabled Android 16
     * emulator the flow below produced `outcome=registered` with a 142-byte raw
     * FCM token — the same length the physical device registers — and a push
     * sent to it arrived and was dismissed by room.
     *
     * The cost of the old guard was not theoretical. Per-room dismissal could
     * only ever be exercised on physical hardware, so when the phone was
     * unreachable the work stopped; an emulator would have settled it in
     * minutes. Nothing downstream needed the guard either: the token paths
     * below already end in `skipped-empty-token` when nothing comes back, which
     * is the honest answer for a simulator and does not require guessing in
     * advance which devices can mint one.
     */
    if (!deps.isDevice && deps.platform !== 'android') {
      reportPushRegistration('skipped-no-device', { platform: deps.platform });
      return null;
    }

    let perms = await deps.getPermissions();
    const alreadyGranted = isGranted(perms, deps.provisionalIosStatus);
    if (!alreadyGranted) {
      perms = await deps.requestPermissions();
    }
    if (!isGranted(perms, deps.provisionalIosStatus)) {
      reportPushRegistration('skipped-permission-denied', {
        platform: deps.platform,
        status: perms.status,
        iosStatus: perms.ios?.status,
        // Distinguishes "the user just said no to the prompt" from "the
        // permission was already gone before we asked", which need different
        // fixes (in-app rationale vs. deep link to Settings).
        prompted: !alreadyGranted,
      });
      return null;
    }

    // Minting an Expo push token requires the EAS project id. It comes from app
    // config (`expo.extra.eas.projectId`) or the EAS build config. When absent
    // (not yet configured for this build) we cannot get a token.
    if (!deps.projectId) {
      reportPushRegistration('skipped-no-project-id', { platform: deps.platform });
      return null;
    }

    /*
     * Android takes the raw FCM registration token; iOS keeps the Expo one.
     *
     * The server routes on `push_tokens.platform`, so the two shapes never meet
     * — see `pushProvider.ts`. A device that cannot produce a raw token falls
     * back to the Expo one rather than registering nothing: a push that arrives
     * and cannot be dismissed is still better than no push.
     */
    let pushToken: string | undefined;
    if (deps.platform === 'android' && typeof deps.getDevicePushToken === 'function') {
      const device = await deps.getDevicePushToken().catch(() => null);
      const raw = device?.data;
      if (typeof raw === 'string' && raw.length > 0) pushToken = raw;
    }
    if (!pushToken) {
      const tokenResponse = await deps.getExpoPushToken(deps.projectId);
      pushToken = tokenResponse?.data;
    }
    if (!pushToken) {
      reportPushRegistration('skipped-empty-token', {
        platform: deps.platform,
        projectId: deps.projectId,
      });
      return null;
    }

    // Stable opaque routing handle — generated once, persisted, never rotated in
    // Phase A. Only chars in [A-Za-z0-9-] (uuid), well under the server cap.
    let routingHandle = await deps.readHandle();
    const minted = !routingHandle;
    if (!routingHandle) {
      routingHandle = deps.newUuid();
      await deps.writeHandle(routingHandle);
    }

    reportPushRegistration('registered', {
      platform: deps.platform,
      routingHandle,
      // `minted` separates a first-ever registration from a re-registration, so
      // a handle churning every launch (a broken AsyncStorage) is visible.
      minted,
      // The token itself is not secret, but it identifies the device, so log
      // only its shape — enough to tell an ExponentPushToken from a raw APNs
      // token, or from garbage.
      tokenPrefix: pushToken.slice(0, 18),
      tokenLength: pushToken.length,
    });
    return { routingHandle, pushToken, platform: deps.platform };
  } catch (err) {
    // Best-effort: any failure (permission race, network, native module missing,
    // Expo rejecting the project's APNs credentials with
    // ERR_NOTIFICATIONS_SERVER_ERROR) degrades to "no push" without breaking
    // chat. It is no longer SILENT: an Expo credential problem is invisible from
    // the server side too, so this line is the only place it can ever surface.
    reportPushRegistration('failed', {
      platform: deps.platform,
      error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
    });
    return null;
  }
}
