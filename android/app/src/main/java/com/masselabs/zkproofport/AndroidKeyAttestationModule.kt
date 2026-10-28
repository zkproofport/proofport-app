package com.masselabs.zkproofport

import android.content.pm.PackageManager
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import android.util.Base64
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.google.android.play.core.integrity.IntegrityManagerFactory
import com.google.android.play.core.integrity.IntegrityServiceException
import com.google.android.play.core.integrity.IntegrityTokenRequest
import com.google.android.play.core.integrity.model.IntegrityErrorCode
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.MessageDigest
import java.security.PrivateKey
import java.security.Signature
import java.security.cert.X509Certificate
import java.security.spec.ECGenParameterSpec
import java.util.UUID
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

    private fun isStrongBoxAvailable(): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.P &&
            reactApplicationContext.packageManager.hasSystemFeature(PackageManager.FEATURE_STRONGBOX_KEYSTORE)

    /**
     * Whether this phone can attest a hardware key at all. Key attestation
     * exists from API 24 (below the app's minSdk, but stated); from API 31
     * the platform also says whether a hardware keystore is present. On 28-30
     * the chain itself tells (a software chain is refused in JS).
     */
    private fun unsupportedReason(): String? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) {
            return "Key attestation needs Android 7.0 (API 24); this is API ${Build.VERSION.SDK_INT}"
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
            !reactApplicationContext.packageManager.hasSystemFeature(PackageManager.FEATURE_HARDWARE_KEYSTORE)
        ) {
            return "This phone reports no hardware keystore (FEATURE_HARDWARE_KEYSTORE)"
        }
        return null
    }

    private fun generateKey(alias: String, challenge: ByteArray, strongBox: Boolean) {
        val spec = KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_SIGN)
            .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
            .setDigests(KeyProperties.DIGEST_SHA256)
            .setAttestationChallenge(challenge)
            .setUserAuthenticationRequired(false)
            .apply { if (strongBox) setIsStrongBoxBacked(true) }
            .build()
        val generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, KEYSTORE)
        generator.initialize(spec)
        generator.generateKeyPair()
    }

    private fun deleteKey(keyStore: KeyStore, alias: String) {
        try {
            if (keyStore.containsAlias(alias)) keyStore.deleteEntry(alias)
        } catch (e: Exception) {
            // The key is unusable without the statement it was made for; a
            // leftover entry costs storage only. Logged so it is seen.
            Log.w(TAG, "Could not delete key $alias: ${e.javaClass.name}: ${e.message}", e)
        }
    }

    @ReactMethod
    fun attestAndSign(statementBase64: String?, promise: Promise) {
        val statement: ByteArray = try {
            if (statementBase64.isNullOrEmpty()) throw IllegalArgumentException("empty")
            Base64.decode(statementBase64, Base64.NO_WRAP)
        } catch (e: IllegalArgumentException) {
            promise.reject(CODE_INVALID_INPUT, "attestAndSign needs the statement as non-empty base64: ${e.message}")
            return
        }
        if (statement.isEmpty()) {
            promise.reject(CODE_INVALID_INPUT, "attestAndSign needs a non-empty statement")
            return
        }
        unsupportedReason()?.let {
            Log.w(TAG, it)
            promise.reject(CODE_UNSUPPORTED, it)
            return
        }

        executor.execute {
            val alias = "zkproofport-statement-${UUID.randomUUID()}"
            val keyStore = try {
                KeyStore.getInstance(KEYSTORE).apply { load(null) }
            } catch (e: Exception) {
                Log.e(TAG, "AndroidKeyStore unavailable: ${e.javaClass.name}: ${e.message}", e)
                promise.reject(CODE_UNSUPPORTED, "AndroidKeyStore unavailable: ${e.javaClass.name}: ${e.message}", e)
                return@execute
            }
            try {
                val challenge = MessageDigest.getInstance("SHA-256").digest(statement)

                // StrongBox first, then the TEE (zkPassport's order). A
                // StrongBoxUnavailableException is the documented "no
                // StrongBox for this key"; any other StrongBox failure also
                // falls back, as zkPassport does, and is logged with its class.
                var strongBox = false
                var strongBoxFailure: Exception? = null
                if (isStrongBoxAvailable()) {
                    try {
                        generateKey(alias, challenge, true)
                        strongBox = true
                    } catch (e: StrongBoxUnavailableException) {
                        strongBoxFailure = e
                    } catch (e: Exception) {
                        strongBoxFailure = e
                    }
                    strongBoxFailure?.let {
                        Log.w(TAG, "StrongBox key generation failed, using the TEE: ${it.javaClass.name}: ${it.message}", it)
                        deleteKey(keyStore, alias)
                    }
                }
                if (!strongBox) {
                    try {
                        generateKey(alias, challenge, false)
                    } catch (e: Exception) {
                        val detail = "Key generation failed: ${e.javaClass.name}: ${e.message} " +
                            "[${Build.MANUFACTURER} ${Build.MODEL}, Android ${Build.VERSION.RELEASE}, SDK ${Build.VERSION.SDK_INT}]" +
                            (strongBoxFailure?.let { "; StrongBox before it: ${it.javaClass.name}: ${it.message}" } ?: "")
                        Log.e(TAG, detail, e)
                        promise.reject(CODE_KEYGEN_FAILED, detail, e)
                        return@execute
                    }
                }

                val chain = keyStore.getCertificateChain(alias)
                if (chain == null || chain.isEmpty()) {
                    val detail = "The keystore returned no attestation chain for $alias"
                    Log.e(TAG, detail)
                    promise.reject(CODE_EMPTY_CHAIN, detail)
                    return@execute
                }

                val signatureBytes = try {
                    val key = keyStore.getKey(alias, null) as? PrivateKey
                        ?: throw IllegalStateException("$alias holds no private key")
                    Signature.getInstance("SHA256withECDSA").run {
                        initSign(key)
                        update(statement)
                        sign()
                    }
                } catch (e: Exception) {
                    val detail = "Signing the statement failed: ${e.javaClass.name}: ${e.message}"
                    Log.e(TAG, detail, e)
                    promise.reject(CODE_SIGN_FAILED, detail, e)
                    return@execute
                }

                val certs = Arguments.createArray()
                chain.forEachIndexed { i, cert ->
                    val subject = (cert as? X509Certificate)?.subjectX500Principal?.name ?: cert.type
                    Log.i(TAG, "Chain[$i]: ${cert.encoded.size} bytes, subject $subject")
                    certs.pushString(Base64.encodeToString(cert.encoded, Base64.NO_WRAP))
                }
                Log.i(
                    TAG,
                    "Attested key $alias in ${if (strongBox) "StrongBox" else "the TEE"} (SDK ${Build.VERSION.SDK_INT}): " +
                        "${chain.size} certificates, ${statement.size}-byte statement signed",
                )
                val result = Arguments.createMap()
                result.putArray("chain", certs)
                result.putString("signature", Base64.encodeToString(signatureBytes, Base64.NO_WRAP))
                result.putBoolean("strongBox", strongBox)
                result.putInt("sdkInt", Build.VERSION.SDK_INT)
                promise.resolve(result)
            } catch (e: Exception) {
                val detail = "Android key attestation failed: ${e.javaClass.name}: ${e.message}"
                Log.e(TAG, detail, e)
                promise.reject(CODE_KEYGEN_FAILED, detail, e)
            } finally {
                deleteKey(keyStore, alias)
            }
        }
    }

    @ReactMethod
    fun requestIntegrityToken(nonceBase64Url: String?, promise: Promise) {
        if (nonceBase64Url.isNullOrEmpty() || !NONCE_FORM.matches(nonceBase64Url)) {
            promise.reject(CODE_INVALID_INPUT, "requestIntegrityToken needs an unpadded base64url nonce of 16-500 characters")
            return
        }
        val request = IntegrityTokenRequest.builder().setNonce(nonceBase64Url).build()
        IntegrityManagerFactory.create(reactApplicationContext).requestIntegrityToken(request)
            .addOnSuccessListener { response ->
                val token = response.token()
                Log.i(TAG, "Play Integrity token received (${token.length} characters)")
                promise.resolve(token)
            }
            .addOnFailureListener { e ->
                val errorCode = (e as? IntegrityServiceException)?.errorCode
                val code = when (errorCode) {
                    IntegrityErrorCode.NETWORK_ERROR,
                    IntegrityErrorCode.TOO_MANY_REQUESTS,
                    IntegrityErrorCode.GOOGLE_SERVER_UNAVAILABLE,
                    IntegrityErrorCode.CLIENT_TRANSIENT_ERROR,
                    IntegrityErrorCode.INTERNAL_ERROR -> CODE_INTEGRITY_TRANSIENT
                    IntegrityErrorCode.NONCE_TOO_SHORT,
                    IntegrityErrorCode.NONCE_TOO_LONG,
                    IntegrityErrorCode.NONCE_IS_NOT_BASE64 -> CODE_INVALID_INPUT
                    else -> CODE_INTEGRITY_UNAVAILABLE
                }
                val detail = "Play Integrity failed (errorCode ${errorCode ?: "none"}): ${e.javaClass.name}: ${e.message}"
                Log.e(TAG, detail, e)
                promise.reject(code, detail, e)
            }
    }

    override fun invalidate() {
        executor.shutdown()
        super.invalidate()
    }

    companion object {
        private const val TAG = "AndroidKeyAttestation"
        private const val KEYSTORE = "AndroidKeyStore"
        const val CODE_UNSUPPORTED = "ANDROIDATTEST_UNSUPPORTED"
        const val CODE_INVALID_INPUT = "ANDROIDATTEST_INVALID_INPUT"
        const val CODE_KEYGEN_FAILED = "ANDROIDATTEST_KEYGEN_FAILED"
        const val CODE_EMPTY_CHAIN = "ANDROIDATTEST_EMPTY_CHAIN"
        const val CODE_SIGN_FAILED = "ANDROIDATTEST_SIGN_FAILED"
        const val CODE_INTEGRITY_TRANSIENT = "ANDROIDATTEST_INTEGRITY_TRANSIENT"
        const val CODE_INTEGRITY_UNAVAILABLE = "ANDROIDATTEST_INTEGRITY_UNAVAILABLE"
        private val NONCE_FORM = Regex("^[A-Za-z0-9_-]{16,500}$")
    }
}
