import { execFileSync, spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statfsSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const androidRoot = resolve(root, "android");
const apkPath = resolve(androidRoot, "app", "build", "outputs", "apk", "release", "app-release.apk");
const platformCacheRoot = process.platform === "darwin"
  ? resolve(homedir(), "Library", "Caches", "JianyinGradle")
  : process.platform === "win32"
    ? resolve(process.env.LOCALAPPDATA || resolve(homedir(), "AppData", "Local"), "JianyinGradle")
    : resolve(process.env.XDG_CACHE_HOME || resolve(homedir(), ".cache"), "JianyinGradle");
const defaultGradleUserHome = resolve(platformCacheRoot, "gradle-user-home");
const defaultGradleBuildRoot = resolve(platformCacheRoot, "gradle-build");
const gradleVolume = "/Volumes/JianyinGradle";
const gradleSparseBundle = resolve(root, "..", "gradle-cache-apfs.sparsebundle");
const APFS_FILESYSTEM_TYPES = new Set([25, 26]);
const aliyunMavenMarker = "// JIANYIN_ALIYUN_MAVEN_MIRRORS";
const aliyunMavenRepositories = [
  'maven { url "https://maven.aliyun.com/repository/google" }',
  'maven { url "https://maven.aliyun.com/repository/public" }'
];
const EXPECTED_RELEASE_SIGNER_SHA256 = "09392c015136c81b1aa60be09958ba2d8218dccba822d275124f2d5dba226d92";
const javaHomeCandidates = [
  process.env.JAVA_HOME,
  resolve(root, "..", "jdk-21"),
  "/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home",
  "/opt/homebrew/opt/openjdk@21"
].filter(Boolean);
const androidHomeCandidates = [
  process.env.ANDROID_HOME,
  process.env.ANDROID_SDK_ROOT,
  resolve(root, "..", "android-sdk"),
  "/opt/homebrew/share/android-commandlinetools"
].filter(Boolean);
const defaultReleaseKeystore = resolve(root, "..", "old", "debug.keystore");
const ndkVersion = "28.2.13676358";

function commandName(name) {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

function findJavaHome() {
  const javaName = process.platform === "win32" ? "java.exe" : "java";
  return javaHomeCandidates.find((path) => existsSync(resolve(path, "bin", javaName)));
}

function findAndroidHome() {
  return androidHomeCandidates.find((path) => existsSync(resolve(path, "platforms")) && existsSync(resolve(path, "build-tools")));
}

function findReleaseKeystore(env) {
  if (env.JIANYIN_RELEASE_KEYSTORE) return env.JIANYIN_RELEASE_KEYSTORE;
  return existsSync(defaultReleaseKeystore) ? defaultReleaseKeystore : undefined;
}

function isAndroidNdkHome(path) {
  if (!path) return false;
  const ndkBuild = process.platform === "win32" ? "ndk-build.cmd" : "ndk-build";
  return existsSync(resolve(path, "source.properties")) && existsSync(resolve(path, ndkBuild));
}

function findAndroidNdkHome(androidHome) {
  const candidates = [
    process.env.JIANYIN_ANDROID_NDK_PATH,
    process.env.ANDROID_NDK_HOME,
    process.env.ANDROID_NDK_ROOT
  ].filter(Boolean);

  if (androidHome) {
    candidates.push(
      resolve(androidHome, "ndk", ndkVersion),
      resolve(androidHome, "ndk", ndkVersion, "android-ndk-r28c")
    );
    const ndkRoot = resolve(androidHome, "ndk");
    if (existsSync(ndkRoot)) {
      for (const name of readdirSync(ndkRoot)) {
        const versionDir = resolve(ndkRoot, name);
        candidates.push(versionDir);
        if (existsSync(versionDir) && statSync(versionDir).isDirectory()) {
          for (const childName of readdirSync(versionDir)) {
            candidates.push(resolve(versionDir, childName));
          }
        }
      }
    }
  }

  return candidates.find(isAndroidNdkHome);
}

function localPropertyPath(path) {
  return path.replace(/\\/g, "/");
}

function writeAndroidLocalProperties(env) {
  if (!env.ANDROID_HOME) return;
  const lines = [`sdk.dir=${localPropertyPath(env.ANDROID_HOME)}`];
  if (env.JIANYIN_ANDROID_NDK_PATH) {
    lines.push(`ndk.dir=${localPropertyPath(env.JIANYIN_ANDROID_NDK_PATH)}`);
  }
  writeFileSync(resolve(androidRoot, "local.properties"), `${lines.join("\n")}\n`);
}

export function resolveGradleUserHome(env = {}) {
  return env.GRADLE_USER_HOME || defaultGradleUserHome;
}

function isUsableGradleDirectory(path) {
  try {
    const filesystem = statfsSync(path);
    return process.platform !== "darwin" || APFS_FILESYSTEM_TYPES.has(filesystem.type);
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function ensureGradleDirectory(path, label) {
  mkdirSync(path, { recursive: true });
  if (!isUsableGradleDirectory(path)) {
    const requirement = process.platform === "darwin" ? "APFS" : "a supported local filesystem";
    throw new Error(`${label} must be on ${requirement}; refusing to use ${path}.`);
  }
  return path;
}

function attachGradleSparseBundle() {
  if (process.platform !== "darwin" || !existsSync(gradleSparseBundle)) return false;
  try {
    execFileSync("hdiutil", ["attach", "-nobrowse", gradleSparseBundle], { stdio: "ignore" });
  } catch {
    return false;
  }
  return isUsableGradleDirectory(gradleVolume);
}

export function prepareGradleStorage(sourceEnv = process.env) {
  const env = { ...sourceEnv };
  const requestedUserHome = env.GRADLE_USER_HOME;
  const requestedBuildRoot = env.JIANYIN_ANDROID_GRADLE_BUILD_DIR;
  if (requestedUserHome || requestedBuildRoot) {
    return {
      gradleUserHome: ensureGradleDirectory(requestedUserHome || defaultGradleUserHome, "GRADLE_USER_HOME"),
      gradleBuildRoot: ensureGradleDirectory(requestedBuildRoot || defaultGradleBuildRoot, "JIANYIN_ANDROID_GRADLE_BUILD_DIR")
    };
  }

  if (process.platform === "darwin" && !isUsableGradleDirectory(gradleVolume)) attachGradleSparseBundle();
  if (process.platform === "darwin" && isUsableGradleDirectory(gradleVolume)) {
    return {
      gradleUserHome: ensureGradleDirectory(resolve(gradleVolume, "gradle-user-home"), "Gradle user home"),
      gradleBuildRoot: ensureGradleDirectory(resolve(gradleVolume, "gradle-build"), "Gradle build directory")
    };
  }

  return {
    gradleUserHome: ensureGradleDirectory(defaultGradleUserHome, "Fallback Gradle user home"),
    gradleBuildRoot: ensureGradleDirectory(defaultGradleBuildRoot, "Fallback Gradle build directory")
  };
}

export function configureEnv(sourceEnv = process.env) {
  const env = { ...sourceEnv };
  env.COPYFILE_DISABLE = "1";
  env.COPY_EXTENDED_ATTRIBUTES_DISABLE = "1";
  env.JIANYIN_ANDROID_RELEASE = "1";
  env.JAVA_HOME = findJavaHome() ?? env.JAVA_HOME;
  env.ANDROID_HOME = findAndroidHome() ?? env.ANDROID_HOME;
  env.ANDROID_SDK_ROOT = env.ANDROID_HOME;
  env.JIANYIN_ANDROID_NDK_PATH = findAndroidNdkHome(env.ANDROID_HOME) ?? env.JIANYIN_ANDROID_NDK_PATH;
  env.ANDROID_NDK_HOME = env.JIANYIN_ANDROID_NDK_PATH ?? env.ANDROID_NDK_HOME;
  env.ANDROID_NDK_ROOT = env.JIANYIN_ANDROID_NDK_PATH ?? env.ANDROID_NDK_ROOT;
  env.GRADLE_USER_HOME = resolveGradleUserHome(env);
  env.JIANYIN_ANDROID_GRADLE_BUILD_DIR = env.JIANYIN_ANDROID_GRADLE_BUILD_DIR || defaultGradleBuildRoot;
  env.JIANYIN_RELEASE_KEYSTORE = findReleaseKeystore(env);
  env.JIANYIN_RELEASE_KEYSTORE_PASSWORD = env.JIANYIN_RELEASE_KEYSTORE_PASSWORD || "android";
  env.JIANYIN_RELEASE_KEY_ALIAS = env.JIANYIN_RELEASE_KEY_ALIAS || "androiddebugkey";
  env.JIANYIN_RELEASE_KEY_PASSWORD = env.JIANYIN_RELEASE_KEY_PASSWORD || "android";

  const pathParts = [];
  if (env.JAVA_HOME) pathParts.push(resolve(env.JAVA_HOME, "bin"));
  if (env.ANDROID_HOME) pathParts.push(resolve(env.ANDROID_HOME, "platform-tools"));
  env.Path = [...pathParts, env.Path || env.PATH || ""].filter(Boolean).join(process.platform === "win32" ? ";" : ":");
  env.PATH = env.Path;
  return env;
}

function run(label, command, args, options = {}) {
  console.log(`\n==> ${label}`);
  const useCmd = process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
  execFileSync(command, args, {
    cwd: options.cwd ?? root,
    env: options.env,
    stdio: "inherit",
    shell: useCmd
  });
}

function runStreaming(label, command, args, options = {}) {
  console.log(`\n==> ${label}`);
  return new Promise((resolvePromise, reject) => {
    const useCmd = process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
    const child = spawn(command, args, {
      cwd: options.cwd ?? root,
      env: options.env,
      stdio: "inherit",
      shell: useCmd
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolvePromise();
      } else {
        reject(new Error(`Command failed: ${command} ${args.join(" ")}${signal ? ` (${signal})` : ""}`));
      }
    });
  });
}

function runForOutput(command, args, env) {
  const useCmd = process.platform === "win32" && /\.(cmd|bat)$/i.test(command);
  // apksigner/keytool 在部分环境下把结果写到 stderr，合并两个流避免解析到 0 个签名。
  const result = spawnSync(command, args, {
    cwd: root,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: useCmd
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")} (exit ${result.status})\n${result.stdout ?? ""}${result.stderr ?? ""}`);
  }
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

function javaTool(env, name) {
  const executable = process.platform === "win32" ? `${name}.exe` : name;
  const command = env.JAVA_HOME ? resolve(env.JAVA_HOME, "bin", executable) : "";
  if (!command || !existsSync(command)) throw new Error(`${name} was not found under JAVA_HOME.`);
  return command;
}

function findAndroidBuildTool(env, name) {
  const buildToolsRoot = env.ANDROID_HOME ? resolve(env.ANDROID_HOME, "build-tools") : "";
  if (!buildToolsRoot || !existsSync(buildToolsRoot)) throw new Error("Android build-tools directory was not found.");
  const executable = process.platform === "win32" ? `${name}.bat` : name;
  const versions = readdirSync(buildToolsRoot)
    .filter((version) => {
      const path = resolve(buildToolsRoot, version);
      return statIfPresent(path)?.isDirectory();
    })
    .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));
  for (const version of versions) {
    const command = resolve(buildToolsRoot, version, executable);
    if (existsSync(command)) return command;
  }
  throw new Error(`${name} was not found in Android build-tools.`);
}

function normalizeSha256(value) {
  return String(value ?? "").replace(/[^0-9a-f]/gi, "").toLowerCase();
}

export function extractKeytoolCertificateSha256(output) {
  const match = String(output ?? "").match(/^\s*SHA256:\s*([0-9a-f:]+)\s*$/im);
  return normalizeSha256(match?.[1]);
}

export function extractApkSignerSha256s(output) {
  const text = String(output ?? "");
  const legacy = [...text.matchAll(/Signer #\d+ certificate SHA-256 digest:\s*([0-9a-f:]+)/gi)]
    .map((match) => normalizeSha256(match[1]));
  if (legacy.length) return [...new Set(legacy)];
  // apksigner 37+（build-tools 37.0.0）改为按签名 scheme 分块打印："V2 Signer: certificate SHA-256 digest:"
  const modern = [...text.matchAll(/V\d+(?:\.\d+)? Signer: certificate SHA-256 digest:\s*([0-9a-f:]+)/gi)]
    .map((match) => normalizeSha256(match[1]));
  return [...new Set(modern)];
}

export function assertExpectedReleaseSigner(signers, label) {
  const normalized = signers.map(normalizeSha256);
  if (normalized.length !== 1 || !/^[0-9a-f]{64}$/.test(normalized[0])) {
    throw new Error(`${label} must contain exactly one verifiable signer; found ${normalized.length}.`);
  }
  if (normalized[0] !== EXPECTED_RELEASE_SIGNER_SHA256) {
    throw new Error(`${label} signer SHA-256 ${normalized[0]} does not match required ${EXPECTED_RELEASE_SIGNER_SHA256}.`);
  }
  return normalized[0];
}

export function verifyReleaseKeystore(env) {
  const output = runForOutput(javaTool(env, "keytool"), [
    "-J-Duser.language=en",
    "-J-Duser.country=US",
    "-list",
    "-v",
    "-keystore",
    env.JIANYIN_RELEASE_KEYSTORE,
    "-storepass:env",
    "JIANYIN_RELEASE_KEYSTORE_PASSWORD",
    "-alias",
    env.JIANYIN_RELEASE_KEY_ALIAS
  ], env);
  const signer = assertExpectedReleaseSigner([extractKeytoolCertificateSha256(output)], "Release keystore");
  console.log(`Verified release keystore signer SHA-256: ${signer}`);
}

export function verifyApkSignature(env) {
  const output = runForOutput(findAndroidBuildTool(env, "apksigner"), ["verify", "--verbose", "--print-certs", apkPath], env);
  const signers = extractApkSignerSha256s(output);
  if (signers.length !== 1) {
    console.error(`[verifyApkSignature] apksigner did not report exactly one signer. Raw output:\n${output}`);
  }
  const signer = assertExpectedReleaseSigner(signers, "Release APK");
  console.log(`Verified release APK signer SHA-256: ${signer}`);
}

function statIfPresent(path) {
  try {
    return statSync(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function removeAppleDoubleFiles(path) {
  if (!existsSync(path)) return;
  for (const name of readdirSync(path)) {
    const child = resolve(path, name);
    if (name.startsWith("._")) {
      rmSync(child, { recursive: true, force: true });
      continue;
    }

    const stats = statIfPresent(child);
    if (stats?.isDirectory()) {
      removeAppleDoubleFiles(child);
    }
  }
}

function countAppleDoubleFiles(path) {
  if (!existsSync(path)) return 0;
  let count = 0;
  for (const name of readdirSync(path)) {
    const child = resolve(path, name);
    if (name.startsWith("._")) {
      count += 1;
      continue;
    }

    const stats = statIfPresent(child);
    if (stats?.isDirectory()) count += countAppleDoubleFiles(child);
  }
  return count;
}

const appleDoubleBuildRoots = [
  resolve(root, "dist"),
  resolve(root, "build", "android-node-runtime"),
  resolve(androidRoot, "app", "src", "main", "assets"),
  resolve(androidRoot, "app", "src", "main", "res"),
  resolve(androidRoot, "capacitor-cordova-android-plugins", "src", "main", "java"),
  resolve(androidRoot, "capacitor-cordova-android-plugins", "src", "main", "res"),
  resolve(androidRoot, "capacitor-cordova-android-plugins", "src", "main", "assets"),
  resolve(androidRoot, "capacitor-cordova-android-plugins", "src", "main", "libs"),
  resolve(androidRoot, "capacitor-cordova-android-plugins", "libs"),
  resolve(androidRoot, "capacitor-cordova-android-plugins", ".cxx"),
  resolve(androidRoot, "app", "build"),
  resolve(androidRoot, "app", ".cxx"),
  resolve(androidRoot, "capacitor-cordova-android-plugins", "build"),
  resolve(root, "node_modules", "@capacitor", "android", "capacitor", "build")
];

function removeGeneratedAppleDoubleFiles() {
  for (const path of appleDoubleBuildRoots) {
    removeAppleDoubleFiles(path);
  }
}

function countGeneratedAppleDoubleFiles() {
  return appleDoubleBuildRoots.reduce((count, path) => count + countAppleDoubleFiles(path), 0);
}

async function assembleRelease(env) {
  const command = process.platform === "win32" ? resolve(androidRoot, "gradlew.bat") : resolve(androidRoot, "gradlew");
  const cleaner = setInterval(removeGeneratedAppleDoubleFiles, 750);
  try {
    const gradleBuildRoot = env.JIANYIN_ANDROID_GRADLE_BUILD_DIR;
    const externalApkPath = resolve(gradleBuildRoot, "app", "outputs", "apk", "release", "app-release.apk");
    rmSync(gradleBuildRoot, { recursive: true, force: true });
    removeGeneratedAppleDoubleFiles();
    await runStreaming("Assemble Android release APK", command, ["assembleRelease"], { cwd: androidRoot, env });
    if (existsSync(externalApkPath)) {
      mkdirSync(dirname(apkPath), { recursive: true });
      copyFileSync(externalApkPath, apkPath);
    }
  } catch (error) {
    const appleDoubleCount = countGeneratedAppleDoubleFiles();
    if (appleDoubleCount) {
      console.warn(`Found ${appleDoubleCount} AppleDouble metadata files after failed assemble. Cleaning and retrying once...`);
      removeGeneratedAppleDoubleFiles();
    } else {
      // CI/本地网络抖动（如 maven classpath 解析瞬断）也会走到这里，重试一次自愈。
      console.warn(`Gradle assemble failed. Retrying once in case of a transient network error...`);
    }
    await runStreaming("Retry Android release APK assemble", command, ["assembleRelease"], { cwd: androidRoot, env });
    if (existsSync(externalApkPath)) {
      mkdirSync(dirname(apkPath), { recursive: true });
      copyFileSync(externalApkPath, apkPath);
    }
  } finally {
    clearInterval(cleaner);
  }
}

export function injectAliyunMavenMirrors(gradleFiles = [
    resolve(androidRoot, "build.gradle"),
    resolve(root, "node_modules", "@capacitor", "android", "capacitor", "build.gradle"),
    resolve(androidRoot, "capacitor-cordova-android-plugins", "build.gradle")
]) {
  let changed = 0;
  for (const path of gradleFiles) {
    if (!existsSync(path)) throw new Error(`Generated Gradle file not found after Capacitor sync: ${path}`);
    const source = readFileSync(path, "utf8");
    if (aliyunMavenRepositories.every((repository) => source.includes(repository))) continue;
    const updated = source.replace(/^(\s*)repositories\s*\{/gm, (match, indentation) => (
      `${match}\n${indentation}    ${aliyunMavenMarker}\n${aliyunMavenRepositories.map((repository) => `${indentation}    ${repository}`).join("\n")}`
    ));
    if (updated === source) throw new Error(`No repositories block found in generated Gradle file: ${path}`);
    writeFileSync(path, updated);
    changed += 1;
  }
  return changed;
}

function newestJsAssetName() {
  const assetsDir = resolve(root, "dist", "assets");
  const candidates = readdirSync(assetsDir)
    .filter((name) => /^index-.*\.js$/.test(name))
    .map((name) => ({ name, mtimeMs: statSync(resolve(assetsDir, name)).mtimeMs }))
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (!candidates.length) throw new Error("No built index-*.js asset found in dist/assets.");
  return candidates[0].name;
}

function listApkEntries(env) {
  const jar = resolve(env.JAVA_HOME ?? "", "bin", process.platform === "win32" ? "jar.exe" : "jar");
  const command = existsSync(jar) ? jar : "jar";
  return execFileSync(command, ["tf", apkPath], { cwd: root, env, encoding: "utf8" }).split(/\r?\n/);
}

function verifyApk(env) {
  if (!existsSync(apkPath)) throw new Error(`APK was not generated: ${apkPath}`);
  verifyApkSignature(env);
  const entries = new Set(listApkEntries(env));
  const jsAsset = newestJsAssetName();
  const required = [
    "assets/public/index.html",
    `assets/public/assets/${jsAsset}`,
    "assets/www/nodejs-project/server.mjs",
    "assets/www/nodejs-project/main.cjs",
    "assets/www/nodejs-project/dist/index.html",
    `assets/www/nodejs-project/dist/assets/${jsAsset}`
  ];
  const missing = required.filter((entry) => !entries.has(entry));
  if (missing.length) {
    throw new Error(`APK is missing required embedded assets:\n${missing.join("\n")}`);
  }

  const nativeAbis = new Set();
  for (const entry of entries) {
    const match = entry.match(/^lib\/([^/]+)\//);
    if (match) nativeAbis.add(match[1]);
  }
  const unexpectedAbis = [...nativeAbis].filter((abi) => abi !== "arm64-v8a");
  if (unexpectedAbis.length) {
    throw new Error(`APK contains unsupported native ABIs: ${unexpectedAbis.join(", ")}`);
  }
  if (!nativeAbis.has("arm64-v8a")) {
    throw new Error("APK is missing arm64-v8a native libraries.");
  }

  const sizeMb = (statSync(apkPath).size / 1024 / 1024).toFixed(2);
  console.log(`\nAPK ready: ${apkPath}`);
  console.log(`Size: ${sizeMb} MB`);
  console.log(`Verified web asset: ${jsAsset}`);
  console.log("Verified embedded Node backend assets.");
  console.log("Verified native ABI: arm64-v8a only.");
}

export async function main() {
  const gradleStorage = prepareGradleStorage();
  const env = configureEnv({
    ...process.env,
    GRADLE_USER_HOME: gradleStorage.gradleUserHome,
    JIANYIN_ANDROID_GRADLE_BUILD_DIR: gradleStorage.gradleBuildRoot
  });
  if (!env.JIANYIN_RELEASE_KEYSTORE || !existsSync(env.JIANYIN_RELEASE_KEYSTORE)) {
    throw new Error("Release keystore not found. Refusing to build an unsigned APK.");
  }
  verifyReleaseKeystore(env);
  console.log(`Gradle user home: ${env.GRADLE_USER_HOME}`);

  writeAndroidLocalProperties(env);
  run("Build desktop/web assets", commandName("npm"), ["run", "build"], { env });
  run("Sync Capacitor Android project", commandName("npx"), ["cap", "sync", "android"], { env });
  if (shouldInjectAliyunMirror(env)) {
    const mirrorFilesUpdated = injectAliyunMavenMirrors();
    console.log(`Aliyun Maven mirror present in generated Gradle files (${mirrorFilesUpdated} updated).`);
  } else {
    console.log("Skipping Aliyun Maven mirror injection (JIANYIN_SKIP_ALIYUN_MIRROR=1).");
  }
  run("Prepare embedded Android Node backend", process.execPath, [resolve(root, "scripts", "prepare-android-embedded-backend.mjs")], { env });
  removeGeneratedAppleDoubleFiles();
  await assembleRelease(env);
  verifyApk(env);
}

export function shouldInjectAliyunMirror(env = process.env) {
  return env.JIANYIN_SKIP_ALIYUN_MIRROR !== "1";
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
