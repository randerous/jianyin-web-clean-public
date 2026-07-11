import path from "node:path";
import { defineConfig, devices } from "playwright/test";

const statePath = path.resolve("test-results/.jianyin-performance-state.json");

export default defineConfig({
  testDir: "./tests",
  testMatch: "perf.e2e.ts",
  testIgnore: "**/._*",
  outputDir: "test-results/performance-artifacts",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  reporter: [
    ["list"],
    ["./tests/reporters/status-reporter.ts", { suiteName: "performance", outputFile: "test-results/reports/performance-summary.json" }],
    ["./tests/reporters/performance-reporter.ts", { outputFile: "test-results/perf-report.json" }]
  ],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  use: {
    baseURL: "http://127.0.0.1:5190",
    trace: "retain-on-failure"
  },
  webServer: {
    command: `node -e "process.env.JIANYIN_STATE_PATH='${statePath.replaceAll("\\", "\\\\")}'; import('./server.mjs').then(({ startServer }) => startServer({ listenPort: 5190, dev: false }))"`,
    url: "http://127.0.0.1:5190/api/health",
    reuseExistingServer: false
  },
  projects: [
    {
      name: "chromium-performance",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
