/*
 * OpenStoaMessagingService — Android FCM data-message handler
 * (E2EE chat Phase 7 / Phase B, design §13.5).
 *
 * Registered in AndroidManifest.xml for `com.google.firebase.MESSAGING_EVENT`.
 *
 * Why it subclasses ExpoFirebaseMessagingService instead of FirebaseMessagingService:
 *   FCM starts exactly ONE service per MESSAGING_EVENT intent — the highest-priority
 *   manifest match wins, it is not a broadcast to every registered service.
 *   expo-notifications registers its own ExpoFirebaseMessagingService with
 *   `android:priority="-1"`, deliberately yielding to an app-level service so that an
 *   app can install its own handler. That means a sibling service declared here at the
 *   default priority 0 would SHADOW expo-notifications and silently kill every Expo
 *   push notification on Android. Subclassing and delegating to `super` keeps the Expo
 *   path intact while adding the OpenStoa data-message path on top of it.
 *
 * §13.6 resolution — read-only decrypt, never advance the MLS epoch:
 *   Same rule as the iOS NSE. This handler decrypts ONLY `act`, the TAK-archived
 *   copy of the body, and never `ct`. `ct` is the live MLS application ciphertext;
 *   opening it would consume a forward-secret message key from the ratchet's secret
 *   tree, after which the main app could no longer derive the same key and the group
 *   would DESYNC. The Topic Archive Key is a stable, non-ratcheting symmetric key, so
 *   opening the archived copy consumes nothing. On ANY failure the Phase A
 *   content-free placeholder ("New message") is shown instead of a broken preview.
 *
 * §13.6 resolution — single OS token ↔ multiple nullifiers:
 *   `data.topicId` + `data.tv` select the correct per-(topic, TAK version) key from
 *   `OpenStoaTakStore`, which the mini-app mirrors there over the host bridge.
 *
 * WHY THE NOTIFICATION IS NOT BUILT BY HAND (the tap-routing decision):
 *   Building our own NotificationCompat would also mean building our own content
 *   intent, and expo-notifications' `addNotificationResponseReceivedListener` only
 *   fires for notifications whose intent its own `ExpoHandlingDelegate` created.
 *   A hand-rolled notification would therefore be delivered but DEAD ON TAP, or
 *   force a second, competing routing mechanism next to `pushTapBridge.ts`.
 *   Instead this service rewrites one field of the message — the FCM data key
 *   `message`, which is what `expo-notifications` renders as the notification body
 *   (`NotificationData.message` → `RemoteNotificationContent.text`) — and hands the
 *   rewritten message to `super`. expo-notifications then builds the notification,
 *   owns the content intent, creates/uses the channel, and fires its response
 *   listener on tap exactly as it does for every other push. iOS (which rewrites
 *   `bestAttemptContent.body` and lets iOS keep the notification) and Android now
 *   do the same thing: substitute the body, leave delivery and tap to the platform
 *   notification stack. One code path, no duplicate channel management, no second
 *   router.
 */

package com.masselabs.zkproofport.openstoa

import android.os.Bundle
import com.google.firebase.messaging.RemoteMessage
import expo.modules.notifications.service.ExpoFirebaseMessagingService

class OpenStoaMessagingService : ExpoFirebaseMessagingService() {

    override fun onMessageReceived(message: RemoteMessage) {
        // Every message reaches expo-notifications: an OpenStoa chat push with its
        // body substituted, anything else byte-for-byte unchanged.
        val decision = OpenStoaPushHandler.decide(message.data) { topicId, takVersion ->
            OpenStoaTakStore.read(applicationContext, topicId, takVersion)
        }
        val delivered = when (decision) {
            is OpenStoaPushDecision.Preview -> withPreview(message, decision.text) ?: message
            OpenStoaPushDecision.Delegate -> message
        }
        super.onMessageReceived(delivered)
    }

    override fun onNewToken(token: String) {
        // expo-notifications owns device-token registration: its delegate forwards the
        // refreshed FCM token to the JS layer, which re-registers it via
        // POST /api/push/register (routing_handle -> token). Do not duplicate that here.
        super.onNewToken(token)
    }

    /**
     * A copy of [message] whose body text is the decrypted preview.
     *
     * `toIntent()` is `new Intent().putExtras(bundle)` — the documented way to get
     * the message's own extras back out — and `RemoteMessage(Bundle)` is the public
     * constructor that parses them again, so message id, sent time, sender, TTL and
     * priority all survive. FCM data entries live as top-level String extras in that
     * bundle (`MessagePayloadKeys.extractDeveloperDefinedPayload` keeps every String
     * key that is not `google.*`/`gcm.*`/`from`/`message_type`/`collapse_key`), which
     * is why writing the data map back over the extras rewrites exactly the data.
     *
     * Returns null if the extras cannot be read, in which case the caller falls back
     * to delivering the original message and its placeholder body.
     */
    private fun withPreview(message: RemoteMessage, preview: String): RemoteMessage? = try {
        val extras: Bundle? = message.toIntent().extras
        if (extras == null) {
            null
        } else {
            for ((key, value) in OpenStoaPushHandler.rewriteData(message.data, preview)) {
                extras.putString(key, value)
            }
            RemoteMessage(extras)
        }
    } catch (_: Exception) {
        null
    }
}
