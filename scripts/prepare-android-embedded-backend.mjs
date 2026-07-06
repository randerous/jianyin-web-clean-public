import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const androidRoot = resolve(root, "android");
const cordovaAssets = resolve(androidRoot, "capacitor-cordova-android-plugins", "src", "main", "assets");
const cordovaRoot = resolve(androidRoot, "capacitor-cordova-android-plugins");
const cordovaNativeLibs = resolve(cordovaRoot, "src", "main", "libs", "cdvnodejsmobile");
const cordovaNativeLibsBuildPath = resolve(cordovaRoot, "libs", "cdvnodejsmobile");
const nodeMobileLibnode = resolve(root, "node_modules", "@red-mobile", "nodejs-mobile-cordova", "libs", "android", "libnode");
const nodeMobile16kLibnode = resolve(root, "..", "tools", "nodejs-mobile-v18.20.4-android-digidem");
const appPublic = resolve(androidRoot, "app", "src", "main", "assets", "public");
const runtimeRoot = resolve(root, "build", "android-node-runtime");
const nodeProject = resolve(cordovaAssets, "www", "nodejs-project");
const pluginAssets = resolve(root, "node_modules", "@red-mobile", "nodejs-mobile-cordova", "install", "nodejs-mobile-cordova-assets");
const builtinAssets = resolve(cordovaAssets, "nodejs-mobile-cordova-assets");
const androidAbis = ["arm64-v8a"];
const androidExpressVersion = "4.21.2";

function assertInside(parent, child) {
  const rel = relative(parent, child);
  if (rel.startsWith("..") || rel === "" || resolve(parent, rel) !== child) {
    throw new Error(`Refusing to operate outside ${parent}: ${child}`);
  }
}

function resetDir(path, parent) {
  assertInside(parent, path);
  rmSync(path, { recursive: true, force: true });
  mkdirSync(path, { recursive: true });
}

function readRootPackage() {
  return JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
}

function runtimePackageManifest(packageJson) {
  return {
    name: "jianyin-android-node-runtime",
    private: true,
    type: "module",
    dependencies: {
      express: androidExpressVersion,
      NeteaseCloudMusicApi: packageJson.dependencies.NeteaseCloudMusicApi
    }
  };
}

