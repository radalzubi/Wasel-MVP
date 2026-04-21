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

# Ensure Homebrew tools (pod, ruby, etc.) are on PATH — they may not be
# present in non-interactive shells (e.g. when launched from an IDE terminal).
export PATH="/opt/homebrew/bin:/opt/homebrew/sbin:$PATH"

# CocoaPods requires UTF-8 locale; non-interactive shells often inherit "C".
export LANG=en_US.UTF-8
export LC_ALL=en_US.UTF-8

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
# xcodeproj is bundled inside CocoaPods' own GEM_HOME, not the system gems.
# Read the GEM_HOME from the pod launcher script so we always match the
# installed CocoaPods version, then run system ruby with that gem path.
COCOAPODS_GEM_HOME=$(grep -o 'GEM_HOME="[^"]*"' /opt/homebrew/bin/pod | cut -d'"' -f2)
GEM_HOME="$COCOAPODS_GEM_HOME" ruby - "$APP_DIR/ios/Pods/Pods.xcodeproj" <<'RUBYEOF'
require 'xcodeproj'
path = ARGV[0]
project = Xcodeproj::Project.open(path)

# Fix 1: Remove duplicate EXNotifications privacy bundle target.
# Xcode auto-generates a MkDir command for any bundle target, so we must
# remove the entire target (not just its build phases) to stop the conflict.
target = project.targets.find { |t| t.name == 'EXNotifications-ExpoNotifications_privacy' }
if target
  project.root_object.targets.delete(target)
  target.build_phases.each(&:remove_from_project)
  if target.build_configuration_list
    target.build_configuration_list.build_configurations.each(&:remove_from_project)
    target.build_configuration_list.remove_from_project
  end
  target.remove_from_project
  puts "   ✓ Removed duplicate EXNotifications target"
end

# Fix 2: fmt library uses C++20 consteval — set c++20 standard on all targets
# so the compiler accepts it. Older default (c++17) causes build errors.
project.targets.each do |t|
  t.build_configurations.each do |config|
    config.build_settings['CLANG_CXX_LANGUAGE_STANDARD'] = 'c++20'
  end
end
puts "   ✓ Set C++20 standard on all Pods targets"

# Fix 3: After removing the EXNotifications-ExpoNotifications_privacy target above,
# there is still a dangling reference to ExpoNotifications_privacy.bundle in the
# EXNotifications target's Copy Resources build phase. Remove it so xcodebuild
# doesn't fail with "Resource not found".
removed_refs = 0
project.targets.each do |t|
  t.build_phases.each do |phase|
    next unless phase.is_a?(Xcodeproj::Project::Object::PBXResourcesBuildPhase)
    before = phase.files.length
    phase.files.delete_if do |f|
      f.file_ref&.path&.include?('ExpoNotifications_privacy.bundle')
    end
    removed_refs += (before - phase.files.length)
  end
end
puts "   ✓ Removed #{removed_refs} dangling ExpoNotifications_privacy.bundle reference(s)"

project.save
RUBYEOF

# Fix 4: CocoaPods generates Pods-<App>-resources.sh which includes a reference
# to EXNotifications/ExpoNotifications_privacy.bundle — produced by the legacy
# EXNotifications-ExpoNotifications_privacy target we deleted above.  That bundle
# no longer exists, so xcodebuild errors "Resource not found".  Remove only the
# stale EXNotifications/ entry; keep the valid ExpoNotifications/ entry.
RESOURCES_SH=$(find "$APP_DIR/ios/Pods/Target Support Files" \
  -name "Pods-*-resources.sh" | head -1)
if [[ -n "$RESOURCES_SH" ]]; then
  sed -i '' '/\/EXNotifications\/ExpoNotifications_privacy\.bundle/d' "$RESOURCES_SH"
  echo "   ✓ Removed stale EXNotifications/ExpoNotifications_privacy.bundle from resources script"
fi

# Fix 5: fmt's consteval is broken in Apple Clang (pointer arithmetic not treated
# as constant expressions). Directly replace FMT_CONSTEVAL consteval → constexpr.
FMT_BASE_H="$APP_DIR/ios/Pods/fmt/include/fmt/base.h"
if [[ -f "$FMT_BASE_H" ]]; then
  chmod u+w "$FMT_BASE_H"
  # Directly replace `consteval` with `constexpr` in the FMT_CONSTEVAL macro.
  # Apple Clang (Xcode 26 beta) has a bug where consteval pointer arithmetic
  # is rejected even in C++20 mode. constexpr compiles correctly.
  sed -i '' -E \
    's/#([[:space:]]*)define([[:space:]]+)FMT_CONSTEVAL([[:space:]]+)consteval/#\1define\2FMT_CONSTEVAL\3constexpr/' \
    "$FMT_BASE_H"
  echo "   ✓ Fix 5: Patched fmt/base.h (FMT_CONSTEVAL: consteval → constexpr)"
fi

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
  -derivedDataPath "$BUILD_DIR/DerivedData" \
  CURRENT_PROJECT_VERSION="$BUILD_NUMBER" \
  MARKETING_VERSION="1.0.0" \
  CODE_SIGNING_REQUIRED=NO \
  CODE_SIGN_IDENTITY="" \
  CLANG_CXX_LANGUAGE_STANDARD=c++20 \
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
# Use perl for fast parallel unlink instead of rm -rf — dramatically faster on
# large Pods/DerivedData trees (100k+ files). Falls back to rm -rf if perl fails.
echo ""
echo "▶ Cleaning up build files"
fast_rm() {
  local dir="$1"
  if [[ -d "$dir" ]]; then
    perl -e 'use File::Find; use POSIX;
      my @dirs; my @files;
      find(sub { if (-d $_) { push @dirs, $File::Find::name } else { push @files, $File::Find::name } }, $ARGV[0]);
      unlink @files;
      rmdir $_ for reverse sort @dirs;
      rmdir $ARGV[0];
    ' "$dir" 2>/dev/null || rm -rf "$dir"
  fi
}
fast_rm "$BUILD_DIR"
fast_rm "$APP_DIR/ios"
echo "   ✓ Done"

echo ""
echo "┌─────────────────────────────────────────────────────┐"
echo "│  ✅ $APP_LABEL shipped to TestFlight!"
echo "│  Build number: $BUILD_NUMBER"
echo "│  Check App Store Connect in ~5 minutes."
echo "└─────────────────────────────────────────────────────┘"
echo ""
