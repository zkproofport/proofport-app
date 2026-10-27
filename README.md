# Proofport App

React Native mobile app for generating zero-knowledge proofs on mobile devices using [mopro](https://github.com/zkmopro/mopro) Rust library with UniFFI bindings.

## Features

- **Coinbase KYC Attestation**: Prove Coinbase attestation without revealing identity details
- **Country Attestation**: Verify country of residence through Coinbase attestation
- **OIDC Domain Attestation**: Prove email domain affiliation (Google, Google Workspace, Microsoft 365) via OIDC JWT without revealing email
- **Microsoft 365 Support**: Authenticate with Microsoft 365 organizational accounts
- **QR-based Deep Linking**: Scan QR codes to receive proof requests from external dApps
- **Proof Home**: Search and filter organization account, Coinbase KYC, and country proofs, with a direct QR scanner entry
- **Laboratory**: Active GIWA, Dojang Playground and Korean mobile ID ownership, age, and region proof flows
- **Request Review**: Review incoming proof conditions and read-only EIP-712 action keys and values before continuing to signing and generation
- **Wallet Integration**: Connect external wallets over WalletConnect (Reown AppKit)
- **Proof History**: Persistent storage and viewing of generated proofs
- **Runtime Circuit Downloads**: Circuit files (JSON, SRS, VK) downloaded from GitHub at startup
- **Deep Link Protocol**: Receive proof requests via `proofport://` URI scheme

## Prerequisites

- Node.js 20+
- Ruby 3.0+ (for iOS)
- Xcode 15+ (for iOS)
- Android Studio with NDK (for Android)
- CocoaPods

## Setup

```bash
# Install dependencies
npm install

# Install iOS pods
cd ios && bundle install && bundle exec pod install && cd ..
```

## Running

```bash
# iOS Simulator
npm run ios

# iOS Device
npm run ios:device

# Android
npm run android

# TypeScript type checking
npx tsc --noEmit
```

### Clean Builds

```bash
# Clean iOS build
npm run ios:clean

# Clean Android build
npm run android:clean

# Clean both
npm run clean:all
```

## Project Structure

```
proofport-app/
├── App.tsx                     # Entry point, deep link handling, provider setup
├── src/
│   ├── screens/
│   │   ├── proof/             # Proof home, laboratory, inputs, generation, completion
│   │   ├── wallet/            # Wallet connection over WalletConnect
│   │   ├── history/           # Proof history viewing and details
│   │   ├── scan/              # QR code scanning for deep link requests
│   │   ├── more/              # Settings, legal, and user information
│   │   ├── MainScreen.tsx     # Legacy landing screen
│   │   ├── LoadingScreen.tsx  # Startup initialization
│   │   └── CoinbaseKycScreen.tsx # Legacy Coinbase flow
│   ├── components/
│   │   ├── ui/                # Atomic design: atoms, molecules, organisms
│   │   ├── ProofRequestModal.tsx     # Full-screen incoming request review
│   │   ├── ActionReviewCard.tsx      # Typed-action summary and field details
│   │   ├── ReadonlyValue.tsx         # Recursive read-only action and request data
│   │   ├── ActionButtons.tsx         # CTA buttons
│   │   ├── Header.tsx               # Navigation header
│   │   ├── LogViewer.tsx            # Debug output panel
│   │   └── StepProgress.tsx         # Multi-step flow indicator
│   ├── hooks/
│   │   ├── useProofHistory.ts        # Proof history management
│   │   ├── useCoinbaseKyc.ts         # KYC attestation generation
│   │   ├── useCoinbaseCountry.ts     # Country attestation generation
│   │   ├── useDeepLink.ts            # Deep link parsing and handling
│   │   ├── useWallet.ts              # Wallet connection state and signing
│   │   ├── useWalletConnect.ts       # WalletConnect (AppKit) integration
│   │   ├── useLogs.ts                # Debug logging
│   │   └── useSettings.ts            # User settings management
│   ├── stores/
│   │   ├── proofHistoryStore.ts      # AsyncStorage-backed proof history
│   │   ├── proofLogStore.ts          # Debug logs storage
│   │   └── settingsStore.ts          # User preferences
│   ├── context/
│   │   └── DeepLinkContext.tsx       # Deep link request context
│   ├── config/
│   │   ├── AppKitConfig.ts           # WalletConnect AppKit setup
│   │   ├── WalletConnectConfig.ts    # WalletConnect project id and app metadata
│   │   ├── contracts.ts              # Circuit metadata and contract addresses
│   │   ├── deployments.ts            # Environment-specific deployments
│   │   └── environment.ts            # Runtime environment detection
│   ├── utils/
│   │   ├── circuitDownload.ts        # Circuit file download and caching
│   │   ├── deeplink.ts               # Deep link parsing and validation
│   │   ├── coinbaseKyc.ts            # KYC utility functions
│   │   ├── attestationSearch.ts      # Attestation verification utilities
│   │   ├── format.ts                 # Text formatting helpers
│   │   └── asset.ts                  # Asset management
│   ├── navigation/
│   │   ├── TabNavigator.tsx          # Bottom tab navigation (5 tabs)
│   │   ├── stacks/                   # Individual stack navigators per tab
│   │   ├── types.ts                  # Navigation type definitions
│   │   └── shared.tsx                # Shared navigation config
│   └── theme/
│       └── index.ts                  # Design tokens and colors
├── mopro_bindings/                  # UniFFI Rust bindings (pre-built, do not modify)
├── ios/                             # iOS native project
├── android/                         # Android native project
└── scripts/
    ├── clear-ios-cache.sh           # Clear iOS build artifacts
    └── clear-android-cache.sh       # Clear Android build artifacts
```

## Navigation Tabs

The app uses a bottom tab navigation with 5 main sections:

1. **Proof** (ProofStackNavigator)
   - Proof Home: Search and filter organization account, Coinbase KYC, and country proofs; open the QR scanner
   - Laboratory: GIWA, Dojang Playground and Korean mobile ID proofs, shown when Laboratory is turned on in More
   - Input Screens: Standalone proof parameters; manual action entry is limited to standalone testing
   - Proof Generation: Generate ZK proof
   - Proof Complete: Show success and proof data

2. **Wallet** (WalletStackNavigator)
   - WalletConnect modal
   - Connection status display

3. **Scan** (ScanStackNavigator)
   - QR code scanner
   - Deep link request handling

4. **History** (HistoryStackNavigator)
   - Proof history list
   - Proof detail view with verifier

5. **More** (MoreStackNavigator)
   - Settings
   - Legal information
   - Placeholder screens

## Deep Link Protocol

The app receives proof requests from external dApps via the `proofport://` URI scheme.

Incoming requests, including Korean mobile ID, open a full-screen review before proof generation. The review shows circuit-specific conditions and disclosure summaries. When the dApp includes an EIP-712 action, a compact card displays its primary type; its chevron opens a separate message view with the original field names and values in rows. Nested objects, arrays, domain fields, type definitions, and request metadata can be expanded without displaying serialized JSON. Values are not converted into token amounts or interpreted as a particular business operation. The app passes the reviewed request to the existing signing flow; it does not ask the user to recreate the dApp's inputs.

The callback address identifies where the proof will be delivered, not a verified website identity. Expired and unsupported requests cannot be accepted, and rejecting a request retains the existing cancellation callback and return-to-requester flow.

### Request Format

```
proofport://proof-request?circuit=<circuit>&signalHash=<hash>&requestId=<id>&callbackUrl=<url>&dappName=<name>
```

### Parameters

- `circuit` (required): Circuit identifier (`coinbase_attestation`, `coinbase_country_attestation`, `oidc_domain_attestation`, `giwa_attestation`, or `dojang_playground`). The canonical list is `@zkproofport-app/sdk/circuits`; an id not in it is refused rather than proved as something else
- `signalHash` (required): Anti-replay challenge from the dApp
- `requestId` (required): Unique request identifier for callback matching
- `callbackUrl` (required): URL to POST proof response to
- `dappName` (optional): Display name of requesting dApp
- `scope` (optional): Attestation scope (e.g., `age`, `country`)

### Response Format

Every request that came through a trusted relay gets exactly **one** terminal
answer, POST-ed to the callback URL as JSON: `completed`, `error` or
`cancelled`. App-internal proofs (Laboratory, no request) send nothing.

```json
{
  "requestId": "...",
  "circuit": "coinbase_attestation",
  "status": "completed|error|cancelled",
  "proof": "0x...",
  "publicInputs": ["0x...", "0x..."],
  "verifierAddress": "0x...",
  "chainId": 8453,
  "nullifier": "0x...",
  "error": "human-readable reason (error and cancelled)",
  "errorCode": "E2005"
}
```

- `errorCode` (`^E\d{4}$`, `error` only) is the ErrorModal code the user was
  shown for that failure — see `src/constants/errorCodes.ts`.
- `cancelled` is sent when the user rejects the review card, dismisses the
  sign-in sheet, rejects the signature in the wallet (EIP-1193 `4001` /
  WalletConnect `5000`), or leaves the proof screen before it finished; also
  when a newer request replaces one still waiting for review, or a review is
  dropped after the app sat in the background too long.
- A request the app was killed during is answered `cancelled` on the next
  launch (or with the error that could not be delivered).
- The relay answers `409` to a second answer or to one after it timed the
  request out; the app reads that as "already answered" and, for a timeout,
  shows E1003. All of this lives in `src/utils/relayAnswer.ts`.

## Circuit Files

Circuit files are downloaded from GitHub at runtime and cached locally. Attestation circuits include:

1. **coinbase_attestation**: Coinbase KYC attestation
   - Input: Coinbase attestation + signer signature
   - Output: Zero-knowledge proof of attestation

2. **coinbase_country_attestation**: Country attestation
   - Input: Country from Coinbase attestation
   - Output: Country-specific proof

3. **oidc_domain_attestation**: OIDC domain attestation
   - Input: OIDC JWT from Google or Microsoft
   - Output: Proof of email domain affiliation without revealing email

4. **giwa_attestation** (Laboratory): GIWA account attestation
   - Input: a GIWA-attested wallet, optionally binding one EIP-712 action the wallet signs.
   - Output: with an action, a proof carrying the action's domain separator and struct
     hash, so a verifier checks WHICH action was authorised.
   - Verification network: GIWA Sepolia (chain 91342).

5. **dojang_playground** (Laboratory): Dojang Playground
   - Input: the connected wallet's own `payAndIssueEAS()` call to the GIWA Playground
     faucet `0x63CCe2b569A7bC35895ee24306c1512fefc06121` (legacy or EIP-1559), found
     through the GIWA explorer, re-read over RPC and hashed back before use, plus the
     wallet's signature over the request (signal hash, or an optional EIP-712 action).
   - A wallet with no such issuance gets error E2007; an explorer or RPC failure is
     E3002, never "no issuance".
   - Verification network: GIWA Sepolia (chain 91342), verifier
     `0x2d01C2fE3445B7DDE60118f956BB14E84Fd64724`.
   - Unit fixtures: `scripts/make-dojang-playground-fixtures.py` rewrites
     `src/utils/__tests__/fixtures/dojangPlayground.json` from the circuits repo's
     Prover.toml files and the GIWA RPC.

### Standalone action testing

With Laboratory turned on in More, open Laboratory in the Verify tab and choose
GIWA. It opens the action input screen without a relay request. Select
Deposit, Withdraw, Transfer, or a custom action, then enter the app name, contract,
and field values. The signed domain follows the selected circuit's network.

Generate proof asks the wallet to switch to that network and signs the structured
action with `eth_signTypedData_v4`. This signs an authorization; it does not execute
the sample Deposit or transfer funds. Prove identity only keeps the action-free
`personal_sign` flow, whose hash may appear as unreadable characters in the wallet.

The local iOS `build_ipa` lane explicitly maps both the app and notification
extension to their development provisioning profiles when exporting the IPA.

Experimental circuit files and verifier broadcasts read `main` in every build,
including production. Their verifier cache follows the circuit data version so
an address cached for older circuit bytes cannot override the current verifier.
Supported circuits (Coinbase KYC, Coinbase Country, OIDC domain) in a production
build read exactly `CIRCUITS_RELEASE_TAG` (`src/config/contracts.ts`), one tag per
app version -- never the newest release, never `main`. A missing tag is an error
naming it (E3007 at launch, E3005 on download).

### Download Locations

- **Development**: `https://raw.githubusercontent.com/zkproofport/circuits/main/...`
- **Development / staging**: `main` for every circuit
- **Production**: `https://raw.githubusercontent.com/zkproofport/circuits/<CIRCUITS_RELEASE_TAG>/...` for the supported circuits

### Cached Files

Each circuit caches three files:
- `.json` - Circuit definition
- `.srs` - Structured Reference String (proving key)
- `.vk` - Verification key

## Wallet Integration

### WalletConnect (Reown AppKit)

The only wallet path. There is no embedded wallet and no separate sign-in step:
connecting an external wallet IS the authenticated state. Private keys never
leave the user's wallet app.

- **Config**: `src/config/AppKitConfig.ts`, `src/config/WalletConnectConfig.ts`
- **Project ID**: Required in environment (`REOWN_PROJECT_ID`)

## Technologies

- **React Native 0.81** - Cross-platform mobile framework
- **TypeScript 5.8** - Type-safe development
- **React Navigation 7** - Tab and stack navigation
- **Expo 54** - Development platform and build system
- **AppKit 2.0** - WalletConnect integration
- **AsyncStorage** - Local data persistence
- **mopro-ffi** - UniFFI bindings for Rust proof generation
- **ethers.js 5.7** - Ethereum utilities
- **viem 2.42** - Modern Ethereum library

## Environment Variables

Create `.env` file with:

```bash
REOWN_PROJECT_ID=your_walletconnect_project_id
```

## Development Scripts

```bash
# Start Metro bundler
npm start

# Type checking
npx tsc --noEmit

# Linting
npm run lint

# Tests
npm run test

# Mutation check: break each "one answer per relay request" guard and
# confirm a test goes red (restores every file byte-for-byte)
python3 scripts/mutate-relay-answer-guards.py

# iOS custom build workflow
npm run ios:build       # Compile
npm run ios:install     # Install on simulator
npm run ios:launch      # Launch app
npm run ios:run         # All three above
```

## Build Artifacts

- iOS: `.xcworkspace` project (use workspace, not `.xcodeproj`)
- Android: Gradle-based build with NDK support for Rust bindings
- Mopro bindings: Pre-built universal libraries, do not rebuild unless updating mopro

## Debugging

The app includes a `LogViewer` component for debug output:

1. Navigate to MyInfo tab
2. Access debug logs section
3. View real-time app logs and proof generation status

## Common Issues

### iOS Pod Installation Fails

```bash
cd ios
rm -rf Pods
rm Podfile.lock
pod repo update
pod install
cd ..
```

### Android Build Fails

```bash
./scripts/clear-android-cache.sh
npm run android
```

### Circuit Download Fails

Ensure the app can reach GitHub and has network permission. Check logs in More debug section.

## Deployment

For CI/CD workflows, beta testing setup, and production release instructions, see [DEPLOYMENT.md](./DEPLOYMENT.md).

## License

MIT