function writeRuntimePackageFiles(manifest) {
  writeFileSync(resolve(runtimeRoot, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(
    resolve(runtimeRoot, "package-lock.json"),
    `${JSON.stringify(
      {
        name: manifest.name,
        lockfileVersion: 3,
        requires: true,
        packages: {
          "": manifest
        }
      },
      null,
      2
    )}\n`
  );
}

function packagePathParts(packageName) {
  return packageName.split("/");
}

function findInstalledPackage(packageName, fromDir, optional = false) {
  let cursor = resolve(fromDir);
  while (true) {
    const candidate = resolve(cursor, "node_modules", ...packagePathParts(packageName));
    if (existsSync(resolve(candidate, "package.json"))) return candidate;
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  if (optional) return null;
  throw new Error(`Local package not found: ${packageName} from ${fromDir}`);
}

function copyPackageWithoutNestedNodeModules(source, target) {
  cpSync(source, target, {
    recursive: true,
    force: true,
    filter: (entry) => {
      const rel = relative(source, entry);
      if (!rel) return true;
      return !rel.split(sep).includes("node_modules");
    }
  });
}

function copyInstalledPackage(packageName, fromDir, targetNodeModules, copied = new Set(), optional = false) {
  const source = findInstalledPackage(packageName, fromDir, optional);
  if (!source) return;

  const target = resolve(targetNodeModules, ...packagePathParts(packageName));
  const key = `${source}\n${target}`;
  if (copied.has(key)) return;
  copied.add(key);

  mkdirSync(targetNodeModules, { recursive: true });
  resetDir(target, targetNodeModules);
  copyPackageWithoutNestedNodeModules(source, target);

  const packageJson = JSON.parse(readFileSync(resolve(source, "package.json"), "utf8"));
  const dependencies = packageJson.dependencies || {};
  for (const dependencyName of Object.keys(dependencies)) {
    copyInstalledPackage(dependencyName, source, resolve(target, "node_modules"), copied);
  }
  const optionalDependencies = packageJson.optionalDependencies || {};
  for (const dependencyName of Object.keys(optionalDependencies)) {
    copyInstalledPackage(dependencyName, source, resolve(target, "node_modules"), copied, true);
  }
}

function copyLocalRuntimeDependencies() {
  if (!existsSync(resolve(root, "node_modules", "NeteaseCloudMusicApi", "package.json"))) return false;

  const copied = new Set();
  const runtimeNodeModules = resolve(runtimeRoot, "node_modules");
  mkdirSync(runtimeNodeModules, { recursive: true });
  copyInstalledPackage("NeteaseCloudMusicApi", root, runtimeNodeModules, copied);
  return false;
}

function installRuntimeDependencies() {
  const packageJson = readRootPackage();
  const manifest = runtimePackageManifest(packageJson);
  resetDir(runtimeRoot, resolve(root, "build"));
  writeRuntimePackageFiles(manifest);
  if (!copyLocalRuntimeDependencies()) {
    execFileSync("npm", ["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], {
      cwd: runtimeRoot,
      stdio: "inherit",
      shell: process.platform === "win32"
    });
  }
  patchNeteaseRuntimeTmpPath();
}

function patchNeteaseRuntimeTmpPath() {
  const files = [
    resolve(runtimeRoot, "node_modules", "NeteaseCloudMusicApi", "app.js"),
    resolve(runtimeRoot, "node_modules", "NeteaseCloudMusicApi", "generateConfig.js"),
    resolve(runtimeRoot, "node_modules", "NeteaseCloudMusicApi", "main.js"),
    resolve(runtimeRoot, "node_modules", "NeteaseCloudMusicApi", "util", "request.js")
  ];

  for (const file of files) {
    const current = readFileSync(file, "utf8");
    const patched = current.replace(
      "const tmpPath = require('os').tmpdir()",
      "const tmpPath = process.env.JIANYIN_TMP_PATH || require('os').tmpdir()"
    );
    if (patched !== current) writeFileSync(file, patched);
  }
}

function writeNodeEntrypoint() {
  writeFileSync(
    resolve(nodeProject, "main.cjs"),
    `const fs = require("fs");
const path = require("path");

process.env.PORT = process.env.PORT || "5188";

function useAppDirectory(directory) {
  const dataDir = path.resolve(directory);
  const tmpDir = path.join(dataDir, "tmp");
  fs.mkdirSync(tmpDir, { recursive: true });
  process.env.JIANYIN_STATE_PATH = path.join(dataDir, "jianyin-shared-state.json");
  process.env.HOME = process.env.HOME || dataDir;
  process.env.USERPROFILE = process.env.USERPROFILE || dataDir;
  process.env.JIANYIN_TMP_PATH = tmpDir;
  process.env.TMPDIR = tmpDir;
  process.env.TMP = tmpDir;
  process.env.TEMP = tmpDir;
}

try {
  const cordova = require("cordova-bridge");
  useAppDirectory(cordova.app.datadir());
} catch (error) {
  console.error("[jianyin] cordova bridge unavailable", error);
  useAppDirectory(path.join(__dirname, "data"));
}

(async () => {
  const { startServer } = await import("./server.mjs");
  await startServer({ listenPort: Number(process.env.PORT), dev: false });
})().catch((error) => {
  console.error("[jianyin] failed to start embedded server", error);
});
`
  );
}

function writeBootstrapPage() {
  mkdirSync(appPublic, { recursive: true });
  writeFileSync(
    resolve(appPublic, "index.html"),
    `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>拾音</title>
    <style>
      html, body {
        margin: 0;
        min-height: 100%;
        background: #eef3f7;
        color: #18222d;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      body {
        display: grid;
        place-items: center;
      }
      .status {
        font-size: 15px;
      }
    </style>
  </head>
  <body>
    <div class="status" id="status">正在启动拾音...</div>
    <script src="cordova.js"></script>
    <script>
      (function () {
        var started = false;
        var target = "http://127.0.0.1:5188/";
        var health = target + "api/health";
        var status = document.getElementById("status");

        function setStatus(message) {
          if (status) status.textContent = message;
        }

        function openApp() {
          window.location.replace(target);
        }

        function checkServerReady() {
          return fetch(health, { mode: "no-cors", cache: "no-store" }).then(function () {
            return true;
          }).catch(function () {
            return false;
          });
        }

        function waitForServer(deadline) {
          checkServerReady()
            .then(function (ready) {
              if (ready) {
                openApp();
                return;
              }
              if (Date.now() > deadline) {
                setStatus("Still starting...");
              }
              setTimeout(function () {
                waitForServer(deadline);
              }, 450);
            });
        }

        function startNode() {
          if (started) return;
          started = true;
          setStatus("Starting embedded service...");
          checkServerReady().then(function (ready) {
            if (ready) {
              openApp();
              return;
            }
            startNodeEngine();
          });
        }

        function startNodeEngine() {
          if (!window.nodejs || typeof window.nodejs.start !== "function") {
            setStatus("Preparing service...");
            setTimeout(function () {
              started = false;
              startNode();
            }, 500);
            return;
          }
          window.nodejs.start("main.cjs", function (error) {
            if (error) {
              if (/Engine already started/i.test(String(error))) {
                setStatus("正在打开拾音...");
                waitForServer(Date.now() + 15000);
                return;
              }
              setStatus("Service start failed, retrying...");
              started = false;
              setTimeout(startNode, 1000);
              return;
            }
            setStatus("正在打开拾音...");
            waitForServer(Date.now() + 15000);
          }, { redirectOutputToLogcat: true });
        }

        document.addEventListener("deviceready", startNode, false);
        setTimeout(startNode, 1000);
      })();
    </script>
  </body>
</html>
`
  );
}

function patchGeneratedGradle() {
  const appCapacitorGradle = resolve(androidRoot, "app", "capacitor.build.gradle");
  if (existsSync(appCapacitorGradle)) {
    const current = readFileSync(appCapacitorGradle, "utf8");
    const patched = current
      .split(/\r?\n/)
      .filter((line) => !/@red-mobile\/nodejs-mobile-cordova\/src\/android\/build\.gradle/.test(line))
      .join("\n");
    if (patched !== current) writeFileSync(appCapacitorGradle, `${patched.replace(/\n*$/, "")}\n`);
  }

  const cordovaGradle = resolve(cordovaRoot, "build.gradle");
  if (existsSync(cordovaGradle)) {
    let current = readFileSync(cordovaGradle, "utf8");
    current = current
      .replace(/\r?\nandroid \{\r?\n\s+ndkVersion "28\.2\.13676358"\r?\n\}/g, "")
      .replace(/\r?\n\s+ndkVersion "28\.2\.13676358"/g, "")
      .replace(/\r?\n\s+ndk \{\r?\n\s+abiFilters (?:project\.findProperty\("jianyinAbi"\) \?: )?"arm64-v8a"\r?\n\s+\}/g, "")
      .replace(/\r?\nandroid \{\r?\n\}/g, "");
    current = current.replace(
      /android \{\r?\n\s+namespace = "capacitor\.cordova\.android\.plugins"/,
      'android {\n    namespace = "capacitor.cordova.android.plugins"\n    ndkVersion "28.2.13676358"'
    );
    current = current.replace(
      /(defaultConfig \{\r?\n\s+minSdkVersion[^\r\n]*\r?\n\s+targetSdkVersion[^\r\n]*\r?\n\s+versionCode 1\r?\n\s+versionName "1\.0")/,
      '$1\n        ndk {\n            abiFilters "arm64-v8a"\n        }'
    );
    current = current.replace(
      /apply from: "\.\.\/\.\.\/node_modules\/@red-mobile\/nodejs-mobile-cordova\/src\/android\/build\.gradle"\r?\n/,
      'apply from: "../../node_modules/@red-mobile/nodejs-mobile-cordova/src/android/build.gradle"\nandroid {\n    ndkVersion "28.2.13676358"\n}\n'
    );
    if (!current.includes('maven { url uri("${rootProject.projectDir}/local-maven") }')) {
      current = current.replace(
        /(\s+repositories \{\r?\n\s+google\(\)\r?\n\s+mavenCentral\(\))/,
        '$1\n        maven { url uri("${rootProject.projectDir}/local-maven") }'
      );
    }
    writeFileSync(cordovaGradle, current);
  }

  const cmakeLists = resolve(cordovaNativeLibs, "CMakeLists.txt");
  if (existsSync(cmakeLists)) {
    const current = readFileSync(cmakeLists, "utf8");
    const linkOptions = 'target_link_options(nodejs-mobile-cordova-native-lib PRIVATE "-Wl,-z,max-page-size=16384")';
    if (!current.includes(linkOptions)) {
      writeFileSync(cmakeLists, current.replace(/(\r?\ninclude_directories\(libnode\/include\/node\/\)\r?\n)/, `\n${linkOptions}\n$1`));
    }
  }

  if (existsSync(cordovaNativeLibs)) {
    resetDir(cordovaNativeLibsBuildPath, cordovaRoot);
    cpSync(cordovaNativeLibs, cordovaNativeLibsBuildPath, { recursive: true });
    resetDir(resolve(cordovaNativeLibs, "libnode"), cordovaNativeLibs);
    resetDir(resolve(cordovaNativeLibsBuildPath, "libnode"), cordovaNativeLibsBuildPath);
    cpSync(existsSync(nodeMobile16kLibnode) ? nodeMobile16kLibnode : nodeMobileLibnode, resolve(cordovaNativeLibs, "libnode"), { recursive: true });
    cpSync(existsSync(nodeMobile16kLibnode) ? nodeMobile16kLibnode : nodeMobileLibnode, resolve(cordovaNativeLibsBuildPath, "libnode"), { recursive: true });
    for (const base of [resolve(cordovaNativeLibs, "libnode"), resolve(cordovaNativeLibsBuildPath, "libnode")]) {
      for (const abiDirName of readdirSync(resolve(base, "bin"))) {
        if (!androidAbis.includes(abiDirName)) {
          rmSync(resolve(base, "bin", abiDirName), { recursive: true, force: true });
        }
      }

      for (const abi of androidAbis) {
        const abiDir = resolve(base, "bin", abi);
        const gzPath = resolve(abiDir, "libnode.so.gz");
        const soPath = resolve(abiDir, "libnode.so");
        if (existsSync(gzPath)) writeFileSync(soPath, gunzipSync(readFileSync(gzPath)));
      }
    }
  }
}

function shouldSkipAsset(name) {
  return name.startsWith(".") || name.endsWith(".gz") || name.endsWith("~");
}

function collectAssetLists() {
  const dirs = [];
  const files = [];

  function walk(absPath) {
    for (const name of readdirSync(absPath)) {
      if (shouldSkipAsset(name)) continue;
      const child = resolve(absPath, name);
      const rel = relative(cordovaAssets, child).split(sep).join("/");
      const stats = statSync(child);
      if (stats.isDirectory()) {
        dirs.push(rel);
        walk(child);
      } else if (stats.isFile()) {
        files.push(rel);
      }
    }
  }

  walk(resolve(cordovaAssets, "www", "nodejs-project"));
  dirs.sort();
  files.sort();
  writeFileSync(resolve(cordovaAssets, "dir.list"), `${dirs.join("\n")}\n`);
  writeFileSync(resolve(cordovaAssets, "file.list"), `${files.join("\n")}\n`);
}

function prepareAssets() {
  if (!existsSync(resolve(root, "dist", "index.html"))) {
    throw new Error("dist/index.html not found. Run npm run build first.");
  }
  if (!existsSync(pluginAssets)) {
    throw new Error(`Node Mobile plugin assets not found: ${pluginAssets}`);
  }

  resetDir(nodeProject, cordovaAssets);
  resetDir(builtinAssets, cordovaAssets);

  cpSync(pluginAssets, builtinAssets, { recursive: true });
  cpSync(resolve(root, "server.mjs"), resolve(nodeProject, "server.mjs"));
  cpSync(resolve(root, "dist"), resolve(nodeProject, "dist"), { recursive: true });
  cpSync(resolve(runtimeRoot, "node_modules"), resolve(nodeProject, "node_modules"), { recursive: true });
  cpSync(resolve(runtimeRoot, "package-lock.json"), resolve(nodeProject, "package-lock.json"));
  cpSync(resolve(runtimeRoot, "package.json"), resolve(nodeProject, "package.json"));
  writeNodeEntrypoint();

  mkdirSync(resolve(cordovaAssets, "www"), { recursive: true });
  writeFileSync(resolve(cordovaAssets, "www", "NODEJS_MOBILE_BUILD_NATIVE_MODULES_VALUE.txt"), "0\n");
  collectAssetLists();
  writeBootstrapPage();
}

installRuntimeDependencies();
prepareAssets();
patchGeneratedGradle();

console.log("Prepared Android embedded Node backend assets.");
