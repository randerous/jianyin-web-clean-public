# Android Port

This project is packaged as a Capacitor Android app targeting Android 15
(`targetSdkVersion 35`).

## What Runs In The APK

- React/Vite UI
- Local playlists, local audio imports, IndexedDB persistence, backup/restore
- Browser/WebView audio playback and MediaSession integration
- Embedded Node backend at `http://127.0.0.1:5188`
- Remote Netease, Bili, and FLAC search/stream proxy routes

The Android app must not depend on a backend running on the computer. The
embedded backend is prepared into `assets/www/nodejs-project` before Gradle
builds the APK.

## Build Workflow

Use one command:

```bash
npm run android:apk
```

That command is the source of truth for Android packaging. It runs, in order:

1. `npm run build`
2. `npx cap sync android`
3. `node scripts/prepare-android-embedded-backend.mjs`
4. `android/gradlew assembleRelease -PjianyinAbi=arm64-v8a`
5. APK asset verification

Do not run `npx cap sync android` and then Gradle directly when making a test
APK. That skips the embedded backend preparation step and can produce a broken
package.

The signed release APK is generated at:

```text
android/app/build/outputs/apk/release/app-release.apk
```

The workflow verifies that the APK contains both:

```text
assets/public/index.html
assets/www/nodejs-project/server.mjs
```

## Useful Commands

Prepare Android assets without building an APK:

```bash
npm run android:sync
```

Open the Android project:

```bash
npm run android:open
```

Install the release APK on a connected device:

```bash
adb install -r android/app/build/outputs/apk/release/app-release.apk
```

## Android 15 Notes

- `android/variables.gradle` locks `targetSdkVersion` to `35`.
- `MainActivity` enables edge-to-edge with AndroidX Activity.
- CSS uses safe-area insets so the status bar and gesture navigation do not
  cover content in Android 15 edge-to-edge mode.
- Cleartext traffic is allowed only for the app-local `127.0.0.1` backend.
