import fs from "node:fs";
import path from "node:path";
import type { FullConfig, FullResult, Reporter, TestCase, TestResult } from "playwright/types/testReporter";

type Metrics = Record<string, number[]>;

function percentile(values: number[], ratio: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
}

function attachmentBody(attachment: TestResult["attachments"][number]) {
  if (attachment.body) return attachment.body.toString("utf8");
  if (attachment.path && fs.existsSync(attachment.path)) return fs.readFileSync(attachment.path, "utf8");
  return "";
}

export default class PerformanceReporter implements Reporter {
  private metrics: Metrics = {};
  private longTasks: Array<{ test: string; duration: number; start: number }> = [];
  private errors: Array<{ test: string; message: string }> = [];
  private outputFile = "test-results/perf-report.json";

  constructor(options: { outputFile?: string } = {}) {
    if (options.outputFile) this.outputFile = options.outputFile;
  }

  onBegin(config: FullConfig) {
    this.outputFile = path.resolve(config.rootDir, "..", this.outputFile);
  }

  onTestEnd(test: TestCase, result: TestResult) {
    for (const attachment of result.attachments) {
      const body = attachmentBody(attachment);
      if (!body) continue;
      if (attachment.name === "performance-metrics") {
        const metrics = JSON.parse(body) as Metrics;
        for (const [name, values] of Object.entries(metrics)) {
          if (!this.metrics[name]) this.metrics[name] = [];
          this.metrics[name].push(...values);
        }
      }
      if (attachment.name === "performance-diagnostics") {
        const diagnostics = JSON.parse(body) as { longTasks?: Array<{ duration: number; start: number }>; errors?: string[] };
        for (const entry of diagnostics.longTasks ?? []) this.longTasks.push({ test: test.title, ...entry });
        for (const message of diagnostics.errors ?? []) this.errors.push({ test: test.title, message });
      }
    }
  }

  onEnd(result: FullResult) {
    const report = {
      timestamp: new Date().toISOString(),
      status: result.status,
      metrics: Object.fromEntries(Object.entries(this.metrics).map(([name, values]) => [name, values.length >= 5
        ? {
            kind: "multi-sample",
            samples: values.length,
            p50: percentile(values, 0.5),
            p95: percentile(values, 0.95),
            avg: values.reduce((sum, value) => sum + value, 0) / values.length,
            values
          }
        : { kind: "single-run-smoke", samples: values.length, value: values[0] ?? null, values }])),
      longTasks: this.longTasks,
      consoleErrors: this.errors
    };
    fs.mkdirSync(path.dirname(this.outputFile), { recursive: true });
    fs.writeFileSync(this.outputFile, JSON.stringify(report, null, 2));
    console.log(`\n===== 性能测试报告已写入: ${this.outputFile} =====`);
  }
}
