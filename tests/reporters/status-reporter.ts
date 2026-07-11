import fs from "node:fs";
import path from "node:path";
import type { FullConfig, FullResult, Reporter, Suite } from "playwright/types/testReporter";

export default class StatusReporter implements Reporter {
  private outputFile = "test-results/reports/playwright-summary.json";
  private suiteName = "playwright";
  private rootSuite?: Suite;
  private startedAt = 0;

  constructor(options: { outputFile?: string; suiteName?: string } = {}) {
    if (options.outputFile) this.outputFile = options.outputFile;
    if (options.suiteName) this.suiteName = options.suiteName;
  }

  onBegin(config: FullConfig, suite: Suite) {
    this.outputFile = path.resolve(config.rootDir, "..", this.outputFile);
    this.rootSuite = suite;
    this.startedAt = Date.now();
  }

  onEnd(result: FullResult) {
    const counts = {
      total: 0,
      passed: 0,
      failed: 0,
      flaky: 0,
      skipped: 0
    };

    for (const test of this.rootSuite?.allTests() ?? []) {
      counts.total += 1;
      const outcome = test.outcome();
      if (outcome === "unexpected") counts.failed += 1;
      else if (outcome === "skipped") counts.skipped += 1;
      else {
        counts.passed += 1;
        if (outcome === "flaky") counts.flaky += 1;
      }
    }

    const report = {
      suite: this.suiteName,
      timestamp: new Date().toISOString(),
      status: result.status,
      durationMs: Date.now() - this.startedAt,
      ...counts
    };
    fs.mkdirSync(path.dirname(this.outputFile), { recursive: true });
    fs.writeFileSync(this.outputFile, JSON.stringify(report, null, 2));
  }
}
