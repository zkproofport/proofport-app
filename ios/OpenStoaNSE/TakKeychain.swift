//
//  TakKeychain.swift
//  OpenStoaNSE — read-only TAK lookup in the SHARED Keychain access group
//
//  STRICTLY READ-ONLY (design §13.6). The only Keychain API this file may ever
//  call is `SecItemCopyMatching`. Adding `SecItemAdd` / `SecItemUpdate` /
//  `SecItemDelete` here would let the extension mutate E2EE state behind the
//  app's back; the NSE has no way to coordinate with the app process, so any
//  write is a desync waiting to happen.
//
//  The writer is `openstoa/packages/mobile/src/crypto/sharedKeychain.ts`
//  (`mirrorTakWith`), called from the mini-app's ChatRoomScreen. Storage contract:
//    class        kSecClassGenericPassword
//    accessGroup  $(AppIdentifierPrefix)com.zkproofport.app.openstoa
//                 (OpenStoaNSE.entitlements + ProofportApp.entitlements)
//    account      openstoa.tak.<topicId>.<takVersion>
//                 takVersion 0 = the topic's public archive root key,
//                 otherwise the MLS epoch whose per-epoch TAK this is.
//    value        UTF-8 base64 of the 32 raw TAK bytes
//    accessible   kSecAttrAccessibleAfterFirstUnlock — required, because a push
//                 arrives while the device is locked and the default
//                 `WhenUnlocked` item would simply be invisible here.
//
//  `kSecAttrService` is intentionally NOT constrained. The writer goes through
//  expo-secure-store, which defaults the service to "app" and would change it if
//  anyone ever passed `keychainService`; pinning it here would silently break the
//  lookup. The access group plus the account key already scope the match.
//
//  ACCOUNT ENCODING — why the lookup is attempted twice: expo-secure-store passes
//  `kSecAttrAccount` as raw `Data` (`SecureStoreModule.swift`: `Data(key.utf8)`),
//  not as a `String`. Whether the keychain normalises the two to the same stored
//  attribute could not be confirmed by execution here (an unentitled process
//  cannot touch the data-protection keychain, and the Simulator refuses to launch
//  a hand-signed probe bundle), so this does not depend on the answer: it queries
//  the writer's exact `Data` encoding first, then the `String` form that a native
//  writer would produce. Both spellings of the SAME account key — not a guess at
//  a second location.
//

import Foundation
import Security

enum TakKeychain {
  /// Keychain account key for a topic's TAK at a given version.
  static func account(topicId: String, takVersion: Int) -> String {
    return "openstoa.tak.\(topicId).\(takVersion)"
  }

  /// Read the 32 raw TAK bytes for (topicId, takVersion) from the shared group.
  /// Returns nil when the item is missing, unreadable (device locked), not valid
  /// base64, or not exactly 32 bytes.
  static func readTak(topicId: String, takVersion: Int, accessGroup: String) -> Data? {
    guard !topicId.isEmpty else { return nil }
    let key = account(topicId: topicId, takVersion: takVersion)

    // Data first: that is literally what expo-secure-store wrote.
    let stored = copyValue(account: Data(key.utf8), accessGroup: accessGroup)
      ?? copyValue(account: key, accessGroup: accessGroup)

    guard let stored = stored,
          let base64 = String(data: stored, encoding: .utf8)
    else { return nil }

    guard let tak = Data(base64Encoded: base64.trimmingCharacters(in: .whitespacesAndNewlines)),
          tak.count == OpenStoaArchive.takLength
    else { return nil }

    return tak
  }

  /// Keychain account key for the session the extension fetches ATTACHMENTS
  /// with. Mirrors `sharedPushSessionKey` in
  /// `openstoa/packages/mobile/src/crypto/sharedKeychain.ts`.
  static func pushSessionAccount(topicId: String) -> String {
    return "openstoa.push.session.\(topicId)"
  }

  /**
   Read the mirrored `{ baseUrl, token }` for one topic, or nil.

   Why a bearer token lives here at all: the attachment read route is
   membership-gated (a public object URL would outlive every membership check),
   so the extension has to present a session, and it cannot ask the app for one
   — different process, app not running. Same access group, same
   `AFTER_FIRST_UNLOCK` protection and the same read-only rule as the TAK it
   sits beside; the group is scoped by the app identifier prefix, so nothing
   outside this app's own binaries can read either.

   Per TOPIC, not global, because the host owns one APNs token while the
   mini-app may hold several session nullifiers and the push carries none — the
   entry mirrored under a topic is by construction a session that is a member of
   it. An expired or missing entry is not an error: the fetch is skipped and the
   notification arrives with its caption and no thumbnail.
   */
  static func readPushSession(topicId: String, accessGroup: String) -> PushSession? {
    guard !topicId.isEmpty else { return nil }
    let key = pushSessionAccount(topicId: topicId)
    // Same two spellings of one account key as `readTak` — see the header.
    guard let stored = copyValue(account: Data(key.utf8), accessGroup: accessGroup)
      ?? copyValue(account: key, accessGroup: accessGroup)
    else { return nil }
    return PushSession.parse(stored)
  }

  /// One read-only Keychain lookup. `account` is `Any` so the caller can pass
  /// either the `Data` or the `String` spelling of the same account key.
  private static func copyValue(account: Any, accessGroup: String) -> Data? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrAccount as String: account,
      kSecAttrAccessGroup as String: accessGroup,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]

    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)
    guard status == errSecSuccess else { return nil }
    return item as? Data
  }
}
