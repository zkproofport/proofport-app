//
//  VerifyArchiveVectors.swift
//  Cross-implementation known-answer test for the OpenStoa NSE archive decryptor.
//
//  A green Xcode build proves the extension compiles; it proves nothing about
//  whether the Swift key schedule agrees with the TypeScript one. This harness
//  loads `archive_vectors.json` — sealed by openstoa's `sealArchive` — and
//  requires the Swift `OpenStoaArchive.open` to reproduce every plaintext, and
//  to REJECT every corrupted variant.
//
//  Run via `ios/scripts/verify_archive_vectors.sh` (compiles this together with
//  the extension's Foundation-only sources; the extension's iOS-only
//  UserNotifications/Security files are not linked here).
//

import Foundation

private struct VectorFile: Decodable {
  struct Meta: Decodable {
    let suite: String
    let kdfSize: Int
    let nonceLength: Int
    let aeadKeyLength: Int
    /// `CHAT_MEDIA_BODY_PREFIX` / `MAX_CHAT_MEDIA_BYTES` as chatMedia.ts spells
    /// them. Swift restates both; these are what catch it drifting.
    let mediaBodyPrefix: String
    let maxChatMediaBytes: Int
    /// The `{userId}` segment the media object keys in this file were built
    /// with, so a key can be rebuilt here the way the port rebuilds it.
    let mediaUserSegment: String
  }
  struct Vector: Decodable {
    let name: String
    let messageId: String
    let sealed: String
    let plaintext: String
  }
  struct Negative: Decodable {
    let name: String
    let messageId: String
    let sealed: String
  }
  /// An envelope from `buildChatMediaBody` plus the bytes it references, sealed
  /// by `sealMediaBytes`. Swift must parse the one and open the other.
  struct Media: Decodable {
    struct Envelope: Decodable {
      let key: String
      let mediaId: String
      let takVersion: Int
      let mime: String
      let size: Int
    }
    let name: String
    let topicId: String
    let body: String
    let envelope: Envelope
    let sealed: String
    let plaintextBase64: String
  }
  /// Bodies with the outcome the REAL `parseChatMediaBody` produced for them.
  struct MediaBody: Decodable {
    let name: String
    let topicId: String
    let body: String
    let isMediaBody: Bool
    let valid: Bool
    let envelope: Media.Envelope?
  }
  let meta: Meta
  let takBase64: String
  let vectors: [Vector]
  /// Sealed under the fixed `push-preview` context, not under `messageId`.
  let pushPreviews: [Vector]
  let negatives: [Negative]
  let media: [Media]
  let mediaBodies: [MediaBody]
}

private var failures: [String] = []
private var checks = 0

private func check(_ label: String, _ condition: Bool, _ detail: @autoclosure () -> String = "") {
  checks += 1
  if condition {
    print("  ok   \(label)")
  } else {
    let d = detail()
    print("  FAIL \(label)\(d.isEmpty ? "" : " — \(d)")")
    failures.append(label)
  }
}

@main
enum VerifyArchiveVectors {
  static func main() {
    exit(run())
  }
}

