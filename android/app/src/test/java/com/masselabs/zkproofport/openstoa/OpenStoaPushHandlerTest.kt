/*
 * The decision the FCM service makes for one incoming message.
 *
 * These are the tests that fail if a guard is removed from `OpenStoaPushHandler`:
 * the `ct`-only case, the missing-key case, the tampered-body case and the
 * "expo still gets every message" contract all live here rather than in the
 * service, which is a thin adapter with no branching of its own.
 */

package com.masselabs.zkproofport.openstoa

import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class OpenStoaPushHandlerTest {

    private val tak = ByteArray(OpenStoaArchive.TAK_LENGTH) { it.toByte() }
    private val topicId = "0f5b1f6e-6a1e-4d0f-9a1b-2c3d4e5f6a7b"
    private val messageId = "01JQZ8SERVERASSIGNED0000000"

    /** A store holding exactly one (topic, version) → TAK entry. */
    private fun store(
        vararg entries: Pair<Pair<String, Long>, ByteArray>,
    ): TakReader {
        val map = entries.toMap()
        return TakReader { t, v -> map[t to v] }
    }

    private val emptyStore = TakReader { _, _ -> null }

    /** Seal a body under the sender's real push-preview context. */
    private fun sealPreview(key: ByteArray, plaintext: String): String {
        val aead = OpenStoaArchive.archiveKey(key, OpenStoaArchive.PUSH_PREVIEW_CONTEXT_ID)!!
        val nonce = ByteArray(OpenStoaArchive.NONCE_LENGTH) { (it * 7).toByte() }
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(
            Cipher.ENCRYPT_MODE,
            SecretKeySpec(aead, "AES"),
            GCMParameterSpec(OpenStoaArchive.TAG_LENGTH * 8, nonce),
        )
        return Base64.getEncoder()
            .encodeToString(nonce + cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8)))
    }

    /** The Expo envelope the server's push actually arrives in. */
    private fun expoPush(vararg dataFields: Pair<String, Any>): Map<String, String> {
        val body = dataFields.joinToString(",") { (k, v) ->
            if (v is String) "\"$k\":${quote(v)}" else "\"$k\":$v"
        }
        return mapOf(
            "title" to "OpenStoa",
            "message" to "New message",
            "body" to "{$body}",
            "channelId" to "default",
        )
    }

    private fun quote(s: String) = "\"" + s.replace("\\", "\\\\").replace("\"", "\\\"") + "\""

    // ── happy path ────────────────────────────────────────────────────────────

    @Test
    fun `decrypts the preview from a complete expo payload`() {
        val push = expoPush(
            "topicId" to topicId,
            "messageId" to messageId,
            "epoch" to 4,
            "ct" to "live-mls",
            "act" to sealPreview(tak, "Alice: meeting at 3"),
            "tv" to 4,
        )
        val decision = OpenStoaPushHandler.decide(push, store((topicId to 4L) to tak))
        assertEquals(OpenStoaPushDecision.Preview("Alice: meeting at 3"), decision)
    }

    @Test
    fun `decrypts korean and emoji previews intact`() {
        for (text in listOf("회의 3시 🎉", "안녕하세요 👋 hello مرحبا", "🇰🇷🇯🇵🇺🇸")) {
            val push = expoPush(
                "topicId" to topicId,
                "messageId" to messageId,
                "act" to sealPreview(tak, text),
                "tv" to 0,
            )
            assertEquals(
                OpenStoaPushDecision.Preview(text),
                OpenStoaPushHandler.decide(push, store((topicId to 0L) to tak)),
            )
        }
    }

    @Test
    fun `a very long preview is truncated for display`() {
        val long = "가".repeat(20_000)
        val push = expoPush(
            "topicId" to topicId,
            "messageId" to messageId,
            "act" to sealPreview(tak, long),
            "tv" to 0,
        )
        val decision = OpenStoaPushHandler.decide(push, store((topicId to 0L) to tak))
            as OpenStoaPushDecision.Preview
        assertEquals(Preview.MAX_CHARACTERS + 1, decision.text.length)
        assertTrue(decision.text.endsWith("…"))
    }

    @Test
    fun `a flat non-expo payload also previews`() {
        val push = mapOf(
            "topicId" to topicId,
            "messageId" to messageId,
            "act" to sealPreview(tak, "flat sender"),
            "tv" to "0",
        )
        assertEquals(
            OpenStoaPushDecision.Preview("flat sender"),
            OpenStoaPushHandler.decide(push, store((topicId to 0L) to tak)),
        )
    }

    // ── attachments: a caption, never the envelope (P-1) ──────────────────────

    /** A body exactly as `buildChatMediaBody` produces it. */
    private fun mediaBody(
        mediaId: String = "a0b1c2d3e4f5061728394a5b6c7d8e9f",
        mime: String = "image/png",
        size: Int = 4096,
        takVersion: Int = 0,
    ): String =
        OpenStoaPushHandler.CHAT_MEDIA_BODY_PREFIX +
            """{"v":1,"key":"topics/$topicId/chat/u1/$mediaId.bin","mediaId":"$mediaId",""" +
            """"takVersion":$takVersion,"mime":"$mime","size":$size}"""

    private fun previewOf(plaintext: String): OpenStoaPushDecision {
        val push = expoPush(
            "topicId" to topicId,
            "messageId" to messageId,
            "act" to sealPreview(tak, plaintext),
            "tv" to 0,
        )
        return OpenStoaPushHandler.decide(push, store((topicId to 0L) to tak))
    }

    @Test
    fun `an attachment shows a caption, never the envelope JSON`() {
        val decision = previewOf(mediaBody()) as OpenStoaPushDecision.Preview
        assertEquals(OpenStoaPushHandler.MEDIA_PREVIEW_TEXT, decision.text)
        assertFalse(decision.text.contains(OpenStoaPushHandler.CHAT_MEDIA_BODY_PREFIX))
        assertFalse(decision.text.contains("{"))
        assertFalse(decision.text.contains("topics/"))
    }

    @Test
    fun `every envelope shape gets the caption, including malformed ones`() {
        /*
         * The guard is the PREFIX, not a successful parse. A body that is an
         * envelope but broken — a future version, a truncated JSON, a hostile
         * key — is still not text, and a check that only caught the ones it
         * could fully parse would let exactly the broken ones onto a lock
         * screen. That is the wrong way round, so it is pinned here.
         */
        val bodies = listOf(
            mediaBody(),
            mediaBody(mime = "image/gif", size = 1),
            mediaBody(size = 10 * 1024 * 1024),
            // Malformed / hostile, all still prefixed:
            OpenStoaPushHandler.CHAT_MEDIA_BODY_PREFIX,
            OpenStoaPushHandler.CHAT_MEDIA_BODY_PREFIX + "not json",
            OpenStoaPushHandler.CHAT_MEDIA_BODY_PREFIX + "{}",
            OpenStoaPushHandler.CHAT_MEDIA_BODY_PREFIX + """{"v":2}""",
            OpenStoaPushHandler.CHAT_MEDIA_BODY_PREFIX + """{"key":"../../etc/passwd"}""",
            mediaBody().dropLast(3),
        )
        for (body in bodies) {
            val decision = previewOf(body)
            assertEquals(
                "body=$body",
                OpenStoaPushDecision.Preview(OpenStoaPushHandler.MEDIA_PREVIEW_TEXT),
                decision,
            )
        }
    }

    @Test
    fun `text that merely resembles an envelope is still shown as text`() {
        // A member can type any of these into the composer. Treating them as
        // attachments would hide a real message behind a photo caption.
        val texts = listOf(
            "openstoa:media:v2:{\"v\":1}",
            "openstoa:media:v1{\"v\":1}",
            "look at this openstoa:media:v1:{\"v\":1}",
            """{"v":1,"key":"topics/x/chat/u/y.bin"}""",
            "openstoa:media",
            "📷 Photo",
        )
        for (text in texts) {
            assertEquals("text=$text", OpenStoaPushDecision.Preview(text), previewOf(text))
        }
    }

    @Test
    fun `the media prefix matches the one chatMedia ts defines`() {
        // Mirrored by `nativeChatMediaConstants.test.ts` on the TypeScript side,
        // which reads this file; this is the assertion a Kotlin-only reader sees.
        assertEquals("openstoa:media:v1:", OpenStoaPushHandler.CHAT_MEDIA_BODY_PREFIX)
    }

    @Test
    fun `an attachment with no key held keeps the content-free placeholder`() {
        // No preview key → nothing is decrypted at all, so the caption is never
        // reached. The recipient still gets "New message" and the picture in the
        // app on tap.
        val push = expoPush(
            "topicId" to topicId,
            "messageId" to messageId,
            "act" to sealPreview(tak, mediaBody()),
            "tv" to 0,
        )
        assertSame(OpenStoaPushDecision.Delegate, OpenStoaPushHandler.decide(push, emptyStore))
    }

    // ── every guard: must delegate, never preview ─────────────────────────────

    /**
     * §13.6, the guard that matters most: a payload carrying only the live MLS
     * ciphertext must NOT be decrypted here (that would consume a ratchet key and
     * desync the app) and must still reach expo-notifications so a notification is
     * posted.
     */
    @Test
    fun `a ct-only payload is delegated and never decrypted`() {
        val push = expoPush(
            "topicId" to topicId,
            "messageId" to messageId,
            "epoch" to 4,
            "ct" to sealPreview(tak, "this must never be shown"),
        )
        var reads = 0
        val watched = TakReader { t, v -> reads++; store((topicId to 4L) to tak).read(t, v) }
        assertSame(OpenStoaPushDecision.Delegate, OpenStoaPushHandler.decide(push, watched))
        assertEquals("must not even look up a key for a ct-only payload", 0, reads)
    }

    @Test
    fun `a missing or empty act is delegated`() {
        assertSame(
            OpenStoaPushDecision.Delegate,
            OpenStoaPushHandler.decide(
                expoPush("topicId" to topicId, "messageId" to messageId, "tv" to 0),
                store((topicId to 0L) to tak),
            ),
        )
        assertSame(
            OpenStoaPushDecision.Delegate,
            OpenStoaPushHandler.decide(
                expoPush("topicId" to topicId, "messageId" to messageId, "act" to "", "tv" to 0),
                store((topicId to 0L) to tak),
            ),
        )
    }

    @Test
    fun `a missing or invalid tv is delegated`() {
        val act = sealPreview(tak, "hello")
        val bad = listOf("\"abc\"", "1.5", "true", "\"\"", "null")
        for (tv in bad) {
            val push = mapOf(
                "body" to """{"topicId":"$topicId","messageId":"$messageId","act":"$act","tv":$tv}""",
            )
            assertSame("tv=$tv", OpenStoaPushDecision.Delegate, OpenStoaPushHandler.decide(push, store((topicId to 0L) to tak)))
        }
        // tv absent entirely
        assertSame(
            OpenStoaPushDecision.Delegate,
            OpenStoaPushHandler.decide(
                expoPush("topicId" to topicId, "messageId" to messageId, "act" to act),
                store((topicId to 0L) to tak),
            ),
        )
    }

    /**
     * Contract invocation: the store is asked for exactly the (topicId, tv) the
     * push named. Looking up the wrong topic or the wrong version would silently
     * cost every preview, and the AEAD failure it produces is indistinguishable
     * from "no key stored" — so pin the arguments, not just the outcome.
     */
    @Test
    fun `the store is consulted once with the payload's topic and version`() {
        val calls = mutableListOf<Pair<String, Long>>()
        val recording = TakReader { t, v -> calls.add(t to v); tak }
        val push = expoPush(
            "topicId" to topicId,
            "messageId" to messageId,
            "act" to sealPreview(tak, "hello"),
            "tv" to 12,
        )
        assertEquals(OpenStoaPushDecision.Preview("hello"), OpenStoaPushHandler.decide(push, recording))
        assertEquals(listOf(topicId to 12L), calls)
    }

    @Test
    fun `no stored TAK for the topic is delegated`() {
        val push = expoPush(
            "topicId" to topicId,
            "messageId" to messageId,
            "act" to sealPreview(tak, "hello"),
            "tv" to 0,
        )
        assertSame(OpenStoaPushDecision.Delegate, OpenStoaPushHandler.decide(push, emptyStore))
        // Right topic, WRONG version — the store is keyed on both.
        assertSame(
            OpenStoaPushDecision.Delegate,
            OpenStoaPushHandler.decide(push, store((topicId to 7L) to tak)),
        )
        // Right version, WRONG topic.
        assertSame(
            OpenStoaPushDecision.Delegate,
            OpenStoaPushHandler.decide(push, store(("other-topic" to 0L) to tak)),
        )
    }

    @Test
    fun `a TAK of the wrong length is delegated`() {
        val push = expoPush(
            "topicId" to topicId,
            "messageId" to messageId,
            "act" to sealPreview(tak, "hello"),
            "tv" to 0,
        )
        for (size in intArrayOf(0, 16, 31, 33, 64)) {
            assertSame(
                "tak_$size",
                OpenStoaPushDecision.Delegate,
                OpenStoaPushHandler.decide(push, store((topicId to 0L) to tak.copyOf(size))),
            )
        }
    }

    @Test
    fun `a wrong TAK is delegated`() {
        val wrong = ByteArray(OpenStoaArchive.TAK_LENGTH) { (it + 1).toByte() }
        val push = expoPush(
            "topicId" to topicId,
            "messageId" to messageId,
            "act" to sealPreview(tak, "hello"),
            "tv" to 0,
        )
        assertSame(OpenStoaPushDecision.Delegate, OpenStoaPushHandler.decide(push, store((topicId to 0L) to wrong)))
    }

    @Test
    fun `a tampered ciphertext is delegated`() {
        val sealed = sealPreview(tak, "Alice: meeting at 3")
        val raw = Base64.getDecoder().decode(sealed)
        val mutations = mapOf(
            "nonce" to 0,
            "body" to OpenStoaArchive.NONCE_LENGTH,
            "tag" to raw.size - 1,
        )
        for ((label, index) in mutations) {
            val bad = raw.copyOf()
            bad[index] = (bad[index].toInt() xor 0x01).toByte()
            val push = expoPush(
                "topicId" to topicId,
                "messageId" to messageId,
                "act" to Base64.getEncoder().encodeToString(bad),
                "tv" to 0,
            )
            assertSame(
                "tampered_$label",
                OpenStoaPushDecision.Delegate,
                OpenStoaPushHandler.decide(push, store((topicId to 0L) to tak)),
            )
        }
    }

    @Test
    fun `a non-base64 act is delegated`() {
        for (act in listOf("not base64!!", "%%%%", "☃☃☃☃")) {
            val push = expoPush(
                "topicId" to topicId,
                "messageId" to messageId,
                "act" to act,
                "tv" to 0,
            )
            assertSame(act, OpenStoaPushDecision.Delegate, OpenStoaPushHandler.decide(push, store((topicId to 0L) to tak)))
        }
    }

    /** A blank body is worse than the "New message" placeholder it would replace. */
    @Test
    fun `an empty plaintext is delegated`() {
        val push = expoPush(
            "topicId" to topicId,
            "messageId" to messageId,
            "act" to sealPreview(tak, ""),
            "tv" to 0,
        )
        assertSame(OpenStoaPushDecision.Delegate, OpenStoaPushHandler.decide(push, store((topicId to 0L) to tak)))
    }

    /** A push from anything that is not OpenStoa must pass straight through. */
    @Test
    fun `a non-OpenStoa expo push is delegated untouched`() {
        val other = mapOf(
            "title" to "Some other app feature",
            "message" to "You have a new follower",
            "body" to """{"screen":"profile","userId":"u1"}""",
        )
        assertSame(OpenStoaPushDecision.Delegate, OpenStoaPushHandler.decide(other, emptyStore))
        assertSame(OpenStoaPushDecision.Delegate, OpenStoaPushHandler.decide(emptyMap(), emptyStore))
    }

    /** A store that blows up must degrade to the placeholder, not to a crash. */
    @Test
    fun `a throwing store is delegated`() {
        val push = expoPush(
            "topicId" to topicId,
            "messageId" to messageId,
            "act" to sealPreview(tak, "hello"),
            "tv" to 0,
        )
        val exploding = TakReader { _, _ -> throw IllegalStateException("keystore gone") }
        assertSame(OpenStoaPushDecision.Delegate, OpenStoaPushHandler.decide(push, exploding))
    }

    // ── the rewrite handed back to expo-notifications ─────────────────────────

    @Test
    fun `rewriteData replaces only the body text`() {
        val original = mapOf(
            "title" to "OpenStoa",
            "message" to "New message",
            "body" to """{"topicId":"$topicId","messageId":"$messageId"}""",
            "channelId" to "default",
            "experienceId" to "@zkproofport/proofport-app",
        )
        val rewritten = OpenStoaPushHandler.rewriteData(original, "Alice: meeting at 3")

        assertEquals("Alice: meeting at 3", rewritten["message"])
        assertEquals(original.keys, rewritten.keys)
        for ((key, value) in original) {
            if (key != "message") assertEquals("$key must survive", value, rewritten[key])
        }
        // The routing fields the tap handler reads live in `body`; touching it would
        // break `extractTopicId` in pushTapRouting.ts.
        assertEquals(original["body"], rewritten["body"])
        assertFalse(original === rewritten)
        assertEquals("New message", original["message"])
    }

    @Test
    fun `rewriteData targets the key expo renders as the body`() {
        // expo-notifications: NotificationData.message -> RemoteNotificationContent.text.
        assertEquals("message", OpenStoaPushHandler.EXPO_BODY_TEXT_KEY)
    }

    @Test
    fun `rewriteData adds the body text when the payload had none`() {
        val rewritten = OpenStoaPushHandler.rewriteData(mapOf("title" to "OpenStoa"), "preview")
        assertEquals("preview", rewritten["message"])
        assertEquals("OpenStoa", rewritten["title"])
    }

    // ── store key contract (pure half of OpenStoaTakStore) ────────────────────

    @Test
    fun `entry keys match the iOS keychain account format`() {
        assertEquals("openstoa.tak.01JQZ8T.0", OpenStoaTakStore.entryKey("01JQZ8T", 0))
        assertEquals("openstoa.tak.01JQZ8T.42", OpenStoaTakStore.entryKey("01JQZ8T", 42))
        assertEquals("openstoa.tak.$topicId.7", OpenStoaTakStore.entryKey(topicId, 7))
    }

    @Test
    fun `only base64 of exactly 32 bytes is accepted as a TAK`() {
        val encoder = Base64.getEncoder()
        assertTrue(OpenStoaTakStore.isValidTakB64(encoder.encodeToString(ByteArray(32))))
        assertTrue(OpenStoaTakStore.isValidTakB64(" " + encoder.encodeToString(ByteArray(32)) + " "))

        for (size in intArrayOf(0, 1, 16, 31, 33, 64)) {
            assertFalse("size_$size", OpenStoaTakStore.isValidTakB64(encoder.encodeToString(ByteArray(size))))
        }
        for (bad in listOf("", "   ", "not base64!!", "AAAA===", "☃")) {
            assertFalse("bad/$bad", OpenStoaTakStore.isValidTakB64(bad))
        }
    }

    @Test
    fun `decodeTak returns the raw bytes for a valid key`() {
        val encoded = Base64.getEncoder().encodeToString(tak)
        val decoded = OpenStoaTakStore.decodeTak(encoded)!!
        assertEquals(OpenStoaArchive.TAK_LENGTH, decoded.size)
        assertTrue(tak.contentEquals(decoded))
        assertNull(OpenStoaTakStore.decodeTak("AAAA"))
    }
}
