# Tharun Health Tracker Mobile

React Native mobile app for iOS and Android with HealthKit and Health Connect integration.

## Features

- **iOS HealthKit Integration**: Read steps, heart rate, sleep, workouts, calories
- **Android Health Connect**: Sync health data from Google Health Connect
- **Background Sync**: Automatic health data synchronization
- **Offline Support**: SQLite database for local data storage
- **WebView Container**: Embedded web app for dashboard

## Prerequisites

- Node.js >= 18
- Xcode 15+ (for iOS)
- Android Studio (for Android)
- CocoaPods (for iOS)
- React Native CLI

## Installation

```bash
npm install
```

### iOS Setup

1. Install CocoaPods dependencies:
```bash
cd ios && pod install
```

2. Open the workspace in Xcode:
```bash
open TharunHealthTrackerMobile.xcworkspace
```

3. Configure signing:
   - Select the project in Xcode
   - Go to Signing & Capabilities
   - Select your team
   - Enable HealthKit capability

4. Build and run:
```bash
npm run ios
```

### Android Setup

```bash
npm run android
```

## iOS-Specific Configuration

### HealthKit Entitlements

The app includes HealthKit entitlements configured in `TharunHealthTrackerMobile.entitlements`:
- `com.apple.developer.healthkit`
- `com.apple.developer.healthkit.background-delivery`

### Privacy Manifest

A `PrivacyInfo.xcprivacy` file is included for App Store compliance (required since Spring 2024).

### Required Info.plist Keys

- `NSHealthShareUsageDescription` - Permission to read health data
- `NSHealthUpdateUsageDescription` - Permission for health updates
- `BGTaskSchedulerPermittedIdentifiers` - Background fetch identifiers
- `UIBackgroundModes` - fetch, processing

## Available Scripts

- `npm run ios` - Run on iOS simulator
- `npm run ios:device` - Run on connected iOS device
- `npm run ios:release` - Run iOS release build
- `npm run pod-install` - Install iOS pods
- `npm run pod-update` - Update iOS pods
- `npm run ios:clean` - Clean iOS build artifacts
- `npm run android` - Run on Android
- `npm run start` - Start Metro bundler
- `npm run start:reset` - Start Metro with cache reset
- `npm run bundle:ios` - Create iOS bundle for release
- `npm run release:ios` - Build iOS release archive

## Project Structure

```
ios/
├── Podfile                      # iOS dependencies
├── TharunHealthTrackerMobile.xcodeproj
├── TharunHealthTrackerMobile.xcworkspace
└── TharunHealthTrackerMobile/
    ├── AppDelegate.mm           # App delegate with HealthKit
    ├── AppDelegate.h            # App delegate header
    ├── HealthKitBridge.m        # HealthKit native bridge
    ├── Info.plist               # App configuration
    ├── LaunchScreen.storyboard  # Launch screen
    ├── PrivacyInfo.xcprivacy    # Privacy manifest (App Store)
    ├── TharunHealthTrackerMobile.entitlements
    └── Images.xcassets/
        └── AppIcon.appiconset/  # App icons
```

## Troubleshooting

### iOS Build Issues

1. **Pod install fails**:
```bash
cd ios && pod deintegrate && pod install
```

2. **Metro bundler not connecting**:
```bash
npm run start:reset
```

3. **HealthKit not available**:
   - Ensure you're testing on a real device (HealthKit doesn't work on iOS Simulator)
   - Check that HealthKit capability is enabled in Xcode

4. **Signing issues**:
   - Open Xcode and configure your Apple ID in Preferences > Accounts
   - Select your team in the project settings

### App Store Submission

Before submitting to App Store:

1. Update version numbers in:
   - `ios/TharunHealthTrackerMobile/Info.plist`
   - `package.json`

2. Create app icons (all required sizes in `Images.xcassets/AppIcon.appiconset`)

3. Verify privacy manifest includes all accessed APIs

4. Test background fetch functionality

5. Archive and upload via Xcode Organizer

## License

Private - Tharun Manikonda
