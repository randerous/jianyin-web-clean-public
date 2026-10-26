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
  resolveGradleUserHome,
  shouldInjectAliyunMirror
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

test("Aliyun Maven mirror injection can be skipped for CI builds", () => {
  assert.equal(shouldInjectAliyunMirror({}), true);
  assert.equal(shouldInjectAliyunMirror({ JIANYIN_SKIP_ALIYUN_MIRROR: "1" }), false);
  const gateIndex = source.indexOf("if (shouldInjectAliyunMirror(env))");
  const injectionIndex = source.indexOf("injectAliyunMavenMirrors()");
  assert.ok(gateIndex !== -1 && injectionIndex !== -1 && gateIndex < injectionIndex, "skip gate must wrap mirror injection");
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
  // apksigner 37+（build-tools 37.0.0）按 scheme 分块打印签名证书
  const modernApksignerOutput = [
    "Verifies",
    "Verified using v1 scheme (JAR signing): false",
    "Verified using v2 scheme (APK Signature Scheme v2): true",
    "Number of signers: 1",
    `V2 Signer: certificate DN: C=US, O=Android, CN=Android Debug`,
    `V2 Signer: certificate SHA-256 digest: ${expectedSigner}`,
    "V2 Signer: key algorithm: RSA"
  ].join("\n");
  assert.deepEqual(extractApkSignerSha256s(modernApksignerOutput), [expectedSigner]);
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

test("assembleRelease defines the external APK path outside the try block", () => {
  // 重试分支（catch）也会用它拷贝产物；若声明在 try 内，重试时抛
  // ReferenceError: externalApkPath is not defined，构建以退出码 1 结束。
  const fnStart = source.indexOf("async function assembleRelease(env) {");
  assert.ok(fnStart >= 0, "assembleRelease must exist");
  const tryIndex = source.indexOf("\n  try {", fnStart);
  const declaration = source.indexOf("const externalApkPath =", fnStart);
  assert.ok(tryIndex > fnStart, "assembleRelease must contain a try block");
  assert.ok(
    declaration > fnStart && declaration < tryIndex,
    "externalApkPath must be declared before the try block so the catch retry path can use it"
  );
});

test("Gradle repositories prefer official sources before the Aliyun mirror", async () => {
  // maven.aliyun.com 实测返回 502 时 Gradle 会连带禁用整个 repository 并中止构建，
  // 因此官方源必须排在镜像之前。
  const gradle = await readFile(resolve(import.meta.dirname, "..", "android", "build.gradle"), "utf8");
  // 逐个匹配 "repositories {" 到其配对右括号之间的正文。
  const bodies = [];
  const openRe = /repositories\s*\{/g;
  let match;
  while ((match = openRe.exec(gradle))) {
    let depth = 1;
    let index = match.index + match[0].length;
    const start = index;
    while (index < gradle.length && depth > 0) {
      if (gradle[index] === "{") depth += 1;
      else if (gradle[index] === "}") depth -= 1;
      index += 1;
    }
    bodies.push(gradle.slice(start, index - 1));
  }
  assert.ok(bodies.length >= 2, "expected buildscript and allprojects repository blocks");
  for (const raw of bodies) {
    // 去掉行注释：正文注释里也会出现 maven.aliyun.com 字样，直接 indexOf 会误判。
    // 只剥「整行注释」，不能按 // 切：URL 里的 https:// 也含 //。
    const body = raw.split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
    const google = body.indexOf("google()");
    const aliyun = body.indexOf("maven.aliyun.com");
    assert.ok(google >= 0, "each block must declare google()");
    assert.ok(aliyun >= 0, "each block must keep the Aliyun mirror as fallback");
    assert.ok(google < aliyun, "google() must come before the Aliyun mirror");
  }
});
