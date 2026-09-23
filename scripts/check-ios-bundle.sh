#!/usr/bin/env bash
set -euo pipefail

# Run the exact Xcode bundle phase before spending time on native compilation.
# Only temporary JS/assets are produced; no signing or upload is performed.
APP_ROOT="$(git rev-parse --show-toplevel)"
cd "$APP_ROOT"
: "${APP_ENV:?Set APP_ENV to the build environment}"
BUNDLE_CHECK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/proofport-ios-bundle.XXXXXX")"
trap 'rm -rf "$BUNDLE_CHECK_DIR"' EXIT

bundle exec ruby -rxcodeproj -e '
  project = Xcodeproj::Project.open(ARGV.fetch(0))
  target = project.targets.find { |item| item.name == "ProofportApp" }
  raise "ProofportApp target not found" unless target
  phase = target.shell_script_build_phases.find { |item| item.name == "Bundle React Native code and images" }
  raise "React Native bundle phase not found" unless phase
  File.write(ARGV.fetch(1), phase.shell_script)
' ios/ProofportApp.xcodeproj "$BUNDLE_CHECK_DIR/bundle.sh"

mkdir -p "$BUNDLE_CHECK_DIR/build/ProofportApp.app"
PROJECT_DIR="$APP_ROOT/ios" \
PROJECT_ROOT="$APP_ROOT" \
NODE_BINARY="$(command -v node)" \
PODS_ROOT="$APP_ROOT/ios/Pods" \
CONFIGURATION=Release \
CONFIGURATION_BUILD_DIR="$BUNDLE_CHECK_DIR/build" \
UNLOCALIZED_RESOURCES_FOLDER_PATH=ProofportApp.app \
PLATFORM_NAME=iphoneos \
USE_HERMES=false \
OPENSTOA_ENABLED=false \
  bash "$BUNDLE_CHECK_DIR/bundle.sh"

test -s "$BUNDLE_CHECK_DIR/build/ProofportApp.app/main.jsbundle"
echo "Release iOS JavaScript bundle verified."
