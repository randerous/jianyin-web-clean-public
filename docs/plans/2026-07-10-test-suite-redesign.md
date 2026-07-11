# Desktop Test Suite Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make desktop functional and performance tests deterministic, isolated, measurable, and runnable through explicit commands.

**Architecture:** Keep API tests in Node, desktop functional tests in Playwright against an isolated server, and browser performance tests in a separate serial Playwright run. The default `npm test` gate runs deterministic API and desktop functional tests only; the performance gate uses a different port and state file so it cannot mutate functional test state.

**Tech Stack:** Node test runner, Playwright, TypeScript, Chromium.

---

### Task 1: Separate the test gates

**Files:**
- Modify: `package.json`
- Modify: `playwright.config.ts`
- Create: `playwright.performance.config.ts`

**Steps:**
1. Make the functional Playwright config match only `tests/app.e2e.ts` and use one worker because the app persists shared server state.
2. Add a browser-performance config with its own port/state file, one worker, and `tests/perf.e2e.ts` only.
3. Add explicit npm scripts for API, desktop functional, desktop performance, and all desktop gates.
4. Run `npx playwright test --list` for each config and verify no suite appears in the wrong gate.

### Task 2: Correct browser performance measurements

**Files:**
- Modify: `tests/perf.e2e.ts`

**Steps:**
1. Remove APK/ADB tests from the browser performance suite.
2. Correct percentile calculation to nearest-rank P95.
3. Require at least five measured samples for performance thresholds.
4. Replace fixed sleeps and swallowed assertions with observable content/audio state changes.
5. Make the 2-second slow-response test wait for a unique slow-response result and assert both lower and upper bounds.
6. Write a report that includes thresholds and pass/fail status.
7. Run the desktop performance gate twice to check repeatability.

### Task 3: Align documentation and run all gates

**Files:**
- Modify: `测试用例/00-执行入口-测试.md`
- Modify: `测试用例/README.md`
- Modify: `性能测试用例/00-性能测试执行入口.md`
- Modify: `性能测试用例/README.md`

**Steps:**
1. Replace stale fixed pass counts with commands and invariant acceptance criteria.
2. Remove the manual-test entry from the required automated workflow.
3. Document isolation, sample count, and measurement endpoint.
4. Run build, API, desktop functional, and desktop performance.
5. Re-run the full gate after any product optimization and review `git diff --check` plus workspace status.
