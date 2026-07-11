# Product Design and Performance Completion Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Finish the remaining product design and performance improvements, then prove them with desktop and connected-device verification.

**Architecture:** Product changes use small request, persistence, playback, and rendering boundaries covered by deterministic regression tests. Page-side timing and durable reports verify performance without driving the product design. Test splitting remains mechanical and shares one fixture module.

**Tech Stack:** React, TypeScript, Playwright, Node test runner, Vite, Android/ADB.

---

### Task 1: Home request concurrency and reuse

**Files:**
- Modify: `tests/app.e2e.ts` before splitting
- Modify: `src/lib/api.ts`
- Modify: `src/App.tsx`

**Steps:**
1. Add a failing slow-old/fast-new refresh regression.
2. Add a failing regression for duplicate same-parameter home requests.
3. Add AbortSignal support and an in-flight request cache to the home API.
4. Abort superseded UI requests and ignore stale success, failure, and finally paths.
5. Run the focused tests and homepage suite.

### Task 2: Shared-state single-flight and lifecycle flush

**Files:**
- Modify: `tests/app.e2e.ts` before splitting
- Create: `src/lib/shared-state-writer.ts`
- Modify: `src/App.tsx`

**Steps:**
1. Add failing tests proving one POST is in flight and the final queued state wins.
2. Serialize remote writes and replace pending state with the latest state.
3. Preserve immediate localStorage, immediate structural remote writes, and 250ms settings debounce.
4. Flush the latest queued settings on `visibilitychange` and `pagehide`.
5. Re-run persistence, reload, quota, and clean-context regressions.

### Task 3: Playback adjacency and tail latency

**Files:**
- Modify: `tests/app.e2e.ts` before splitting
- Modify: `src/App.tsx`
- Modify: `tests/perf.e2e.ts`

**Steps:**
1. Add a regression for immediate previous/next queue prewarming without duplicate resolution.
2. Reuse the existing prewarm cache and in-flight Promise map.
3. Add `preload="metadata"` to the audio element.
4. Add page-side click-to-canplay and click-to-playing phase measurements over five samples.
5. Verify continuous-switch P95 and request counts.

### Task 4: Rendering boundaries for the supported list size

**Files:**
- Modify: `src/App.tsx`
- Create or modify only as justified: `src/components/*`
- Modify: `tests/perf.e2e.ts`

**Steps:**
1. Profile which product subtree rerenders during playback position updates with a 1000-song detail open.
2. Limit playback position commits to user-visible one-second changes while keeping the precise ref for resume and Android state.
3. Stabilize row callbacks and memoize song rows where the measurement proves benefit.
4. Keep virtualization and 5000-song capacity out of scope.
5. Re-run mobile layout and 1000-song functional/performance regressions.

### Task 5: Durable performance measurements and reports

**Files:**
- Create: `tests/helpers/performance.ts`
- Create: `tests/reporters/performance-reporter.ts`
- Modify: `tests/perf.e2e.ts`
- Modify: `playwright.performance.config.ts`

**Steps:**
1. Capture Long Tasks, console/page errors, DOM completion, and audio phases from page initialization.
2. Convert homepage, search, playback, continuous switching, and long-list core metrics to at least five samples.
3. Attach metrics and diagnostics through `testInfo.attach`.
4. Aggregate attachments in a reporter so worker restarts cannot erase earlier results.
5. Run production performance tests and validate the report schema.

### Task 6: Mechanical E2E split

**Files:**
- Create: `tests/helpers/app-fixture.ts`
- Create: `tests/e2e/home.e2e.ts`
- Create: `tests/e2e/settings.e2e.ts`
- Create: `tests/e2e/playback.e2e.ts`
- Create: `tests/e2e/library.e2e.ts`
- Create: `tests/e2e/search.e2e.ts`
- Create: `tests/e2e/accounts.e2e.ts`
- Create: `tests/e2e/flac.e2e.ts`
- Remove after verified replacement: `tests/app.e2e.ts`
- Modify: `playwright.config.ts`

**Steps:**
1. Move helpers without semantic changes.
2. Move all 57+ tests by domain without changing assertions.
3. List tests and confirm names/counts match before and after.
4. Run the full functional suite with one worker.

### Task 7: Generated status and real-network isolation

**Files:**
- Create: `tests/reporters/status-reporter.ts`
- Create: `scripts/generate-test-status.mjs`
- Create: `tests/smoke/real-flac.smoke.mjs`
- Modify: `package.json`
- Modify: `tests/server.test.mjs`
- Modify: `测试用例/00-执行入口-测试.md`

**Steps:**
1. Write actual suite summaries to JSON.
2. Move the real FLAC smoke out of the deterministic API file.
3. Generate `test-results/test-status.json` from actual reports.
4. Remove hard-coded pass counts from documentation.
5. Verify deterministic API contains no skipped real-network test.

### Task 8: Final desktop and true-device gates

**Files:**
- Verify all changed files.

**Steps:**
1. Run `npm run test:all` and validate generated reports.
2. Run `git diff --check`.
3. Build the APK without deleting user-owned workspace files.
4. Use only `adb install -r`; verify signature and `firstInstallTime` preservation.
5. Run low-load true-device startup, navigation, retained local playback, crash/ANR, CPU, memory, and screenshot checks.
6. Stop all test/debug processes and report exact results.
