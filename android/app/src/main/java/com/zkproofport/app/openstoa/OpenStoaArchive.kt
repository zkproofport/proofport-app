/*
 * OpenStoaArchive.kt
 * OpenStoa Android push — TAK archive crypto (E2EE chat design §5.2 / §13.5).
 *
 * A byte-for-byte Kotlin port of `openArchive` in the OpenStoa client
 * (`openstoa/src/lib/mls/takClient.ts`), and the Android twin of
 * `proofport-app/ios/OpenStoaNSE/ArchiveDecryptor.swift`. The MLS ciphersuite is
 * 0x0001 (MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519), so the archive layer is
 * HKDF-SHA256 + AES-128-GCM with a 12-byte nonce:
 *
 *     prk   = HKDF-SHA256-Extract(salt: 32 zero bytes, ikm: tak)
 *     key   = HKDF-SHA256-Expand(prk, info: "openstoa-archive/v1:<messageId>", L: 16)
 *     raw   = base64Decode(sealed)
 *     plain = AES-128-GCM.open(key, nonce: raw[0..<12], sealed: raw[12...])
 *
 * The zero salt (rather than a random one) is not a weakness here: the TAK is
 * already a uniformly-random 32-byte key, and the label + message id are bound in
 * the expand info instead. It matches the TS side because the ts-mls KDF requires
 * the extract salt to be exactly hash-length.
 *
 * Android ships no HKDF primitive, so extract/expand are written out over
 * `javax.crypto.Mac` (RFC 5869). Standard JCA only — no new dependency, and no
 * Android framework import, so the whole file runs in a plain JVM unit test.
 *
 * Cross-implementation agreement is enforced by the SAME vector file the iOS port
 * is checked against (`proofport-app/ios/scripts/archive_vectors.json`, sealed by
 * the TypeScript `sealArchive`) via `OpenStoaArchiveVectorsTest`.
 */

package com.zkproofport.app.openstoa

import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import java.nio.charset.CodingErrorAction
import java.nio.charset.StandardCharsets
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Read-only TAK archive crypto. Stateless: nothing is cached, nothing is
 * persisted, and no MLS ratchet state is touched (design §13.6 — the background
 * push handler must never consume a forward-secret message key or it desyncs the
 * main app).
 */
object OpenStoaArchive {
    /** Expand-info prefix. Must match `ARCHIVE_LABEL` in takClient.ts. */
    const val ARCHIVE_LABEL = "openstoa-archive/v1"

    /**
     * The archive context the SENDER uses for the push-preview copy
     * (`PUSH_PREVIEW_CONTEXT_ID` in takClient.ts). The preview is sealed BEFORE
     * the POST that mints the server-side message id, so it cannot bind to that
     * id and uses this constant instead. This — not the payload's `messageId` —
     * is what `pushArchive.ct` is actually sealed under.
     */
    const val PUSH_PREVIEW_CONTEXT_ID = "push-preview"

    /** Raw TAK length in bytes (suite KDF hash size). */
    const val TAK_LENGTH = 32

    /** Derived AEAD key length — matches the suite AEAD (AES-128-GCM). */
    const val ARCHIVE_KEY_LENGTH = 16

    /** AES-GCM nonce length used by the suite HPKE AEAD. */
    const val NONCE_LENGTH = 12

    /** AES-GCM authentication tag length. */
    const val TAG_LENGTH = 16

    private const val HMAC_ALGORITHM = "HmacSHA256"
    private const val HMAC_OUTPUT_LENGTH = 32

    /**
     * HKDF-derive the per-message AEAD key from a TAK/root key + message id.
     * Returns null if the TAK is not exactly [TAK_LENGTH] bytes — a short or
     * oversized key means the stored entry is corrupt and must not be used.
     */
    fun archiveKey(tak: ByteArray, messageId: String): ByteArray? {
        if (tak.size != TAK_LENGTH) return null
        return try {
            val prk = hkdfExtract(ByteArray(TAK_LENGTH), tak)
            val info = "$ARCHIVE_LABEL:$messageId".toByteArray(StandardCharsets.UTF_8)
            hkdfExpand(prk, info, ARCHIVE_KEY_LENGTH)
        } catch (_: Exception) {
            // A JCA provider that cannot do HmacSHA256 is not a case we can
            // recover from; the caller degrades to the content-free placeholder.
            null
        }
    }

