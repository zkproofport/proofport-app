/*
 * OpenStoaTakStore.kt
 * Topic Archive Key mirror for the Android push handler (design §13.6 strategy A).
 *
 * WHY A STORE OF OUR OWN
 *   The mini-app's normal secure storage on Android is `expo-secure-store`, which
 *   writes Keystore-encrypted JSON envelopes into its own SharedPreferences file
 *   using its own `AESEncryptor` / `HybridAESEncryptor` format. Reading that from
 *   here would mean reimplementing a private format that is free to change on any
 *   package upgrade. So this is a separate, tiny store that only OUR code writes
 *   (via `OpenStoaTakModule` from JS) and only OUR code reads (the FCM service).
 *   The canonical MLS/TAK state keeps living where it already lives, untouched.
 *
 *   Unlike iOS there is no cross-process problem to solve: `OpenStoaMessagingService`
 *   runs in the same app package as the JS layer, so a plain app-private file is
 *   enough. It is encrypted anyway because the value is raw key material.
 *
 * STORAGE CONTRACT — identical to the iOS Keychain contract so the two platforms
 * stay comparable (`ios/OpenStoaNSE/TakKeychain.swift`):
 *   entry key  openstoa.tak.<topicId>.<takVersion>
 *              takVersion 0 = the topic's public archive root key, otherwise the
 *              MLS epoch whose per-epoch TAK this is.
 *   value      base64 of exactly 32 raw TAK bytes
 *
 * A push can arrive while the device is locked. Direct-boot aware storage is NOT
 * used: the app is not `directBootAware`, so the FCM service is not started before
 * first unlock anyway, and credential-encrypted storage is readable from then on.
 */

package com.masselabs.zkproofport.openstoa

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.util.Base64

object OpenStoaTakStore {
    private const val TAG = "OpenStoaTakStore"

    /** App-private, Keystore-encrypted preferences file. Written/read only here. */
    const val PREFS_NAME = "openstoa_tak_store"

    /** Entry key for one topic's TAK at one version. Mirrors `sharedTakKey` in TS. */
    fun entryKey(topicId: String, takVersion: Long): String =
        "openstoa.tak.$topicId.$takVersion"

    /**
     * base64 of exactly [OpenStoaArchive.TAK_LENGTH] raw bytes — rejects anything
     * else. The JS side validates the same thing before calling; this is the
     * server-side-of-the-bridge copy of that guard, so a caller that skips it
     * cannot poison the store with a key the decryptor will only reject later.
     */
    fun isValidTakB64(value: String): Boolean = decodeTak(value) != null

    /** Decode a base64 TAK to exactly 32 raw bytes, or null. */
    fun decodeTak(value: String): ByteArray? {
        val trimmed = value.trim()
        if (trimmed.isEmpty()) return null
        val raw = try {
            Base64.getDecoder().decode(trimmed)
        } catch (_: IllegalArgumentException) {
            return null
        }
        return if (raw.size == OpenStoaArchive.TAK_LENGTH) raw else null
    }

    /**
     * Persist one TAK. Returns true only when the entry was actually written.
     * Never throws — a failed mirror just means the push handler falls back to the
     * content-free "New message" placeholder.
     */
    fun write(context: Context, topicId: String, takVersion: Long, takB64: String): Boolean {
        if (topicId.isEmpty()) return false
        if (takVersion < 0) return false
        if (!isValidTakB64(takB64)) return false
        val prefs = prefs(context) ?: return false
        return try {
            prefs.edit().putString(entryKey(topicId, takVersion), takB64.trim()).commit()
        } catch (e: Exception) {
            Log.w(TAG, "TAK mirror write failed", e)
            false
        }
    }

    /**
     * Read the 32 raw TAK bytes for (topicId, takVersion). Returns null when the
     * entry is missing, the store is unreadable, or the stored value is not base64
     * of exactly 32 bytes.
     */
    fun read(context: Context, topicId: String, takVersion: Long): ByteArray? {
        if (topicId.isEmpty()) return null
        if (takVersion < 0) return null
        val prefs = prefs(context) ?: return null
        return try {
            prefs.getString(entryKey(topicId, takVersion), null)?.let { decodeTak(it) }
        } catch (e: Exception) {
            Log.w(TAG, "TAK mirror read failed", e)
            null
        }
    }

    /**
     * Open the encrypted preferences, or null if the platform refuses.
     *
     * Opening can genuinely fail — a Keystore entry invalidated by a device
     * restore, or a preferences file left half-written by a kill during commit —
     * and there is nothing useful to do about it in a notification handler, so the
     * caller degrades to the placeholder. Not cached: the service process is
     * short-lived, and holding a Keystore-backed handle across it buys nothing.
     */
    private fun prefs(context: Context): SharedPreferences? = try {
        val masterKey = MasterKey.Builder(context.applicationContext)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context.applicationContext,
            PREFS_NAME,
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    } catch (e: Exception) {
        Log.w(TAG, "encrypted TAK store unavailable", e)
        null
    }
}
