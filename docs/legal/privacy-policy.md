# Privacy Policy for ZKProofport Mobile App

**Effective Date:** February 1, 2026

**Last Updated:** February 10, 2026

## Introduction

ZKProofport ("we," "us," "our," or "Company") operates the ZKProofport mobile application (the "App"). This Privacy Policy explains how we handle, protect, and process information when you use our App.

We are committed to protecting your privacy. Our App is designed with privacy as a core principle: zero-knowledge proofs are generated locally on your device, and we minimize data collection and server transmission.

## 1. Information We Collect

### 1.1 Wallet Address

When you authenticate using wallet connection (via Privy or WalletConnect), your wallet address is used for:
- Authenticating your identity within the App
- On-chain verification of proof submissions (when applicable)
- Correlating proof requests and completions

**Your wallet address is stored only locally on your device. We do not store wallet addresses on our servers.**

### 1.2 Proof Request Data

When you receive a proof request via QR code scan or deep link, we temporarily process the request metadata (circuit type, input fields, callback URL) to display the proof request to you. This data:
- Remains on your device during processing
- Is sent to the relay server only after you explicitly approve the proof generation
- Is cached temporarily on the relay server (up to 5 minutes) to enable reconnection in case of network interruption, then automatically deleted
- Is deleted from your device after the proof is generated or the request is rejected

### 1.3 Proof Generation & Cryptographic Data

- **Zero-knowledge proofs are generated locally on your device.** We do not collect, store, or transmit your proof inputs or computation data to any server.
- Only the completed proof (a cryptographic output) is transmitted to the relay server when you submit it.
- The proof itself contains no personal information about your input data—this is the defining property of zero-knowledge proofs.

### 1.4 QR Code Scans

QR codes are scanned and decoded entirely on your device. We do not:
- Send QR code images to any server
- Log or track which QR codes you scan
- Store scan history on our servers

### 1.5 Relay Server Communication

When you submit a completed proof, we communicate with our relay server to:
- Transmit the proof and associated metadata (circuit type, proof hash, timestamp)
- Receive acknowledgment of successful submission
- Handle callback notifications to the requesting application

The relay server temporarily caches proof results (proof data, public inputs, nullifier) for up to 5 minutes to enable reconnection in case of network interruption, then automatically deletes this cached data.

**No personal data about your identity or proof inputs is transmitted in this process.**

### 1.6 Information We Do NOT Collect

We explicitly do NOT collect or transmit to our servers:
- Wallet addresses (stored only on your device)
- Proof inputs (country lists, attestation data, signatures)
- Full proof data (only cached temporarily for 5 minutes in relay, then deleted)
- Your personal identity information (name, email, phone number) for mobile app users
- Location data or device identifiers
- Device IMEI, IMSI, MAC address, or hardware serial numbers
- Biometric data
- Browser/app usage analytics or behavioral tracking
- Advertising identifiers or cross-app tracking data

## 2. How We Use Information

### 2.1 Wallet Address Usage

- **Authentication**: Verifying your identity each time you use the App
- **Proof Verification**: Enabling requesting applications to verify your proof submissions
- **Service Delivery**: Routing proof requests to you and receiving completed proofs

### 2.2 Proof & Request Data Usage

- **Proof Processing**: Facilitating the generation and submission of zero-knowledge proofs
- **Relay Communication**: Transmitting completed proofs to callback URLs specified by proof requesters
- **Request Validation**: Ensuring proof requests are valid before displaying them to you

### 2.3 Aggregate & Statistical Data

We may analyze aggregate, anonymized data (e.g., total proofs generated, circuit type distribution) for:
- Service improvement and optimization
- Technical debugging and reliability monitoring
- Capacity planning

**This analysis does not identify individual users and is not shared with third parties.**

## 3. Data Storage

### 3.1 Local Device Storage

The App stores the following data locally on your device:
- Wallet address
- Proof history (proof hash, circuit type, status, timestamps)
- Proof generation logs (for your reference)
- App settings (theme, language)
- Wallet connection status

**You can export or clear this data at any time using the App's built-in export/clear functions.**

### 3.2 Server-Side Storage

ZKProofport servers store:
- Usage metadata (circuit type, request ID, credits used, status, timestamp) for billing purposes
- Nullifier hashes (for Plan 2 duplicate detection only)
- Transaction hashes (for Plan 2 on-chain registration only)
- Dashboard account data (email, name, password hash) for users who register for the dashboard (not mobile app users)

The relay server temporarily caches proof results (proof data, public inputs, nullifier) in Redis for up to 5 minutes to enable reconnection, then automatically deletes this cached data. Request status and nonce replay prevention data are cached for up to 10 minutes, then automatically deleted.

**We do not store wallet addresses, proof inputs, or full proof data permanently on our servers.** Usage metadata is retained for billing purposes. Dashboard account data is retained until account deletion is requested.

