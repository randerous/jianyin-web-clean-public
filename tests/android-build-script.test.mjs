import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { test } from "node:test";
import {
  assertExpectedReleaseSigner,
  configureEnv,
  extractApkSignerSha256s,
  extractKeytoolCertificateSha256,
  injectAliyunMavenMirrors,
  resolveGradleUserHome
} from "../scripts/build-android-apk.mjs";

const source = await readFile(new URL("../scripts/build-android-apk.mjs", import.meta.url), "utf8");
const expectedSigner = "09392c015136c81b1aa60be09958ba2d8218dccba822d275124f2d5dba226d92";

test("Android release builds use an APFS local fallback instead of the project volume", () => {
  const projectRoot = resolve(import.meta.dirname, "..");
  const expectedCacheRoot = process.platform === "darwin"
    ? resolve(homedir(), "Library", "Caches", "JianyinGradle")
    : process.platform === "win32"
      ? resolve(process.env.LOCALAPPDATA || resolve(homedir(), "AppData", "Local"), "JianyinGradle")
      : resolve(process.env.XDG_CACHE_HOME || resolve(homedir(), ".cache"), "JianyinGradle");
  const expectedDefault = resolve(expectedCacheRoot, "gradle-user-home");
  const explicitOverride = resolve(projectRoot, "custom-gradle-home");

  assert.equal(resolveGradleUserHome({}), expectedDefault);
  assert.notEqual(resolveGradleUserHome({}), resolve(homedir(), ".gradle"));
  assert.equal(resolveGradleUserHome({}).includes("/Volumes/Ventoy"), false);
  assert.equal(resolveGradleUserHome({ GRADLE_USER_HOME: explicitOverride }), explicitOverride);
  assert.equal(configureEnv({}).GRADLE_USER_HOME, expectedDefault);
  assert.equal(configureEnv({ GRADLE_USER_HOME: explicitOverride }).GRADLE_USER_HOME, explicitOverride);
  assert.equal(configureEnv({}).JIANYIN_ANDROID_RELEASE, "1");
});

test("Android release builds prioritize the APFS sparsebundle and reject exFAT paths", () => {
  assert.match(source, /const gradleVolume = "\/Volumes\/JianyinGradle";/);
  assert.match(source, /gradle-cache-apfs\.sparsebundle/);
  assert.match(source, /execFileSync\("hdiutil", \["attach", "-nobrowse", gradleSparseBundle\]/);
  assert.match(source, /const requirement = process\.platform === "darwin" \? "APFS"/);
  assert.match(source, /capacitor-cordova-android-plugins.*build\.gradle/);
});

test("Aliyun Maven mirrors are injected idempotently after Capacitor sync", async () => {
  const directory = await mkdtemp("/tmp/jianyin-gradle-test-");
  const firstGradleFile = resolve(directory, "build.gradle");
  const secondGradleFile = resolve(directory, "capacitor.build.gradle");
  const repositories = "repositories {\n    google()\n    mavenCentral()\n}\n";
  await Promise.all([writeFile(firstGradleFile, repositories), writeFile(secondGradleFile, repositories)]);

  assert.equal(injectAliyunMavenMirrors([firstGradleFile, secondGradleFile]), 2);
  const [first, second] = await Promise.all([readFile(firstGradleFile, "utf8"), readFile(secondGradleFile, "utf8")]);
  for (const contents of [first, second]) {
    assert.match(contents, /https:\/\/maven\.aliyun\.com\/repository\/google/);
    assert.match(contents, /https:\/\/maven\.aliyun\.com\/repository\/public/);
  }
  assert.equal(injectAliyunMavenMirrors([firstGradleFile, secondGradleFile]), 0);

  const syncIndex = source.indexOf('run("Sync Capacitor Android project"');
  const injectionIndex = source.indexOf("injectAliyunMavenMirrors();");
  assert.ok(injectionIndex > syncIndex, "mirror injection must occur after Capacitor sync");
});

test("Android release builds verify the expected keystore signer before building", () => {
  assert.match(
    source,
    /const EXPECTED_RELEASE_SIGNER_SHA256 = "09392c015136c81b1aa60be09958ba2d8218dccba822d275124f2d5dba226d92";/,
  );
  const preflightIndex = source.indexOf("verifyReleaseKeystore(env);");
  const buildIndex = source.indexOf('run("Build desktop/web assets"');
  assert.ok(preflightIndex >= 0, "release keystore signer must be verified");
  assert.ok(preflightIndex < buildIndex, "release keystore signer must be verified before build work starts");
});

test("signer verification accepts only the established release certificate", () => {
  const colonSeparated = expectedSigner.match(/.{2}/g).join(":").toUpperCase();
  const keytoolOutput = `Certificate fingerprints:\n\t SHA256: ${colonSeparated}\n`;
  const apksignerOutput = `Number of signers: 1\nSigner #1 certificate SHA-256 digest: ${expectedSigner}\n`;

  assert.equal(extractKeytoolCertificateSha256(keytoolOutput), expectedSigner);
  assert.deepEqual(extractApkSignerSha256s(apksignerOutput), [expectedSigner]);
  assert.equal(assertExpectedReleaseSigner([expectedSigner], "Release artifact"), expectedSigner);
  assert.throws(
    () => assertExpectedReleaseSigner(["f".repeat(64)], "Release artifact"),
    /does not match required/,
  );
  assert.throws(
    () => assertExpectedReleaseSigner([expectedSigner, expectedSigner], "Release artifact"),
    /exactly one verifiable signer/,
  );
  assert.throws(
    () => assertExpectedReleaseSigner([expectedSigner, "not-a-fingerprint"], "Release artifact"),
    /exactly one verifiable signer/,
  );
});

test("Android release builds verify the generated APK signer", () => {
  const assembleIndex = source.indexOf("await assembleRelease(env);");
  const verificationIndex = source.indexOf("verifyApk(env);");
  assert.ok(assembleIndex >= 0);
  assert.ok(verificationIndex > assembleIndex, "APK verification must run after assembly");
  assert.match(source, /function verifyApk\(env\) \{[\s\S]*?verifyApkSignature\(env\);/);
});
