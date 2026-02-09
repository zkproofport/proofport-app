#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# build-android.sh — Build release AAB/APK for ZKProofport Android
# =============================================================================
#
# Prerequisites Setup Guide
# -------------------------
#
# 1. Generate release keystore (PKCS12, one-time):
#
#    mkdir -p ~/.android/keystores
#    keytool -genkeypair -v \
#      -storetype PKCS12 \
#      -keystore ~/.android/keystores/zkproofport-release.keystore \
#      -alias zkproofport \
#      -keyalg RSA \
#      -keysize 2048 \
#      -validity 10000
#
#    - When prompted for store password, enter your chosen password
#    - Key password will be the same as store password (PKCS12)
#    - Enter organization info when prompted (name, org, city, etc.)
#    - Confirm with "yes" when asked
#
#    IMPORTANT: Back up this keystore securely. If lost, you cannot update
#    your app on Google Play. Google Play App Signing uses this as the
#    "upload key" — Google manages the actual distribution signing key.
#
# 2. Create environment file (proofport-app/.env.keystore):
#
#    export ANDROID_KEYSTORE_FILE="$HOME/.android/keystores/zkproofport-release.keystore"
#    export ANDROID_KEYSTORE_PASSWORD="your-password-here"
#    export ANDROID_KEY_ALIAS="zkproofport"
#    export ANDROID_KEY_PASSWORD="your-password-here"
#
#    - ANDROID_KEYSTORE_FILE: absolute path to the .keystore file
#    - ANDROID_KEYSTORE_PASSWORD: store password set during keytool generation
#    - ANDROID_KEY_ALIAS: must match the -alias used in keytool (zkproofport)
#    - ANDROID_KEY_PASSWORD: same as store password for PKCS12 format
#    - This file is gitignored (.env.keystore in .gitignore)
#
# 3. Install Ruby gems (for Fastlane):
#
#    cd proofport-app && bundle install
#
# 4. Install Node dependencies:
#
#    cd proofport-app && npm install
#
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$APP_DIR/.env.keystore"

usage() {
  echo "Usage: $0 <command> [environment]"
  echo ""
  echo "Commands:"
  echo "  beta [staging|production]   Build release AAB (for Play Console upload)"
  echo "  apk [staging|production]    Build release APK (for direct device install)"
  echo "  status                      Check signing config and build readiness"
  echo ""
  echo "Environments:"
  echo "  staging      Base Sepolia testnet, staging relay (default)"
  echo "  production   Base Mainnet, production relay"
  echo ""
  echo "Examples:"
  echo "  $0 beta                # Build staging AAB (default)"
  echo "  $0 beta staging       # Build staging AAB"
  echo "  $0 beta production    # Build production AAB"
  echo "  $0 apk staging        # Build staging APK for sideloading"
  echo "  $0 apk production     # Build production APK"
  echo "  $0 status             # Check if everything is configured"
}

check_env() {
  if [[ ! -f "$ENV_FILE" ]]; then
    echo "ERROR: $ENV_FILE not found"
    echo "Create it with keystore credentials. See .env.keystore.example"
    exit 1
  fi

  source "$ENV_FILE"

  if [[ -z "${ANDROID_KEYSTORE_FILE:-}" ]]; then
    echo "ERROR: ANDROID_KEYSTORE_FILE not set in $ENV_FILE"
    exit 1
  fi

  if [[ ! -f "${ANDROID_KEYSTORE_FILE/#\~/$HOME}" ]]; then
    # Expand $HOME in path
    local expanded="${ANDROID_KEYSTORE_FILE}"
    expanded="${expanded/#\$HOME/$HOME}"
    if [[ ! -f "$expanded" ]]; then
      echo "ERROR: Keystore file not found: $ANDROID_KEYSTORE_FILE"
      echo "Generate one with:"
      echo "  keytool -genkeypair -v -storetype PKCS12 -keystore ~/.android/keystores/zkproofport-release.keystore -alias zkproofport -keyalg RSA -keysize 2048 -validity 10000"
      exit 1
    fi
  fi

  echo "Signing config OK"
}

