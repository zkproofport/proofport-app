//
//  ChatMediaEnvelope.swift
//  OpenStoaNSE — reading an ATTACHMENT reference out of a decrypted push preview
//
//  ⚠️ SOURCE OF TRUTH FOR EVERYTHING IN THIS FILE IS TYPESCRIPT ⚠️
//
//      openstoa/packages/mls/src/chatMedia.ts
//
//  That is ONE file, compiled by the web app, the mini-app and the SDK —
//  three clients, one implementation, reached through re-export files at
//  `src/lib/chatMedia.ts`, `packages/mobile/src/lib/chatMedia.ts` and
//  `packages/sdk/src/chatMedia.ts`. This file is the FOURTH language the same
//  rules exist in, and it cannot import them. Everything restated below is therefore a
//  hand-carried constant, which is precisely the kind of duplication that
//  silently rots: a prefix bumped to `v2` in TypeScript would not fail to
//  compile here, it would just stop matching, and every attachment push would
//  quietly degrade to a placeholder with nothing in any log to say why.
//
//  Two things hold it together, and BOTH must be kept working:
//    1. Every restated constant appears exactly ONCE in this target. Nothing
//       else in OpenStoaNSE may spell out the prefix, the key shape or the
//       media AEAD context — they read them from here.
//    2. `openstoa/scripts/gen-archive-vectors.ts` emits `media` vectors built by
//       the REAL TypeScript, and `ios/scripts/verify_archive_vectors.sh`
//       compiles this file on macOS and checks it reproduces them.
//       `openstoa/src/__tests__/nativeChatMediaConstants.test.ts` additionally
//       reads THIS file and fails if the constants below drift from the
//       TypeScript ones. Change chatMedia.ts and one of the two goes red.
//
//  Deliberately Foundation-only (no UserNotifications, no Security) so the
//  vector verifier can compile it standalone with `swiftc`.
//

import Foundation

/// The attachment reference carried inside a sealed chat message body.
/// Mirrors `ChatMediaEnvelope` in chatMedia.ts.
struct ChatMediaEnvelope: Equatable {
  /// R2 object key of the CIPHERTEXT, always inside the pushed topic.
  let key: String
  /// Client-generated AEAD context id (32 lowercase hex). Not the key.
  let mediaId: String
  /// TAK version the BYTES were sealed under. Independent of the push's `tv`,
  /// which is the version the message PREVIEW was sealed under.
  let takVersion: Int
  /// Decrypted content type, so nothing has to sniff the plaintext.
  let mime: String
  /// Plaintext byte length. Bounds the work before any of it is done.
  let size: Int
}

enum ChatMedia {
  // MARK: - Restated from chatMedia.ts (see the file header)

  /// `CHAT_MEDIA_BODY_PREFIX`. A prefix rather than bare JSON, because a member
  /// can type `{"v":1,…}` into the composer and a body that merely parses as
  /// JSON must never make a client fetch anything.
  static let bodyPrefix = "openstoa:media:v1:"

  /// `MAX_CHAT_MEDIA_BYTES` — the plaintext cap both senders enforce.
  ///
  /// Not a round 10MB: the framework caps a buffered request body at 10MB, so
  /// the reachable plaintext maximum is that ceiling minus the AEAD frame and a
  /// 5% margin. It rose from 7_471_076 when the transport stopped being base64
  /// inside JSON — that framing spent a third of the ceiling on the 4/3
  /// expansion. Kept in step with `chatMedia.ts` by `nativeChatMediaConstants`.
  static let maxPlaintextBytes = 9_961_444

  /// `CHAT_MEDIA_AEAD_OVERHEAD_BYTES` — 12-byte AES-GCM nonce + 16-byte tag.
  /// Restated because `maxResponseBytes` below is derived from it now that a
  /// response is the ciphertext itself rather than a JSON wrapper around it.
  static let aeadOverheadBytes = 28

  /// `CHAT_MEDIA_MIME_ALLOWLIST`.
  static let mimeAllowlist = ["image/jpeg", "image/png", "image/gif", "image/webp", "image/bmp"]

