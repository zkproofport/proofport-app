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
  let meta: Meta
  let takBase64: String
  let vectors: [Vector]
  /// Sealed under the fixed `push-preview` context, not under `messageId`.
  let pushPreviews: [Vector]
  let negatives: [Negative]
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
  if failures.isEmpty {
    print("PASS — \(checks) checks, 0 failures")
    return 0
  }
  print("FAIL — \(checks) checks, \(failures.count) failures:")
  for f in failures { print("  - \(f)") }
  return 1
}
