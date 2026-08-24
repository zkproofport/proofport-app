/**
 * The chat channel exists BEFORE this device is registered for push.
 *
 * WHY ORDER, AND WHY A SOURCE CONTRACT. On Android a data message is only built
 * into a notification by `expo-notifications` if the channel it names exists;
 * without one the message falls back to Firebase's own presentation. That is not
 * cosmetic — `getPresentedNotificationsAsync()` returns an EMPTY list for a
 * notification Firebase built, so `clearDeliveredForTopic` has nothing to match
 * and opening the room can never empty the tray. The symptom is "notifications
 * arrive but never clear", which is indistinguishable on a device from a broken
 * dismiss, and that ambiguity has already cost this project a night.
 *
 * So the channel must be created before the server can possibly send anything —
 * that is, before the token is registered. Moving one call past the other is a
 * silent regression with a misleading symptom, and nothing else catches it:
 * `registerForPushWithDeps` is injected and unit-tested, but the WRAPPER that
 * sequences the channel around it is not, because it is wired to `expo-device`,
 * `expo-notifications` and `AsyncStorage` and cannot be mounted here.
 *
 * A source assertion is the honest instrument for that. It cannot prove the call
 * succeeds; it proves the ORDER, which is the part that regresses.
 *
 * EDGE-CASE MATRIX → coverage
 *   contract   → the channel call appears before the registration call
 *   contract   → the channel id is the one the server names in `data.channelId`
 *   integrity  → the channel creation is Android-only
 *   boundary   → a failure to create it does not abort registration
 * N/A: hostile/empty/UTF-8/authz — this file reads source, not input.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const HOST_API = join(__dirname, '..', 'zkProofportHostApi.ts');
const CLEARING = join(__dirname, '..', 'pushClearing.ts');

describe('the chat channel is created before push registration', () => {
  const src = readFileSync(HOST_API, 'utf8');

  it('CONTRACT: setNotificationChannelAsync comes before registerForPushWithDeps', () => {
    const channelAt = src.indexOf('setNotificationChannelAsync');
    const registerAt = src.indexOf('registerForPushWithDeps({');

    /*
     * Jest's `expect` takes no message argument (that is Vitest), so the reason
     * rides in the compared VALUE — a failure prints the sentence rather than
     * two bare offsets that mean nothing to whoever broke it.
     */
    expect({ found: channelAt > -1, what: 'setNotificationChannelAsync' }).toEqual({
      found: true,
      what: 'setNotificationChannelAsync',
    });
    expect({ found: registerAt > -1, what: 'registerForPushWithDeps' }).toEqual({
      found: true,
      what: 'registerForPushWithDeps',
    });
    expect({
      order: channelAt < registerAt,
      why: 'the channel must exist before the server can send, or Firebase builds the notification and it cannot be dismissed',
    }).toEqual({
      order: true,
      why: 'the channel must exist before the server can send, or Firebase builds the notification and it cannot be dismissed',
    });
  });

  it('INTEGRITY: the channel is created on Android only', () => {
    // iOS has no channels; calling it there is a no-op at best and an
    // exception at worst, and it must never gate an iOS registration.
    const channelAt = src.indexOf('setNotificationChannelAsync');
    const guardAt = src.lastIndexOf("Platform.OS === 'android'", channelAt);
    expect({ guarded: guardAt > -1 && channelAt - guardAt < 600 }).toEqual({ guarded: true });
  });

  it('BOUNDARY: a failed channel creation does not abort registration', () => {
    /*
     * No channel is the behaviour that shipped for months — degraded, not
     * broken. An old OS or a revoked permission must not cost the user their
     * push registration entirely.
     */
    const channelAt = src.indexOf('setNotificationChannelAsync');
    const registerAt = src.indexOf('registerForPushWithDeps({');
    const between = src.slice(channelAt, registerAt);
    expect({ caught: /catch\s*\{/.test(between) }).toEqual({ caught: true });
  });

  it('CONTRACT: the id is the one the server names, from one definition', () => {
    // The server writes `data.channelId` from its own constant; if the two ever
    // disagree the notification lands on a channel that does not exist, which
    // is the failure this whole file is about.
    expect(readFileSync(CLEARING, 'utf8')).toMatch(
      /export const CHAT_CHANNEL_ID = 'chat'/,
    );
    expect({ usesTheConstant: /setNotificationChannelAsync\(CHAT_CHANNEL_ID/.test(src) }).toEqual({
      usesTheConstant: true,
    });
  });
});
