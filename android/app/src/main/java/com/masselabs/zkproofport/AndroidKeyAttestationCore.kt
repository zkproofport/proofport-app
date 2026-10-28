package com.masselabs.zkproofport

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.security.keystore.StrongBoxUnavailableException
import android.util.Log
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

/** A refusal with the code the JS side maps to an error (see AndroidKeyAttestationModule). */
class AttestationException(val code: String, message: String, cause: Throwable? = null) : Exception(message, cause)

/** What attestAndSign produces: the chain (DER, leaf first) and the statement's DER signature. */
class AttestationResult(val chain: List<ByteArray>, val signature: ByteArray, val strongBox: Boolean)

/**
 * The key attestation and Play Integrity work itself, without React Native:
 * AndroidKeyAttestationModule calls it for the app, and the debug-only
 * AttestationProbeReceiver for scripts/capture-android-attestation.sh (real
 * device vectors). One implementation, so a captured vector is what the app
 * produces. Blocking; call it off the main thread.
 */
object AndroidKeyAttestationCore {
    const val TAG = "AndroidKeyAttestation"
    private const val KEYSTORE = "AndroidKeyStore"
    const val CODE_UNSUPPORTED = "ANDROIDATTEST_UNSUPPORTED"
    const val CODE_INVALID_INPUT = "ANDROIDATTEST_INVALID_INPUT"
    const val CODE_KEYGEN_FAILED = "ANDROIDATTEST_KEYGEN_FAILED"
    const val CODE_EMPTY_CHAIN = "ANDROIDATTEST_EMPTY_CHAIN"
    const val CODE_SIGN_FAILED = "ANDROIDATTEST_SIGN_FAILED"
    const val CODE_INTEGRITY_TRANSIENT = "ANDROIDATTEST_INTEGRITY_TRANSIENT"
    const val CODE_INTEGRITY_UNAVAILABLE = "ANDROIDATTEST_INTEGRITY_UNAVAILABLE"
    val NONCE_FORM = Regex("^[A-Za-z0-9_-]{16,500}$")

    private fun isStrongBoxAvailable(context: Context): Boolean =
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.P &&
            context.packageManager.hasSystemFeature(PackageManager.FEATURE_STRONGBOX_KEYSTORE)

    /**
     * Whether this phone can attest a hardware key at all. Key attestation
     * exists from API 24 (below the app's minSdk, but stated); from API 31
     * the platform also says whether a hardware keystore is present. On 28-30
     * the chain itself tells (a software chain is refused in JS).
     */
    fun unsupportedReason(context: Context): String? {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N) {
            return "Key attestation needs Android 7.0 (API 24); this is API ${Build.VERSION.SDK_INT}"
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
            !context.packageManager.hasSystemFeature(PackageManager.FEATURE_HARDWARE_KEYSTORE)
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

    /**
     * A fresh EC P-256 key (StrongBox first, then the TEE) with attestation
     * challenge SHA-256(statement), its chain, and its SHA256withECDSA
     * signature over the statement; the key is deleted afterwards.
     */
    fun attestAndSign(context: Context, statement: ByteArray): AttestationResult {
        if (statement.isEmpty()) throw AttestationException(CODE_INVALID_INPUT, "attestAndSign needs a non-empty statement")
        unsupportedReason(context)?.let {
            Log.w(TAG, it)
            throw AttestationException(CODE_UNSUPPORTED, it)
        }
        val alias = "zkproofport-statement-${UUID.randomUUID()}"
        val keyStore = try {
            KeyStore.getInstance(KEYSTORE).apply { load(null) }
        } catch (e: Exception) {
            Log.e(TAG, "AndroidKeyStore unavailable: ${e.javaClass.name}: ${e.message}", e)
            throw AttestationException(CODE_UNSUPPORTED, "AndroidKeyStore unavailable: ${e.javaClass.name}: ${e.message}", e)
        }
        try {
            val challenge = MessageDigest.getInstance("SHA-256").digest(statement)
            // StrongBox first, then the TEE (zkPassport's order). A
            // StrongBoxUnavailableException is the documented "no StrongBox
            // for this key"; any other StrongBox failure also falls back, as
            // zkPassport does, and is logged with its class.
            var strongBox = false
            var strongBoxFailure: Exception? = null
            if (isStrongBoxAvailable(context)) {
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
                    throw AttestationException(CODE_KEYGEN_FAILED, detail, e)
                }
            }
            val chain = keyStore.getCertificateChain(alias)
            if (chain == null || chain.isEmpty()) {
                val detail = "The keystore returned no attestation chain for $alias"
                Log.e(TAG, detail)
                throw AttestationException(CODE_EMPTY_CHAIN, detail)
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
                throw AttestationException(CODE_SIGN_FAILED, detail, e)
            }
            chain.forEachIndexed { i, cert ->
                val subject = (cert as? X509Certificate)?.subjectX500Principal?.name ?: cert.type
                Log.i(TAG, "Chain[$i]: ${cert.encoded.size} bytes, subject $subject")
            }
            Log.i(
                TAG,
                "Attested key $alias in ${if (strongBox) "StrongBox" else "the TEE"} (SDK ${Build.VERSION.SDK_INT}): " +
                    "${chain.size} certificates, ${statement.size}-byte statement signed",
            )
            return AttestationResult(chain.map { it.encoded }, signatureBytes, strongBox)
        } catch (e: AttestationException) {
            throw e
        } catch (e: Exception) {
            val detail = "Android key attestation failed: ${e.javaClass.name}: ${e.message}"
            Log.e(TAG, detail, e)
            throw AttestationException(CODE_KEYGEN_FAILED, detail, e)
        } finally {
            deleteKey(keyStore, alias)
        }
    }

    /** The classic Play Integrity token (encrypted JWE) for `nonceBase64Url`. */
    fun requestIntegrityToken(
        context: Context,
        nonceBase64Url: String,
        onToken: (String) -> Unit,
        onError: (AttestationException) -> Unit,
    ) {
        if (!NONCE_FORM.matches(nonceBase64Url)) {
            onError(AttestationException(CODE_INVALID_INPUT, "requestIntegrityToken needs an unpadded base64url nonce of 16-500 characters"))
            return
        }
        val request = IntegrityTokenRequest.builder().setNonce(nonceBase64Url).build()
        IntegrityManagerFactory.create(context).requestIntegrityToken(request)
            .addOnSuccessListener { response ->
                val token = response.token()
                Log.i(TAG, "Play Integrity token received (${token.length} characters)")
                onToken(token)
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
                onError(AttestationException(code, detail, e))
            }
    }
}