  /// `OBJECT_KEY_RE` — the shape of `chatMediaObjectKey(topicId, userId, mediaId)`.
  private static let objectKeyPattern =
    "^topics/[0-9a-fA-F-]{36}/chat/([A-Za-z0-9_-]{1,128})/([0-9a-f]{32})\\.bin$"

  /// `MEDIA_ID_RE`.
  private static let mediaIdPattern = "^[0-9a-f]{32}$"

  /// `mediaContextId` in takClient.ts: the AEAD context an attachment's BYTES
  /// are sealed under. The `media:` prefix keeps that namespace disjoint from
  /// message ids, so the same TAK can never derive one key for both.
  static func mediaContextId(_ mediaId: String) -> String {
    return "media:\(mediaId)"
  }

  /// `chatMediaObjectKey`. Used to REBUILD a key and compare it whole, which is
  /// stricter than a prefix match and cannot drift from the shape above.
  static func objectKey(topicId: String, userId: String, mediaId: String) -> String {
    return "topics/\(topicId)/chat/\(userId)/\(mediaId).bin"
  }

  // MARK: - NSE-specific budget

  /**
   An NSE is capped at ~24MB of memory and ~30s of wall clock, and it is killed
   outright — with no notification delivered — the instant it crosses the memory
   line. So the ceiling here is not a preference, it is what keeps a large
   attachment from turning a working text notification into no notification.

   The transport is now the raw ciphertext, so a plaintext of N bytes costs
   roughly N (the bytes read off disk) + N (the plaintext) ≈ 2N resident, down
   from ~3.4N when the response was base64 inside JSON and the string had to
   exist before the bytes did. At 2MB that is ~4MB of peak, which leaves the
   rest of the budget for URLSession and the runtime.

   The ceiling stays at 2MB rather than rising with the saving. It is a budget
   for an extension that is KILLED on breach — delivering no notification at
   all — and spending a newly-won margin on a bigger thumbnail is the wrong
   trade for it.

   Above the ceiling the fetch is SKIPPED — not attempted and abandoned — and
   the recipient still gets the "📷 Photo" notification and the picture in the
   app on tap. Raising this number means changing the transport first (download
   to a file, memory-map it, decode incrementally), not just editing it.
   */
  static let maxPreviewPlaintextBytes = 2 * 1024 * 1024

  /// Is this attachment small enough to open inside the extension's budget?
  static func isWithinPreviewBudget(_ envelope: ChatMediaEnvelope) -> Bool {
    return envelope.size <= maxPreviewPlaintextBytes
  }

  /**
   Hard cap on the RESPONSE, independent of what the envelope claimed.

   `size` is written by the sender, so it is not a bound — a body claiming 4KB
   can name an object holding the 10MB the upload route allows, and the check
   above would wave it through. Believing that number is how a "budget" turns
   into a crash: the extension is killed at ~24MB and the recipient gets NO
   notification, so a hostile member would have a one-line way to silence
   someone's phone.

   The transport is the ciphertext itself, so an honest response for a plaintext
   at the preview ceiling is exactly that ceiling plus the AEAD frame — which
   makes this bound EXACT rather than the 2x slack the base64-in-JSON framing
   needed. Enforced against the file on DISK before any of it is read into
   memory, which is what makes it a real bound rather than a check that runs
   after the damage.
   */
  static let maxResponseBytes = maxPreviewPlaintextBytes + aeadOverheadBytes

  // MARK: - Parsing

  /// Whether a decrypted body is an attachment envelope, without paying for a
  /// parse. Mirrors `isChatMediaBody`.
  ///
  /// This is the check that decides whether a plaintext may be shown AS TEXT.
  /// Anything true here must never reach a notification body.
  static func isMediaBody(_ body: String) -> Bool {
    return body.hasPrefix(bodyPrefix)
  }

