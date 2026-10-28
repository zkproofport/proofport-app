package com.masselabs.zkproofport

import android.app.Activity
import androidx.core.content.ContextCompat
import androidx.credentials.CredentialManager
import androidx.credentials.CredentialManagerCallback
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.GetCredentialResponse
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReadableType
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.android.libraries.identity.googleid.GoogleIdTokenParsingException
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Google sign-in that returns an ID token carrying a nonce the caller chose.
 *
 * `@react-native-google-signin/google-signin`'s free API built a legacy
 * `GoogleSignInOptions`, which has no nonce. Credential Manager's
 * `GetSignInWithGoogleOption.Builder(serverClientId).setNonce(nonce)` does
 * (androidx.credentials 1.6.0, googleid 1.2.0). The server client id is the
 * WEB client id, as Google's guide requires.
 *
 * JS contract (src/oidc/googleIdToken.ts): `signIn({nonce, serverClientId})`
 * resolves `{idToken}` or rejects with CANCELLED / IN_PROGRESS / INVALID_INPUT
 * / NO_ACTIVITY / NO_CREDENTIAL / NO_ID_TOKEN / SIGN_IN_FAILED. The nonce check
 * on the returned token is done in JS, where it is tested.
 */
class GoogleIdTokenModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private val inFlight = AtomicBoolean(false)

    override fun getName(): String = "GoogleIdToken"

    private companion object {
        const val REAUTH_FAILED_MESSAGE = "[16] Account reauth failed"
    }

    private fun stringOption(options: ReadableMap, key: String): String? =
        if (options.hasKey(key) && options.getType(key) == ReadableType.String) options.getString(key) else null

    @ReactMethod
    fun signIn(options: ReadableMap, promise: Promise) {
        val nonce = stringOption(options, "nonce")
        val serverClientId = stringOption(options, "serverClientId")
        if (nonce.isNullOrEmpty() || serverClientId.isNullOrEmpty()) {
            promise.reject("INVALID_INPUT", "signIn needs a non-empty nonce and serverClientId")
            return
        }
        val activity: Activity? = reactApplicationContext.currentActivity
        if (activity == null) {
            promise.reject("NO_ACTIVITY", "No foreground activity to show Google sign-in on")
            return
        }
        if (!inFlight.compareAndSet(false, true)) {
            promise.reject("IN_PROGRESS", "A Google sign-in is already open")
            return
        }

        val option = GetSignInWithGoogleOption.Builder(serverClientId)
            .setNonce(nonce)
            .build()
        val request = GetCredentialRequest.Builder()
            .addCredentialOption(option)
            .build()

        CredentialManager.create(activity).getCredentialAsync(
            activity,
            request,
            null,
            ContextCompat.getMainExecutor(activity),
            object : CredentialManagerCallback<GetCredentialResponse, GetCredentialException> {
                override fun onResult(result: GetCredentialResponse) {
                    inFlight.set(false)
                    val credential = result.credential
                    val isGoogle = credential is CustomCredential && (
                        credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL ||
                            credential.type == GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_SIWG_CREDENTIAL
                        )
                    if (!isGoogle) {
                        promise.reject("NO_ID_TOKEN", "Unexpected credential type ${credential.type}")
                        return
                    }
                    try {
                        val google = GoogleIdTokenCredential.createFrom(credential.data)
                        val map = Arguments.createMap()
                        map.putString("idToken", google.idToken)
                        promise.resolve(map)
                    } catch (e: GoogleIdTokenParsingException) {
                        promise.reject("NO_ID_TOKEN", "Google ID token response could not be read: ${e.message}", e)
                    }
                }

                override fun onError(e: GetCredentialException) {
                    inFlight.set(false)
                    val code = when {
                        // "[16] Account reauth failed" arrives as a cancellation but
                        // is not one: seen 2026-10-28 when the person ADDED an
                        // account inside the picker (sign-in + 2-step) -- the new
                        // account's sign-in ended the sheet, and the same request
                        // succeeded at once on the next try.
                        e is GetCredentialCancellationException &&
                            e.message?.contains(REAUTH_FAILED_MESSAGE) == true -> "REAUTH_FAILED"
                        e is GetCredentialCancellationException -> "CANCELLED"
                        e is NoCredentialException -> "NO_CREDENTIAL"
                        else -> "SIGN_IN_FAILED"
                    }
                    promise.reject(code, "${e.type}: ${e.message}", e)
                }
            },
        )
    }
}
