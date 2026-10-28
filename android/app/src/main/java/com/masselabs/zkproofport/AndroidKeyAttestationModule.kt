package com.masselabs.zkproofport

import android.util.Base64
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.util.concurrent.Executors

/**
 * Android key attestation as a statement signer (Coinbase KYC v2 and the OIDC
 * provider-key statement on Android; circuits `*-android` packages).
 *
 * JS contract (src/androidAttest/nativeAndroidKeyAttestation.ts):
 * `attestAndSign(statementBase64)` resolves
 * `{chain: [base64 DER, leaf first], signature: base64 DER, strongBox, sdkInt}`
 * or rejects with ANDROIDATTEST_UNSUPPORTED / INVALID_INPUT / KEYGEN_FAILED /
 * EMPTY_CHAIN / SIGN_FAILED.
 *
 * `requestIntegrityToken(nonceBase64Url)` (factory-provisioned phones only)
 * resolves the classic Play Integrity token for that nonce -- the encrypted
 * JWE, which the relay decrypts -- or rejects with
 * ANDROIDATTEST_INTEGRITY_TRANSIENT (network, rate limit, Google's server:
 * worth retrying), ANDROIDATTEST_INVALID_INPUT (a nonce Play refuses) or
 * ANDROIDATTEST_INTEGRITY_UNAVAILABLE (no Play Store / services, outdated,
 * not installed from Play, ...). The app is distributed on Play, so no Cloud
 * project number is set (developer.android.com/google/play/integrity/classic).
 *
 * One FRESH key per statement, deleted afterwards: an EC P-256 key in
 * AndroidKeyStore (PURPOSE_SIGN, SHA-256), StrongBox first when the phone has
 * it and the TEE otherwise (as zkPassport's app-attest module does), with the
 * attestation challenge SHA-256(statement). The Remote Key Provisioning
 * attestation-key certificate in its chain lives about two weeks and the
 * circuit requires it valid at the statement's time, so a stored key would
 * stop working. The circuit binds the statement through the key's own
 * SHA256withECDSA signature over it; the challenge is not read there.
 *
 * Logged: alias, StrongBox or TEE, SDK level, the chain's certificate sizes
 * and subjects (Google CA names and a per-key random CN), never the
 * statement, the signature or the certificates' bytes.
 */
class AndroidKeyAttestationModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    private val executor = Executors.newSingleThreadExecutor()

    override fun getName(): String = "AndroidKeyAttestation"

    @ReactMethod
    fun attestAndSign(statementBase64: String?, promise: Promise) {
        val statement: ByteArray = try {
            if (statementBase64.isNullOrEmpty()) throw IllegalArgumentException("empty")
            Base64.decode(statementBase64, Base64.NO_WRAP)
        } catch (e: IllegalArgumentException) {
            promise.reject(CODE_INVALID_INPUT, "attestAndSign needs the statement as non-empty base64: ${e.message}")
            return
        }
        executor.execute {
            try {
                val r = AndroidKeyAttestationCore.attestAndSign(reactApplicationContext, statement)
                val certs = Arguments.createArray()
                r.chain.forEach { certs.pushString(Base64.encodeToString(it, Base64.NO_WRAP)) }
                val result = Arguments.createMap()
                result.putArray("chain", certs)
                result.putString("signature", Base64.encodeToString(r.signature, Base64.NO_WRAP))
                result.putBoolean("strongBox", r.strongBox)
                result.putInt("sdkInt", android.os.Build.VERSION.SDK_INT)
                promise.resolve(result)
            } catch (e: AttestationException) {
                promise.reject(e.code, e.message, e)
            }
        }
    }

    @ReactMethod
    fun requestIntegrityToken(nonceBase64Url: String?, promise: Promise) {
        if (nonceBase64Url.isNullOrEmpty()) {
            promise.reject(CODE_INVALID_INPUT, "requestIntegrityToken needs an unpadded base64url nonce of 16-500 characters")
            return
        }
        AndroidKeyAttestationCore.requestIntegrityToken(
            reactApplicationContext,
            nonceBase64Url,
            { token -> promise.resolve(token) },
            { e -> promise.reject(e.code, e.message, e) },
        )
    }

    override fun invalidate() {
        executor.shutdown()
        super.invalidate()
    }

    companion object {
        const val CODE_UNSUPPORTED = AndroidKeyAttestationCore.CODE_UNSUPPORTED
        const val CODE_INVALID_INPUT = AndroidKeyAttestationCore.CODE_INVALID_INPUT
        const val CODE_KEYGEN_FAILED = AndroidKeyAttestationCore.CODE_KEYGEN_FAILED
        const val CODE_EMPTY_CHAIN = AndroidKeyAttestationCore.CODE_EMPTY_CHAIN
        const val CODE_SIGN_FAILED = AndroidKeyAttestationCore.CODE_SIGN_FAILED
        const val CODE_INTEGRITY_TRANSIENT = AndroidKeyAttestationCore.CODE_INTEGRITY_TRANSIENT
        const val CODE_INTEGRITY_UNAVAILABLE = AndroidKeyAttestationCore.CODE_INTEGRITY_UNAVAILABLE
    }
}