  /**
   Read an envelope out of a message body, or nil for anything else — ordinary
   text, a hostile imitation, a truncated envelope, a future version. Mirrors
   `parseChatMediaBody`, INCLUDING the topic check `isChatMediaKeyForTopic`
   performs separately: the key arrives from inside a body any member could have
   written, so a body naming another topic's object is refused here rather than
   relying on the server to refuse it later.

   nil never means "show the JSON". The caller's contract is that a body which
   `isMediaBody` accepts is never rendered as text, whatever this returns.
   */
  static func parse(body: String, topicId: String) -> ChatMediaEnvelope? {
    guard body.hasPrefix(bodyPrefix) else { return nil }
    let json = String(body.dropFirst(bodyPrefix.count))
    guard
      let parsed = try? JSONSerialization.jsonObject(with: Data(json.utf8)),
      let e = parsed as? [String: Any]
    else { return nil }

    // `v` is the envelope version. A different one is a different shape, so it
    // falls through to "not something this build understands".
    guard integer(e["v"]) == 1 else { return nil }

    guard let key = e["key"] as? String, !key.contains(".."),
          let match = objectKeyMatch(key)
    else { return nil }
    guard let mediaId = e["mediaId"] as? String, matches(mediaIdPattern, mediaId) else { return nil }
    guard let takVersion = integer(e["takVersion"]), takVersion >= 0 else { return nil }
    guard let mime = e["mime"] as? String, mimeAllowlist.contains(mime) else { return nil }
    guard let size = integer(e["size"]), size > 0, size <= maxPlaintextBytes else { return nil }

    // The key embeds the AEAD context, so an envelope naming one media id and a
    // key ending in another is inconsistent by construction — a hand-edited body.
    guard key.hasSuffix("/\(mediaId).bin") else { return nil }

    // Rebuilt and compared WHOLE: this is what confines the reference to the
    // topic the push is about, so one member cannot make another member's
    // extension fetch an object from a topic it is reading on their behalf.
    guard key == objectKey(topicId: topicId, userId: match.userSegment, mediaId: match.mediaId) else {
      return nil
    }
    return ChatMediaEnvelope(key: key, mediaId: mediaId, takVersion: takVersion, mime: mime, size: size)
  }

  // MARK: - Transport

  /// The membership-gated read route for one attachment.
  /// `GET {base}/api/topics/{topicId}/chat/media?key={key}` — mirrors what both
  /// clients call. Returns nil for a base URL that is not an absolute http(s)
  /// origin, so a corrupted mirror entry cannot send a bearer token anywhere.
  static func mediaURL(baseUrl: String, topicId: String, key: String) -> URL? {
    let trimmed = baseUrl.hasSuffix("/") ? String(baseUrl.dropLast()) : baseUrl
    guard let base = URL(string: trimmed),
          let scheme = base.scheme?.lowercased(),
          scheme == "https" || scheme == "http",
          base.host != nil
    else { return nil }
    var components = URLComponents(string: "\(trimmed)/api/topics/\(topicId)/chat/media")
    components?.queryItems = [URLQueryItem(name: "key", value: key)]
    return components?.url
  }

  /**
   The ciphertext out of the read route's response body.

   The body IS the ciphertext now — `application/octet-stream`, no wrapper. It
   used to be `{ "ciphertext": "<base64>" }`, a shape that existed because React
   Native could not receive binary over `fetch`; this extension never needed it
   and paid for it anyway, in a JSON parse and a base64 decode over megabytes
   inside a ~24MB memory budget.

   Still a function rather than an inline `Data(contentsOf:)` at the call site,
   for two reasons: the emptiness check is the one that stops a zero-length
   "success" reaching the decryptor, and there is exactly one place to change if
   the framing ever moves again.

   nil for an empty body. A non-200 is refused by the caller before this runs,
   so an error JSON or an HTML error page never reaches here — and if one did,
   it would fail to authenticate under the AEAD rather than be mistaken for a
   picture.
   */
  static func ciphertext(fromResponseBody data: Data) -> Data? {
    return data.isEmpty ? nil : data
  }

