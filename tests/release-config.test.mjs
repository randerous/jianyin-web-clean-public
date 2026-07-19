import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";

const root = resolve(import.meta.dirname, "..");

test("release Android networking permits cleartext only for the embedded loopback backend", async () => {
  const [capacitor, networkConfig, manifest] = await Promise.all([
    readFile(resolve(root, "capacitor.config.ts"), "utf8"),
    readFile(resolve(root, "android/app/src/main/res/xml/network_security_config.xml"), "utf8"),
    readFile(resolve(root, "android/app/src/main/AndroidManifest.xml"), "utf8")
  ]);

  assert.doesNotMatch(capacitor, /allowMixedContent\s*:\s*true/);
  assert.match(networkConfig, /<base-config cleartextTrafficPermitted="false">/);
  assert.match(networkConfig, /<domain[^>]*>localhost<\/domain>/);
  assert.match(networkConfig, /<domain[^>]*>127\.0\.0\.1<\/domain>/);
  assert.doesNotMatch(networkConfig, /10\.0\.2\.2/);
  assert.match(manifest, /android:usesCleartextTraffic="false"/);
});

test("v1.0.29 release metadata is synchronized across web and Android", async () => {
  const [packageJson, gradle] = await Promise.all([
    readFile(resolve(root, "package.json"), "utf8"),
    readFile(resolve(root, "android/app/build.gradle"), "utf8")
  ]);

  assert.equal(JSON.parse(packageJson).version, "1.0.29");
  assert.match(gradle, /versionCode 30/);
  assert.match(gradle, /versionName "1\.0\.29"/);
});

test("Android updater uses an ASCII User-Agent accepted by DownloadManager", async () => {
  const mainActivity = await readFile(
    resolve(root, "android/app/src/main/java/com/randerous/jianyin/MainActivity.java"),
    "utf8"
  );

  assert.match(mainActivity, /request\.addRequestHeader\("User-Agent", "Jianyin Android updater"\)/);
  assert.doesNotMatch(mainActivity, /request\.addRequestHeader\("User-Agent", "既见 Android updater"\)/);
});

test("Android updater resumes completed downloads and grants the installer a readable APK URI", async () => {
  const [mainActivity, filePaths] = await Promise.all([
    readFile(resolve(root, "android/app/src/main/java/com/randerous/jianyin/MainActivity.java"), "utf8"),
    readFile(resolve(root, "android/app/src/main/res/xml/file_paths.xml"), "utf8")
  ]);

  assert.match(mainActivity, /onResume\(\)/);
  assert.match(mainActivity, /persistPendingUpdate\(\)/);
  assert.match(mainActivity, /resumeCompletedUpdate\(\)/);
  assert.match(mainActivity, /FileProvider\.getUriForFile/);
  assert.match(mainActivity, /Intent\.ACTION_INSTALL_PACKAGE/);
  assert.match(mainActivity, /ClipData\.newRawUri/);
  assert.match(mainActivity, /FLAG_GRANT_READ_URI_PERMISSION/);
  assert.match(filePaths, /<external-files-path name="update_files" path="Download\/"\s*\/>/);
});

test("Android updater receives the system DownloadManager completion broadcast", async () => {
  const mainActivity = await readFile(
    resolve(root, "android/app/src/main/java/com/randerous/jianyin/MainActivity.java"),
    "utf8"
  );

  assert.match(mainActivity, /registerReceiver\(updateDownloadReceiver, filter, Context\.RECEIVER_EXPORTED\)/);
});
