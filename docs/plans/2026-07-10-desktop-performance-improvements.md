# Desktop Performance Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Improve desktop performance and performance-test fidelity without changing user-visible behavior or adding dependencies.

**Architecture:** Keep localStorage persistence synchronous for durability. Debounce settings-only remote shared-state POSTs by 250ms so bursts collapse to the final state, while structural data changes (playlists, favorites, history, downloads, queue, and search history) continue to save immediately. Run performance tests against the production build. An off-screen `content-visibility` optimization was A/B tested and rejected because it regressed the 1000-song detail measurement.

**Tech Stack:** React, TypeScript, CSS, Playwright, Vite.

---

### Task 1: Prove shared-state writes are currently unbatched

**Files:**
- Modify: `tests/app.e2e.ts`

**Steps:**
1. Add an E2E test that intercepts `/api/state` POST requests after startup settles.
2. Change several settings rapidly.
3. Assert localStorage immediately contains the final settings.
4. Assert the burst results in exactly one shared-state POST.
5. Run the test and verify it fails before implementation.

### Task 2: Batch settings-only shared-state persistence

**Files:**
- Modify: `src/App.tsx`

**Steps:**
1. Preserve the immediate `saveState(state)` call and existing quota error handling.
2. Compare structural state references with the previous render.
3. Save structural data changes to shared state immediately so reload cannot restore stale data.
4. For settings-only changes, schedule `saveSharedState(state)` after 250ms and cancel the previous timer so only the final burst state is posted.
5. Keep remote failure toast behavior.
6. Re-run the new batching test plus reload and clean-context persistence regressions.

**Verified:** the batching test observes exactly one POST; playlist reverse sorting survives reload; remote playlists survive a clean browser context.

### Task 3: Measure production and evaluate off-screen rendering

**Files:**
- Modify: `package.json`
- Modify: `playwright.performance.config.ts`
- Modify: `src/styles.css`

**Steps:**
1. Add an internal `test:perf:run` command and make public `test:perf` build first.
2. Start the performance server with `dev: false` so it serves `dist`.
3. A/B test `content-visibility: auto` on song rows inside long scrollable lists.
4. Reject the CSS change if it regresses the 1000-song detail baseline.
5. Record the verified result: `content-visibility` regressed to 1851ms; without it, production runs measured 360/361/371ms.

### Task 4: Full regression

**Files:**
- Verify all modified files.

**Steps:**
1. Run `npm run build`.
2. Run `npm run test:api`.
3. Run `npm run test:e2e`.
4. Run `npm run test:perf:run` after the build.
5. Run `git diff --check` and confirm no Android emulator process is started.

**Verified:** build passed; API tests passed 35 with 1 real-network smoke skipped; functional E2E passed 57; performance tests passed 28; `git diff --check` passed. Production measurements included homepage P95 44ms, refresh P95 63ms, playlist-detail P95 128ms, and 1000-song detail 340ms.
