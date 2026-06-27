import { spawn } from "node:child_process";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = 5189;
const statePath = path.join(root, "test-results", ".jianyin-e2e-state.json");

function envWithPath(extra = {}) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.toLowerCase() === "path") env.Path = value;
    else env[key] = value;
  }
  return { ...env, ...extra };
}

function isPortFree() {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => server.close(() => resolve(true)));
    server.listen(port, "127.0.0.1");
  });
}

function waitForServer(timeoutMs = 30_000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/health`);
        if (response.ok) {
          resolve();
          return;
        }
      } catch {
        // Keep polling until the dev server is ready.
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error("E2E server did not become ready"));
        return;
      }
      setTimeout(tick, 250);
    };
    void tick();
  });
}

function spawnChild(command, args, options = {}) {
  return spawn(command, args, {
    cwd: root,
    env: envWithPath(options.env),
    stdio: options.stdio ?? "inherit",
    windowsHide: true
  });
}

async function main() {
  let server = null;
  const playwrightArgs = process.argv.slice(2);
  const shouldStartServer = await isPortFree();

  if (shouldStartServer) {
    server = spawnChild(process.execPath, [
      "-e",
      "import('./server.mjs').then(({ startServer }) => startServer({ listenPort: 5189, dev: true }))"
    ], {
      env: { JIANYIN_STATE_PATH: statePath }
    });
    await waitForServer();
  }

  const test = spawnChild(process.execPath, [
    "node_modules/playwright/cli.js",
    "test",
    ...playwrightArgs
  ], {
    env: {
      CI: "1",
      JIANYIN_E2E_EXTERNAL_SERVER: "1"
    }
  });

  const exitCode = await new Promise((resolve) => {
    test.on("exit", (code) => resolve(code ?? 1));
  });

  if (server) {
    server.kill();
    await new Promise((resolve) => server.once("exit", resolve));
  }

  process.exit(exitCode);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
