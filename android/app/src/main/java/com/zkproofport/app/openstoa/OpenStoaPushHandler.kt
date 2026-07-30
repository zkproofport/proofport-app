/*
 * OpenStoaPushHandler.kt
 * The decision layer of the OpenStoa Android push path (design §13.5 / §13.6).
 *
 * Everything the FCM service does that is worth testing lives here, in pure
 * Kotlin with no Android framework import, so it runs in a plain JVM unit test:
 * OpenStoaMessagingService is left as a thin adapter around `decide` +
 * `rewriteData`.
 */

package com.zkproofport.app.openstoa

/** What the FCM service should do with one incoming message. */
sealed interface OpenStoaPushDecision {
    /**
     * Not an OpenStoa preview-bearing message, or nothing trustworthy to show.
     * The message is handed to expo-notifications UNCHANGED, which posts the
     * content-free "New message" placeholder the server already put in it.
     */
    data object Delegate : OpenStoaPushDecision

    /** Decrypted preview text that should replace the placeholder body. */
    data class Preview(val text: String) : OpenStoaPushDecision
}

/** Reads the 32 raw TAK bytes for one (topicId, takVersion), or null. */
fun interface TakReader {
    fun read(topicId: String, takVersion: Long): ByteArray?
}

object OpenStoaPushHandler {
    /**
     * The FCM data key `expo-notifications` renders as the notification body
     * (`NotificationData.message`, read by `RemoteNotificationContent.text`).
     * Rewriting THIS key — rather than building our own notification — is what
     * keeps tap routing on the single existing code path: expo-notifications
     * still builds the notification, still owns the content intent, and still
     * fires `addNotificationResponseReceivedListener` on tap.
     */
    const val EXPO_BODY_TEXT_KEY = "message"

    /**
     * Decide what to do with one FCM data payload.
     *
     * [Delegate][OpenStoaPushDecision.Delegate] is returned for every payload that
     * is not a complete OpenStoa preview envelope — including a `ct`-only one.
     * `ct` is the live MLS ciphertext and is NEVER touched here: opening it would
     * consume a forward-secret ratchet key and desync the main app (§13.6). Only
     * `act`, the TAK-archived copy sealed under a stable non-ratcheting key, is
     * decrypted.
     *
     * Never throws: it runs from an OS callback, and a thrown exception would take
     * the notification down with it.
     */
    fun decide(data: Map<String, String>, taks: TakReader): OpenStoaPushDecision {
        return try {
            val push = OpenStoaPushPayload.parse(data) ?: return OpenStoaPushDecision.Delegate
            val tak = taks.read(push.topicId, push.takVersion) ?: return OpenStoaPushDecision.Delegate
            val plaintext = OpenStoaArchive.openPushPreview(
                tak,
                push.messageId,
                push.archivedCiphertext,
            )
            // An empty plaintext is treated as a failure: a blank notification body
            // is less useful than the "New message" placeholder it would replace.
            if (plaintext.isNullOrEmpty()) {
                OpenStoaPushDecision.Delegate
            } else {
                OpenStoaPushDecision.Preview(Preview.truncateForDisplay(plaintext))
            }
        } catch (_: Throwable) {
            OpenStoaPushDecision.Delegate
        }
    }

    /**
     * The data map expo-notifications should see instead of the original: every
     * key preserved, only the body text replaced. In particular `topicId` and
     * `messageId` survive, because the tap handler reads them back out of the
     * notification's data to route to the chat room.
     */
    fun rewriteData(data: Map<String, String>, preview: String): Map<String, String> {
        val out = LinkedHashMap(data)
        out[EXPO_BODY_TEXT_KEY] = preview
        return out
    }
}
