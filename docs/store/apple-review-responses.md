APPLE REVIEW REJECTION RESPONSES
ZKProofport Mobile Application
================================================================================

================================================================================
GUIDELINE 3.1.5 — CRYPTOCURRENCIES (Second Response — v1.5.1)
================================================================================
Date: 2026-03-29
Context: Same issue raised during initial beta submission, resolved via same
argument. Apple accepted and allowed TestFlight + review to proceed.
Now raised again on v1.5.1 production submission.

---

Dear App Review Team,

Thank you for your continued review. We previously addressed this same concern during our initial beta submission. At that time, the explanation was accepted and our app was approved for TestFlight distribution and subsequent review submissions.

Our app uses a wallet address solely for the following purposes:

1. Requesting a cryptographic signature for identity verification (EIP-4361 "Sign-In with Ethereum" — an authentication standard, not a financial transaction)
2. Querying the Ethereum Attestation Service (EAS) to read publicly available identity attestation data (e.g., Coinbase KYC verification)
3. Generating zero-knowledge proofs on-device to verify identity claims without revealing personal data

There is no cryptocurrency trading, no coin or token transfers, and no virtual currency storage in our app. The wallet connection is used exclusively for signature-based authentication and on-chain attestation lookups to generate ZK identity proofs.

This was explained and accepted during our initial review, and our app has been in TestFlight distribution since then. We respectfully request consistency with that prior determination.

Thank you for your time and consideration.

---

================================================================================
GUIDELINE 5.1.1(iv) — CAMERA PERMISSION BUTTON TEXT
================================================================================
Date: 2026-03-27 (v1.5.0 submission)
Result: RESOLVED — Fixed in v1.5.1

Issue: Custom pre-permission dialog had "Allow Camera" button.
Fix: Changed to "Continue" per Apple's guidance.
File: src/screens/scan/QRScanScreen.tsx:124

Response sent with v1.5.1 submission:

---

Regarding Guideline 5.1.1(iv) — Camera Permission Button Text:

We have resolved this issue. The custom pre-permission dialog button text has been changed from "Allow Camera" to "Continue" in this updated build (v1.5.1). The app no longer uses the word "Allow" in any custom permission request UI.

---

================================================================================
RESOLUTION CENTER FULL TIMELINE (v1.5.1, Submission ID: 6adec938-9ae4-414f-b1bc-d4199325f1e1)
================================================================================

1. Apple   2026-03-25 01:04 — Initial rejection (Guideline 3.1.5)
2. Apple   2026-03-26 11:36 — Additional rejection details (with attachment)
3. 현제혁  2026-03-28 02:17 — First response (camera button fix + 3.1.5 explanation)
4. Apple   2026-03-28 11:20 — Apple reply (with attachment)
5. 현제혁  2026-03-29 09:30 — Second response (detailed 3.1.5 rebuttal, see above)
6. Apple   2026-03-30 10:58 — Final rejection:
   "your wallet app facilitates the transmission and/or storage of a virtual
   currency but was submitted by an Apple Developer Program account registered
   to an individual, which is not appropriate for the App Store."
   Next Steps: Submit via organization account or convert individual → org.

Resolution Center was not making progress (reviewer kept insisting on org account).

================================================================================
APPLE DEVELOPER CONTACT APPEAL (Separate Channel)
================================================================================
Date: ~2026-03-30 (after receiving Apple's final Resolution Center rejection)
Channel: developer.apple.com/contact/app-store/?topic=appeal
Status: Appeal accepted — app status changed to "심사 대기 중" on 2026-04-07

Content: Same argument as the Resolution Center response (see GUIDELINE 3.1.5
section above). Key points reiterated:

1. Wallet address is used ONLY for EIP-4361 signature-based authentication
   (not cryptocurrency transactions)
2. App queries EAS for publicly available identity attestation data
   (not token balances or transfers)
3. Zero-knowledge proofs generated on-device for privacy-preserving
   identity verification
4. No cryptocurrency trading, no token transfers, no virtual currency storage
5. Previously accepted during initial beta submission — requesting consistency
6. Guideline 3.1.5(i) requires org account only for apps that "facilitate
   virtual currency storage" — ZKProofport does not store any virtual currency

Result: On 2026-04-07, app status changed from "해결되지 않은 문제" to
"심사 대기 중" (iOS 1.5.1 build 23), suggesting Appeal was accepted for
re-review by App Review Board (separate from original reviewer).

================================================================================
REFERENCE: GUIDELINE 3.1.5 FULL TEXT
================================================================================
Source: https://developer.apple.com/app-store/review/guidelines/#cryptocurrencies

3.1.5(i) Wallets: Apps may facilitate virtual currency storage, provided
they are offered by developers enrolled as an organization.

3.1.5(ii) Mining: Apps may not mine for cryptocurrencies unless the
processing is performed off device (e.g. cloud-based mining).

3.1.5(iii) Exchanges: Apps may facilitate transactions or transmissions of
cryptocurrency on an approved exchange, provided they are offered only in
countries or regions where the app has appropriate licensing and permissions.

3.1.5(iv) ICOs: Apps facilitating ICOs, cryptocurrency futures trading, and
other crypto-securities must come from established financial institutions.

3.1.5(v): Cryptocurrency apps may not offer currency for completing tasks.

KEY ARGUMENT: 3.1.5(i) requires organization account ONLY for apps that
"facilitate virtual currency storage." ZKProofport does not store any
virtual currency — it only reads attestation data and requests signatures
for identity verification.
