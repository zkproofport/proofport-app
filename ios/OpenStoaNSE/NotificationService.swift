//
//  NotificationService.swift
//  OpenStoaNSE — Notification Service Extension (E2EE chat Phase 7 / Phase B, design §13.5)
//
//  What this extension does:
//    1. APNs delivers the message push with `aps.mutable-content = 1` and a
//       payload carrying { topicId, messageId, epoch, ct, act, tv }. The server
//       never had the plaintext (SI-1) — both `ct` and `act` are opaque to it.
//       iOS wakes this NSE before the notification is shown.
//    2. The NSE reads the topic's Topic Archive Key from the SHARED Keychain
//       access group the host app writes E2EE keys into, decrypts `act`
//       READ-ONLY, and rewrites `bestAttemptContent.body` to the preview.
//    3. On ANY failure (no key, decrypt error, budget/time exceeded) it leaves
//       the Phase A content-free placeholder ("New message") untouched — the
//       recipient still gets a notification and decrypts in-app on tap.
//
//  §13.6 — WHY `act` AND NOT `ct`:
//    `ct` is the live MLS application ciphertext. Decrypting it consumes a
//    forward-secret message key from the ratchet's secret tree; if this
//    extension advanced that state the main app could no longer derive the same
//    key and the group would DESYNC. The NSE therefore NEVER touches `ct` — it
//    decrypts `act`, the TAK-archived copy. The Topic Archive Key is a STABLE
//    symmetric key (non-ratcheting, design §5.2), so opening the archived
//    ciphertext consumes nothing and cannot desync the live group. When `act` is
//    absent (message not archived yet) the NSE falls back to the placeholder.
//
//  §13.6 — single OS token ↔ multiple nullifiers:
//    The host owns ONE APNs token but the mini-app may hold several session
//    nullifiers. The server keys push_tokens on (user_id=nullifier, routing_handle),
//    so the same OS token registered under different nullifiers produces distinct
//    rows and the topic-member fan-out selects only the row whose nullifier is a
//    member. The NSE then uses `topicId` + `tv` to pick the correct TAK from the
//    shared Keychain. The access group scopes which identities' keys it may read.
//

import UserNotifications

// The shared Keychain access group the host app must ALSO write E2EE keys into so
// this NSE can read them. Kept in sync with `withOpenStoaNSE.js` and the host
// entitlements (`$(AppIdentifierPrefix)com.zkproofport.app.openstoa`).
private let kSharedKeychainAccessGroup = "com.zkproofport.app.openstoa"

class NotificationService: UNNotificationServiceExtension {
  private var contentHandler: ((UNNotificationContent) -> Void)?
  private var bestAttemptContent: UNMutableNotificationContent?

  override func didReceive(
    _ request: UNNotificationRequest,
    withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
  ) {
    self.contentHandler = contentHandler
    self.bestAttemptContent =
      (request.content.mutableCopy() as? UNMutableNotificationContent)

    guard let bestAttemptContent = bestAttemptContent else {
      contentHandler(request.content)
      return
    }

    if let preview = Self.decryptPreview(userInfo: request.content.userInfo) {
      bestAttemptContent.body = preview
    }
    // Any nil above leaves the Phase A placeholder in place. The notification is
    // ALWAYS delivered — a failed decrypt must never swallow the message.
    contentHandler(bestAttemptContent)
  }

  override func serviceExtensionTimeWillExpire() {
    // Budget/time exceeded (design §13.5 fallback): deliver whatever we have,
    // which is the content-free placeholder — never block the notification.
    if let contentHandler = contentHandler, let bestAttemptContent = bestAttemptContent {
      contentHandler(bestAttemptContent)
    }
  }

  /// Resolve the archived-ciphertext preview for a push payload, or nil to keep
  /// the placeholder. Read-only: it opens the stable TAK-archived copy and never
  /// writes Keychain or MLS state.
  ///
  /// Note the deliberate absence of any `userInfo["ct"]` read: the live MLS
  /// ciphertext is off limits here (see §13.6 above).
  ///
  /// An empty plaintext is treated as a failure — a blank notification body is
  /// less useful than the "New message" placeholder it would replace.
  static func decryptPreview(userInfo: [AnyHashable: Any]) -> String? {
    guard
      let push = PushPayload.parse(userInfo),
      let tak = TakKeychain.readTak(
        topicId: push.topicId,
        takVersion: push.takVersion,
        accessGroup: kSharedKeychainAccessGroup
      ),
      let plaintext = OpenStoaArchive.openPushPreview(
        tak: tak,
        messageId: push.messageId,
        sealedBase64: push.archivedCiphertext
      ),
      !plaintext.isEmpty
    else { return nil }

    return Preview.truncateForDisplay(plaintext)
  }
}