  /// Filename extension for a decrypted attachment. iOS decides an attachment's
  /// type from the file extension (or an explicit type hint), and a file with
  /// the wrong one is rejected wholesale rather than sniffed.
  static func fileExtension(forMime mime: String) -> String? {
    switch mime {
    case "image/jpeg": return "jpg"
    case "image/png": return "png"
    case "image/gif": return "gif"
    case "image/webp": return "webp"
    case "image/bmp": return "bmp"
    default: return nil
    }
  }

  /**
   What the notification says for an attachment.

   Not the envelope, and not an empty string. There is no caption field in the
   envelope today, so this is the honest whole of what the sender's body says:
   somebody sent a picture. It is also what shows when the fetch, the key, the
   budget or the attachment write fails — the recipient is told the same true
   thing either way, and only the thumbnail differs.
   */
  static let attachmentBody = "📷 Photo"

  // MARK: - Helpers

  private struct ObjectKeyMatch {
    let userSegment: String
    let mediaId: String
  }

  private static func objectKeyMatch(_ key: String) -> ObjectKeyMatch? {
    guard let re = try? NSRegularExpression(pattern: objectKeyPattern) else { return nil }
    let range = NSRange(key.startIndex..<key.endIndex, in: key)
    guard let m = re.firstMatch(in: key, range: range), m.numberOfRanges == 3,
          let userRange = Range(m.range(at: 1), in: key),
          let mediaRange = Range(m.range(at: 2), in: key)
    else { return nil }
    return ObjectKeyMatch(userSegment: String(key[userRange]), mediaId: String(key[mediaRange]))
  }

  private static func matches(_ pattern: String, _ value: String) -> Bool {
    guard let re = try? NSRegularExpression(pattern: pattern) else { return false }
    let range = NSRange(value.startIndex..<value.endIndex, in: value)
    return re.firstMatch(in: value, range: range) != nil
  }

  /**
   A JSON integer, or nil.

   Stricter than `PushPayload.intValue` on purpose: that one accepts `"3"`
   because an APNs payload is built by transports we do not control, whereas
   this JSON is written by `buildChatMediaBody` and read by a TypeScript parser
   that requires `typeof === 'number'`. Accepting a string here would make the
   Swift parser admit envelopes the other three clients reject, and a validator
   that is more permissive than its source of truth is not a mirror.
   */
  private static func integer(_ raw: Any?) -> Int? {
    guard let n = raw as? NSNumber else { return nil }
    // `Bool` bridges to NSNumber too; `true` is not 1 here.
    if CFGetTypeID(n) == CFBooleanGetTypeID() { return nil }
    let i = n.intValue
    return NSNumber(value: i) == n ? i : nil
  }
}

/**
 The credential the extension uses to fetch an attachment.

 The read route is membership-gated — correctly, since a public object URL would
 be an unauthenticated handle that outlives every membership check — so the NSE
 has to present the same session the mini-app does. It cannot ask the app for
 one (different process, app not running), so the mini-app mirrors it into the
 same shared Keychain group it already mirrors TAKs into.

 Keyed by TOPIC rather than stored once, for the same reason the TAK is: the
 host owns ONE APNs token but the mini-app may hold several session nullifiers,
 and the push carries no nullifier. The entry mirrored for a topic is by
 construction the session that is a member of it (§13.6).
 */
struct PushSession: Equatable {
  let baseUrl: String
  let token: String

  /// Parse `{"baseUrl":"…","token":"…"}` as written by `mirrorPushSessionWith`
  /// in `openstoa/packages/mobile/src/crypto/sharedKeychain.ts`.
  static func parse(_ raw: Data) -> PushSession? {
    guard
      let parsed = try? JSONSerialization.jsonObject(with: raw),
      let object = parsed as? [String: Any],
      let baseUrl = object["baseUrl"] as? String, !baseUrl.isEmpty,
      let token = object["token"] as? String, !token.isEmpty
    else { return nil }
    return PushSession(baseUrl: baseUrl, token: token)
  }
}
