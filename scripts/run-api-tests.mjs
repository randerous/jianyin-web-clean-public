import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateTestStatus } from "./generate-test-status.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reportPath = path.join(projectRoot, "test-results", "reports", "api-junit.xml");
await fs.mkdir(path.dirname(reportPath), { recursive: true });
await fs.rm(reportPath, { force: true });

const args = [
  "--test",
  "--test-reporter=spec",
  "--test-reporter-destination=stdout",
  "--test-reporter=junit",
  `--test-reporter-destination=${reportPath}`,
  ...process.argv.slice(2),
  "tests/server.test.mjs",
  "tests/release-config.test.mjs"
];

const exitCode = await new Promise((resolve, reject) => {
  const child = spawn(process.execPath, args, { cwd: projectRoot, stdio: "inherit" });
  child.once("error", reject);
  child.once("exit", (code, signal) => resolve(signal ? 1 : code ?? 1));
});

await generateTestStatus();
process.exitCode = exitCode;
