# Product Design and Performance Completion

## Goal

Complete the remaining product design and performance improvements, using deterministic desktop tests and low-load Android true-device checks as verification rather than as the primary deliverable.

## Chosen approach

Keep the existing Node, Playwright, React, and Vite stack. Product changes stay surgical. Home requests use request identity plus cancellation so stale results cannot overwrite newer results. Shared-state persistence keeps synchronous localStorage durability, batches settings-only writes, serializes remote writes through a single-flight coordinator, and flushes the latest queued state on lifecycle events. Playback prewarming targets the immediate previous and next queue entries and reuses the existing in-flight/cache maps.

Rendering work targets the supported 1000-song product scope. Extract screen and song-row boundaries only where that prevents high-frequency playback position or large-list updates from invalidating unrelated UI. Add memoization only after stable props are established. Virtualization is out of scope, and the previously rejected `content-visibility` rule remains removed.

Tests support these changes. Each behavior change begins with a deterministic regression. Performance measurements are produced inside the page from initiating DOM events to MutationObserver or native audio completion events. Per-test attachments and reporters make results durable across worker restarts. Functional E2E splitting is mechanical and must not change behavior.

## Explicit non-goals

- Do not restore `content-visibility`; A/B testing showed a regression from about 360ms to 1851ms.
- Do not add a virtual-list dependency; the product does not need to display 5000 search or playlist rows at once.
- Do not split the production bundle while the main gzip asset remains about 86KB.
- Do not perform a large `App.tsx` component architecture rewrite.
- Do not run an Android emulator.

## Verification

Each behavior change starts with a failing deterministic test. The final gate is build, API, all functional E2E files, production performance tests, generated status validation, APK static validation, and low-load true-device smoke/performance checks. Existing user data is preserved with `adb install -r`; `uninstall` and `pm clear` are forbidden.
