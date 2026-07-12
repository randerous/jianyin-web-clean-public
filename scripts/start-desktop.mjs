import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT) || 5188;
const url = `http://127.0.0.1:${port}/`;
const healthUrl = `${url}api/health`;
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
process.env.COPYFILE_DISABLE = "1";
process.env.COPY_EXTENDED_ATTRIBUTES_DISABLE = "1";

function run(command, args, label) {
  console.log(`\n==> ${label}`);
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
    shell: process.platform === "win32"
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
}

function dependenciesNeedInstall() {
  const installedLock = resolve(root, "node_modules", ".package-lock.json");
  const projectLock = resolve(root, "package-lock.json");
  if (!existsSync(installedLock)) return true;
  return existsSync(projectLock) && statSync(projectLock).mtimeMs > statSync(installedLock).mtimeMs;
}

function removeAppleDoubleFiles(path) {
  if (!existsSync(path)) return;
  for (const name of readdirSync(path)) {
    const child = resolve(path, name);
    if (name.startsWith("._")) {
      rmSync(child, { recursive: true, force: true });
      continue;
    }
    try {
      if (statSync(child).isDirectory()) removeAppleDoubleFiles(child);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

function cleanGeneratedAppleDoubleFiles() {
  if (process.platform !== "darwin") return;
  removeAppleDoubleFiles(resolve(root, "node_modules"));
  removeAppleDoubleFiles(resolve(root, "dist"));
}

async function isJianyinHealthy() {
  try {
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(1_000) });
    if (!response.ok) return false;
    const body = await response.json();
    return body?.ok === true && body?.provider === "NeteaseCloudMusicApi";
  } catch {
    return false;
  }
}

function openBrowser() {
  if (process.env.JIANYIN_NO_OPEN === "1") return;
  let command;
  let args;
  if (process.platform === "win32") {
    command = "cmd.exe";
    args = ["/d", "/s", "/c", `start "" "${url}"`];
  } else if (process.platform === "darwin") {
    command = "open";
    args = [url];
  } else {
    command = "xdg-open";
    args = [url];
  }
  const opener = spawn(command, args, { cwd: root, detached: true, stdio: "ignore" });
  opener.unref();
}

async function waitForServer(child) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(`本地服务启动失败：${child.exitCode ?? child.signalCode ?? "unknown"}`);
    }
    if (await isJianyinHealthy()) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(`本地服务未能在 20 秒内启动：${url}`);
}

async function main() {
  console.log("既见桌面版一键启动");
  console.log(`项目目录：${root}`);

  if (dependenciesNeedInstall()) {
    run(npmCommand, ["ci", "--loglevel=error", "--no-audit", "--no-fund"], "首次安装/更新依赖");
  }
  cleanGeneratedAppleDoubleFiles();
  run(npmCommand, ["run", "build"], "构建桌面生产版本");
  cleanGeneratedAppleDoubleFiles();

  if (await isJianyinHealthy()) {
    console.log(`\n既见已经在运行：${url}`);
    openBrowser();
    return;
  }

  process.env.JIANYIN_ENABLE_UPDATE = "1";
  process.env.JIANYIN_UPDATE_ROOT = root;
  let opened = false;
  let stopping = false;
  let child = null;
  const stop = () => {
    stopping = true;
    if (child?.exitCode === null) child.kill("SIGTERM");
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  process.once("exit", stop);

  while (!stopping) {
    console.log("\n==> 启动既见本地服务");
    child = spawn(process.execPath, ["server.mjs", "--port", String(port)], {
      cwd: root,
      env: process.env,
      stdio: "inherit"
    });
    try {
      await waitForServer(child);
      if (!opened) {
        console.log(`\n既见已打开：${url}`);
        console.log("保持此窗口开启；关闭窗口即可停止本地服务。");
        openBrowser();
        opened = true;
      }
      if (process.env.JIANYIN_EXIT_AFTER_READY === "1") {
        child.kill("SIGTERM");
        await new Promise((resolvePromise) => child.once("exit", resolvePromise));
        return;
      }
      const exit = await new Promise((resolvePromise, reject) => {
        child.once("error", reject);
        child.once("exit", (code, signal) => resolvePromise({ code, signal }));
      });
      if (stopping || exit.signal === "SIGTERM" || exit.signal === "SIGINT" || exit.code === 0) return;
      if (exit.code === 75) {
        run(npmCommand, ["run", "build"], "应用更新后重新构建");
        cleanGeneratedAppleDoubleFiles();
        continue;
      }
      throw new Error(`本地服务异常退出：${exit.code ?? exit.signal}`);
    } catch (error) {
      if (child.exitCode === null) child.kill("SIGTERM");
      throw error;
    }
  }
}

main().catch((error) => {
  console.error(`\n启动失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