### 3.3 Your Control Over Data

You can:
- Clear all local proof history from the App at any time
- Export your proof history in portable format
- Disconnect your wallet, which removes you from future proof requests

If you have a dashboard account, you can request deletion of your account and associated server records. Account deletion requests will be honored within 30 days, after which all your server-side data is permanently deleted.

## 4. Third-Party Services

### 4.1 Privy (Wallet Authentication)

We use **Privy** (privy.io) as a third-party authentication provider. Privy:
- Handles secure wallet connection and authentication
- Never accesses your seed phrase or private keys
- May collect analytics on authentication events (see Privy's Privacy Policy: https://www.privy.io/privacy-policy)

**Your private keys remain on your device and under your control at all times.**

### 4.2 WalletConnect (Wallet Integration)

We integrate **WalletConnect** (walletconnect.com) for optional wallet connection:
- Enables communication between the App and your external wallet (MetaMask, Trust Wallet, etc.)
- Operates as a relay for wallet signing requests only
- See WalletConnect's Privacy Policy: https://walletconnect.com/privacy

**Your wallet never exposes private keys to ZKProofport; all signing happens within your wallet application.**

### 4.3 Third-Party Verification Services

When you approve a proof request, the requesting application (dApp) may independently submit your proof for verification. Any on-chain verification is performed by the requesting application, not by ZKProofport. ZKProofport does not initiate, process, or facilitate any blockchain transactions or cryptocurrency transfers.

### 4.4 Callback Services

When you approve a proof request, the completed proof is transmitted to a callback URL specified by the requesting application. ZKProofport:
- Does not control or monitor the receiving service
- Is not responsible for the privacy practices of callback endpoints
- Recommends reviewing the requesting application's privacy policy

## 5. Data Security

### 5.1 Local Device Security

- **Encryption**: Locally stored data is encrypted using iOS/Android built-in encryption (iOS Keychain, Android Keystore)
- **No Root Access**: We do not request or require device root access or jailbreak
- **Local Processing**: All proof computations are performed locally on your device using the mopro library

### 5.2 Server-Side Security

- **Encryption in Transit**: All server communication uses TLS 1.3
- **Encryption at Rest**: Server databases are encrypted
- **Access Control**: Server access is limited to authorized personnel with role-based permissions
- **Audit Logging**: Server actions are logged for security monitoring
- **No Proof Data**: Servers never store your proof inputs or computation data

### 5.3 What We Cannot Protect

We cannot guarantee security against:
- Loss of your device
- Malware installed on your device (outside our control)
- Compromise of your wallet's private keys
- Network interception at endpoints you do not control (callback receivers)

## 6. Children's Privacy

The ZKProofport App is not directed to children under 13 years of age. We do not knowingly collect information from children under 13. If we learn that we have collected information from a child under 13, we will delete such information and the child's account immediately.

If you are a parent or guardian and believe your child has provided information to ZKProofport, please contact us at support@zkproofport.app.

**Users must be at least 13 years old to use this App (or the minimum digital age of majority in your jurisdiction, if higher).**

## 7. Changes to This Privacy Policy

We may update this Privacy Policy from time to time to reflect changes in our practices, technology, legal requirements, or other factors. We will notify you of material changes by:
- Posting the updated policy to the App with a new "Last Updated" date
- Requesting your affirmative consent in the App if required by law

**Your continued use of the App after changes become effective constitutes your acceptance of the updated Privacy Policy.**

## 8. Contact Us

If you have questions, concerns, or requests regarding this Privacy Policy or our privacy practices, please contact us:

**Email:** support@zkproofport.app

**Developer:** ZKProofport Team

**Address:** [To be completed with registered office address]

We will respond to privacy inquiries within 30 days.

### Data Subject Rights

Depending on your jurisdiction, you may have the right to:
- Access the personal data we hold about you
- Correct inaccurate or incomplete data
- Delete your data (right to be forgotten)
- Restrict processing
- Data portability
- Object to processing

To exercise any of these rights, please contact support@zkproofport.app with "Privacy Request" in the subject line.

---

## Appendix: Zero-Knowledge Proof Privacy Guarantee

ZKProofport leverages zero-knowledge proof technology to provide mathematical privacy guarantees:

1. **Proof inputs are never transmitted** - Your proof inputs remain private to you
2. **Only proof outputs are shared** - The completed proof is a cryptographic statement verifiable without revealing inputs
3. **Input privacy is mathematically enforced** - It is computationally infeasible to derive your inputs from a zero-knowledge proof
4. **Wallet connection is for authentication only** - We use your wallet address solely for identity verification (signing), not for any financial transactions

This privacy model is fundamentally different from traditional apps that collect and process personal data. ZKProofport's architecture ensures your data remains under your control on your device.

---

**Document Version:** 1.0
**Status:** Ready for Use
**License:** © 2026 ZKProofport Team. All rights reserved.
