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
//    3. When that plaintext is an ATTACHMENT ENVELOPE rather than text (P-1) it
//       fetches the ciphertext object through the membership-gated route,
//       decrypts it with the same key schedule, and attaches the picture — the
//       same thing every other messenger does inside the extension's ~30s.
//    4. On ANY failure (no key, decrypt error, budget/time exceeded) it leaves
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
//    An ATTACHMENT'S BYTES follow the same rule: they are sealed under the same
//    stable TAK (`media:<mediaId>` context), so opening them consumes nothing
//    either. There is no path in this target that touches `ct`.
//
//  §13.6 — single OS token ↔ multiple nullifiers:
//    The host owns ONE APNs token but the mini-app may hold several session
//    nullifiers. The server keys push_tokens on (user_id=nullifier, routing_handle),
//    so the same OS token registered under different nullifiers produces distinct
//    rows and the topic-member fan-out selects only the row whose nullifier is a
//    member. The NSE then uses `topicId` + `tv` to pick the correct TAK from the
//    shared Keychain. The access group scopes which identities' keys it may read.
//
//  THE ONE RULE FOR ATTACHMENTS: an envelope is never rendered as text.
//    `act` decrypts to the message BODY, and for an attachment that body is a
//    JSON envelope. Every exit below therefore either sets the body to a caption
//    or leaves the content-free placeholder — a body that `ChatMedia.isMediaBody`
//    accepts must never reach `bestAttemptContent.body`. The earlier fix for
//    this was to stop SENDING the sealed copy for attachments, which removed the
//    preview instead of teaching this file to read it.
//

import UserNotifications

// The shared Keychain access group the host app must ALSO write E2EE keys into so
// this NSE can read them. Kept in sync with `withOpenStoaNSE.js` and the host
// entitlements (`$(AppIdentifierPrefix)com.masselabs.zkproofport.openstoa`).
private let kSharedKeychainAccessGroup = "com.masselabs.zkproofport.openstoa"

/**
 How long the attachment fetch may take.

 The extension gets ~30s in total, after which iOS calls
 `serviceExtensionTimeWillExpire` and then posts whatever we last handed it. This
 leaves that much room to spare: a fetch that is still running at 15s is not
 going to produce a decrypted, written, validated attachment inside the
 remainder, and a caption delivered on time beats a thumbnail delivered never.
 */
private let kMediaFetchTimeout: TimeInterval = 15

class NotificationService: UNNotificationServiceExtension {
  private var contentHandler: ((UNNotificationContent) -> Void)?
  private var bestAttemptContent: UNMutableNotificationContent?

  /// Guards the two things the expiry callback races: the once-only delivery and
  /// the `bestAttemptContent` mutation. The attachment path finishes on a
  /// URLSession queue while `serviceExtensionTimeWillExpire` fires on another,
  /// and delivering twice is an API contract violation, not a cosmetic one.
  private let lock = NSLock()
  private var delivered = false

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

    /*
     * GROUPING, before anything that can fail.
     *
     * `threadIdentifier` is the only thing iOS groups Notification Center by:
     * banners sharing one are stacked as a single conversation, banners without
     * one pile up as N unrelated rows (UNNotificationContent.threadIdentifier —
     * "for remote notifications, the system sets this property to the value of
     * the thread-id key in the aps dictionary"). Expo's push API has no field
     * for `thread-id`, so this extension is the only place it can be set.
     *
     * Set here, above the decrypt guard, so it also applies on the placeholder
     * path: a notification this device holds no key for still belongs to its
     * conversation, and grouping it is the one thing we can do for it.
     *
     * It is NOT what per-conversation CLEARING keys off — that matches on
     * `data.topicId`, which every payload carries whether or not the NSE ran
     * (see ../../src/openstoa-host/pushClearing.ts). Grouping and clearing are
     * independent; this improves the former only.
     *
     * Read straight off `dataDictionary` and NOT via `PushPayload.parse`: that
     * parse also demands `messageId`, `act` and `tv`, and returns nil without
     * them. `act` is documented as optional (a message not archived yet), so
     * going through it would drop grouping on exactly the notifications that
     * already fall back to the placeholder — the ones a grouped stack helps
     * most.
     */
    let pushData = PushPayload.dataDictionary(request.content.userInfo)
    if let topicId = pushData["topicId"] as? String, !topicId.isEmpty {
      bestAttemptContent.threadIdentifier = topicId
    }