    /**
     * Decrypt an archive body sealed by the TypeScript `sealArchive`.
     *
     * Returns null on EVERY failure — bad base64, a body too short to hold a
     * nonce + tag, a wrong or corrupt TAK, GCM authentication failure, or a
     * plaintext that is not valid UTF-8. Callers treat null as "leave the
     * content-free placeholder", never as an error to surface.
     */
    fun open(tak: ByteArray, messageId: String, sealedBase64: String): String? {
        if (sealedBase64.isEmpty()) return null
        val raw = decodeBase64(sealedBase64) ?: return null
        if (raw.size < NONCE_LENGTH + TAG_LENGTH) return null
        val key = archiveKey(tak, messageId) ?: return null

        return try {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(
                Cipher.DECRYPT_MODE,
                SecretKeySpec(key, "AES"),
                // JCA takes the tag length in BITS and expects the tag appended to
                // the ciphertext, which is exactly the `nonce‖ct‖tag` wire layout.
                GCMParameterSpec(TAG_LENGTH * 8, raw, 0, NONCE_LENGTH),
            )
            val plaintext = cipher.doFinal(raw, NONCE_LENGTH, raw.size - NONCE_LENGTH)
            decodeUtf8Strict(plaintext)
        } catch (_: Exception) {
            // AEADBadTagException, ShortBufferException, provider errors — every
            // one of them means "no trustworthy preview".
            null
        }
    }

    /**
     * Decrypt a push-preview copy. Tries the sender's real context first
     * ([PUSH_PREVIEW_CONTEXT_ID], what `sealPushPreview` uses), then the payload's
     * `messageId`.
     *
     * The second attempt is not a guess at a different key location: it is the
     * per-message archive context (`sealArchive(tak, messageId, …)`), which is what
     * a sender that seals the preview after the POST would produce. Both attempts
     * are pure AEAD opens against a stable, non-ratcheting key, so a failed one
     * costs a few microseconds and consumes nothing.
     */
    fun openPushPreview(tak: ByteArray, messageId: String, sealedBase64: String): String? {
        open(tak, PUSH_PREVIEW_CONTEXT_ID, sealedBase64)?.let { return it }
        return open(tak, messageId, sealedBase64)
    }

    /** RFC 5869 HKDF-Extract. `salt` must be hash-length (the suite's requirement). */
    private fun hkdfExtract(salt: ByteArray, ikm: ByteArray): ByteArray {
        val mac = Mac.getInstance(HMAC_ALGORITHM)
        mac.init(SecretKeySpec(salt, HMAC_ALGORITHM))
        return mac.doFinal(ikm)
    }

    /** RFC 5869 HKDF-Expand. */
    private fun hkdfExpand(prk: ByteArray, info: ByteArray, length: Int): ByteArray {
        require(length in 1..(255 * HMAC_OUTPUT_LENGTH))
        val mac = Mac.getInstance(HMAC_ALGORITHM)
        mac.init(SecretKeySpec(prk, HMAC_ALGORITHM))
        val out = ByteArray(length)
        var block = ByteArray(0)
        var written = 0
        var counter = 1
        while (written < length) {
            mac.reset()
            mac.update(block)
            mac.update(info)
            mac.update(counter.toByte())
            block = mac.doFinal()
            val take = minOf(block.size, length - written)
            System.arraycopy(block, 0, out, written, take)
            written += take
            counter++
        }
        return out
    }

    /**
     * Strict base64. `Base64.getDecoder()` throws on any character outside the
     * alphabet, which is the behaviour we want — the iOS and TS ports reject
     * non-base64 too, and a lenient decode would hand garbage to the AEAD.
     * Surrounding whitespace is trimmed first because a transport may add it.
     */
    private fun decodeBase64(value: String): ByteArray? = try {
        Base64.getDecoder().decode(value.trim())
    } catch (_: IllegalArgumentException) {
        null
    }

    /**
     * UTF-8 decode that FAILS on malformed input instead of substituting U+FFFD.
     * `String(bytes, UTF_8)` would silently produce replacement characters, so a
     * wrong-but-authenticating key (impossible here) or a truncated plaintext
     * would render as a preview full of "?" rather than falling back cleanly.
     * Matches `String(data:encoding:.utf8)` on iOS, which returns nil.
     */
    private fun decodeUtf8Strict(bytes: ByteArray): String? = try {
        StandardCharsets.UTF_8
            .newDecoder()
            .onMalformedInput(CodingErrorAction.REPORT)
            .onUnmappableCharacter(CodingErrorAction.REPORT)
            .decode(ByteBuffer.wrap(bytes))
            .toString()
    } catch (_: CharacterCodingException) {
        null
    }
}
