//
//  PushPayload.swift
//  OpenStoaNSE — parsing of the ciphertext push payload (design §13.5)
//
//  Split out of NotificationService so it can be exercised by
//  `ios/scripts/verify_archive_vectors.sh`, which compiles the extension's logic
//  on macOS with `swiftc` and therefore cannot link `UNNotificationServiceExtension`.
//  Foundation only — no UserNotifications, no Security.
//

import Foundation

/// The fields of a chat push the NSE needs in order to build a preview.
struct ArchivePush: Equatable {
  /// Topic (= MLS group) the message belongs to. Selects the Keychain TAK.
  let topicId: String
  /// Message id — bound into the archive key's HKDF info, so it must match the
  /// sender's exactly or the AEAD open fails.
  let messageId: String
  /// TAK version: 0 = the topic's public archive root key, otherwise the MLS
  /// epoch whose per-epoch TAK sealed this copy.
  let takVersion: Int
  /// Base64 of nonce‖ciphertext‖tag for the TAK-ARCHIVED copy (`act`).
  ///
  /// Deliberately NOT the live MLS `ct`: opening `ct` would consume a
  /// forward-secret ratchet key and desync the main app (design §13.6).
  let archivedCiphertext: String
}

enum PushPayload {
  /// Unwrap the Expo push envelope.
  ///
  /// The server sends through Expo's push service (`openstoa/src/lib/pushProvider.ts`),
  /// which does NOT splice the message's `data` into the top level of the APNs
  /// payload — it nests it under a `body` key. expo-notifications reads exactly
  /// that: `EXNotificationSerializer.m` returns `request.content.userInfo[@"body"]`
  /// for any remote notification. An NSE reading `userInfo["topicId"]` directly
  /// would therefore find nothing and silently never render a preview.
  ///
  /// Both shapes of that key are accepted because both occur in the wild: a
  /// dictionary (what expo-notifications 0.32 expects) and a JSON string (what
  /// some Expo/FCM transports deliver). Anything else falls through to the top
  /// level, which is what a direct APNs sender would produce.
  static func dataDictionary(_ userInfo: [AnyHashable: Any]) -> [AnyHashable: Any] {
    guard let body = userInfo["body"] else { return userInfo }

    if let dict = body as? [AnyHashable: Any] { return dict }
    if let json = body as? String,
       let parsed = try? JSONSerialization.jsonObject(with: Data(json.utf8)),
       let dict = parsed as? [AnyHashable: Any] {
      return dict
    }
    return userInfo
  }

  /// Extract the archive fields from an APNs `userInfo`, or nil when any field
  /// is missing or empty — in which case the NSE keeps the content-free
  /// placeholder rather than guessing.
  static func parse(_ userInfo: [AnyHashable: Any]) -> ArchivePush? {
    let data = dataDictionary(userInfo)
    guard
      let topicId = data["topicId"] as? String, !topicId.isEmpty,
      let messageId = data["messageId"] as? String, !messageId.isEmpty,
      let archived = data["act"] as? String, !archived.isEmpty,
      let takVersion = intValue(data["tv"])
    else { return nil }

    return ArchivePush(
      topicId: topicId,
      messageId: messageId,
      takVersion: takVersion,
      archivedCiphertext: archived
    )
  }

  /// APNs JSON numbers arrive as NSNumber, but a payload built by a client that
  /// stringifies its fields would deliver "0"/"3" instead. Accept both rather
  /// than losing every preview over a JSON encoding detail. Rejects non-integer
  /// strings and fractional numbers, which would select the wrong Keychain key.
  static func intValue(_ raw: Any?) -> Int? {
    if let n = raw as? NSNumber {
      // `Bool` bridges to NSNumber too; a bool `tv` is a malformed payload.
      if CFGetTypeID(n) == CFBooleanGetTypeID() { return nil }
      let i = n.intValue
      return NSNumber(value: i) == n ? i : nil
    }
    if let s = raw as? String { return Int(s) }
    return nil
  }
}

enum Preview {
  /// Upper bound on the preview written into the notification body. This is UI
  /// text, not a log line, so trimming it is display formatting rather than the
  /// log truncation the repo forbids: iOS renders only a few lines anyway and an
  /// unbounded body just wastes the extension's memory budget.
  static let maxCharacters = 300

  /// Clamp to `maxCharacters` grapheme clusters so a long message cannot split
  /// an emoji or a composed Hangul syllable mid-character.
  static func truncateForDisplay(_ text: String) -> String {
    guard text.count > maxCharacters else { return text }
    return String(text.prefix(maxCharacters)) + "…"
  }
}
