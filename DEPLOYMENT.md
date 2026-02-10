# ZKProofport Mobile App Deployment Guide

## Table of Contents

- [1. Version Management](#1-version-management)
- [2. Prerequisites](#2-prerequisites)
- [3. Manual Deployment (from Local Machine)](#3-manual-deployment-from-local-machine)
- [4. CI/CD Deployment (GitHub Actions)](#4-cicd-deployment-github-actions)
- [5. Production Release Checklist](#5-production-release-checklist)
- [6. Troubleshooting](#6-troubleshooting)

---

## 1. Version Management

### Versioning Scheme

- **Semantic Versioning (semver)**: `MAJOR.MINOR.PATCH`
- **Beta phase**: `0.x.x` (current: `0.1.0`)
- **Production release**: starts at `1.0.0`

**Version bump rules:**

| Change Type | Example | Description |
|-------------|---------|-------------|
| `PATCH` | 0.1.0 → 0.1.1 | Bug fixes |
| `MINOR` | 0.1.0 → 0.2.0 | New features (backward compatible) |
| `MAJOR` | 0.x.x → 1.0.0 | Production release or breaking changes |

### Single Source of Truth: package.json

- The `version` field in `package.json` is the **only version source**
- iOS (`project.pbxproj`) and Android (`build.gradle`) are synced automatically via script
- UI reads native version dynamically via `expo-application`

### Version Sync

```bash
# Run after changing version in package.json
npm run version:sync
```

**What this script does:**

- **iOS**: Updates `MARKETING_VERSION` and `CURRENT_PROJECT_VERSION`
- **Android**: Updates `versionName` and `versionCode`
- **versionCode formula**: `major * 10000 + minor * 100 + patch`
  - e.g., `0.1.0` → `100`
  - e.g., `1.2.3` → `10203`

### Version Change Procedure

1. Edit `version` in `package.json`
2. Run `npm run version:sync`
3. Verify changed files: `package.json`, `project.pbxproj`, `build.gradle`
4. Commit

### semantic-release (Automation)

- Automatic version determination based on **Conventional Commits**
- **Tag format**: `app-v0.1.0`
- **Version bump rules**:
  - `feat:` commit → minor version bump
  - `fix:` commit → patch version bump
  - `feat!:` or `BREAKING CHANGE:` → major version bump
- **Config file**: `.releaserc.json`

---

## 2. Prerequisites

### Common Setup

```bash
# Install Ruby + Fastlane
cd proofport-app
bundle install

# Install Node dependencies
npm install
```

### iOS Prerequisites

#### Apple Developer Account

- Apple Developer Program membership required ($99/year)
- **Team ID**: `Y9847K5587`
- **Bundle ID**: `com.zkproofport.app`

#### App Store Connect API Key

1. Go to [App Store Connect](https://appstoreconnect.apple.com) → Users and Access → Integrations → App Store Connect API
2. Create a new key (Admin role)
3. Save the following values:
   - `ASC_KEY_ID`: Key ID
   - `ASC_ISSUER_ID`: Issuer ID
   - `ASC_API_KEY`: Base64-encoded contents of the .p8 file

**How to Base64-encode:**

```bash
base64 -i AuthKey_XXXXX.p8 | pbcopy
```

#### Code Signing (Fastlane Match)

Fastlane Match stores certificates and provisioning profiles in a Git repo for team sharing.

```bash
# Initial setup (one-time only)
cd ios
bundle exec fastlane match init
# Select storage mode: git
# Enter Git URL (private repo)

# Generate certificates
bundle exec fastlane match appstore
```

**Required values:**

- `MATCH_GIT_URL`: Git repo URL for Match certificates
- `MATCH_PASSWORD`: Match encryption password

#### TestFlight Initial Setup

1. Register the app in App Store Connect (Bundle ID: `com.zkproofport.app`)
2. Fill in app name, category, screenshots, and basic info
3. Create an internal testing group in TestFlight

### Android Prerequisites

#### Release Keystore Generation

```bash
keytool -genkeypair \
  -v \
  -storetype PKCS12 \
  -keystore release.keystore \
  -alias zkproofport \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000 \
  -dname "CN=ZKProofport, OU=Mobile, O=ZKProofport, L=Seoul, S=Seoul, C=KR"
```

> **Warning**: Never lose the keystore file or password. Apps uploaded to the Play Store can only be updated with the same keystore.

**Required values:**

- `ANDROID_KEYSTORE_FILE`: Keystore file path (`release.keystore` in CI)
- `ANDROID_KEYSTORE_PASSWORD`: Keystore password
- `ANDROID_KEY_ALIAS`: Key alias (e.g., `zkproofport`)
- `ANDROID_KEY_PASSWORD`: Key password

#### Google Play Console Setup

1. Register a developer account at [Google Play Console](https://play.google.com/console) ($25 one-time)
2. Create a new app (package name: `com.zkproofport.app`)
3. Set up internal testing track

---

## 3. Manual Deployment (from Local Machine)

> **Note**: "Manual" means running build commands on your local Mac (as opposed to CI/CD).
> The built artifacts are still uploaded to cloud services (TestFlight / Play Store) for testers to download.

### iOS → TestFlight (Beta Distribution)

TestFlight is Apple's official cloud-based beta testing platform. After uploading, testers install the app via the **TestFlight app** on their iOS devices (up to 10,000 external testers).

```bash
cd ios

# Set environment variables
export ASC_KEY_ID="your-key-id"
export ASC_ISSUER_ID="your-issuer-id"
export ASC_API_KEY="base64-encoded-p8-key"
export MATCH_GIT_URL="https://github.com/your-org/match-certs.git"
export MATCH_PASSWORD="your-match-password"

# Build + upload to TestFlight
bundle exec fastlane ios beta
```

### iOS → App Store (Production)

```bash
cd ios
bundle exec fastlane ios release
```

### Android → AAB (Play Store)

```bash
cd android

# Set environment variables
export ANDROID_KEYSTORE_FILE="/path/to/release.keystore"
export ANDROID_KEYSTORE_PASSWORD="your-password"
export ANDROID_KEY_ALIAS="zkproofport"
export ANDROID_KEY_PASSWORD="your-password"

# Build AAB
bundle exec fastlane android beta
```

### Android → APK (Direct Install)

```bash
cd android
bundle exec fastlane android build_apk
```

Output APK location: `android/app/build/outputs/apk/release/app-release.apk`

---

## 4. CI/CD Deployment (GitHub Actions)

### GitHub Secrets Configuration

Go to Repository → Settings → Secrets and variables → Actions and add the following secrets:

| Secret | Description | Example |
|--------|-------------|---------|
| `GH_PAT` | GitHub Personal Access Token (repo scope) | `ghp_xxxx` |
| `ASC_KEY_ID` | App Store Connect API Key ID | `ABCD1234EF` |
| `ASC_ISSUER_ID` | App Store Connect Issuer ID | `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` |
| `ASC_API_KEY` | Base64-encoded .p8 key file | `base64 -i AuthKey_XXX.p8` |
| `MATCH_GIT_URL` | Git repo URL for Match certificates | `https://github.com/org/certs.git` |
| `MATCH_PASSWORD` | Match encryption password | - |
| `ANDROID_KEYSTORE_BASE64` | Base64-encoded keystore | `base64 -i release.keystore` |
| `ANDROID_KEYSTORE_PASSWORD` | Keystore password | - |
| `ANDROID_KEY_ALIAS` | Key alias | `zkproofport` |
| `ANDROID_KEY_PASSWORD` | Key password | - |

**How to Base64-encode:**

```bash
# iOS .p8 key
base64 -i AuthKey_XXXXX.p8 | pbcopy

# Android keystore
base64 -i release.keystore | pbcopy
```

### Running the Workflow

1. Go to GitHub → Actions → "Release App" → "Run workflow"
2. Select options:
   - `dry_run`: true (test only) / false (actual deployment)
   - `platform`: both / ios / android

### Pipeline Flow

```
workflow_dispatch
    │
    ▼
[version] Determine version via semantic-release
    │
    ├──────────────────┐
    ▼                  ▼
[build-ios]      [build-android]
TestFlight        AAB build
```

---

## 5. Production Release Checklist

### Pre-Release Preparation

#### Code Quality

- [ ] All TypeScript errors resolved (`npx tsc --noEmit`)
- [ ] Lint passes (`npm run lint`)
- [ ] No critical bugs

#### Testing

- [ ] Full flow test on iOS Simulator
- [ ] Full flow test on Android Emulator
- [ ] Physical device testing (iOS + Android)
- [ ] Deep link handling verified
- [ ] Wallet connection (Privy + WalletConnect) tested
- [ ] Proof generation → verification full flow tested
- [ ] Dark mode / Light mode UI verified
- [ ] Network error handling verified
- [ ] ErrorModal system working correctly

#### App Store Preparation

- [ ] App icon (1024x1024)
- [ ] Screenshots (iPhone 6.7", 6.1", iPad)
- [ ] App description (Korean / English)
- [ ] Privacy policy URL
- [ ] Support URL
- [ ] App category configured
- [ ] Age rating confirmed

#### Play Store Preparation

- [ ] Feature Graphic (1024x500)
- [ ] Screenshots (phone, 7" tablet, 10" tablet)
- [ ] App description (Korean / English)
- [ ] Privacy policy URL
- [ ] Content rating questionnaire completed
- [ ] Data safety section filled out

### Release Procedure

#### 1. Finalize Version

```bash
# Change package.json version to 1.0.0
npm run version:sync
```

#### 2. Final Build Test

```bash
# iOS
cd ios && bundle exec fastlane ios beta
# Verify on TestFlight

# Android
cd android && bundle exec fastlane android beta
# Verify on internal test track
```

#### 3. Production Deployment

```bash
# iOS → Submit to App Store Review
cd ios && bundle exec fastlane ios release

# Android → Upload AAB to Play Store
cd android && bundle exec fastlane android beta
# Promote to production track in Play Console
```

#### 4. Create Tag

```bash
git tag app-v1.0.0
git push origin app-v1.0.0
```

#### 5. Post-Release Monitoring

- [ ] App Store review status (typically 24-48 hours)
- [ ] Play Store review status (typically a few hours to 3 days)
- [ ] Crash report monitoring (Sentry/Crashlytics when integrated)
- [ ] User feedback monitoring

---

## 6. Troubleshooting

### iOS Build Failure

**Symptom**: CocoaPods or Xcode build errors

```bash
# Reset CocoaPods cache
cd ios && pod deintegrate && pod install

# Clear Xcode derived data
rm -rf ~/Library/Developer/Xcode/DerivedData

# Full reset
npm run clean:ios
```

### Android Build Failure

**Symptom**: Gradle build errors

```bash
# Clean Gradle cache
cd android && ./gradlew clean

# Full cache reset
npm run clean:android

# Reinstall dependencies
cd .. && npm install
```

### Match Certificate Issues

**Symptom**: Code signing errors or expired certificates

```bash
# Renew certificates
cd ios && bundle exec fastlane match nuke appstore
bundle exec fastlane match appstore
```

> **Warning**: `match nuke` deletes existing certificates. Coordinate with team members before running.

### semantic-release Not Working as Expected

**Symptom**: Automatic version determination produces unexpected results

```bash
# Check next version with dry-run
npx semantic-release --dry-run
```

### TestFlight Upload Failure

**Symptom**: API authentication or upload errors

- Verify App Store Connect API Key is not expired
- Re-check `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_API_KEY` values
- Verify API Key status in App Store Connect

### Play Store AAB Upload Failure

**Symptom**: Signing errors or version conflicts

- Verify `versionCode` is higher than the previous version
- Re-check keystore password
- Check previous version status in Play Console

### mopro Build Errors

**Symptom**: `mopro-ffi` native module build failure

```bash
# Check Rust toolchain
rustc --version
cargo --version

# Rebuild mopro from project root
cd /Users/nhn/Workspace/proofport-app-dev
./scripts/mopro_build.sh
```

### Native Module Link Errors

**Symptom**: `mopro-ffi` or other native module linking failure

```bash
# iOS
cd ios && pod install

# Android
npm run clean:android
```

---

## Appendix

### Useful Commands

```bash
# Check current version
node -e "console.log(require('./package.json').version)"

# List iOS simulators
xcrun simctl list devices

# List Android emulators
emulator -list-avds

# Check build artifacts
# iOS
ls -lh ios/build/ProofportApp.ipa
# Android
ls -lh android/app/build/outputs/bundle/release/app-release.aab
ls -lh android/app/build/outputs/apk/release/app-release.apk
```

### References

- [Fastlane Documentation](https://docs.fastlane.tools/)
- [Fastlane Match Guide](https://docs.fastlane.tools/actions/match/)
- [semantic-release Documentation](https://semantic-release.gitbook.io/)
- [App Store Connect API](https://developer.apple.com/documentation/appstoreconnectapi)
- [Google Play Console Help](https://support.google.com/googleplay/android-developer)
