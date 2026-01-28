# ProofPort App

A React Native mobile app for generating zero-knowledge proofs on mobile devices using [mopro](https://github.com/zkmopro/mopro).

## Features

- **Age Verifier**: Prove you are above a minimum age without revealing your birth date
- **Coinbase KYC**: Prove Coinbase attestation without revealing identity details
- **Wallet Integration**: Connect external wallets via WalletConnect/Privy

## Prerequisites

- Node.js 18+
- Ruby 3.0+ (for iOS)
- Xcode 15+ (for iOS)
- Android Studio (for Android)
- CocoaPods

## Setup

```bash
# Install dependencies
npm install

# Install iOS pods
cd ios && bundle install && bundle exec pod install && cd ..
```

## Running the App

### iOS Simulator

```bash
npm run ios
```

### iOS Device

```bash
npm run ios -- --device
```

### Android

```bash
npm run android
```

## Project Structure

```
proofport-app/
├── src/
│   ├── components/     # Reusable UI components
│   ├── screens/        # App screens
│   ├── hooks/          # Custom React hooks
│   ├── utils/          # Utility functions
│   └── config/         # App configuration
├── mopro_bindings/     # Mopro native bindings
├── ios/                # iOS native code
├── android/            # Android native code
└── scripts/            # Build and utility scripts
```

## Circuit Files

Circuit files (.json, .srs, .vk) are downloaded from GitHub at runtime:
- `age_verifier`: From mopro-101 repository
- `coinbase_attestation`: From zkproofport/circuits repository

## Scripts

```bash
# Clear iOS build cache
./scripts/clear-ios-cache.sh

# Clear Android build cache
./scripts/clear-android-cache.sh

# Test WalletConnect relay
node scripts/test-walletconnect.js
```

## License

MIT
