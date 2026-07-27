/*
 * OpenStoaMessagingService — Android FCM data-message handler scaffold
 * (E2EE chat Phase 7 / Phase B, design §13.5).
 *
 * ⚠️ Phase 7 device: this file lives in `android/openstoa-push-scaffold/`, NOT in
 * the compiled source set (`android/app/src/main/java/...`), ON PURPOSE — it
 * imports `com.google.firebase.messaging.*`, which is not yet a dependency, so
 * dropping it into the source set would break the gradle build. No build was run
 * for the scaffold. Do NOT run `./gradlew` as part of scaffolding.
 *
 * Remaining native steps (do once, on a device build, then verify on device):
 *   1. Add Firebase Cloud Messaging: `com.google.firebase:firebase-messaging` +
 *      the `com.google.gms.google-services` gradle plugin + `google-services.json`.
 *      (If shipping via Expo push, Expo already fronts FCM — a custom data handler
 *      is only needed for the Phase B on-device decrypt path.)
 *   2. Move this file to
 *      `android/app/src/main/java/com/zkproofport/app/openstoa/OpenStoaMessagingService.kt`.
 *   3. Register it in `AndroidManifest.xml` inside <application>:
 *        <service android:name=".openstoa.OpenStoaMessagingService"
 *                 android:exported="false">
 *          <intent-filter>
 *            <action android:name="com.google.firebase.MESSAGING_EVENT" />
 *          </intent-filter>
 *        </service>
 *   4. Bind the real read-only decrypt (see §13.6 below) + a NotificationChannel
 *      and local `NotificationCompat` builder for the preview.
 *
 * §13.6 resolution — read-only decrypt, never advance the MLS epoch:
 *   Same rule as the iOS NSE. Decrypt READ-ONLY (preferred: the non-ratcheting
 *   TAK-archived copy; fallback: an in-memory MLS snapshot that is DISCARDED, not
 *   persisted) so the background handler never desyncs the main app's ratchet. On
 *   ANY failure or budget/time limit, show the Phase A content-free notification
 *   ("New message") instead of a broken preview.
 *
 * §13.6 resolution — single OS token ↔ multiple nullifiers:
 *   The `data.topicId` selects the correct per-(nullifier, topic) key from the
 *   host's shared secure storage; keys are stored under
 *   `mls.state.<identity>.<topicId>` (openstoa mlsSession.ts).
 */

package com.zkproofport.app.openstoa

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage

class OpenStoaMessagingService : FirebaseMessagingService() {

    override fun onMessageReceived(message: RemoteMessage) {
        // Phase B payload: a data-only message carrying the opaque, already-sealed
        // ciphertext. Any missing field => fall back to the content-free dummy.
        val data = message.data
        val topicId = data["topicId"]
        val ct = data["ct"]

        if (topicId.isNullOrEmpty() || ct.isNullOrEmpty()) {
            showDummyNotification(topicId)
            return
        }

        // Phase 7 device TODO: wire the real read-only decrypt.
        //   val key = SharedSecureStore.readTopicKey(topicId)      // read-only
        //   val preview = OpenStoaDecryptor.previewReadOnly(ct, key)  // no ratchet
        //   if (preview != null) { showPreviewNotification(topicId, preview); return }
        //
        // Until the decryptor is bound at device-build time, degrade to Phase A.
        showDummyNotification(topicId)
    }

    override fun onNewToken(token: String) {
        // Phase 6 wiring: forward the refreshed FCM token to the RN layer so the
        // mini-app re-registers it via POST /api/push/register (routing_handle → token).
    }

    /** Phase A fallback: a content-free "New message" that deep-links topicId on tap. */
    private fun showDummyNotification(topicId: String?) {
        // Phase 7 device TODO: build a NotificationChannel + NotificationCompat
        // notification with title "OpenStoa" / body "New message" and a tap intent
        // carrying topicId (no message content — SI-1).
    }
}
