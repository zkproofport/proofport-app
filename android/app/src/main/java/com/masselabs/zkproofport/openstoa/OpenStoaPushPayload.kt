/*
 * OpenStoaPushPayload.kt
 * OpenStoa Android push — parsing of the ciphertext push payload (design §13.5).
 *
 * The Android twin of `proofport-app/ios/OpenStoaNSE/PushPayload.swift`, kept
 * deliberately free of Android framework imports so the whole thing runs in a
 * plain JVM unit test alongside the crypto.
 */

package com.masselabs.zkproofport.openstoa

import org.json.JSONObject

/** The fields of a chat push the handler needs in order to build a preview. */
data class ArchivePush(
    /** Topic (= MLS group) the message belongs to. Selects the stored TAK. */
    val topicId: String,
    /**
     * Server-assigned message id. Used as the SECONDARY archive context (see
     * [OpenStoaArchive.openPushPreview]) and, on the tap side, as part of the
     * de-duplication key.
     */
    val messageId: String,
    /**
     * TAK version: 0 = the topic's public archive root key, otherwise the MLS
     * epoch whose per-epoch TAK sealed this copy.
     */
    val takVersion: Long,
    /**
     * Base64 of nonce‖ciphertext‖tag for the TAK-ARCHIVED copy (`act`).
     *
     * Deliberately NOT the live MLS `ct`: opening `ct` would consume a
     * forward-secret ratchet key and desync the main app (design §13.6).
     */
    val archivedCiphertext: String,
)

object OpenStoaPushPayload {
    /**
     * Unwrap the Expo push envelope.
     *
     * Expo's push service does NOT splice the message's `data` into the top level
     * of the FCM data payload — it nests it under a `body` key holding a JSON
     * STRING, and puts the display text in `title`/`message`. That layout is what
     * Expo documents for a hand-rolled FCM v1 sender
     * (docs/pages/push-notifications/sending-notifications-custom.mdx) and what
     * `expo-notifications`' own `NotificationData` reads. A handler looking at
     * `data["topicId"]` directly would therefore find nothing and never render a
     * preview.
     *
     * Both shapes are accepted because both occur: the nested Expo envelope, and
     * a flat payload from a direct (non-Expo) FCM sender. Anything unrecognised
     * — a `body` that is not a JSON object, e.g. an alert string or a JSON array
     * — falls through to the top level rather than discarding a payload that may
     * well be flat.
     */
    fun dataDictionary(data: Map<String, String>): Map<String, String> {
        val body = data["body"] ?: return data
        val json = try {
            JSONObject(body)
        } catch (_: Exception) {
            return data
        }
        val out = HashMap<String, String>(json.length())
        for (key in json.keys()) {
            val value = json.get(key)
            if (value === JSONObject.NULL) continue
            // JSON numbers/booleans arrive as Integer/Long/Double/Boolean; render
            // them as their decimal/literal text so the map stays String→String.
            // `intValue` below is what rejects the ones that are not integers.
            out[key] = if (value is String) value else value.toString()
        }
        return out
    }

    /**
     * Extract the archive fields, or null when any is missing or empty — in which
     * case the handler keeps the content-free placeholder rather than guessing.
     *
     * Note the deliberate absence of any `ct` read: the live MLS ciphertext is off
     * limits here (design §13.6).
     */
    fun parse(data: Map<String, String>): ArchivePush? {
        val d = dataDictionary(data)
        val topicId = d["topicId"]?.takeIf { it.isNotEmpty() } ?: return null
        val messageId = d["messageId"]?.takeIf { it.isNotEmpty() } ?: return null
        val archived = d["act"]?.takeIf { it.isNotEmpty() } ?: return null
        val takVersion = intValue(d["tv"]) ?: return null
        return ArchivePush(topicId, messageId, takVersion, archived)
    }

