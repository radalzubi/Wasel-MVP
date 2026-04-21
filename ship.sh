#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# ship.sh — Build and upload to TestFlight using your Mac (no EAS credits)
#
# Usage:
#   ./ship.sh rider     → builds and uploads the Rider app
#   ./ship.sh driver    → builds and uploads the Driver app
#
# One-time setup: fill in .ship-secrets (see .ship-secrets.example)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

APP="${1:?Usage: ./ship.sh rider  OR  ./ship.sh driver}"

# ── Load credentials ──────────────────────────────────────────────────────────
SECRETS_FILE="$(dirname "$0")/.ship-secrets"
if [[ ! -f "$SECRETS_FILE" ]]; then
  echo "❌ Missing .ship-secrets file."
  echo "   Copy .ship-secrets.example → .ship-secrets and fill it in."
  exit 1
fi
# shellcheck source=.ship-secrets
source "$SECRETS_FILE"

# ── Config ────────────────────────────────────────────────────────────────────
ROOT="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$ROOT/$APP"
BUILD_DIR="$APP_DIR/build"
P8_PATH="$HOME/.private_keys/AuthKey_${ASC_KEY_ID}.p8"

case "$APP" in
  rider)
    BUNDLE_ID="com.waselapp.rider"
    APP_LABEL="Wasel Rider"
    ;;
  driver)
    BUNDLE_ID="com.waselapp.driver"
    APP_LABEL="Wasel Driver"
    ;;
  *)
    echo "❌ Unknown app '$APP'. Use 'rider' or 'driver'."
    exit 1
    ;;
esac

# Build number = unix timestamp so it always increments automatically
BUILD_NUMBER=$(date +%s)

echo ""
echo "┌─────────────────────────────────────────────────────┐"
echo "│  Shipping: $APP_LABEL"
echo "│  Bundle:   $BUNDLE_ID"
echo "│  Build #:  $BUILD_NUMBER"
echo "└─────────────────────────────────────────────────────┘"
echo ""

# ── Step 1: Expo prebuild ──────────────────────────────────────────────────────
echo "▶ Step 1/5 — Expo prebuild (generates native iOS project)"
cd "$APP_DIR"
EXPO_PUBLIC_API_URL="$API_URL" npx expo prebuild --platform ios --clean
echo "   ✓ Done"

# ── Step 2: Pod install ────────────────────────────────────────────────────────
echo ""
echo "▶ Step 2/5 — pod install (installs iOS dependencies)"
cd "$APP_DIR/ios"
pod install --silent
cd "$APP_DIR"

# Fix: expo-notifications registers two CocoaPods targets that both produce
# ExpoNotifications_privacy.bundle, causing "Multiple commands produce" error.
# We use the xcodeproj gem (already installed by CocoaPods) to strip all build
# phases from the duplicate legacy target directly in the Pods project file.
# Use Homebrew ruby — it has the xcodeproj gem installed by CocoaPods
RUBY_BIN="/opt/homebrew/bin/ruby"
[[ ! -f "$RUBY_BIN" ]] && RUBY_BIN="ruby"
"$RUBY_BIN" - "$APP_DIR/ios/Pods/Pods.xcodeproj" <<'RUBYEOF'
require 'xcodeproj'
path = ARGV[0]
project = Xcodeproj::Project.open(path)
target = project.targets.find { |t| t.name == 'EXNotifications-ExpoNotifications_privacy' }
if target
  target.build_phases.each(&:remove_from_project)
  project.save
  puts "   ✓ Removed duplicate ExpoNotifications build phases"
else
  puts "   ✓ No duplicate target found (already clean)"
end
RUBYEOF

echo "   ✓ Done"

# ── Detect workspace and scheme ────────────────────────────────────────────────
WORKSPACE=$(find "$APP_DIR/ios" -maxdepth 1 -name "*.xcworkspace" | head -1)
if [[ -z "$WORKSPACE" ]]; then
  echo "❌ Could not find .xcworkspace in $APP_DIR/ios"
  exit 1
fi
# Derive scheme from workspace name — this is always the main app scheme
# for Expo-generated projects (e.g. WaselRider.xcworkspace → WaselRider)
SCHEME=$(basename "$WORKSPACE" .xcworkspace)
echo "   Workspace: $(basename "$WORKSPACE")"
echo "   Scheme:    $SCHEME"

# ── Step 3: Archive ────────────────────────────────────────────────────────────
# Skip code signing during archive — the export step (Step 4) handles all
# signing with the App Store distribution certificate via the API key.
echo ""
echo "▶ Step 3/5 — Archive (compiling... this takes 10–15 min)"
mkdir -p "$BUILD_DIR"
xcodebuild archive \
  -workspace "$WORKSPACE" \
  -scheme "$SCHEME" \
  -configuration Release \
  -destination "generic/platform=iOS" \
  -archivePath "$BUILD_DIR/$SCHEME.xcarchive" \
  CURRENT_PROJECT_VERSION="$BUILD_NUMBER" \
  MARKETING_VERSION="1.0.0" \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY="" \
  -quiet
echo "   ✓ Archive created"

# ── Step 4: Export IPA ─────────────────────────────────────────────────────────
# This is where actual App Store signing happens using the API key.
echo ""
echo "▶ Step 4/5 — Exporting and signing IPA"
rm -rf "$BUILD_DIR/export"
cat > "$BUILD_DIR/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>app-store</string>
  <key>teamID</key>
  <string>${APPLE_TEAM_ID}</string>
  <key>signingStyle</key>
  <string>automatic</string>
  <key>uploadSymbols</key>
  <true/>
  <key>compileBitcode</key>
  <false/>
</dict>
</plist>
PLIST

xcodebuild -exportArchive \
  -archivePath "$BUILD_DIR/$SCHEME.xcarchive" \
  -exportOptionsPlist "$BUILD_DIR/ExportOptions.plist" \
  -exportPath "$BUILD_DIR/export" \
  -allowProvisioningUpdates \
  -authenticationKeyPath "$P8_PATH" \
  -authenticationKeyID "$ASC_KEY_ID" \
  -authenticationKeyIssuerID "$ASC_ISSUER_ID" \
  -quiet
echo "   ✓ IPA exported and signed"

# ── Step 5: Upload to TestFlight ───────────────────────────────────────────────
echo ""
echo "▶ Step 5/5 — Uploading to TestFlight"
IPA=$(find "$BUILD_DIR/export" -name "*.ipa" | head -1)
if [[ -z "$IPA" ]]; then
  echo "❌ No .ipa found in $BUILD_DIR/export"
  exit 1
fi

xcrun altool --upload-app \
  -f "$IPA" \
  -t ios \
  --apiKey "$ASC_KEY_ID" \
  --apiIssuer "$ASC_ISSUER_ID"

# ── Cleanup ────────────────────────────────────────────────────────────────────
echo ""
echo "▶ Cleaning up build files"
rm -rf "$BUILD_DIR"
rm -rf "$APP_DIR/ios"
echo "   ✓ Done"

echo ""
echo "┌─────────────────────────────────────────────────────┐"
echo "│  ✅ $APP_LABEL shipped to TestFlight!"
echo "│  Build number: $BUILD_NUMBER"
echo "│  Check App Store Connect in ~5 minutes."
echo "└─────────────────────────────────────────────────────┘"
echo ""
