import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const resultsRoot = path.join(projectRoot, "test-results");
const reportsRoot = path.join(resultsRoot, "reports");
const outputPath = path.join(resultsRoot, "test-status.json");
const knownReports = {
  api: path.join(reportsRoot, "api-junit.xml"),
  e2e: path.join(reportsRoot, "e2e-summary.json"),
  performance: path.join(reportsRoot, "performance-summary.json"),
  performanceMetrics: path.join(resultsRoot, "perf-report.json")
};

async function readJson(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function junitCount(xml, name) {
  const match = xml.match(new RegExp(`<!-- ${name} (\\d+(?:\\.\\d+)?) -->`));
  return match ? Number(match[1]) : 0;
}

async function readApiSummary() {
  try {
    const xml = await fs.readFile(knownReports.api, "utf8");
    const stat = await fs.stat(knownReports.api);
    const failed = junitCount(xml, "fail") + junitCount(xml, "cancelled");
    return {
      suite: "api",
      timestamp: stat.mtime.toISOString(),
      status: failed === 0 ? "passed" : "failed",
      durationMs: junitCount(xml, "duration_ms"),
      total: junitCount(xml, "tests"),
      passed: junitCount(xml, "pass"),
      failed,
      skipped: junitCount(xml, "skipped"),
      todo: junitCount(xml, "todo"),
      report: path.relative(projectRoot, knownReports.api)
    };
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function withReport(summary, reportPath) {
  return summary ? { ...summary, report: path.relative(projectRoot, reportPath) } : null;
}

export async function generateTestStatus() {
  const [api, e2eRaw, performanceRaw, performanceMetrics] = await Promise.all([
    readApiSummary(),
    readJson(knownReports.e2e),
    readJson(knownReports.performance),
    readJson(knownReports.performanceMetrics)
  ]);
  const e2e = withReport(e2eRaw, knownReports.e2e);
  const performance = withReport(performanceRaw, knownReports.performance);
  if (performance && performanceMetrics) {
    performance.metricsReport = path.relative(projectRoot, knownReports.performanceMetrics);
    performance.longTasks = performanceMetrics.longTasks?.length ?? 0;
    performance.consoleErrors = performanceMetrics.consoleErrors?.length ?? 0;
  }

  const suites = { api, e2e, performance };
  const completed = Object.values(suites).filter(Boolean);
  const failed = completed.some((suite) => suite.status !== "passed");
  const status = failed ? "failed" : completed.length === Object.keys(suites).length ? "passed" : completed.length ? "partial" : "not-run";
  const report = {
    generatedAt: new Date().toISOString(),
    status,
    suites
  };
  await fs.mkdir(resultsRoot, { recursive: true });
  await fs.writeFile(outputPath, JSON.stringify(report, null, 2));
  console.log(`测试状态已写入 ${path.relative(projectRoot, outputPath)}（${status}）`);
  return report;
}

export async function resetTestStatus() {
  await Promise.all([
    ...Object.values(knownReports),
    outputPath
  ].map((filePath) => fs.rm(filePath, { force: true })));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes("--reset")) await resetTestStatus();
  else await generateTestStatus();
}