    let parsedPush = PushPayload.parse(request.content.userInfo)

    // No payload, no key, no plaintext → the Phase A placeholder stands.
    guard
      let push = parsedPush,
      let previewTak = TakKeychain.readTak(
        topicId: push.topicId,
        takVersion: push.takVersion,
        accessGroup: kSharedKeychainAccessGroup
      ),
      let plaintext = OpenStoaArchive.openPushPreview(
        tak: previewTak,
        messageId: push.messageId,
        sealedBase64: push.archivedCiphertext
      ),
      !plaintext.isEmpty
    else {
      deliver()
      return
    }

    guard ChatMedia.isMediaBody(plaintext) else {
      // Ordinary text: this is the whole of the P-Q behaviour.
      setBody(Preview.truncateForDisplay(plaintext))
      deliver()
      return
    }

    /*
     * From here the body is an envelope, so the caption is set FIRST and every
     * subsequent failure simply delivers it. Written this way round on purpose:
     * an early return that forgot to set a body would otherwise leave the JSON
     * in place, and that is the one outcome this file exists to prevent.
     */
    setBody(ChatMedia.attachmentBody)

    guard
      let envelope = ChatMedia.parse(body: plaintext, topicId: push.topicId),
      ChatMedia.isWithinPreviewBudget(envelope),
      let fileExtension = ChatMedia.fileExtension(forMime: envelope.mime),
      // The bytes are sealed under the version in the ENVELOPE, which is not
      // necessarily the version that sealed the preview: a device that holds the
      // key for the message may still hold no key for its picture.
      let mediaTak = TakKeychain.readTak(
        topicId: push.topicId,
        takVersion: envelope.takVersion,
        accessGroup: kSharedKeychainAccessGroup
      ),
      let session = TakKeychain.readPushSession(
        topicId: push.topicId,
        accessGroup: kSharedKeychainAccessGroup
      ),
      let url = ChatMedia.mediaURL(baseUrl: session.baseUrl, topicId: push.topicId, key: envelope.key)
    else {
      deliver()
      return
    }

