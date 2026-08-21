/*
 * Cross-implementation known-answer test for the OpenStoa Android archive decryptor.
 *
 * A green Gradle build proves the Kotlin compiles; it proves nothing about whether
 * the Kotlin key schedule agrees with the TypeScript one. This loads the SAME
 * `ios/scripts/archive_vectors.json` the Swift port is checked against — sealed by
 * openstoa's `sealArchive` (`openstoa/src/lib/mls/takClient.ts`) — and requires
 * `OpenStoaArchive.open` to reproduce every plaintext and REJECT every corrupted
 * variant.
 *
 * Regenerate the vectors after any change to takClient.ts:
 *   cd openstoa && npx tsx scripts/gen-archive-vectors.ts \
 *     > ../proofport-app/ios/scripts/archive_vectors.json
 */

package com.masselabs.zkproofport.openstoa

import java.io.File
import java.util.Base64
import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class OpenStoaArchiveVectorsTest {

    private companion object {
        /** Set by `android/app/build.gradle`, which also declares the file as a task input. */
        const val VECTOR_PATH_PROPERTY = "openstoa.archiveVectors"
    }

    private val file: JSONObject by lazy { JSONObject(vectorFile().readText()) }
    private val tak: ByteArray by lazy { Base64.getDecoder().decode(file.getString("takBase64")) }

    /**
     * The vector file. `build.gradle` passes its absolute path as a system property
     * AND declares it as a task input, so editing the vectors invalidates the test
     * task instead of letting Gradle report it up-to-date and skip the run. The
     * walk-up is the fallback for running this class straight from an IDE, which
     * does not go through that task.
     */
    private fun vectorFile(): File {
        System.getProperty(VECTOR_PATH_PROPERTY)?.let { path ->
            val declared = File(path)
            if (declared.isFile) return declared
            throw AssertionError("$VECTOR_PATH_PROPERTY points at a missing file: $path")
        }
        var dir: File? = File(System.getProperty("user.dir") ?: ".").absoluteFile
        while (dir != null) {
            val candidate = File(dir, "ios/scripts/archive_vectors.json")
            if (candidate.isFile) return candidate
            dir = dir.parentFile
        }
        throw AssertionError(
            "ios/scripts/archive_vectors.json not found above ${System.getProperty("user.dir")}",
        )
    }

    // ── suite parameters — the Kotlin port hardcodes these ────────────────────

    @Test
    fun `suite parameters match the vector file`() {
        val meta = file.getJSONObject("meta")
        assertEquals(
            "MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519",
            meta.getString("suite"),
        )
        assertEquals(meta.getInt("kdfSize"), OpenStoaArchive.TAK_LENGTH)
        assertEquals(meta.getInt("nonceLength"), OpenStoaArchive.NONCE_LENGTH)
        assertEquals(meta.getInt("aeadKeyLength"), OpenStoaArchive.ARCHIVE_KEY_LENGTH)
        assertEquals(OpenStoaArchive.TAK_LENGTH, tak.size)
    }

    // ── positive vectors — Kotlin must reproduce the TypeScript plaintext ─────

    @Test
    fun `every positive vector decrypts to the TypeScript plaintext`() {
        val vectors = file.getJSONArray("vectors")
        assertTrue("vector file has no positive vectors", vectors.length() >= 9)
        for (i in 0 until vectors.length()) {
            val v = vectors.getJSONObject(i)
            val name = v.getString("name")
            val got = OpenStoaArchive.open(tak, v.getString("messageId"), v.getString("sealed"))
            assertEquals("decrypt/$name", v.getString("plaintext"), got)
        }
    }

    /** Korean + emoji must survive byte-for-byte, not as replacement characters. */
    @Test
    fun `utf8 vectors round-trip exactly`() {
        val korean = vectorNamed("korean_emoji")
        val got = OpenStoaArchive.open(tak, korean.getString("messageId"), korean.getString("sealed"))
        assertEquals(korean.getString("plaintext"), got)
        assertTrue("expected Korean text", got!!.contains("회의"))
        assertTrue("expected emoji", got.contains("🎉"))
        assertArrayEquals(
            korean.getString("plaintext").toByteArray(Charsets.UTF_8),
            got.toByteArray(Charsets.UTF_8),
        )
    }

    // ── negative vectors — must return null, never a garbage preview ──────────

    @Test
    fun `every negative vector is rejected`() {
        val negatives = file.getJSONArray("negatives")
        assertTrue("vector file has no negative vectors", negatives.length() >= 10)
        for (i in 0 until negatives.length()) {
            val n = negatives.getJSONObject(i)
            val name = n.getString("name")
            val got = OpenStoaArchive.open(tak, n.getString("messageId"), n.getString("sealed"))
            assertNull("reject/$name — unexpectedly decrypted to \"$got\"", got)
        }
    }

    // ── key-material edge cases ───────────────────────────────────────────────

    @Test
    fun `wrong-length and wrong-value TAKs are rejected`() {
        val base = vectorNamed("ascii")
        val messageId = base.getString("messageId")
        val sealed = base.getString("sealed")

        assertNull("tak_31_bytes", OpenStoaArchive.open(tak.copyOf(31), messageId, sealed))
        assertNull("tak_33_bytes", OpenStoaArchive.open(tak.copyOf(33), messageId, sealed))
        assertNull("tak_empty", OpenStoaArchive.open(ByteArray(0), messageId, sealed))

        val flipped = tak.copyOf()
        flipped[0] = (flipped[0].toInt() xor 0x01).toByte()
        assertNull("tak_one_bit_off", OpenStoaArchive.open(flipped, messageId, sealed))

        assertNull("empty_message_id", OpenStoaArchive.open(tak, "", sealed))
        assertNull("archiveKey rejects short tak", OpenStoaArchive.archiveKey(tak.copyOf(31), "m"))
        assertNotNull("archiveKey accepts 32-byte tak", OpenStoaArchive.archiveKey(tak, "m"))
        assertEquals(
            OpenStoaArchive.ARCHIVE_KEY_LENGTH,
            OpenStoaArchive.archiveKey(tak, "m")!!.size,
        )
    }

    /** The message id is bound into the HKDF info, so a different one must fail. */
    @Test
    fun `message id is bound into the key schedule`() {
        val base = vectorNamed("ascii")
        val sealed = base.getString("sealed")
        assertNotNull(OpenStoaArchive.open(tak, base.getString("messageId"), sealed))
        assertNull(OpenStoaArchive.open(tak, base.getString("messageId") + "x", sealed))
        assertNull(OpenStoaArchive.open(tak, "완전히-다른-id", sealed))
    }

    /** Boundary lengths around nonce(12) + tag(16). */
    @Test
    fun `bodies shorter than nonce plus tag are rejected before any AEAD work`() {
        val encoder = Base64.getEncoder()
        for (size in intArrayOf(0, 1, 11, 12, 13, 27)) {
            val sealed = encoder.encodeToString(ByteArray(size))
            assertNull("length_$size", OpenStoaArchive.open(tak, "m", sealed))
        }
        // 28 bytes is the minimum ACCEPTED length; it still fails the tag check,
        // which is what proves the guard above is a length guard and not the AEAD.
        assertNull("length_28", OpenStoaArchive.open(tak, "m", encoder.encodeToString(ByteArray(28))))
    }

    @Test
    fun `non-base64 input is rejected without throwing`() {
        for (bad in listOf("not base64!!", "%%%%", "AAAA===", "☃☃☃☃", " ", "\u0000")) {
            assertNull("non_base64/$bad", OpenStoaArchive.open(tak, "m", bad))
        }
    }

    // ── push-preview context — what the sender ACTUALLY seals under ───────────

    /**
     * THE test that matters for the push path: these blobs are sealed by the real
     * TypeScript `sealPushPreview` (`openstoa/scripts/gen-archive-vectors.ts` →
     * the shared `archive_vectors.json`), so they prove agreement with the SENDER
     * rather than self-consistency with this file's own crypto.
     *
     * Each case carries a `messageId` deliberately unrelated to the seal, because
     * the preview is sealed under the fixed `push-preview` context BEFORE the POST
     * that mints the server-side id. The negative half — a plain per-message `open`
     * on the same blob must return null — is the assertion that catches the
     * regression: iOS shipped exactly that mistake and its 63 green checks never
     * saw it, because they only ever exercised `open` with matching ids.
     */
    @Test
    fun `every push-preview vector opens under the push-preview context`() {
        val previews = file.getJSONArray("pushPreviews")
        assertTrue("vector file has no pushPreviews array", previews.length() >= 3)
        for (i in 0 until previews.length()) {
            val v = previews.getJSONObject(i)
            val name = v.getString("name")
            val messageId = v.getString("messageId")
            val sealed = v.getString("sealed")

            assertEquals(
                "pushPreview/$name",
                v.getString("plaintext"),
                OpenStoaArchive.openPushPreview(tak, messageId, sealed),
            )
            assertNull(
                "pushPreview/$name — a per-message open must NOT succeed on a " +
                    "push-preview blob; if it does, the contexts have converged and " +
                    "this vector no longer guards anything",
                OpenStoaArchive.open(tak, messageId, sealed),
            )
        }
    }

    /** The Korean/emoji push-preview vector must survive byte-for-byte. */
    @Test
    fun `utf8 push-preview vector round-trips exactly`() {
        val v = pushPreviewNamed("push_korean_emoji")
        val got = OpenStoaArchive.openPushPreview(tak, v.getString("messageId"), v.getString("sealed"))
        assertEquals(v.getString("plaintext"), got)
        assertArrayEquals(
            v.getString("plaintext").toByteArray(Charsets.UTF_8),
            got!!.toByteArray(Charsets.UTF_8),
        )
    }

    /**
     * The empty-body vector decrypts to "" at the crypto layer. Turning that into
     * the content-free placeholder is the handler's job, not this one's — see
     * `OpenStoaPushHandlerTest.an empty plaintext is delegated`.
     */
    @Test
    fun `the empty push-preview vector decrypts to an empty string`() {
        val v = pushPreviewNamed("push_empty")
        assertEquals("", OpenStoaArchive.openPushPreview(tak, v.getString("messageId"), v.getString("sealed")))
    }

    /**
     * The constant this whole path hinges on. A rename on either side silently
     * costs every preview, so pin the literal against takClient.ts.
     */
    @Test
    fun `the push-preview context id matches the TypeScript constant`() {
        assertEquals("push-preview", OpenStoaArchive.PUSH_PREVIEW_CONTEXT_ID)
        assertEquals("openstoa-archive/v1", OpenStoaArchive.ARCHIVE_LABEL)
    }

    /**
     * Locally-sealed twin of the shared vectors. Kept because it exercises a
     * message id the generator does not ship (one containing a colon, the info
     * separator), but it is NOT the cross-implementation proof — the vectors above
     * are.
     */
    @Test
    fun `openPushPreview opens a copy sealed under the push-preview context`() {
        val sealed = sealForTest(tak, OpenStoaArchive.PUSH_PREVIEW_CONTEXT_ID, "Alice: 회의 3시 🎉")
        assertEquals(
            "Alice: 회의 3시 🎉",
            OpenStoaArchive.openPushPreview(tak, "01JQZ8:SERVER:ASSIGNED:ID", sealed),
        )
        // The plain `open` with the payload's message id must NOT open it — that is
        // exactly the mismatch this fallback exists to absorb.
        assertNull(OpenStoaArchive.open(tak, "01JQZ8:SERVER:ASSIGNED:ID", sealed))
    }

    /** The secondary attempt still opens a per-message-sealed copy. */
    @Test
    fun `openPushPreview falls back to the per-message context`() {
        val base = vectorNamed("ascii")
        assertEquals(
            base.getString("plaintext"),
            OpenStoaArchive.openPushPreview(tak, base.getString("messageId"), base.getString("sealed")),
        )
    }

    @Test
    fun `openPushPreview returns null when neither context opens the body`() {
        val sealed = sealForTest(tak, "some-other-context", "secret")
        assertNull(OpenStoaArchive.openPushPreview(tak, "m1", sealed))
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    private fun vectorNamed(name: String): JSONObject = named("vectors", name)

    private fun pushPreviewNamed(name: String): JSONObject = named("pushPreviews", name)

    private fun named(array: String, name: String): JSONObject {
        val vectors = file.getJSONArray(array)
        for (i in 0 until vectors.length()) {
            val v = vectors.getJSONObject(i)
            if (v.getString("name") == name) return v
        }
        throw AssertionError("$array entry \"$name\" missing from archive_vectors.json")
    }

    /**
     * Seal a body the way `sealArchive` does. Test-only — production code never
     * encrypts here — and it is the *inverse* of the code under test rather than a
     * reimplementation of it: the positive vectors above are what pin the key
     * schedule to TypeScript, this only builds inputs for the context tests.
     */
    private fun sealForTest(tak: ByteArray, context: String, plaintext: String): String {
        val key = OpenStoaArchive.archiveKey(tak, context)!!
        val nonce = ByteArray(OpenStoaArchive.NONCE_LENGTH) { it.toByte() }
        val cipher = javax.crypto.Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(
            javax.crypto.Cipher.ENCRYPT_MODE,
            javax.crypto.spec.SecretKeySpec(key, "AES"),
            javax.crypto.spec.GCMParameterSpec(OpenStoaArchive.TAG_LENGTH * 8, nonce),
        )
        val body = cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8))
        return Base64.getEncoder().encodeToString(nonce + body)
    }
}
