/*
 * Payload parsing + preview truncation for the Android push handler.
 *
 * Mirrors the `[push payload parsing]`, `[expo push envelope]` and
 * `[preview truncation]` sections of `ios/scripts/VerifyArchiveVectors.swift`, so a
 * divergence between the two platforms shows up as a failing test on one of them.
 */

package com.masselabs.zkproofport.openstoa

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class OpenStoaPushPayloadTest {

    private fun payload(vararg pairs: Pair<String, String>) = mapOf(*pairs)

    private val valid = payload(
        "topicId" to "t1",
        "messageId" to "m1",
        "act" to "AAAA",
        "tv" to "0",
        "ct" to "live-mls-ciphertext",
    )

    // ── field extraction ──────────────────────────────────────────────────────

    @Test
    fun `parses a complete payload`() {
        val push = OpenStoaPushPayload.parse(valid)!!
        assertEquals("t1", push.topicId)
        assertEquals("m1", push.messageId)
        assertEquals(0L, push.takVersion)
    }

    /** SI/§13.6: the live MLS ciphertext must never be picked up as the preview. */
    @Test
    fun `carries act and never ct`() {
        assertEquals("AAAA", OpenStoaPushPayload.parse(valid)!!.archivedCiphertext)
    }

    @Test
    fun `rejects a ct-only payload`() {
        assertNull(
            OpenStoaPushPayload.parse(
                payload("topicId" to "t", "messageId" to "m", "ct" to "live", "tv" to "0"),
            ),
        )
    }

    @Test
    fun `rejects missing or empty required fields`() {
        assertNull("missing tv", OpenStoaPushPayload.parse(payload("topicId" to "t", "messageId" to "m", "act" to "a")))
        assertNull("missing act", OpenStoaPushPayload.parse(payload("topicId" to "t", "messageId" to "m", "tv" to "0")))
        assertNull("empty act", OpenStoaPushPayload.parse(payload("topicId" to "t", "messageId" to "m", "act" to "", "tv" to "0")))
        assertNull("empty topic", OpenStoaPushPayload.parse(payload("topicId" to "", "messageId" to "m", "act" to "a", "tv" to "0")))
        assertNull("empty messageId", OpenStoaPushPayload.parse(payload("topicId" to "t", "messageId" to "", "act" to "a", "tv" to "0")))
        assertNull("empty payload", OpenStoaPushPayload.parse(emptyMap()))
    }

    @Test
    fun `accepts hostile-looking topic and message ids verbatim`() {
        val push = OpenStoaPushPayload.parse(
            payload(
                "topicId" to "토픽-🎉",
                "messageId" to "메시지-🆔",
                "act" to "a",
                "tv" to "3",
            ),
        )!!
        assertEquals("토픽-🎉", push.topicId)
        assertEquals("메시지-🆔", push.messageId)
        assertEquals(3L, push.takVersion)
    }

    // ── tv parsing ────────────────────────────────────────────────────────────

    @Test
    fun `tv accepts integers and rejects everything else`() {
        assertEquals(0L, OpenStoaPushPayload.intValue("0"))
        assertEquals(7L, OpenStoaPushPayload.intValue("7"))
        assertEquals(-1L, OpenStoaPushPayload.intValue("-1"))
        assertEquals(2147483648L, OpenStoaPushPayload.intValue("2147483648"))
        assertEquals(42L, OpenStoaPushPayload.intValue(" 42 "))

        assertNull("null", OpenStoaPushPayload.intValue(null))
        assertNull("empty", OpenStoaPushPayload.intValue(""))
        assertNull("blank", OpenStoaPushPayload.intValue("   "))
        assertNull("bool true", OpenStoaPushPayload.intValue("true"))
        assertNull("bool false", OpenStoaPushPayload.intValue("false"))
        assertNull("fractional", OpenStoaPushPayload.intValue("1.5"))
        assertNull("garbage", OpenStoaPushPayload.intValue("abc"))
        assertNull("hex", OpenStoaPushPayload.intValue("0x10"))
        assertNull("overflow", OpenStoaPushPayload.intValue("99999999999999999999"))
    }

    // ── the Expo envelope: data nested under `body` ───────────────────────────

    /**
     * What Expo's push service actually delivers: display text at the top level in
     * `title`/`message`, the server's `data` object as a JSON STRING under `body`
     * (Expo's own FCM v1 example, and what `expo-notifications`' `NotificationData`
     * reads). A handler that only looked at the top level would never see `act`.
     */
    @Test
    fun `unwraps the expo body envelope`() {
        val expo = payload(
            "title" to "OpenStoa",
            "message" to "New message",
            "body" to """{"topicId":"t2","messageId":"m2","epoch":4,"ct":"live","act":"BBBB","tv":9}""",
            "channelId" to "default",
        )
        val push = OpenStoaPushPayload.parse(expo)!!
        assertEquals("t2", push.topicId)
        assertEquals("m2", push.messageId)
        assertEquals(9L, push.takVersion)
        assertEquals("BBBB", push.archivedCiphertext)
    }

    @Test
    fun `unwrapped json numbers keep their integer form`() {
        val d = OpenStoaPushPayload.dataDictionary(payload("body" to """{"tv":0,"epoch":12}"""))
        assertEquals("0", d["tv"])
        assertEquals("12", d["epoch"])
        assertEquals(0L, OpenStoaPushPayload.intValue(d["tv"]))
    }

    @Test
    fun `unwrapped json booleans and floats are rejected as tv`() {
        assertNull(OpenStoaPushPayload.parse(payload("body" to """{"topicId":"t","messageId":"m","act":"a","tv":true}""")))
        assertNull(OpenStoaPushPayload.parse(payload("body" to """{"topicId":"t","messageId":"m","act":"a","tv":1.5}""")))
    }

    @Test
    fun `a non-object body falls through to the top level`() {
        // A direct (non-Expo) FCM sender puts the fields flat, and may use `body`
        // for something else entirely. Neither case may hide the flat fields.
        val flatWithAlertBody = payload(
            "body" to "New message",
            "topicId" to "t3",
            "messageId" to "m3",
            "act" to "CCCC",
            "tv" to "0",
        )
        assertEquals("t3", OpenStoaPushPayload.parse(flatWithAlertBody)!!.topicId)

        val jsonArrayBody = payload("body" to "[1,2,3]", "topicId" to "t4", "messageId" to "m4", "act" to "D", "tv" to "1")
        assertEquals("t4", OpenStoaPushPayload.parse(jsonArrayBody)!!.topicId)
    }

    @Test
    fun `an empty body object yields no fields`() {
        assertNull(OpenStoaPushPayload.parse(payload("body" to "{}")))
        assertTrue(OpenStoaPushPayload.dataDictionary(payload("body" to "{}")).isEmpty())
    }

    @Test
    fun `json null members are dropped rather than stringified`() {
        val d = OpenStoaPushPayload.dataDictionary(payload("body" to """{"act":null,"topicId":"t"}"""))
        assertNull(d["act"])
        assertEquals("t", d["topicId"])
    }

    @Test
    fun `a flat payload is passed through untouched`() {
        assertEquals(valid, OpenStoaPushPayload.dataDictionary(valid))
    }

    // ── preview truncation (display formatting, not log truncation) ───────────

    @Test
    fun `short previews are untouched`() {
        assertEquals("hi", Preview.truncateForDisplay("hi"))
        assertEquals("", Preview.truncateForDisplay(""))
        assertEquals("회의 3시 🎉", Preview.truncateForDisplay("회의 3시 🎉"))
    }

    @Test
    fun `a preview of exactly the cap is untouched`() {
        val exact = "a".repeat(Preview.MAX_CHARACTERS)
        assertEquals(exact, Preview.truncateForDisplay(exact))
    }

    @Test
    fun `a long preview is clamped and marked`() {
        val long = "가".repeat(Preview.MAX_CHARACTERS + 50)
        val truncated = Preview.truncateForDisplay(long)
        assertEquals(Preview.MAX_CHARACTERS + 1, truncated.length)
        assertTrue(truncated.endsWith("…"))
    }

    /** A 20k-char body must not be pasted into the shade in full. */
    @Test
    fun `a very large preview is clamped to the cap`() {
        val huge = "x".repeat(20_000)
        assertEquals(Preview.MAX_CHARACTERS + 1, Preview.truncateForDisplay(huge).length)
    }

    /**
     * Grapheme-safe: a flag emoji is two surrogate PAIRS (4 UTF-16 units). Slicing
     * by `String.length` would cut one in half and emit an unpaired surrogate.
     */
    @Test
    fun `truncation never splits a multi-scalar grapheme`() {
        val flags = "🇰🇷".repeat(Preview.MAX_CHARACTERS + 10)
        val truncated = Preview.truncateForDisplay(flags)
        // MAX_CHARACTERS flags × 4 UTF-16 units, plus the ellipsis.
        assertEquals(Preview.MAX_CHARACTERS * 4 + 1, truncated.length)
        assertTrue(truncated.endsWith("🇰🇷…"))
        // A UTF-8 round trip is the cheap proof that no unpaired surrogate leaked:
        // an orphaned half would come back as U+FFFD and break the equality.
        assertEquals(truncated, String(truncated.toByteArray(Charsets.UTF_8), Charsets.UTF_8))
    }

    /** A ZWJ sequence renders as ONE glyph and must be cut as one. */
    @Test
    fun `truncation never splits a ZWJ emoji sequence`() {
        val family = "👨‍👩‍👧" // 5 code points (3 emoji + 2 ZWJ) = 8 UTF-16 units, 1 cluster
        assertEquals(8, family.length)
        val truncated = Preview.truncateForDisplay(family.repeat(Preview.MAX_CHARACTERS + 10))
        assertEquals(Preview.MAX_CHARACTERS * 8 + 1, truncated.length)
        assertTrue(truncated.endsWith("$family…"))
    }

    /** Combining marks and skin tones attach to the base they decorate. */
    @Test
    fun `truncation keeps combining marks with their base`() {
        val decorated = "é" // e + combining acute
        val truncated = Preview.truncateForDisplay(decorated.repeat(Preview.MAX_CHARACTERS + 5))
        assertEquals(Preview.MAX_CHARACTERS * 2 + 1, truncated.length)
        assertTrue(truncated.endsWith("$decorated…"))

        val toned = "👋🏽" // waving hand + medium skin tone
        assertEquals(
            Preview.MAX_CHARACTERS * 4 + 1,
            Preview.truncateForDisplay(toned.repeat(Preview.MAX_CHARACTERS + 5)).length,
        )
    }

    /** Mixed scripts count one cluster each — no script gets a discount. */
    @Test
    fun `truncation counts multiscript text one cluster at a time`() {
        val mixed = "aあ한🎉"
        val truncated = Preview.truncateForDisplay(mixed.repeat(Preview.MAX_CHARACTERS))
        // 300 clusters = 75 repeats = 75 × (1+1+1+2) UTF-16 units, plus the ellipsis.
        assertEquals(75 * 5 + 1, truncated.length)
    }
}
