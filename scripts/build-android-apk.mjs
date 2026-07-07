import { execFileSync, spawn } from "node:child_process";
import { existsSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const androidRoot = resolve(root, "android");
const apkPath = resolve(androidRoot, "app", "build", "outputs", "apk", "debug", "app-debug.apk");
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
const debugKeystoreCandidates = [
  process.env.JIANYIN_DEBUG_KEYSTORE,
  resolve(root, "..", "old", "debug.keystore"),
  resolve(root, "..", ".android", "debug.keystore")
].filter(Boolean);
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

function findDebugKeystore() {
  return debugKeystoreCandidates.find((path) => existsSync(path));
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

function configureEnv() {
  const env = { ...process.env };
  env.COPYFILE_DISABLE = "1";
  env.COPY_EXTENDED_ATTRIBUTES_DISABLE = "1";
  env.JAVA_HOME = findJavaHome() ?? env.JAVA_HOME;
  env.ANDROID_HOME = findAndroidHome() ?? env.ANDROID_HOME;
  env.ANDROID_SDK_ROOT = env.ANDROID_HOME;
  env.JIANYIN_ANDROID_NDK_PATH = findAndroidNdkHome(env.ANDROID_HOME) ?? env.JIANYIN_ANDROID_NDK_PATH;
  env.ANDROID_NDK_HOME = env.JIANYIN_ANDROID_NDK_PATH ?? env.ANDROID_NDK_HOME;
  env.ANDROID_NDK_ROOT = env.JIANYIN_ANDROID_NDK_PATH ?? env.ANDROID_NDK_ROOT;
  env.JIANYIN_DEBUG_KEYSTORE = findDebugKeystore() ?? env.JIANYIN_DEBUG_KEYSTORE;
  env.JIANYIN_DEBUG_KEYSTORE_PASSWORD = env.JIANYIN_DEBUG_KEYSTORE_PASSWORD || "android";
  env.JIANYIN_DEBUG_KEY_ALIAS = env.JIANYIN_DEBUG_KEY_ALIAS || "androiddebugkey";
  env.JIANYIN_DEBUG_KEY_PASSWORD = env.JIANYIN_DEBUG_KEY_PASSWORD || "android";

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

function removeAppleDoubleFiles(path) {
  if (!existsSync(path)) return;
  for (const name of readdirSync(path)) {
    const child = resolve(path, name);
    if (name.startsWith("._")) {
      rmSync(child, { recursive: true, force: true });
      continue;
    }

    const stats = statSync(child);
    if (stats.isDirectory()) {
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

    const stats = statSync(child);
    if (stats.isDirectory()) count += countAppleDoubleFiles(child);
  }
  return count;
}

const appleDoubleBuildRoots = [
  resolve(root, "dist"),
  resolve(root, "build", "android-node-runtime"),
  resolve(androidRoot, "app", "src", "main", "assets"),
  resolve(androidRoot, "capacitor-cordova-android-plugins", "src", "main", "assets"),
  resolve(androidRoot, "capacitor-cordova-android-plugins", "src", "main", "libs"),
  resolve(androidRoot, "capacitor-cordova-android-plugins", "libs"),
  resolve(androidRoot, "app", "build"),
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

async function assembleDebug(env) {
  const command = process.platform === "win32" ? resolve(androidRoot, "gradlew.bat") : resolve(androidRoot, "gradlew");
  const cleaner = setInterval(removeGeneratedAppleDoubleFiles, 750);
  try {
    await runStreaming("Assemble Android debug APK", command, ["assembleDebug"], { cwd: androidRoot, env });
  } catch (error) {
    const appleDoubleCount = countGeneratedAppleDoubleFiles();
    if (!appleDoubleCount) throw error;

    console.warn(`Found ${appleDoubleCount} AppleDouble metadata files after failed assemble. Cleaning and retrying once...`);
    removeGeneratedAppleDoubleFiles();
    await runStreaming("Retry Android debug APK assemble", command, ["assembleDebug"], { cwd: androidRoot, env });
  } finally {
    clearInterval(cleaner);
  }
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

const env = configureEnv();

writeAndroidLocalProperties(env);
run("Build desktop/web assets", commandName("npm"), ["run", "build"], { env });
run("Sync Capacitor Android project", commandName("npx"), ["cap", "sync", "android"], { env });
run("Prepare embedded Android Node backend", process.execPath, [resolve(root, "scripts", "prepare-android-embedded-backend.mjs")], { env });
removeGeneratedAppleDoubleFiles();
await assembleDebug(env);
verifyApk(env);
