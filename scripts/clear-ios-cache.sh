#!/bin/bash
# Clear iOS build cache and Xcode DerivedData
# Run this before building if you encounter stale builds or cache issues

echo "=== Clearing iOS Build Cache ==="

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "Project directory: $PROJECT_DIR"

# =============================================================================
# Clear Xcode DerivedData
# =============================================================================
echo ""
echo "Clearing Xcode DerivedData..."
rm -rf ~/Library/Developer/Xcode/DerivedData/ProofPortApp-* 2>/dev/null
echo "DerivedData cleared"

# =============================================================================
# Clear iOS build directory
# =============================================================================
echo ""
echo "Clearing iOS build directory..."
rm -rf "$PROJECT_DIR/ios/build" 2>/dev/null
rm -rf "$PROJECT_DIR/ios/Pods" 2>/dev/null
rm -rf "$PROJECT_DIR/ios/Podfile.lock" 2>/dev/null
echo "iOS build directory cleared"

# =============================================================================
# Clear Metro bundler cache
# =============================================================================
echo ""
echo "Clearing Metro bundler cache..."
rm -rf "$PROJECT_DIR/node_modules/.cache" 2>/dev/null
rm -rf /tmp/metro-* 2>/dev/null
rm -rf /tmp/haste-map-* 2>/dev/null

# Clear React Native cache
echo "Clearing React Native cache..."
rm -rf "$PROJECT_DIR/.react-native" 2>/dev/null

# Clear watchman if installed
if command -v watchman &> /dev/null; then
    echo "Clearing Watchman cache..."
    watchman watch-del-all 2>/dev/null
fi

echo ""
echo "=== iOS Cache Cleared Successfully ==="
echo ""
echo "Next steps:"
echo "  1. Run: npm run pod-install"
echo "  2. Run: npm run ios:device"