    /**
     * Parse a `tv` that may have arrived as a JSON number or as a string. Rejects
     * booleans and fractional values, which would select the wrong stored key.
     * Values outside `Long` are rejected rather than wrapped.
     */
    fun intValue(raw: String?): Long? {
        val s = raw?.trim() ?: return null
        if (s.isEmpty() || s == "true" || s == "false") return null
        return s.toLongOrNull()
    }
}

object Preview {
    /**
     * Upper bound on the preview written into the notification body. This is UI
     * text, not a log line, so trimming it is display formatting rather than the
     * log truncation the repo forbids: the shade renders only a few lines anyway
     * and an unbounded body just wastes the handler's memory budget. Same value as
     * the iOS `Preview.maxCharacters` so the two platforms clamp identically.
     */
    const val MAX_CHARACTERS = 300

    /**
     * Clamp to [MAX_CHARACTERS] grapheme clusters so a long message cannot split
     * an emoji or a composed Hangul syllable mid-character. Kotlin's `String`
     * indexes UTF-16 code units, so slicing by `length` would cut a surrogate
     * pair in half and emit an unpaired surrogate.
     *
     * `java.text.BreakIterator.getCharacterInstance()` is deliberately NOT used:
     * it is a legacy clusterer that treats each regional indicator as its own
     * cluster, so it splits a flag (🇰🇷 = two regional indicators) down the middle
     * — measured, not assumed: it reported 300 clusters for 150 flags. Swift's
     * `Character` applies UAX #29, so the iOS truncation keeps the flag whole.
     * [clusterBoundaries] implements the part of UAX #29 that difference turns on.
     */
    fun truncateForDisplay(text: String): String {
        // `clusterBoundaries` ends with the string length, so it holds one more
        // entry than there are clusters.
        val boundaries = clusterBoundaries(text)
        if (boundaries.size - 1 <= MAX_CHARACTERS) return text
        return text.substring(0, boundaries[MAX_CHARACTERS]) + "…"
    }

    /**
     * Offsets at which a new grapheme cluster STARTS, in UTF-16 code units, plus
     * a final entry for the end of the string. A cluster is a base code point
     * followed by everything that visually attaches to it: combining marks,
     * variation selectors, skin-tone modifiers, keycaps, ZWJ-joined sequences,
     * the second half of a regional-indicator pair, and the LF of a CRLF.
     *
     * Not a complete UAX #29 implementation (no Indic conjunct or Hangul jamo
     * composition rules) — it covers what this is for: never cutting a preview in
     * the middle of something a reader sees as one character.
     */
    private fun clusterBoundaries(text: String): List<Int> {
        val starts = ArrayList<Int>(text.length + 1)
        var index = 0
        var previous = -1
        // Regional indicators pair up, so whether the NEXT one joins or starts a
        // flag of its own depends on how many are already in this cluster.
        var pendingRegionalIndicators = 0
        while (index < text.length) {
            val cp = text.codePointAt(index)
            val extends = previous >= 0 && when {
                cp == ZWJ -> true
                previous == ZWJ -> true
                cp == 0x0A && previous == 0x0D -> true
                cp in 0xFE00..0xFE0F -> true // variation selectors
                cp in 0x1F3FB..0x1F3FF -> true // skin-tone modifiers
                cp == 0x20E3 -> true // combining enclosing keycap
                isCombiningMark(cp) -> true
                isRegionalIndicator(cp) -> pendingRegionalIndicators % 2 == 1
                else -> false
            }
            if (!extends) {
                starts.add(index)
                pendingRegionalIndicators = 0
            }
            if (isRegionalIndicator(cp)) pendingRegionalIndicators++ else pendingRegionalIndicators = 0
            previous = cp
            index += Character.charCount(cp)
        }
        starts.add(text.length)
        return starts
    }

    private const val ZWJ = 0x200D

    private fun isRegionalIndicator(cp: Int) = cp in 0x1F1E6..0x1F1FF

    private fun isCombiningMark(cp: Int) = when (Character.getType(cp).toByte()) {
        Character.NON_SPACING_MARK,
        Character.ENCLOSING_MARK,
        Character.COMBINING_SPACING_MARK,
        -> true
        else -> false
    }
}
