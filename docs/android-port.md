# Android Port

This project is packaged as a Capacitor Android app targeting Android 15
(`targetSdkVersion 35`).

## What Runs In The APK

- React/Vite UI
- Local playlists, local audio imports, IndexedDB persistence, backup/restore
- Browser/WebView audio playback and MediaSession integration

The Node `server.mjs` proxy is not embedded in the APK. Remote Netease, Bili,
FLAC search, streaming, account cookie validation, and shared-state sync need a
reachable proxy backend.

## Backend URL

Run the proxy on your computer or server:

```bash
npm install
node server.mjs --dev --host 0.0.0.0 --port 5188
```

On Android, open `Settings` and set `API backend URL`, for example:

```text
http://192.168.1.10:5188
```

Use your computer's LAN IP, not `127.0.0.1`, when testing on a physical phone.
For the Android emulator, `http://10.0.2.2:5188` points at the host machine.

## Build

```bash
npm run android:sync
cd android
.\gradlew.bat assembleDebug
```

The debug APK is generated at:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

## Android 15 Notes

- `android/variables.gradle` locks `compileSdkVersion` and `targetSdkVersion`
  to `35`.
- `MainActivity` enables edge-to-edge with AndroidX Activity.
- CSS uses safe-area insets so the status bar and gesture navigation do not
  cover content in Android 15 edge-to-edge mode.
- Cleartext traffic is allowed for LAN proxy development. Use HTTPS for a
  production backend before publishing.
