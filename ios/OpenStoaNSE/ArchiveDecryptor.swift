//
//  ArchiveDecryptor.swift
//  OpenStoaNSE — TAK archive crypto (E2EE chat design §5.2 / §13.5)
//
//  A byte-for-byte Swift port of `openArchive` in the OpenStoa web/mobile client
//  (`openstoa/src/lib/mls/takClient.ts`). The MLS ciphersuite is 0x0001
//  (MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519), so the archive layer is
//  HKDF-SHA256 + AES-128-GCM with a 12-byte nonce:
//
//      prk   = HKDF-SHA256-Extract(salt: 32 zero bytes, ikm: tak)
//      key   = HKDF-SHA256-Expand(prk, info: "openstoa-archive/v1:<messageId>", L: 16)
//      raw   = base64Decode(sealed)
//      plain = AES-128-GCM.open(key, nonce: raw[0..<12], sealed: raw[12...])
//
//  The zero salt (rather than a random one) is not a weakness here: the TAK is
//  already a uniformly-random 32-byte key, and the label + message id are bound
//  in the expand info instead. It matches the TS side because the ts-mls KDF
//  requires the extract salt to be exactly hash-length.
//
//  Cross-implementation agreement is enforced by `ios/scripts/archive_vectors.json`
//  (sealed by the TypeScript `sealArchive`) via `ios/scripts/verify_archive_vectors.sh`.
//  This file deliberately imports nothing but Foundation + CryptoKit so that
//  verifier can compile it standalone with `swiftc`.
//

import CryptoKit
import Foundation

/// Read-only TAK archive crypto. Stateless: nothing is cached, nothing is
/// persisted, and no MLS ratchet state is touched (design §13.6 — the NSE must
/// never consume a forward-secret message key or it desyncs the main app).
enum OpenStoaArchive {
  /// Expand-info prefix. Must match `ARCHIVE_LABEL` in takClient.ts.
  static let archiveLabel = "openstoa-archive/v1"
  /// Context the SENDER seals the push copy under. Must match
  /// `PUSH_PREVIEW_CONTEXT_ID` in takClient.ts. It is a fixed string, not the
  /// message id, because the sender seals `pushArchive.ct` BEFORE POST /chat
  /// returns — at that point the server has not assigned a message id yet.
  static let pushPreviewContextId = "push-preview"
  /// Raw TAK length in bytes (suite KDF hash size).
  static let takLength = 32
  /// Derived AEAD key length — matches the suite AEAD (AES-128-GCM).
  static let archiveKeyLength = 16
  /// AES-GCM nonce length used by the suite HPKE AEAD.
  static let nonceLength = 12
  /// AES-GCM authentication tag length.
  static let tagLength = 16

  /// HKDF-derive the per-message AEAD key from a TAK/root key + message id.
  /// Returns nil if the TAK is not exactly `takLength` bytes — a short or
  /// oversized key means the Keychain entry is corrupt and must not be used.
  static func archiveKey(tak: Data, messageId: String) -> SymmetricKey? {
    guard tak.count == takLength else { return nil }
    let prk = HKDF<SHA256>.extract(
      inputKeyMaterial: SymmetricKey(data: tak),
      salt: Data(repeating: 0, count: takLength)
    )
    let info = Data("\(archiveLabel):\(messageId)".utf8)
    return HKDF<SHA256>.expand(
      pseudoRandomKey: prk,
      info: info,
      outputByteCount: archiveKeyLength
    )
  }

  /// Decrypt an archive body sealed by the TypeScript `sealArchive`.
  ///
  /// Returns nil on EVERY failure — bad base64, a body too short to hold a
  /// nonce + tag, a wrong or corrupt TAK, GCM authentication failure, or a
  /// plaintext that is not valid UTF-8. Callers treat nil as "leave the
  /// content-free placeholder", never as an error to surface.
  static func open(tak: Data, messageId: String, sealedBase64: String) -> String? {
    guard !sealedBase64.isEmpty,
          let raw = Data(base64Encoded: sealedBase64),
          let plaintext = openBytes(tak: tak, contextId: messageId, sealed: raw)
    else { return nil }
    return String(data: plaintext, encoding: .utf8)
  }

  /// The same open, over RAW BYTES and returning bytes.
  ///
  /// Two callers, two shapes of the one operation: a message body arrives
  /// base64-encoded inside a push payload and decodes to text, while an
  /// attachment arrives as bytes from the media route and stays bytes. Splitting
  /// them here rather than round-tripping an image through base64 and a String
  /// matters in an extension with a ~24MB ceiling — and a UTF-8 decode of a JPEG
  /// would fail anyway, which is how a shared String path would have silently
  /// broken every attachment.
  ///
  /// `contextId` is whatever was bound into the HKDF info: a message id for an
  /// archived body, the fixed `push-preview` label for a push copy, or
  /// `media:<mediaId>` for an attachment (`ChatMedia.mediaContextId`). Passing
  /// the wrong one derives a different key and fails authentication — which is
  /// the intended outcome, not a bug to work around.
  ///
  /// Returns nil on EVERY failure: a body too short to hold a nonce + tag, a
  /// wrong or corrupt TAK, or GCM authentication failure. Consumes no ratchet
  /// state whatsoever (design §13.6).
  static func openBytes(tak: Data, contextId: String, sealed: Data) -> Data? {
    guard sealed.count >= nonceLength + tagLength,
          let key = archiveKey(tak: tak, messageId: contextId)
    else { return nil }

    // Data slices keep the parent's indices, so re-base them before handing the
    // bytes to CryptoKit (which reads from index 0).
    let nonceBytes = Data(sealed.prefix(nonceLength))
    let body = Data(sealed.dropFirst(nonceLength))
    let ciphertext = Data(body.dropLast(tagLength))
    let tag = Data(body.suffix(tagLength))

    do {
      let nonce = try AES.GCM.Nonce(data: nonceBytes)
      let box = try AES.GCM.SealedBox(nonce: nonce, ciphertext: ciphertext, tag: tag)
      return try AES.GCM.open(box, using: key)
    } catch {
      return nil
    }
  }

  /// Decrypt the push-preview copy carried in `act`.
  ///
  /// The sender seals it under the FIXED `push-preview` context
  /// (`sealPushPreview` in takClient.ts), not under the message id, so that is
  /// what we try first. Opening with the message id instead derives a different
  /// key, fails GCM authentication, and silently degrades every push to the
  /// content-free placeholder — do not "simplify" this back to a single
  /// message-id open.
  ///
  /// The second attempt is the per-message archive context, which is what a
  /// sender that seals the preview AFTER the POST would produce. Both attempts
  /// are pure AEAD opens against a stable, non-ratcheting key: a failed one
  /// consumes nothing and cannot desync the group. Mirrors
  /// `OpenStoaArchive.openPushPreview` on Android.
  static func openPushPreview(tak: Data, messageId: String, sealedBase64: String) -> String? {
    if let plaintext = open(tak: tak, messageId: pushPreviewContextId, sealedBase64: sealedBase64) {
      return plaintext
    }
    return open(tak: tak, messageId: messageId, sealedBase64: sealedBase64)
  }
}
