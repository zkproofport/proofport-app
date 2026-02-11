# Proofport App

React Native mobile app for generating zero-knowledge proofs on mobile devices using [mopro](https://github.com/zkmopro/mopro) Rust library with UniFFI bindings.

## Features

- **Coinbase KYC Attestation**: Prove Coinbase attestation without revealing identity details
- **Country Attestation**: Verify country of residence through Coinbase attestation
- **QR-based Deep Linking**: Scan QR codes to receive proof requests from external dApps
- **Wallet Integration**: Connect wallets via Privy (embedded) and WalletConnect (AppKit)
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
│   │   ├── proof/             # Proof generation: circuit selection, generation, completion
│   │   ├── wallet/            # Wallet connection: Privy and WalletConnect flows
│   │   ├── history/           # Proof history viewing and details
│   │   ├── scan/              # QR code scanning for deep link requests
│   │   ├── more/              # Settings, legal, and user information
│   │   ├── MainScreen.tsx     # Legacy landing screen
│   │   ├── LoadingScreen.tsx  # Startup initialization
│   │   └── CoinbaseKycScreen.tsx # Legacy Coinbase flow
│   ├── components/
│   │   ├── ui/                # Atomic design: atoms, molecules, organisms
│   │   ├── ProofRequestModal.tsx     # Deep link request modal
│   │   ├── ActionButtons.tsx         # CTA buttons
│   │   ├── Header.tsx               # Navigation header
│   │   ├── LogViewer.tsx            # Debug output panel
│   │   └── StepProgress.tsx         # Multi-step flow indicator
│   ├── hooks/
│   │   ├── useProofHistory.ts        # Proof history management
│   │   ├── useCoinbaseKyc.ts         # KYC attestation generation
│   │   ├── useCoinbaseCountry.ts     # Country attestation generation
│   │   ├── useDeepLink.ts            # Deep link parsing and handling
│   │   ├── usePrivyWallet.ts         # Privy wallet integration
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
│   │   ├── PrivyConfig.ts            # Privy authentication setup
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
   - Circuit Selection: Choose attestation type
   - Proof Generation: Generate ZK proof
   - Proof Complete: Show success and proof data

2. **Wallet** (WalletStackNavigator)
   - Privy embedded wallet
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

### Request Format

```
proofport://proof-request?circuit=<circuit>&signalHash=<hash>&requestId=<id>&callbackUrl=<url>&dappName=<name>
```

### Parameters

- `circuit` (required): Circuit identifier (`coinbase_attestation` or `coinbase_country_attestation`)
- `signalHash` (required): Anti-replay challenge from the dApp
- `requestId` (required): Unique request identifier for callback matching
- `callbackUrl` (required): URL to POST proof response to
- `dappName` (optional): Display name of requesting dApp
- `scope` (optional): Attestation scope (e.g., `age`, `country`)

### Response Format

Proof responses are POST-ed to the callback URL as JSON:

```json
{
  "requestId": "...",
  "circuit": "coinbase_attestation",
  "status": "success|cancelled|error",
  "proof": "0x...",
  "publicInputs": ["0x...", "0x..."],
  "error": "error message if status=error"
}
```

## Circuit Files

Circuit files are downloaded from GitHub at runtime and cached locally. The app supports two circuits:

1. **coinbase_attestation**: Coinbase KYC attestation
   - Input: Coinbase attestation + signer signature
   - Output: Zero-knowledge proof of attestation

2. **coinbase_country_attestation**: Country attestation
   - Input: Country from Coinbase attestation
   - Output: Country-specific proof

### Download Locations

- **Development**: `https://raw.githubusercontent.com/zkproofport/circuits/main/...`
- **Production**: Resolved from latest GitHub Release tag

### Cached Files

Each circuit caches three files:
- `.json` - Circuit definition
- `.srs` - Structured Reference String (proving key)
- `.vk` - Verification key

## Wallet Integration

### Privy (Embedded Wallet)

Handles user authentication and embedded wallet management.

- **Storage**: Custom AsyncStorage adapter (no keychain dependency)
- **Config**: See `src/config/PrivyConfig.ts`

### WalletConnect (AppKit)

Enables connection to external wallets via WalletConnect v2.

- **Config**: See `src/config/AppKitConfig.ts`
- **Project ID**: Required in environment

## Technologies

- **React Native 0.81** - Cross-platform mobile framework
- **TypeScript 5.8** - Type-safe development
- **React Navigation 7** - Tab and stack navigation
- **Expo 54** - Development platform and build system
- **Privy SDK 0.62** - Embedded wallet and authentication
- **AppKit 2.0** - WalletConnect integration
- **AsyncStorage** - Local data persistence
- **mopro-ffi** - UniFFI bindings for Rust proof generation
- **ethers.js 5.7** - Ethereum utilities
- **viem 2.42** - Modern Ethereum library

## Environment Variables

Create `.env` file with:

```bash
PRIVY_APP_ID=your_privy_app_id
PRIVY_CLIENT_ID=your_privy_client_id
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