private func run() -> Int32 {
  let here = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
  let vectorURL = here.appendingPathComponent("archive_vectors.json")

  guard let data = try? Data(contentsOf: vectorURL),
        let file = try? JSONDecoder().decode(VectorFile.self, from: data)
  else {
    print("FATAL: cannot read \(vectorURL.path)")
    return 1
  }
  guard let tak = Data(base64Encoded: file.takBase64) else {
    print("FATAL: takBase64 is not valid base64")
    return 1
  }

  print("vector file: \(vectorURL.path)")
  print("suite:       \(file.meta.suite)")
  print("")

  print("[suite parameters — the Swift port hardcodes these]")
  check("kdfSize == OpenStoaArchive.takLength",
        file.meta.kdfSize == OpenStoaArchive.takLength,
        "json=\(file.meta.kdfSize) swift=\(OpenStoaArchive.takLength)")
  check("nonceLength == OpenStoaArchive.nonceLength",
        file.meta.nonceLength == OpenStoaArchive.nonceLength,
        "json=\(file.meta.nonceLength) swift=\(OpenStoaArchive.nonceLength)")
  check("aeadKeyLength == OpenStoaArchive.archiveKeyLength",
        file.meta.aeadKeyLength == OpenStoaArchive.archiveKeyLength,
        "json=\(file.meta.aeadKeyLength) swift=\(OpenStoaArchive.archiveKeyLength)")
  check("tak is \(OpenStoaArchive.takLength) bytes", tak.count == OpenStoaArchive.takLength)

  print("")
  print("[positive vectors — Swift must reproduce the TypeScript plaintext]")
  for v in file.vectors {
    let got = OpenStoaArchive.open(tak: tak, messageId: v.messageId, sealedBase64: v.sealed)
    let detail: String
    if got == nil {
      detail = "decrypt returned nil"
    } else if got != v.plaintext {
      detail = "got \(got!.count) chars, want \(v.plaintext.count) chars"
    } else {
      detail = ""
    }
    check("decrypt/\(v.name)", got == v.plaintext, detail)
  }

  print("")
  print("[push-preview vectors — what the sender actually puts in `act`]")
  for v in file.pushPreviews {
    // openPushPreview must bind the fixed `push-preview` context, NOT v.messageId.
    // The message id here is deliberately unrelated to the seal: a port that opens
    // `act` with it derives a different key and every push silently degrades.
    let got = OpenStoaArchive.openPushPreview(tak: tak, messageId: v.messageId, sealedBase64: v.sealed)
    check("push/\(v.name)", got == v.plaintext, got == nil ? "returned nil" : "plaintext mismatch")

    // The plain per-message open MUST fail on this blob — that is exactly the bug
    // this section exists to catch.
    check("push/\(v.name)/msgid-open-fails",
          OpenStoaArchive.open(tak: tak, messageId: v.messageId, sealedBase64: v.sealed) == nil,
          "a message-id open unexpectedly succeeded")
  }

  print("")
  print("[negative vectors — Swift must return nil, never a garbage preview]")
  for n in file.negatives {
    let got = OpenStoaArchive.open(tak: tak, messageId: n.messageId, sealedBase64: n.sealed)
    check("reject/\(n.name)", got == nil, got.map { "unexpectedly decrypted to \"\($0)\"" } ?? "")
  }

  print("")
  print("[key-material edge cases]")
  let base = file.vectors[0]
  check("reject/tak_31_bytes",
        OpenStoaArchive.open(tak: tak.prefix(31), messageId: base.messageId, sealedBase64: base.sealed) == nil)
  check("reject/tak_33_bytes",
        OpenStoaArchive.open(tak: tak + Data([0]), messageId: base.messageId, sealedBase64: base.sealed) == nil)
  check("reject/tak_empty",
        OpenStoaArchive.open(tak: Data(), messageId: base.messageId, sealedBase64: base.sealed) == nil)
  var flipped = tak
  flipped[0] ^= 0x01
  check("reject/tak_one_bit_off",
        OpenStoaArchive.open(tak: flipped, messageId: base.messageId, sealedBase64: base.sealed) == nil)
  check("reject/empty_message_id",
        OpenStoaArchive.open(tak: tak, messageId: "", sealedBase64: base.sealed) == nil)
  check("archiveKey rejects short tak", OpenStoaArchive.archiveKey(tak: tak.prefix(31), messageId: "m") == nil)
  check("archiveKey accepts 32-byte tak", OpenStoaArchive.archiveKey(tak: tak, messageId: "m") != nil)

  print("")
  print("[push payload parsing]")
  let good: [AnyHashable: Any] = ["topicId": "t1", "messageId": "m1", "act": "AAAA", "tv": 0, "ct": "live-mls"]
  check("parse/valid_tv_number", PushPayload.parse(good)?.takVersion == 0)
  check("parse/never_reads_ct",
        PushPayload.parse(good)?.archivedCiphertext == "AAAA",
        "must carry `act`, not `ct`")
  check("parse/tv_as_string",
        PushPayload.parse(["topicId": "t", "messageId": "m", "act": "a", "tv": "7"])?.takVersion == 7)
  check("parse/tv_negative",
        PushPayload.parse(["topicId": "t", "messageId": "m", "act": "a", "tv": -1])?.takVersion == -1)
  check("parse/tv_large",
        PushPayload.parse(["topicId": "t", "messageId": "m", "act": "a", "tv": 2_147_483_648])?.takVersion == 2_147_483_648)
  check("parse/reject_missing_tv",
        PushPayload.parse(["topicId": "t", "messageId": "m", "act": "a"]) == nil)
  check("parse/reject_missing_act",
        PushPayload.parse(["topicId": "t", "messageId": "m", "tv": 0]) == nil)
  check("parse/reject_empty_act",
        PushPayload.parse(["topicId": "t", "messageId": "m", "act": "", "tv": 0]) == nil)
  check("parse/reject_empty_topic",
        PushPayload.parse(["topicId": "", "messageId": "m", "act": "a", "tv": 0]) == nil)
  check("parse/reject_empty_message_id",
        PushPayload.parse(["topicId": "t", "messageId": "", "act": "a", "tv": 0]) == nil)
  check("parse/reject_ct_only",
        PushPayload.parse(["topicId": "t", "messageId": "m", "ct": "live", "tv": 0]) == nil)
  check("parse/reject_tv_bool",
        PushPayload.parse(["topicId": "t", "messageId": "m", "act": "a", "tv": true]) == nil)
  check("parse/reject_tv_fractional",
        PushPayload.parse(["topicId": "t", "messageId": "m", "act": "a", "tv": 1.5]) == nil)
  check("parse/reject_tv_garbage_string",
        PushPayload.parse(["topicId": "t", "messageId": "m", "act": "a", "tv": "abc"]) == nil)
  check("parse/reject_empty_payload", PushPayload.parse([:]) == nil)
  check("parse/utf8_topic_and_message_id",
        PushPayload.parse(["topicId": "토픽-🎉", "messageId": "메시지-🆔", "act": "a", "tv": 3])?.topicId == "토픽-🎉")

  print("")
  print("[expo push envelope — data is nested under userInfo[\"body\"]]")
  // Exactly what Expo's push service delivers for the server's `data` object.
  let expoDict: [AnyHashable: Any] = [
    "aps": ["alert": ["title": "OpenStoa", "body": "New message"], "mutable-content": 1],
    "body": ["topicId": "t1", "messageId": "m1", "act": "AAAA", "tv": 4, "ct": "live-mls"],
    "experienceId": "@zkproofport/proofport-app",
  ]
  check("expo/dict_body_is_unwrapped", PushPayload.parse(expoDict)?.takVersion == 4)
  check("expo/dict_body_reads_act", PushPayload.parse(expoDict)?.archivedCiphertext == "AAAA")
  check("expo/dict_body_reads_topic", PushPayload.parse(expoDict)?.topicId == "t1")

  let expoString: [AnyHashable: Any] = [
    "body": #"{"topicId":"t2","messageId":"m2","act":"BBBB","tv":9}"#,
  ]
  check("expo/json_string_body_is_unwrapped", PushPayload.parse(expoString)?.takVersion == 9)
  check("expo/json_string_body_reads_topic", PushPayload.parse(expoString)?.topicId == "t2")

  // A direct APNs sender puts the fields at the top level; that must still work.
  check("expo/top_level_still_works", PushPayload.parse(good)?.topicId == "t1")
  // A non-dict, non-JSON `body` (e.g. an alert string) must not hide top-level fields.
  check("expo/opaque_body_falls_through_to_top_level",
        PushPayload.parse(["body": "New message", "topicId": "t3", "messageId": "m3", "act": "CCCC", "tv": 0])?.topicId == "t3")
  check("expo/empty_body_dict_yields_nil", PushPayload.parse(["body": [String: String]()]) == nil)
  check("expo/body_json_array_falls_through", PushPayload.parse(["body": "[1,2,3]"]) == nil)

  print("")
  print("[keychain account key]")
  check("account/root_key_version_0",
        TakKeychain.account(topicId: "01JQZ8T", takVersion: 0) == "openstoa.tak.01JQZ8T.0")
  check("account/epoch_version",
        TakKeychain.account(topicId: "01JQZ8T", takVersion: 42) == "openstoa.tak.01JQZ8T.42")

  print("")
  print("[preview truncation]")
  let long = String(repeating: "가", count: Preview.maxCharacters + 50)
  let truncated = Preview.truncateForDisplay(long)
  check("truncate/long_is_clamped", truncated.count == Preview.maxCharacters + 1)
  check("truncate/long_has_ellipsis", truncated.hasSuffix("…"))
  check("truncate/exact_length_untouched",
        Preview.truncateForDisplay(String(repeating: "a", count: Preview.maxCharacters)).count == Preview.maxCharacters)
  check("truncate/short_untouched", Preview.truncateForDisplay("hi") == "hi")
  check("truncate/empty_untouched", Preview.truncateForDisplay("") == "")
  // Grapheme-safe: a flag emoji is 2 scalars; slicing by Character must not split it.
  let flags = String(repeating: "🇰🇷", count: Preview.maxCharacters + 10)
  check("truncate/does_not_split_emoji",
        Preview.truncateForDisplay(flags).unicodeScalars.count == Preview.maxCharacters * 2 + 1)

  print("")
  print("[chat media — constants restated from chatMedia.ts]")
  // The whole reason this section exists: a `v2` bump in TypeScript would not
  // fail to compile in Swift, it would just stop matching, and every attachment
  // push would degrade to a placeholder with nothing to say why.
  check("media/prefix_matches_typescript",
        file.meta.mediaBodyPrefix == ChatMedia.bodyPrefix,
        "json=\"\(file.meta.mediaBodyPrefix)\" swift=\"\(ChatMedia.bodyPrefix)\"")
  check("media/max_bytes_matches_typescript",
        file.meta.maxChatMediaBytes == ChatMedia.maxPlaintextBytes,
        "json=\(file.meta.maxChatMediaBytes) swift=\(ChatMedia.maxPlaintextBytes)")

  print("")
  print("[chat media — envelope + bytes round-trip]")
  for m in file.media {
    guard let want = Data(base64Encoded: m.plaintextBase64), let sealed = Data(base64Encoded: m.sealed) else {
      check("media/\(m.name)/fixture_decodes", false, "vector file is not valid base64")
      continue
    }
    let parsed = ChatMedia.parse(body: m.body, topicId: m.topicId)
    check("media/\(m.name)/body_parses", parsed != nil, "Swift refused a body TypeScript built")
    check("media/\(m.name)/key", parsed?.key == m.envelope.key)
    check("media/\(m.name)/mediaId", parsed?.mediaId == m.envelope.mediaId)
    check("media/\(m.name)/takVersion", parsed?.takVersion == m.envelope.takVersion)
    check("media/\(m.name)/mime", parsed?.mime == m.envelope.mime)
    check("media/\(m.name)/size", parsed?.size == m.envelope.size)
    check("media/\(m.name)/is_media_body", ChatMedia.isMediaBody(m.body))

    // The key is rebuilt, never prefix-matched — same rule as
    // `isChatMediaKeyForTopic`, so the two cannot disagree about where a topic's
    // objects live.
    check("media/\(m.name)/object_key_rebuilds",
          ChatMedia.objectKey(
            topicId: m.topicId,
            userId: file.meta.mediaUserSegment,
            mediaId: m.envelope.mediaId
          ) == m.envelope.key)

    let opened = OpenStoaArchive.openBytes(
      tak: tak,
      contextId: ChatMedia.mediaContextId(m.envelope.mediaId),
      sealed: sealed
    )
    check("media/\(m.name)/bytes_open",
          opened == want,
          opened == nil ? "decrypt returned nil" : "got \(opened!.count) bytes, want \(want.count)")

    // Sealed under `media:<mediaId>`, so the MESSAGE-id context must fail. A
    // port that reuses the message-id open here silently shows no picture — and
    // "no picture" is indistinguishable from a slow network, so it would never
    // be reported as a bug.
    check("media/\(m.name)/wrong_context_fails",
          OpenStoaArchive.openBytes(tak: tak, contextId: m.envelope.mediaId, sealed: sealed) == nil,
          "opening media bytes under the message-id context unexpectedly succeeded")

    // The plaintext is arbitrary bytes: a String-shaped path would have mangled
    // or dropped it. `media_all_byte_values` is the one that proves it.
    check("media/\(m.name)/bytes_not_utf8_dependent",
          opened.map { $0.elementsEqual(want) } ?? false)
  }

  print("")
  print("[chat media — bodies TypeScript accepts and rejects, verbatim]")
  for b in file.mediaBodies {
    // `isMediaBody` is the check that decides a body may never be shown as text.
    // It is deliberately SEPARATE from parsing: a malformed envelope is still
    // not text, and rendering it would put JSON on a lock screen.
    check("mediaBody/\(b.name)/is_media_body",
          ChatMedia.isMediaBody(b.body) == b.isMediaBody,
          "swift=\(ChatMedia.isMediaBody(b.body)) typescript=\(b.isMediaBody)")

    let parsed = ChatMedia.parse(body: b.body, topicId: b.topicId)
    check("mediaBody/\(b.name)/accepted==\(b.valid)",
          (parsed != nil) == b.valid,
          parsed == nil ? "Swift rejected what TypeScript accepted" : "Swift accepted what TypeScript rejected")
    if let want = b.envelope, let got = parsed {
      check("mediaBody/\(b.name)/fields",
            got.key == want.key && got.mediaId == want.mediaId && got.takVersion == want.takVersion
              && got.mime == want.mime && got.size == want.size)
    }
  }

  print("")
  print("[chat media — extension budget]")
  // The ceiling is what stops a large attachment from killing the extension
  // outright (~24MB), which would deliver NO notification at all.
  func envelope(size: Int, mime: String = "image/png") -> ChatMediaEnvelope {
    return ChatMediaEnvelope(
      key: "topics/3f2504e0-4f89-11d3-9a0c-0305e82c3301/chat/u/a0b1c2d3e4f5061728394a5b6c7d8e9f.bin",
      mediaId: "a0b1c2d3e4f5061728394a5b6c7d8e9f",
      takVersion: 0,
      mime: mime,
      size: size
    )
  }
  check("budget/one_byte", ChatMedia.isWithinPreviewBudget(envelope(size: 1)))
  check("budget/at_ceiling", ChatMedia.isWithinPreviewBudget(envelope(size: ChatMedia.maxPreviewPlaintextBytes)))
  check("budget/over_ceiling", !ChatMedia.isWithinPreviewBudget(envelope(size: ChatMedia.maxPreviewPlaintextBytes + 1)))
  check("budget/sender_maximum_is_over_ceiling",
        !ChatMedia.isWithinPreviewBudget(envelope(size: ChatMedia.maxPlaintextBytes)),
        "the 10MB a sender may attach must not be fetched inside a 24MB extension")
  check("budget/ceiling_below_sender_max", ChatMedia.maxPreviewPlaintextBytes < ChatMedia.maxPlaintextBytes)
  // The response cap is what actually bounds memory: `size` is written by the
  // SENDER, so an envelope claiming 4KB may name a 10MB object. It has to leave
  // room for base64 (~1.34x) over an honest ceiling-sized attachment, and still
  // refuse a dishonest one that names the largest object the upload route takes.
  check("budget/response_cap_covers_base64_of_ceiling",
        ChatMedia.maxResponseBytes >= (ChatMedia.maxPreviewPlaintextBytes * 4) / 3 + 1024)
  check("budget/response_cap_refuses_sender_max",
        ChatMedia.maxResponseBytes < ChatMedia.maxPlaintextBytes,
        "a lying envelope must not be able to pull the full 10MB into a 24MB extension")

  print("")
  print("[chat media — file extension per mime]")
  check("ext/jpeg", ChatMedia.fileExtension(forMime: "image/jpeg") == "jpg")
  check("ext/png", ChatMedia.fileExtension(forMime: "image/png") == "png")
  check("ext/gif", ChatMedia.fileExtension(forMime: "image/gif") == "gif")
  check("ext/webp", ChatMedia.fileExtension(forMime: "image/webp") == "webp")
  check("ext/bmp", ChatMedia.fileExtension(forMime: "image/bmp") == "bmp")
  check("ext/unknown_is_nil", ChatMedia.fileExtension(forMime: "image/heic") == nil)
  check("ext/empty_is_nil", ChatMedia.fileExtension(forMime: "") == nil)
  // Every allowlisted type must have one, or an attachment the sender was
  // allowed to send could never be written to disk here.
  for mime in ChatMedia.mimeAllowlist {
    check("ext/allowlisted_\(mime)", ChatMedia.fileExtension(forMime: mime) != nil)
  }
  check("body/caption_is_not_json", !ChatMedia.isMediaBody(ChatMedia.attachmentBody))
  check("body/caption_is_not_empty", !ChatMedia.attachmentBody.isEmpty)

  print("")
  print("[chat media — read route URL]")
  let mediaKey = "topics/3f2504e0-4f89-11d3-9a0c-0305e82c3301/chat/u/a0b1c2d3e4f5061728394a5b6c7d8e9f.bin"
  let url = ChatMedia.mediaURL(baseUrl: "https://openstoa.xyz", topicId: "t1", key: mediaKey)
  check("url/path", url?.path == "/api/topics/t1/chat/media")
  /*
   * The property that matters is not WHICH characters got escaped — `/` is legal
   * unescaped in a query and `URLQueryItem` leaves it alone — but that the
   * server reads back exactly the key we asked for. `&`, `#` and `+` are the
   * ones that would silently truncate or alter it, so the round trip is checked
   * with those present even though `ChatMedia.parse` would already have refused
   * such a key: the URL builder must not be the layer that is merely lucky.
   */
  func roundTrip(_ key: String) -> String? {
    guard let u = ChatMedia.mediaURL(baseUrl: "https://openstoa.xyz", topicId: "t1", key: key),
          let items = URLComponents(url: u, resolvingAgainstBaseURL: false)?.queryItems
    else { return nil }
    return items.first(where: { $0.name == "key" })?.value
  }
  check("url/key_round_trips", roundTrip(mediaKey) == mediaKey, "got \(roundTrip(mediaKey) ?? "nil")")
  check("url/key_round_trips_with_ampersand", roundTrip("a&b=c") == "a&b=c")
  check("url/key_round_trips_with_fragment", roundTrip("a#b") == "a#b")
  check("url/key_round_trips_with_plus", roundTrip("a+b") == "a+b")
  check("url/key_round_trips_with_space", roundTrip("a b") == "a b")
  check("url/trailing_slash_is_absorbed",
        ChatMedia.mediaURL(baseUrl: "https://openstoa.xyz/", topicId: "t1", key: mediaKey)?.absoluteString
          == url?.absoluteString)
  check("url/http_allowed_for_local_dev",
        ChatMedia.mediaURL(baseUrl: "http://192.168.0.2:3200", topicId: "t1", key: mediaKey) != nil)
  // A corrupted mirror entry must never send a bearer token somewhere else.
  check("url/reject_empty_base", ChatMedia.mediaURL(baseUrl: "", topicId: "t1", key: mediaKey) == nil)
  check("url/reject_relative_base", ChatMedia.mediaURL(baseUrl: "/api", topicId: "t1", key: mediaKey) == nil)
  check("url/reject_no_host", ChatMedia.mediaURL(baseUrl: "https://", topicId: "t1", key: mediaKey) == nil)
  check("url/reject_file_scheme", ChatMedia.mediaURL(baseUrl: "file:///etc", topicId: "t1", key: mediaKey) == nil)
  check("url/reject_javascript_scheme",
        ChatMedia.mediaURL(baseUrl: "javascript:alert(1)", topicId: "t1", key: mediaKey) == nil)

  print("")
  print("[chat media — read route response]")
  check("response/ok", ChatMedia.ciphertext(fromResponseBody: Data(#"{"ciphertext":"AAEC"}"#.utf8))
          == Data([0x00, 0x01, 0x02]))
  check("response/reject_error_json",
        ChatMedia.ciphertext(fromResponseBody: Data(#"{"error":"Not a member of this topic"}"#.utf8)) == nil)
  check("response/reject_empty_string",
        ChatMedia.ciphertext(fromResponseBody: Data(#"{"ciphertext":""}"#.utf8)) == nil)
  check("response/reject_non_base64",
        ChatMedia.ciphertext(fromResponseBody: Data(#"{"ciphertext":"!!!!"}"#.utf8)) == nil)
  check("response/reject_number",
        ChatMedia.ciphertext(fromResponseBody: Data(#"{"ciphertext":123}"#.utf8)) == nil)
  check("response/reject_html", ChatMedia.ciphertext(fromResponseBody: Data("<html>502</html>".utf8)) == nil)
  check("response/reject_empty_body", ChatMedia.ciphertext(fromResponseBody: Data()) == nil)
  check("response/reject_array", ChatMedia.ciphertext(fromResponseBody: Data("[]".utf8)) == nil)

  print("")
  print("[chat media — mirrored session credential]")
  check("session/ok",
        PushSession.parse(Data(#"{"baseUrl":"https://openstoa.xyz","token":"jwt"}"#.utf8))
          == PushSession(baseUrl: "https://openstoa.xyz", token: "jwt"))
  check("session/reject_missing_token",
        PushSession.parse(Data(#"{"baseUrl":"https://openstoa.xyz"}"#.utf8)) == nil)
  check("session/reject_empty_token",
        PushSession.parse(Data(#"{"baseUrl":"https://openstoa.xyz","token":""}"#.utf8)) == nil)
  check("session/reject_empty_base_url",
        PushSession.parse(Data(#"{"baseUrl":"","token":"jwt"}"#.utf8)) == nil)
  check("session/reject_garbage", PushSession.parse(Data("not json".utf8)) == nil)
  check("session/reject_empty", PushSession.parse(Data()) == nil)
  check("session/account_key",
        TakKeychain.pushSessionAccount(topicId: "01JQZ8T") == "openstoa.push.session.01JQZ8T")

  print("")
  if failures.isEmpty {
    print("PASS — \(checks) checks, 0 failures")
    return 0
  }
  print("FAIL — \(checks) checks, \(failures.count) failures:")
  for f in failures { print("  - \(f)") }
  return 1
}