    fetchAttachment(
      url: url,
      token: session.token,
      envelope: envelope,
      tak: mediaTak,
      fileExtension: fileExtension
    ) { [weak self] attachment in
      if let attachment = attachment { self?.attach(attachment) }
      self?.deliver()
    }
  }

  override func serviceExtensionTimeWillExpire() {
    // Budget/time exceeded (design §13.5 fallback): deliver whatever we have,
    // which is the placeholder or the caption — never block the notification.
    deliver()
  }

  // MARK: - Attachment

  /**
   Fetch one attachment's ciphertext, decrypt it, and write it where
   `UNNotificationAttachment` can take it. `nil` for every failure: an
   unreachable server, an expired session, a 403 from a membership that has since
   ended, a body that is not the shape we expect, bytes that do not authenticate,
   a temp directory that will not take the file, or a type iOS declines. The
   caller delivers the caption in all of those cases.
   */
  private func fetchAttachment(
    url: URL,
    token: String,
    envelope: ChatMediaEnvelope,
    tak: Data,
    fileExtension: String,
    completion: @escaping (UNNotificationAttachment?) -> Void
  ) {
    var request = URLRequest(url: url, timeoutInterval: kMediaFetchTimeout)
    request.httpMethod = "GET"
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

    let configuration = URLSessionConfiguration.ephemeral
    configuration.timeoutIntervalForRequest = kMediaFetchTimeout
    configuration.timeoutIntervalForResource = kMediaFetchTimeout
    let session = URLSession(configuration: configuration)

    /*
     * A DOWNLOAD task, not a data task: the response lands on disk and is
     * measured there before a byte of it is read into memory.
     *
     * `envelope.size` is written by the sender, so it cannot bound anything. A
     * body claiming 4KB may name an object holding the ~9.5MB the upload route
     * accepts, and a data task would have that in memory before anyone could
     * object — in an extension that is killed at ~24MB, which delivers NO
     * notification at all. That would hand a hostile member a one-line way to
     * silence someone's phone. On disk the size is a fact, checked first.
     *
     * The response is the raw ciphertext, so what lands in that file is exactly
     * what gets decrypted — `maxResponseBytes` bounds it to the preview ceiling
     * plus the AEAD frame, with none of the slack the old base64-in-JSON
     * framing forced.
     */
    session.downloadTask(with: request) { fileURL, response, _ in
      defer { session.finishTasksAndInvalidate() }
      guard
        let http = response as? HTTPURLResponse, http.statusCode == 200,
        let fileURL = fileURL,
        let size = try? FileManager.default.attributesOfItem(atPath: fileURL.path)[.size] as? Int,
        size > 0, size <= ChatMedia.maxResponseBytes,
        let body = try? Data(contentsOf: fileURL),
        let sealed = ChatMedia.ciphertext(fromResponseBody: body),
        let plaintext = OpenStoaArchive.openBytes(
          tak: tak,
          contextId: ChatMedia.mediaContextId(envelope.mediaId),
          sealed: sealed
        ),
        !plaintext.isEmpty
      else {
        completion(nil)
        return
      }
      completion(Self.writeAttachment(plaintext, mediaId: envelope.mediaId, fileExtension: fileExtension))
    }.resume()
  }

  /**
   Write the decrypted bytes to the extension's own temp directory and wrap them
   in an attachment.

   The type is carried by the FILE EXTENSION rather than an explicit
   `UNNotificationAttachmentOptionsTypeHintKey` UTI. iOS infers it from the
   extension, and a UTI table here would be a fifth restatement of a mapping that
   already exists in TypeScript, Swift and Kotlin — one more place to drift, for
   no behaviour we do not already get. iOS validates the file itself and refuses
   a type it cannot render, which is what the `try?` below is for: WEBP and BMP
   are in the sender's allowlist because a browser can display them, and if this
   platform declines one the recipient gets the caption instead of nothing.

   `UNNotificationAttachment` MOVES the file into its own storage, so nothing
   here has to clean up after a success; a failure leaves one small file in a
   temp directory the OS reclaims.
   */
  private static func writeAttachment(
    _ bytes: Data,
    mediaId: String,
    fileExtension: String
  ) -> UNNotificationAttachment? {
    let directory = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
      .appendingPathComponent("openstoa-media", isDirectory: true)
    do {
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    } catch {
      return nil
    }
    // `mediaId` is 32 hex characters, validated by `ChatMedia.parse` — it cannot
    // contribute a path separator or an extension of its own.
    let file = directory.appendingPathComponent("\(mediaId).\(fileExtension)")
    do {
      try bytes.write(to: file, options: .atomic)
    } catch {
      return nil
    }
    return try? UNNotificationAttachment(identifier: mediaId, url: file, options: nil)
  }

  // MARK: - Delivery

  private func setBody(_ body: String) {
    lock.lock()
    defer { lock.unlock() }
    bestAttemptContent?.body = body
  }

  private func attach(_ attachment: UNNotificationAttachment) {
    lock.lock()
    defer { lock.unlock() }
    bestAttemptContent?.attachments = [attachment]
  }

  /// Hand the notification to iOS, exactly once.
  ///
  /// The attachment path and `serviceExtensionTimeWillExpire` run on different
  /// queues and either may get here first, so the flag is what stops a slow
  /// fetch from calling the handler a second time after the expiry already
  /// delivered. Whoever loses simply returns — the notification is already out,
  /// with whatever body and attachment had been set by then.
  private func deliver() {
    lock.lock()
    if delivered {
      lock.unlock()
      return
    }
    delivered = true
    let handler = contentHandler
    let content = bestAttemptContent
    lock.unlock()

    if let handler = handler, let content = content { handler(content) }
  }

  /// Resolve the archived-ciphertext preview for a push payload, or nil to keep
  /// the placeholder. Read-only: it opens the stable TAK-archived copy and never
  /// writes Keychain or MLS state.
  ///
  /// Note the deliberate absence of any `userInfo["ct"]` read: the live MLS
  /// ciphertext is off limits here (§13.6 above).
  ///
  /// An empty plaintext is treated as a failure — a blank notification body is
  /// less useful than the "New message" placeholder it would replace.
  ///
  /// ATTACHMENTS ARE NOT PREVIEWED HERE. A body that is an envelope returns the
  /// caption, never the JSON: this function is also the one a future caller is
  /// most likely to reuse for "give me the text of this push", and handing that
  /// caller an envelope is how the JSON would end up on a lock screen again. The
  /// picture itself needs the network, so it lives in `didReceive`.
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

    if ChatMedia.isMediaBody(plaintext) { return ChatMedia.attachmentBody }
    return Preview.truncateForDisplay(plaintext)
  }
}
