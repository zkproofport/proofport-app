#!/usr/bin/env bash
set -euo pipefail

# =============================================================================
# build-ios.sh — Build release IPA for ZKProofport iOS
# =============================================================================
#
# Prerequisites Setup Guide
# -------------------------
#
# 1. Apple Developer Account:
#
#    - Team ID: Y9847K5587 (configured in ios/fastlane/Appfile)
#    - Ensure signing certificates and provisioning profiles are set up
#
# 2. For TestFlight upload (optional), create .env.ios with:
#
#    export ASC_KEY_ID="your-key-id"
#    export ASC_ISSUER_ID="your-issuer-id"
#    export ASC_API_KEY="base64-encoded-key-content"
#
# 3. Install Ruby gems (for Fastlane):
#
#    cd proofport-app && bundle install
#
# 4. Install Node dependencies:
#
#    cd proofport-app && npm install
#
# 5. Install CocoaPods:
#
#    cd proofport-app/ios && pod install
#
# =============================================================================

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$APP_DIR/.env.ios"

usage() {
  echo "Usage: $0 <command> [environment]"
  echo ""
  echo "Commands:"
  echo "  beta [staging|production]   Build IPA and upload to TestFlight"
  echo "  ipa [staging|production]    Build IPA only (for local install)"
  echo "  status                      Check build readiness"
  echo ""
  echo "Environments:"
  echo "  staging      Base Sepolia testnet, staging relay (default)"
  echo "  production   Base Mainnet, production relay"
  echo ""
  echo "Examples:"
  echo "  $0 ipa                  # Build staging IPA (default)"
  echo "  $0 ipa staging          # Build staging IPA"
  echo "  $0 ipa production       # Build production IPA"
  echo "  $0 beta staging         # Build staging + upload to TestFlight"
  echo "  $0 beta production      # Build production + upload to TestFlight"
  echo "  $0 status               # Check if everything is configured"
}

cmd_status() {
  echo "=== iOS Build Status ==="
  echo ""

  # Check env file
  if [[ -f "$ENV_FILE" ]]; then
    echo "[OK] .env.ios exists"
  else
    echo "[INFO] .env.ios not found (only needed for TestFlight upload)"
  fi

  # Check Gemfile/fastlane
  if [[ -f "$APP_DIR/Gemfile" ]]; then
    echo "[OK] Gemfile exists"
  else
    echo "[MISSING] Gemfile — run: cd proofport-app && bundle install"
  fi

  if [[ -f "$APP_DIR/ios/fastlane/Fastfile" ]]; then
    echo "[OK] iOS Fastfile exists"
  else
    echo "[MISSING] iOS Fastfile"
  fi

  # Check node_modules
  if [[ -d "$APP_DIR/node_modules" ]]; then
    echo "[OK] node_modules installed"
  else
    echo "[MISSING] node_modules — run: cd proofport-app && npm install"
  fi

  # Check Pods
  if [[ -d "$APP_DIR/ios/Pods" ]]; then
    echo "[OK] CocoaPods installed"
  else
    echo "[MISSING] Pods — run: cd proofport-app/ios && pod install"
  fi

  # Check workspace
  if [[ -d "$APP_DIR/ios/ProofportApp.xcworkspace" ]]; then
    echo "[OK] Xcode workspace exists"
  else
    echo "[MISSING] Xcode workspace — run pod install first"
  fi

  echo ""
  echo "Version: $(node -e "console.log(require('$APP_DIR/package.json').version)" 2>/dev/null || echo 'unknown')"
}

cmd_beta() {
  local env="${1:-staging}"
  if [[ "$env" != "staging" && "$env" != "production" ]]; then
    echo "ERROR: Invalid environment '$env'. Use 'staging' or 'production'."
    exit 1
  fi

  echo "=== Building IPA + TestFlight Upload ($env) ==="

  # Source App Store Connect credentials if available
  if [[ -f "$ENV_FILE" ]]; then
    source "$ENV_FILE"
  else
    echo "WARNING: .env.ios not found. TestFlight upload will be skipped."
  fi

  cd "$APP_DIR/ios"
  bundle exec fastlane beta env:"$env"

  local ipa_path
  ipa_path=$(find "$APP_DIR/ios/build" -name "*.ipa" 2>/dev/null | head -1)
  if [[ -n "$ipa_path" ]]; then
    echo ""
    echo "IPA built successfully! ($env)"
    echo "Path: $ipa_path"
    echo "Size: $(du -h "$ipa_path" | cut -f1)"
  fi
}

cmd_ipa() {
  local env="${1:-staging}"
  if [[ "$env" != "staging" && "$env" != "production" ]]; then
    echo "ERROR: Invalid environment '$env'. Use 'staging' or 'production'."
    exit 1
  fi

  echo "=== Building IPA ($env) ==="

  cd "$APP_DIR/ios"
  bundle exec fastlane build_ipa env:"$env"

  local ipa_path
  ipa_path=$(find "$APP_DIR/ios/build" -name "*.ipa" 2>/dev/null | head -1)
  if [[ -n "$ipa_path" ]]; then
    echo ""
    echo "IPA built successfully! ($env)"
    echo "Path: $ipa_path"
    echo "Size: $(du -h "$ipa_path" | cut -f1)"
    echo ""
    echo "Install on device:"
    echo "  xcrun devicectl device install app --device <device-id> $ipa_path"
  fi
}

COMMAND="${1:-}"
ENV_ARG="${2:-}"

case "$COMMAND" in
  beta)     cmd_beta "$ENV_ARG" ;;
  ipa)      cmd_ipa "$ENV_ARG" ;;
  status)   cmd_status ;;
  *)        usage ;;
esac
