/*
 * OpenStoaTakModule.kt
 * The JS → native write path for the TAK mirror (design §13.6 strategy A).
 *
 * The mini-app already derives the Topic Archive Key it needs; on iOS it mirrors
 * that key into the shared Keychain access group so the Notification Service
 * Extension can read it. Android has no access-group problem — the FCM service runs
 * in the same package — but it does need somewhere to put the key that our own code
 * owns, which is `OpenStoaTakStore`. This module is the only door into it.
 *
 * Deliberately write-only from JS: nothing here can READ a key back out, so a bug
 * (or a compromised JS bundle) cannot exfiltrate raw MLS-derived key material
 * through the bridge. The reader is the FCM service, in Kotlin.
 */

package com.zkproofport.app.openstoa

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class OpenStoaTakModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String = NAME

    /**
     * Mirror one topic's TAK so the push handler can decrypt that topic's previews.
     *
     * Resolves `true` only when the entry was actually written, `false` for every
     * rejected or failed write (bad key material, unusable store). It never
     * rejects: the mirror is a best-effort optimisation and a failure must not
     * surface as an error in the chat send path — the recipient simply keeps
     * getting the content-free "New message".
     *
     * `takVersion` crosses the bridge as a Double because that is the only number
     * type the RN bridge carries; it is validated back to a non-negative integer
     * here rather than truncated silently.
     */
    @ReactMethod
    fun mirrorTopicArchiveKey(
        topicId: String?,
        takVersion: Double,
        takB64: String?,
        promise: Promise,
    ) {
        try {
            val topic = topicId
            val key = takB64
            if (topic.isNullOrEmpty() || key.isNullOrEmpty()) {
                promise.resolve(false)
                return
            }
            if (!takVersion.isFinite() || takVersion < 0 || takVersion != Math.floor(takVersion)) {
                promise.resolve(false)
                return
            }
            if (takVersion > MAX_SAFE_INTEGER) {
                promise.resolve(false)
                return
            }
            promise.resolve(
                OpenStoaTakStore.write(reactApplicationContext, topic, takVersion.toLong(), key),
            )
        } catch (_: Throwable) {
            promise.resolve(false)
        }
    }

    companion object {
        const val NAME = "OpenStoaTak"

        /** `Number.MAX_SAFE_INTEGER` — beyond it a JS number is not an exact integer. */
        private const val MAX_SAFE_INTEGER = 9007199254740991.0
    }
}
