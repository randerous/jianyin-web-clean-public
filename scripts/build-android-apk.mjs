import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const androidRoot = resolve(root, "android");
const apkPath = resolve(androidRoot, "app", "build", "outputs", "apk", "debug", "app-debug.apk");
const defaultJavaHome = resolve(root, "..", "tools", "jdk-21");
const defaultAndroidHome = resolve(root, "..", "tools", "android-sdk");

function commandName(name) {
  return process.platform === "win32" ? `${name}.cmd` : name;
}

function configureEnv() {
  const env = { ...process.env };
  if (!env.JAVA_HOME && existsSync(resolve(defaultJavaHome, "bin", process.platform === "win32" ? "java.exe" : "java"))) {
    env.JAVA_HOME = defaultJavaHome;
  }
  if (!env.ANDROID_HOME && existsSync(defaultAndroidHome)) {
    env.ANDROID_HOME = defaultAndroidHome;
  }

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

  const sizeMb = (statSync(apkPath).size / 1024 / 1024).toFixed(2);
  console.log(`\nAPK ready: ${apkPath}`);
  console.log(`Size: ${sizeMb} MB`);
  console.log(`Verified web asset: ${jsAsset}`);
  console.log("Verified embedded Node backend assets.");
}

const env = configureEnv();

run("Build desktop/web assets", commandName("npm"), ["run", "build"], { env });
run("Sync Capacitor Android project", commandName("npx"), ["cap", "sync", "android"], { env });
run("Prepare embedded Android Node backend", process.execPath, [resolve(root, "scripts", "prepare-android-embedded-backend.mjs")], { env });
run("Assemble Android debug APK", process.platform === "win32" ? resolve(androidRoot, "gradlew.bat") : resolve(androidRoot, "gradlew"), ["assembleDebug", "-PjianyinAbi=arm64-v8a"], { cwd: androidRoot, env });
verifyApk(env);