cmd_status() {
  echo "=== Android Build Status ==="
  echo ""

  # Check env file
  if [[ -f "$ENV_FILE" ]]; then
    echo "[OK] .env.keystore exists"
    source "$ENV_FILE"
  else
    echo "[MISSING] .env.keystore"
  fi

  # Check keystore file
  local ks="${ANDROID_KEYSTORE_FILE:-}"
  ks="${ks/#\$HOME/$HOME}"
  if [[ -n "$ks" && -f "$ks" ]]; then
    echo "[OK] Keystore: $ks"
  else
    echo "[MISSING] Keystore file: ${ks:-not set}"
  fi

  # Check Gemfile/fastlane
  if [[ -f "$APP_DIR/Gemfile" ]]; then
    echo "[OK] Gemfile exists"
  else
    echo "[MISSING] Gemfile — run: cd proofport-app && bundle install"
  fi

  if [[ -f "$APP_DIR/android/fastlane/Fastfile" ]]; then
    echo "[OK] Android Fastfile exists"
  else
    echo "[MISSING] Android Fastfile"
  fi

  # Check node_modules
  if [[ -d "$APP_DIR/node_modules" ]]; then
    echo "[OK] node_modules installed"
  else
    echo "[MISSING] node_modules — run: cd proofport-app && npm install"
  fi

  echo ""
  echo "Version: $(node -e "console.log(require('$APP_DIR/package.json').version)" 2>/dev/null || echo 'unknown')"
}

cmd_beta() {
  local flavor="${1:-staging}"
  if [[ "$flavor" != "staging" && "$flavor" != "production" ]]; then
    echo "ERROR: Invalid environment '$flavor'. Use 'staging' or 'production'."
    exit 1
  fi

  echo "=== Building Release AAB ($flavor) ==="
  check_env
  source "$ENV_FILE"

  cd "$APP_DIR/android"
  bundle exec fastlane beta flavor:"$flavor"

  local aab_path
  aab_path=$(find "$APP_DIR/android/app/build/outputs/bundle/${flavor}Release" -name "*.aab" 2>/dev/null | head -1)
  if [[ -n "$aab_path" ]]; then
    echo ""
    echo "AAB built successfully! ($flavor)"
    echo "Path: $aab_path"
    echo "Size: $(du -h "$aab_path" | cut -f1)"
    echo ""
    echo "Upload to Play Console:"
    echo "  Play Console → ZKProofport → Testing → Internal testing → Create new release"
  fi
}

cmd_apk() {
  local flavor="${1:-staging}"
  if [[ "$flavor" != "staging" && "$flavor" != "production" ]]; then
    echo "ERROR: Invalid environment '$flavor'. Use 'staging' or 'production'."
    exit 1
  fi

  echo "=== Building Release APK ($flavor) ==="
  check_env
  source "$ENV_FILE"

  cd "$APP_DIR/android"
  bundle exec fastlane build_apk flavor:"$flavor"

  local apk_path
  apk_path=$(find "$APP_DIR/android/app/build/outputs/apk/${flavor}/release" -name "*.apk" 2>/dev/null | head -1)
  if [[ -n "$apk_path" ]]; then
    echo ""
    echo "APK built successfully! ($flavor)"
    echo "Path: $apk_path"
    echo "Size: $(du -h "$apk_path" | cut -f1)"
    echo ""
    echo "Install on device:"
    echo "  adb install $apk_path"
  fi
}

COMMAND="${1:-}"
ENV_ARG="${2:-}"

case "$COMMAND" in
  beta)     cmd_beta "$ENV_ARG" ;;
  apk)      cmd_apk "$ENV_ARG" ;;
  status)   cmd_status ;;
  *)        usage ;;
esac
