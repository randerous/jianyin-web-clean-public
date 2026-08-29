import path from "node:path";
import { defineConfig, devices } from "playwright/test";

const statePath = path.resolve("test-results/.jianyin-e2e-state.json");
const externalServer = process.env.JIANYIN_E2E_EXTERNAL_SERVER === "1";

export default defineConfig({
  testDir: "./tests",
  testMatch: "e2e/*.e2e.ts",
  testIgnore: "**/._*",
  outputDir: "test-results/e2e-artifacts",
  timeout: 30_000,
  expect: { timeout: 6_000 },
  reporter: [
    ["list"],
    ["./tests/reporters/status-reporter.ts", { suiteName: "e2e", outputFile: "test-results/reports/e2e-summary.json" }]
  ],
  fullyParallel: false,
  workers: 1,
  # CI 共享 runner 时序抖动会偶发触发 e2e flake；本地保持 0 次重试，不掩盖问题。
  retries: process.env.CI ? 2 : 0,
  use: {
    baseURL: "http://127.0.0.1:5189",
    trace: "on-first-retry"
  },
  webServer: externalServer ? undefined : {
    command: `node -e "process.env.JIANYIN_STATE_PATH='${statePath.replaceAll("\\", "\\\\")}'; import('./server.mjs').then(({ startServer }) => startServer({ listenPort: 5189, dev: true }))"`,
    url: "http://127.0.0.1:5189",
    reuseExistingServer: !process.env.CI
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
