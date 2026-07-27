//
//  NotificationService.swift
//  OpenStoaNSE — Notification Service Extension (E2EE chat Phase 7 / Phase B, design §13.5)
//
//  Phase 7 device: NSE requires a device build + Keychain access-group entitlement;
//  verify on device. This target is NOT built/verified in the scaffolding commit
//  (no `pod install`, no `expo prebuild`, no `xcodebuild` was run). See
//  `proofport-app/plugins/withOpenStoaNSE.js` for the target-registration steps.
//
//  What this extension does (design §13.5):
//    1. APNs delivers the message push with `aps.mutable-content = 1` and a
//       `data` dict carrying { topicId, messageId, epoch, ct } where `ct` is the
//       OPAQUE, already-sealed ciphertext (the server never had the plaintext —
//       SI-1). iOS wakes this NSE before the notification is shown.
//    2. The NSE loads the topic's decrypt key from the SHARED Keychain access
//       group the host app writes E2EE keys into (see §13.6 resolution below),
//       decrypts `ct` READ-ONLY, and rewrites `bestAttemptContent.body` to the
//       preview (e.g. "Alice: 회의 3시").
//    3. On ANY failure (no key, decrypt error, budget/time exceeded) it leaves
//       the Phase A content-free placeholder ("New message") untouched — the
//       recipient still gets a notification and decrypts in-app on tap.
//
//  §13.6 resolution — NSE MLS epoch safety (READ-ONLY, never ratchet):
//    Decrypting a live MLS application message consumes a forward-secret message
//    key from the ratchet's secret tree. If the NSE advanced/persisted that
//    ratcheted state it would DESYNC the main app (the app could no longer derive
//    the same key). Therefore the NSE MUST NOT write any mutated MLS state back
//    to the Keychain. Two safe strategies, in order of preference:
//      (A) PREFERRED — decrypt the TAK-archived copy. The Topic Archive Key is a
//          STABLE symmetric key (non-ratcheting), so decrypting the archived
//          ciphertext consumes nothing and can never desync the live group. The
//          push should carry (or the NSE should be able to reconstruct) the
//          TAK-sealed copy; when it is absent (message not yet archived) the NSE
//          falls back to the dummy.
//      (B) FALLBACK — load a READ-ONLY snapshot of the MLS group state, derive
//          the message key in memory, show the preview, and DISCARD the mutated
//          snapshot without persisting. The main app re-derives the key itself
//          from its own persisted epoch secret when the user opens the message.
//    This scaffold implements the *shape* (read key → decrypt → rewrite, else
//    leave dummy); the concrete GroupCipher/TAK binding is wired at device time.
//
//  §13.6 resolution — single OS token ↔ multiple nullifiers:
//    The host owns ONE APNs token but the mini-app may hold several session
//    nullifiers. The server keys push_tokens on (user_id=nullifier, routing_handle),
//    so the same OS token registered under different nullifiers produces distinct
//    rows and the topic-member fan-out selects only the row whose nullifier is a
//    member. The NSE then uses `data.topicId` to pick the correct per-(nullifier,
//    topic) key from the shared Keychain — keys are stored under
//    `mls.state.<identity>.<topicId>` (see openstoa mlsSession.ts). The Keychain
//    access group scopes which identities' keys this NSE may read.
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

    // Pull the opaque ciphertext envelope from the push payload. Any missing
    // field => leave the Phase A placeholder ("New message") and return.
    let userInfo = request.content.userInfo
    guard
      let topicId = userInfo["topicId"] as? String,
      let ct = userInfo["ct"] as? String,
      !ct.isEmpty
    else {
      contentHandler(bestAttemptContent)
      return
    }

    // Phase 7 device TODO: wire the real read-only decrypt here.
    //   let key = KeychainReader.readTopicKey(topicId: topicId,
    //                                         accessGroup: kSharedKeychainAccessGroup)
    //   guard let key = key,
    //         let preview = OpenStoaDecryptor.previewReadOnly(ct: ct, key: key)
    //   else { contentHandler(bestAttemptContent); return }
    //   bestAttemptContent.body = preview   // e.g. "Alice: 회의 3시"
    //
    // Until the decryptor is bound at device-build time, we DELIBERATELY leave
    // the content-free placeholder so behavior degrades to Phase A rather than
    // shipping a broken preview.
    _ = topicId
    _ = kSharedKeychainAccessGroup
    contentHandler(bestAttemptContent)
  }

  override func serviceExtensionTimeWillExpire() {
    // Budget/time exceeded (design §13.5 fallback): deliver whatever we have,
    // which is the content-free placeholder — never block the notification.
    if let contentHandler = contentHandler, let bestAttemptContent = bestAttemptContent {
      contentHandler(bestAttemptContent)
    }
  }
}
