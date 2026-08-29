/**
 * 性能测试套件 — 按 00-性能测试执行入口.md 推荐顺序执行
 *
 * 模块：
 *   1. 首页与歌单加载 (PERF-HOME-*)
 *   2. 搜索性能 (PERF-SEARCH-*)
 *   3. 播放与切歌性能 (PERF-PLAY-*)
 *   4. 下载与本地缓存性能 (PERF-DL-*)
 *   5. 数据恢复与存储性能 (PERF-DATA-*)
 *   6. UI 渲染与交互响应性能 (PERF-UI-*)
 * Android APK performance is intentionally isolated in tests/android.e2e.ts.
 */

import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "playwright/test";
import { armAudioPhaseCapture, armDomPhaseCapture, installPerformanceCapture, readAudioPhaseCapture, readDomPhaseCapture, readPerformanceDiagnostics } from "./helpers/performance";
import { toSharedState } from "../src/lib/shared-state";

/* ============================================================
   常量与共享辅助
   ============================================================ */

const storageKey = "jianyin-web-clean-state-v1";
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fullSongFile = path.join(projectRoot, "public", "assets", "full-song-65s.wav");
const sampleCount = 5;

type Metrics = Record<string, number[]>;
let metrics: Metrics = {};

function record(name: string, ms: number) {
  if (!metrics[name]) metrics[name] = [];
  metrics[name].push(ms);
}

function p50(arr: number[]): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function p95(arr: number[]): number {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil(s.length * 0.95) - 1)];
}

function avg(arr: number[]): number {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function mark(label: string): () => number {
  const start = Date.now();
  return () => {
    const elapsed = Date.now() - start;
    record(label, elapsed);
    return elapsed;
  };
}

function expectPerformance(name: string, values: number[], thresholdMs: number) {
  // 阈值按本地硬件标定；共享 CI runner CPU 慢，通过系数放宽，只防数量级回归。
  const factor = Number(process.env.JIANYIN_PERF_THRESHOLD_FACTOR || "1") || 1;
  const effectiveThreshold = Math.round(thresholdMs * Math.max(1, factor));
  expect(values, `${name} requires at least ${sampleCount} measured samples`).toHaveLength(sampleCount);
  const percentile = p95(values);
  console.log(`[${name}] samples=${values.join(",")}ms, P50=${p50(values)}ms, P95=${percentile}ms`);
  expect(percentile, `${name} P95 exceeded ${effectiveThreshold}ms`).toBeLessThan(effectiveThreshold);
}

/** 从首页播放一首本地歌曲 */
async function playLocalSong(page: Page): Promise<void> {
  await page.getByRole("navigation").getByRole("button", { name: "首页" }).click();
  // 首页歌曲按钮的 accessible name 是 "歌曲名 歌手名" 格式
  await page.getByRole("main").getByRole("button", { name: /周杰伦 本地试听/ }).click();
  await expectAudioPlaying(page);
}

async function expectAudioPlaying(page: Page) {
  await expect.poll(() => page.locator("audio").evaluate((a: HTMLAudioElement) => !a.paused)).toBe(true);
  await expect.poll(() => page.locator("audio").evaluate((a: HTMLAudioElement) => a.currentTime)).toBeGreaterThan(0);
}

async function expectAudioPaused(page: Page) {
  await expect.poll(() => page.locator("audio").evaluate((a: HTMLAudioElement) => a.paused)).toBe(true);
}

async function openPlayerSheet(page: Page): Promise<void> {
  await page.locator(".now-playing").click();
  await expect(page.locator(".player-sheet")).toBeVisible();
}

/** 关闭 dialog（点击返回按钮） */
async function closeDialog(page: Page) {
  const back = page.locator(".detail .back-button, .detail .topbar .icon-button, [aria-label=返回]").first();
  if (await back.isVisible().catch(() => false)) {
    await back.click();
    await page.waitForTimeout(200);
  }
}

/** 收集 long task */
async function startLongTaskCapture(page: Page) {
  await page.evaluate(() => {
    (window as any).__perf_long_tasks = [];
    const obs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        (window as any).__perf_long_tasks.push({ duration: entry.duration, start: entry.startTime });
      }
    });
    try { obs.observe({ type: "longtask", buffered: true }); } catch { /* ignore */ }
  });
}

async function getLongTasks(page: Page): Promise<{ duration: number; start: number }[]> {
  return page.evaluate(() => (window as any).__perf_long_tasks ?? []);
}

test.beforeEach(async ({ page }) => {
  metrics = {};
  await installPerformanceCapture(page);
});

test.afterEach(async ({ page }, testInfo) => {
  await testInfo.attach("performance-metrics", {
    body: Buffer.from(JSON.stringify(metrics)),
    contentType: "application/json"
  });
  const diagnostics = await readPerformanceDiagnostics(page).catch(() => ({ longTasks: [], errors: [] }));
  await testInfo.attach("performance-diagnostics", {
    body: Buffer.from(JSON.stringify(diagnostics)),
    contentType: "application/json"
  });
});

/* ============================================================
   测试数据工厂
   ============================================================ */

const testSongs = [
  { id: "test-local-jay", name: "周杰伦 本地试听", artist: "测试曲库", pic: "/assets/icon.png", cover: "/assets/icon.png", url: "/assets/full-song-65s.wav", source: "local", durationMs: 65000, verifiedPlayable: true, br: 320000, level: "exhigh", type: "mp3", audioType: "mp3", quality: "exhigh" },
  { id: "test-local-eason", name: "陈奕迅 本地试听", artist: "测试曲库", pic: "/assets/icon.png", cover: "/assets/icon.png", url: "/assets/full-song-65s.wav", source: "local", durationMs: 65000, verifiedPlayable: true, br: 320000, level: "exhigh", type: "mp3", audioType: "mp3", quality: "exhigh" },
  { id: "test-local-gem", name: "邓紫棋 本地试听", artist: "测试曲库", pic: "/assets/icon.png", cover: "/assets/icon.png", url: "/assets/full-song-65s.wav", source: "local", durationMs: 65000, verifiedPlayable: true, br: 320000, level: "exhigh", type: "mp3", audioType: "mp3", quality: "exhigh" },
];

function emptyState() {
  return {
    playlists: [
      { id: "favorites", name: "我喜欢的音乐", cover: "/assets/icon.png", songs: [], source: "local" },
      { id: "test_hot", name: "热歌推荐", cover: "/assets/icon.png", songs: testSongs.map(s => ({ ...s, remotePlayable: true })), source: "local" },
    ],
    favorites: [], history: [], downloadHistory: [], queue: [], queueIndex: -1,
    searchHistory: [], theme: "light", playQuality: "exhigh", downloadQuality: "exhigh",
    progressStyle: "default", lyricSource: "network", autoLyricsEnabled: true,
    playbackSpeed: 1, fadeEnabled: false, autoCacheEnabled: false,
    keepQueueOnExit: true, autoPlayOnStart: false, autoUpdateEnabled: false, androidStatusNotificationEnabled: false,
  };
}

async function mockHomeApi(page: Page) {
  await page.route("**/api/netease/home**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        radarSongs: testSongs.slice(0, 2).map(s => ({ ...s, remotePlayable: true })),
        hotSongs: [{ id: "home-hot-1", name: "Home Hot Song", artist: "Hot Artist", pic: "/assets/icon.png", url: "/assets/full-song-65s.wav", durationMs: 65000, verifiedPlayable: true, br: 999000, level: "lossless", type: "flac" }],
        recommendedPlaylists: [{ id: "3778678", name: "Home Playlist", cover: "/assets/icon.png", trackCount: 3, creatorNickname: "Mock Creator" }],
      }),
    });
  });
}

async function replaceServerSharedState(
  page: Page,
  state: ReturnType<typeof emptyState> | Record<string, unknown>,
  afterFirstRead?: (baseRevision: number) => Promise<void>
) {
  let currentResponse = await page.request.get("/api/state");
  if (!currentResponse.ok()) throw new Error(`failed to read shared state: ${currentResponse.status()} ${await currentResponse.text()}`);
  let current = await currentResponse.json();
  const projected = toSharedState(state as never);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const baseRevision = current?.state?.revision;
    if (!Number.isSafeInteger(baseRevision) || baseRevision < 0) throw new Error("shared state response has no valid revision");
    if (attempt === 0) await afterFirstRead?.(baseRevision);
    const response = await page.request.post("/api/state", {
      data: {
        state: projected,
        baseRevision,
        writeId: `perf-${randomUUID()}`
      }
    });
    if (response.ok()) return;
    const body = await response.json().catch(() => ({}));
    if (response.status() !== 409 || !body.state) {
      throw new Error(`failed to replace shared state: ${response.status()} ${JSON.stringify(body)}`);
    }
    current = body;
    currentResponse = response;
  }
  throw new Error(`failed to replace shared state after CAS retries: ${currentResponse.status()}`);
}

async function reset(page: Page) {
  const state = emptyState();
  await replaceServerSharedState(page, state);
  await mockHomeApi(page);
  await page.addInitScript(({ key, value }) => {
    localStorage.setItem(key, JSON.stringify(value));
  }, { key: storageKey, value: state });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "刷新推荐" })).toBeEnabled({ timeout: 15_000 });
}

test("PERF-SETUP shared-state reset retries a legitimate CAS race", async ({ page }) => {
  const target = {
    ...emptyState(),
    playlists: [
      ...emptyState().playlists,
      { id: "perf-race-target", name: "Perf Race Target", cover: "", songs: [], source: "local" }
    ]
  };
  let injectedRace = false;

  await replaceServerSharedState(page, target, async (baseRevision) => {
    injectedRace = true;
    const response = await page.request.post("/api/state", {
      data: {
        state: toSharedState(emptyState() as never),
        baseRevision,
        writeId: `perf-race-${randomUUID()}`
      }
    });
    expect(response.ok(), await response.text()).toBe(true);
  });

  expect(injectedRace).toBe(true);
  const response = await page.request.get("/api/state");
  expect(response.ok()).toBe(true);
  const body = await response.json();
  expect(body.state.playlists.some((playlist: { id: string }) => playlist.id === "perf-race-target")).toBe(true);
});

/* ============================================================
   模块 1: 首页与歌单加载性能 (PERF-HOME-*)
   ============================================================ */

test.describe("PERF-HOME 首页与歌单加载性能", () => {

  test.beforeEach(async ({ page }) => {
    await reset(page);
  });

  test("PERF-HOME-01 首页冷打开", async ({ page }) => {
    const values: number[] = [];
    for (let index = 0; index < sampleCount; index++) {
      await page.reload();
      await expect(page.getByRole("heading", { name: "今日推荐" })).toBeVisible({ timeout: 5000 });
      values.push(Math.round(await page.evaluate(() => performance.now())));
    }
    metrics.home_visible_ms = values;
    expectPerformance("PERF-HOME-01", values, 3000);
  });

  test("PERF-HOME-02 首页刷新", async ({ page }) => {
    // 移除 mockHomeApi 路由，注册测试专用路由
    await page.unroute("**/api/netease/home**");
    let sampleName = "Refreshed Song 0";
    await page.route("**/api/netease/home**", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          radarSongs: [{ id: sampleName.toLowerCase().replaceAll(" ", "-"), name: sampleName, artist: "Artist", pic: "/assets/icon.png", url: "/assets/full-song-65s.wav", durationMs: 65000, verifiedPlayable: true, source: "local", remotePlayable: true }],
          hotSongs: [], recommendedPlaylists: [],
        }),
      });
    });
    const values: number[] = [];
    for (let index = 1; index <= sampleCount; index++) {
      sampleName = `Refreshed Song ${index}`;
      const key = `home-refresh-${index}`;
      const refreshButton = page.getByRole("button", { name: "刷新推荐" });
      await armDomPhaseCapture(refreshButton, key, { selector: ".today-shelf .cover-card", text: sampleName });
      await refreshButton.click();
      await expect(page.getByRole("main").getByRole("button", { name: new RegExp(sampleName) })).toBeVisible({ timeout: 5000 });
      let elapsed: number | null = null;
      await expect.poll(async () => {
        elapsed = await readDomPhaseCapture(page, key);
        return elapsed;
      }).not.toBeNull();
      values.push(Math.round(elapsed!));
    }
    metrics.refresh_done_ms = values;
    expectPerformance("PERF-HOME-02", values, 4000);
  });

  test("PERF-HOME-03 推荐歌单详情", async ({ page }) => {
    await page.route(/\/api\/netease\/playlist\/3778678.*/, async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          playlist: { id: "netease_pl_3778678", name: "Home Playlist", cover: "/assets/icon.png", source: "netease",
            songs: [{ id: "pl-song-1", name: "Playlist Song", artist: "Cloud Artist", pic: "/assets/icon.png", url: "/assets/full-song-65s.wav", source: "netease", durationMs: 65000, verifiedPlayable: true }],
          },
        }),
      });
    });
    const values: number[] = [];
    for (let index = 0; index < sampleCount; index++) {
      const key = `playlist-detail-${index}`;
      const playlistButton = page.getByRole("button", { name: /Home Playlist/ });
      await armDomPhaseCapture(playlistButton, key, { selector: ".detail .song-row", text: "Playlist Song" });
      await playlistButton.click();
      const dialog = page.getByRole("dialog", { name: "Home Playlist" });
      await expect(dialog).toContainText("Playlist Song", { timeout: 5000 });
      let elapsed: number | null = null;
      await expect.poll(async () => {
        elapsed = await readDomPhaseCapture(page, key);
        return elapsed;
      }).not.toBeNull();
      values.push(Math.round(elapsed!));
      await dialog.getByRole("button", { name: "返回" }).click();
      await expect(dialog).toHaveCount(0);
      if (index < sampleCount - 1) {
        await page.reload();
        await expect(page.getByRole("button", { name: /Home Playlist/ })).toBeVisible();
      }
    }
    metrics.playlist_detail_ms = values;
    expectPerformance("PERF-HOME-03", values, 4000);
  });

  test("PERF-HOME-04 连续刷新 5 次", async ({ page }) => {
    // 简化测试：不 mock 特定数据，只测量刷新响应时间
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const start = Date.now();
      await page.getByRole("button", { name: "刷新推荐" }).click();
      // 等待刷新完成（内容重新渲染）
      await page.waitForTimeout(500);
      await expect(page.getByRole("heading", { name: "今日推荐" })).toBeVisible({ timeout: 5000 });
      times.push(Date.now() - start);
      await page.waitForTimeout(500);
    }
    console.log(`[PERF-HOME-04] 连续刷新: ${times.map((t, i) => `${i + 1}:${t}ms`).join(", ")}, P95:${p95(times)}ms`);
    expect(p95(times)).toBeLessThan(4000);
  });

  test("PERF-HOME-05 接口慢响应 — mock 延迟 2s", async ({ page }) => {
    let routeHit = false;
    const delayedResponse = new Promise<void>((resolve) => setTimeout(resolve, 2000));
    await page.unroute("**/api/netease/home**");
    await page.route("**/api/netease/home**", async (route) => {
      routeHit = true;
      await delayedResponse;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          radarSongs: [{ ...testSongs[0], id: "slow-home-result", name: "Slow Home Result", remotePlayable: true }],
          hotSongs: [], recommendedPlaylists: [],
        }),
      });
    });
    const end = mark("slow_home_ms");
    await page.getByRole("button", { name: "刷新推荐" }).click();
    await expect(page.getByRole("button", { name: /Slow Home Result/ })).toBeVisible({ timeout: 10000 });
    const t = end();
    console.log(`[PERF-HOME-05] 慢接口首页: ${t}ms, routeHit: ${routeHit}`);
    // route 必须被命中（mock 延迟生效证明）
    expect(routeHit).toBe(true);
    expect(t).toBeGreaterThanOrEqual(1900);
    expect(t).toBeLessThan(4000);
  });

  test("PERF-HOME-06 接口失败 500", async ({ page }) => {
    await page.route("**/api/netease/home**", async (route) => {
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "mock server error" }) });
    });
    const end = mark("home_error_ms");
    await page.getByRole("button", { name: "刷新推荐" }).click();
    await expect(page.locator(".field-error")).toBeVisible({ timeout: 5000 });
    const t = end();
    console.log(`[PERF-HOME-06] 接口失败: ${t}ms`);
    expect(t).toBeLessThan(4000);
    await expect(page.getByRole("heading", { name: "既见" })).toBeVisible();
  });
});

/* ============================================================
   模块 2: 搜索性能 (PERF-SEARCH-*)
   ============================================================ */

test.describe("PERF-SEARCH 搜索性能", () => {

  test.beforeEach(async ({ page }) => {
    await reset(page);
  });

  test("PERF-SEARCH-01 普通搜索", async ({ page }) => {
    await page.route("**/api/flac/search**", async (route) => {
      const keyword = new URL(route.request().url()).searchParams.get("keyword") ?? "Perf Search Song";
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          songs: [{
            id: `flac_${keyword.replaceAll(" ", "-")}`, name: keyword, artist: "Perf Artist",
            pic: "/assets/icon.png", cover: "/assets/icon.png",
            url: "/api/flac/stream/s1?format=mp3&bitrate=320&time=t1&sign=s1",
            source: "flac", remotePlayable: true, verifiedPlayable: true,
            durationMs: 65000, br: 320000, level: "320k", type: "mp3", audioType: "mp3", quality: "320k",
          }],
          page: 1, limit: 30, total: 1, hasMore: false,
        }),
      });
    });
    await page.getByRole("navigation").getByRole("button", { name: "搜索" }).click();
    const input = page.getByPlaceholder("搜索音乐/歌手");
    const values: number[] = [];
    for (let sample = 0; sample < sampleCount; sample += 1) {
      const keyword = `Perf Search Song ${sample}`;
      const key = `search-result-${sample}`;
      await input.fill(keyword);
      await armDomPhaseCapture(input, key, { event: "keydown", keyValue: "Enter", selector: ".song-hit", text: keyword });
      await page.keyboard.press("Enter");
      await expect(page.locator(".song-hit", { hasText: keyword })).toBeVisible({ timeout: 5000 });
      let elapsed: number | null = null;
      await expect.poll(async () => {
        elapsed = await readDomPhaseCapture(page, key);
        return elapsed;
      }).not.toBeNull();
      values.push(Math.round(elapsed!));
    }
    metrics.first_result_ms = values;
    expectPerformance("PERF-SEARCH-01", values, 4000);
  });

  test("PERF-SEARCH-02 搜索播放", async ({ page }) => {
    await page.route("**/api/flac/search**", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          songs: [{
            id: "flac_sp1", name: "Playable Search", artist: "PS Artist",
            pic: "/assets/icon.png", cover: "/assets/icon.png",
            url: "/api/flac/stream/sp1?format=mp3&bitrate=320&time=tp1&sign=sp1",
            source: "flac", remotePlayable: true, verifiedPlayable: true,
            durationMs: 65000, br: 320000, level: "320k", type: "mp3", audioType: "mp3", quality: "320k",
          }],
          page: 1, limit: 30, total: 1, hasMore: false,
        }),
      });
    });
    await page.route("**/api/flac/stream/sp1**", async (route) => {
      await route.fulfill({ path: fullSongFile, headers: { "content-type": "audio/wav" } });
    });
    await page.getByRole("navigation").getByRole("button", { name: "搜索" }).click();
    await page.getByPlaceholder("搜索音乐/歌手").fill("Playable Search");
    await page.keyboard.press("Enter");
    await expect(page.locator(".song-hit", { hasText: "Playable Search" })).toBeVisible({ timeout: 5000 });
    const end = mark("search_play_ms");
    await page.locator(".song-hit", { hasText: "Playable Search" }).click();
    await expectAudioPlaying(page);
    const t = end();
    console.log(`[PERF-SEARCH-02] 搜索播放: ${t}ms`);
    expect(t).toBeLessThan(3000);
  });

  test("PERF-SEARCH-03 连续搜索 A → B → C", async ({ page }) => {
    let lastKw = "";
    await page.route("**/api/flac/search**", async (route) => {
      const kw = new URL(route.request().url()).searchParams.get("keyword") ?? "";
      lastKw = kw;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          songs: [{ id: `flac_${kw}`, name: `Song ${kw}`, artist: "Artist",
            pic: "/assets/icon.png", cover: "/assets/icon.png",
            url: `/api/flac/stream/${kw}?format=mp3&bitrate=320&time=t&sign=s`,
            source: "flac", remotePlayable: true, verifiedPlayable: true,
            durationMs: 65000, br: 320000, level: "320k", type: "mp3", audioType: "mp3", quality: "320k" }],
          page: 1, limit: 30, total: 1, hasMore: false,
        }),
      });
    });
    await page.getByRole("navigation").getByRole("button", { name: "搜索" }).click();
    const input = page.getByPlaceholder("搜索音乐/歌手");
    for (const kw of ["AAA", "BBB", "CCC"]) {
      await input.fill(kw);
      await page.keyboard.press("Enter");
    }
    await expect(page.locator(".song-hit", { hasText: "Song CCC" })).toBeVisible({ timeout: 5000 });
    const ct = await page.getByText("Song AAA").count();
    console.log(`[PERF-SEARCH-03] 最终显示 CCC, AAA 残留: ${ct}`);
    expect(ct).toBe(0);
  });

  test("PERF-SEARCH-04 慢快竞态 — 慢 A 不覆盖快 B", async ({ page }) => {
    await page.route("**/api/flac/search**", async (route) => {
      const kw = new URL(route.request().url()).searchParams.get("keyword") ?? "";
      if (kw === "slow-aaa") await new Promise(r => setTimeout(r, 2000));
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          songs: [{ id: `flac_${kw}`, name: kw === "slow-aaa" ? "Slow AAA" : "Fast BBB", artist: "Artist",
            pic: "/assets/icon.png", cover: "/assets/icon.png",
            url: `/api/flac/stream/${kw}?format=mp3&bitrate=320&time=t&sign=s`,
            source: "flac", remotePlayable: true, verifiedPlayable: true,
            durationMs: 65000, br: 320000, level: "320k", type: "mp3", audioType: "mp3", quality: "320k" }],
          page: 1, limit: 30, total: 1, hasMore: false,
        }),
      });
    });
    await page.getByRole("navigation").getByRole("button", { name: "搜索" }).click();
    const input = page.getByPlaceholder("搜索音乐/歌手");
    await input.fill("slow-aaa");
    await page.keyboard.press("Enter");
    await input.fill("fast-bbb");
    await page.keyboard.press("Enter");
    await expect(page.locator(".song-hit", { hasText: "Fast BBB" })).toBeVisible({ timeout: 5000 });
    await page.waitForTimeout(500);
    const slowCount = await page.getByText("Slow AAA").count();
    console.log(`[PERF-SEARCH-04] 最终显示 Fast BBB, Slow AAA 残留: ${slowCount}`);
    expect(slowCount).toBe(0);
  });

  test("PERF-SEARCH-05 大结果渲染 (60 条)", async ({ page }) => {
    const manySongs = Array.from({ length: 60 }, (_, i) => ({
      id: `flac_mass_${i}`, name: `Mass Result ${i}`, artist: "Mass Artist",
      pic: "/assets/icon.png", cover: "/assets/icon.png",
      url: `/api/flac/stream/mass-${i}?format=mp3&bitrate=320&time=t&sign=s`,
      source: "flac", remotePlayable: true, verifiedPlayable: true,
      durationMs: 65000, br: 320000, level: "320k", type: "mp3", audioType: "mp3", quality: "320k",
    }));
    await page.route("**/api/flac/search**", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ songs: manySongs, page: 1, limit: 60, total: 60, hasMore: false }),
      });
    });
    const end = mark("large_render_ms");
    await page.getByRole("navigation").getByRole("button", { name: "搜索" }).click();
    await page.getByPlaceholder("搜索音乐/歌手").fill("Mass");
    await page.keyboard.press("Enter");
    await expect(page.locator(".song-hit", { hasText: "Mass Result 59" })).toBeVisible({ timeout: 5000 });
    const t = end();
    console.log(`[PERF-SEARCH-05] 60 条渲染: ${t}ms`);
    expect(t).toBeLessThan(2000);
  });

  test("PERF-SEARCH-06 搜索失败 500", async ({ page }) => {
    for (const pattern of ["**/api/flac/search**", "**/api/netease/search**", "**/api/bili/search**"]) {
      await page.route(pattern, async (route) => {
        await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "search failed" }) });
      });
    }
    const end = mark("search_error_ms");
    await page.getByRole("navigation").getByRole("button", { name: "搜索" }).click();
    await page.getByPlaceholder("搜索音乐/歌手").fill("fail");
    await page.keyboard.press("Enter");
    await expect(page.locator(".toast, .field-error")).toBeVisible({ timeout: 4000 });
    const t = end();
    console.log(`[PERF-SEARCH-06] 搜索 500 错误提示: ${t}ms`);
    expect(t).toBeLessThan(4000);
  });
});

/* ============================================================
   模块 3: 播放与切歌性能 (PERF-PLAY-*)
   ============================================================ */

test.describe("PERF-PLAY 播放与切歌性能", () => {

  test.beforeEach(async ({ page }) => {
    await reset(page);
  });

  test("PERF-PLAY-01 首页播放", async ({ page }) => {
    const playingValues: number[] = [];
    const canplayValues: number[] = [];
    for (let sample = 0; sample < sampleCount; sample += 1) {
      const songName = sample % 2 === 0 ? "周杰伦 本地试听" : "陈奕迅 本地试听";
      const playButton = page.getByRole("main").getByRole("button", { name: new RegExp(songName) });
      const key = `home-play-${sample}`;
      await armAudioPhaseCapture(playButton, key);
      await playButton.click();
      let phase: Awaited<ReturnType<typeof readAudioPhaseCapture>> = null;
      await expect.poll(async () => {
        phase = await readAudioPhaseCapture(page, key);
        return phase?.playingMs ?? null;
      }).not.toBeNull();
      playingValues.push(Math.round(phase!.playingMs));
      if (phase!.canplayMs !== null) canplayValues.push(Math.round(phase!.canplayMs));
    }
    metrics.play_to_progress_ms = playingValues;
    metrics.play_canplay_ms = canplayValues;
    expectPerformance("PERF-PLAY-01 playing", playingValues, 3000);
    expectPerformance("PERF-PLAY-01 canplay", canplayValues, 3000);
  });

  test("PERF-PLAY-02 歌单播放", async ({ page }) => {
    const end = mark("playlist_play_ms");
    await page.getByRole("navigation").getByRole("button", { name: "我的" }).click();
    await page.getByRole("button", { name: "热歌推荐 3 首歌曲" }).click();
    await page.locator(".detail .song-hit").first().click();
    await expectAudioPlaying(page);
    const t = end();
    console.log(`[PERF-PLAY-02] 歌单播放: ${t}ms`);
    expect(t).toBeLessThan(3000);
    // 关掉 dialog 以便后续操作
    await closeDialog(page);
  });

  test("PERF-PLAY-03 下一首", async ({ page }) => {
    // 从首页播放，这样现播条立即可见
    await playLocalSong(page);
    await openPlayerSheet(page);
    const player = page.locator(".player-sheet");
    const nextButton = player.getByRole("button", { name: "下一首" });
    const playingValues: number[] = [];
    const canplayValues: number[] = [];
    for (let sample = 0; sample < sampleCount; sample += 1) {
      const key = `next-${sample}`;
      await armAudioPhaseCapture(nextButton, key);
      await nextButton.click();
      let phase: Awaited<ReturnType<typeof readAudioPhaseCapture>> = null;
      await expect.poll(async () => {
        phase = await readAudioPhaseCapture(page, key);
        return phase?.playingMs ?? null;
      }).not.toBeNull();
      playingValues.push(Math.round(phase!.playingMs));
      if (phase!.canplayMs !== null) canplayValues.push(Math.round(phase!.canplayMs));
    }
    metrics.next_to_progress_ms = playingValues;
    metrics.next_canplay_ms = canplayValues;
    expectPerformance("PERF-PLAY-03 playing", playingValues, 3000);
    expectPerformance("PERF-PLAY-03 canplay", canplayValues, 3000);
  });

  test("PERF-PLAY-04 上一首", async ({ page }) => {
    await playLocalSong(page);
    // 播第 2 首歌，这样上一首有歌可退
    await page.locator(".now-playing").click();
    await expect(page.locator(".player-sheet")).toBeVisible();
    await page.locator(".player-sheet").getByRole("button", { name: "下一首" }).click();
    await expectAudioPlaying(page);
    await page.waitForTimeout(300);
    const start = Date.now();
    await page.locator(".player-sheet").getByRole("button", { name: "上一首" }).click();
    await expectAudioPlaying(page);
    const t = Date.now() - start;
    record("prev_to_progress_ms", t);
    console.log(`[PERF-PLAY-04] 上一首: ${t}ms`);
    expect(t).toBeLessThan(3000);
  });

  test("PERF-PLAY-05 暂停恢复", async ({ page }) => {
    await playLocalSong(page);
    await openPlayerSheet(page);
    const player = page.locator(".player-sheet");
    await player.getByRole("button", { name: "暂停" }).click();
    await expectAudioPaused(page);
    await page.waitForTimeout(500);
    const end = mark("resume_ms");
    await player.locator(".round-play").click();
    await expectAudioPlaying(page);
    const t = end();
    console.log(`[PERF-PLAY-05] 暂停恢复: ${t}ms`);
    expect(t).toBeLessThan(2000);
  });

  test("PERF-PLAY-07 连续切歌 10 次", async ({ page }) => {
    // 构造 10 首歌的队列，从首页播放（避免 dialog backdrop 遮挡）
    const manySongs = Array.from({ length: 10 }, (_, i) => ({
      ...testSongs[0], id: `qs-${i}`, name: `Queue Song ${i}`,
    }));
    const state = {
      ...emptyState(),
      queue: manySongs, queueIndex: 0,
      playlists: [
        { id: "favorites", name: "我喜欢的音乐", cover: "/assets/icon.png", songs: [], source: "local" },
        { id: "big_queue", name: "大队列", cover: "/assets/icon.png", songs: manySongs, source: "local" },
      ],
    };
    await replaceServerSharedState(page, state);
    await page.addInitScript(({ key, value }) => {
      localStorage.setItem(key, JSON.stringify(value));
    }, { key: storageKey, value: state });
    await mockHomeApi(page);
    await page.goto("/");

    // 从首页播第一首（不打开 dialog）
    await playLocalSong(page);

    // 打开 player sheet
    await page.locator(".now-playing").click();
    const player = page.locator(".player-sheet");
    await expect(player).toBeVisible();

    const times: number[] = [];
    for (let i = 0; i < 10; i++) {
      const key = `continuous-next-${i}`;
      const nextButton = player.getByRole("button", { name: "下一首" });
      await armAudioPhaseCapture(nextButton, key);
      await nextButton.click();
      let phase: Awaited<ReturnType<typeof readAudioPhaseCapture>> = null;
      await expect.poll(async () => {
        phase = await readAudioPhaseCapture(page, key);
        return phase?.playingMs ?? null;
      }).not.toBeNull();
      times.push(Math.round(phase!.playingMs));
    }
    metrics.continuous_next_ms = times;
    console.log(`[PERF-PLAY-07] 连续切歌 10 次: avg=${avg(times).toFixed(0)}ms, P50=${p50(times)}ms, P95=${p95(times)}ms`);
    expect(p95(times)).toBeLessThan(3000);
  });
});

/* ============================================================
   模块 4: 下载与本地缓存性能 (PERF-DL-*)
   ============================================================ */

test.describe("PERF-DL 下载与本地缓存性能", () => {

  test.beforeEach(async ({ page }) => {
    await reset(page);
  });

  test("PERF-DL-01 单首下载 + PERF-DL-02 IDB 写入", async ({ page }) => {
    await page.route("**/api/flac/search**", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          songs: [{ id: "flac_dl_1", name: "Download Test Song", artist: "DL Artist",
            pic: "/assets/icon.png", cover: "/assets/icon.png",
            url: "/api/flac/stream/dl-1?format=mp3&bitrate=320&time=tdl&sign=sdl",
            source: "flac", remotePlayable: true, verifiedPlayable: true,
            durationMs: 65000, br: 320000, level: "320k", type: "mp3", audioType: "mp3", quality: "320k" }],
          page: 1, limit: 30, total: 1, hasMore: false,
        }),
      });
    });
    await page.route("**/api/flac/stream/dl-1**", async (route) => {
      await route.fulfill({ path: fullSongFile, headers: { "content-type": "audio/wav" } });
    });

    await page.getByRole("navigation").getByRole("button", { name: "搜索" }).click();
    await page.getByPlaceholder("搜索音乐/歌手").fill("Download Test Song");
    await page.keyboard.press("Enter");
    await expect(page.locator(".song-hit", { hasText: "Download Test Song" })).toBeVisible({ timeout: 5000 });

    const end = mark("download_ms");
    const downloadPromise = page.waitForEvent("download");
    // 用更精确的定位——该行的下载按钮
    await page.locator(".song-row", { hasText: "Download Test Song" }).locator(".download-button, .icon-button").last().click();
    await downloadPromise;
    const t = end();
    console.log(`[PERF-DL-01] 下载触发: ${t}ms`);
    expect(t).toBeLessThan(3000);

    await expect.poll(() => page.evaluate((key) => {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw).downloadHistory?.length ?? 0 : 0;
    }, storageKey)).toBeGreaterThanOrEqual(1);
    await expect.poll(() => page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open("jianyin-web-clean-audio", 1);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
        const tx = db.transaction("files", "readonly");
        const req = tx.objectStore("files").getAllKeys();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      db.close();
      return keys.some(k => String(k).startsWith("download_"));
    })).toBe(true);
    console.log(`[PERF-DL-02] IDB key 已写入`);
  });

  test("PERF-DL-04 下载管理打开 (50 条)", async ({ page }) => {
    const manyDownloads = Array.from({ length: 50 }, (_, i) => ({
      id: `dl_${i}`, name: `Downloaded Song ${i}`, artist: "DL Artist",
      pic: "/assets/icon.png", cover: "/assets/icon.png",
      url: `/api/flac/stream/dl-${i}?format=mp3&bitrate=320&time=t&sign=s`,
      source: "flac", remotePlayable: true, verifiedPlayable: true,
      durationMs: 65000, br: 320000, level: "320k", type: "mp3", audioType: "mp3", quality: "320k",
      localKey: `download_flac_flac_dl_${i}`,
    }));
    const state = { ...emptyState(), downloadHistory: manyDownloads };
    await replaceServerSharedState(page, state);
    await page.addInitScript(({ key, value }) => {
      localStorage.setItem(key, JSON.stringify(value));
    }, { key: storageKey, value: state });
    await mockHomeApi(page);
    await page.goto("/");

    const end = mark("manager_open_ms");
    await page.getByRole("navigation").getByRole("button", { name: "我的" }).click();
    await page.locator(".section-title .section-action").first().click();
    await expect(page.locator(".detail .song-row").first()).toBeVisible({ timeout: 5000 });
    const t = end();
    console.log(`[PERF-DL-04] 50 条下载管理打开: ${t}ms`);
    expect(t).toBeLessThan(2000);
  });
});

/* ============================================================
   模块 5: 数据恢复与存储性能 (PERF-DATA-*)
   ============================================================ */

test.describe("PERF-DATA 数据恢复与存储性能", () => {

  test("PERF-DATA-01 普通状态启动 (100 首)", async ({ page }) => {
    const manySongs = Array.from({ length: 100 }, (_, i) => ({
      ...testSongs[0], id: `data_${i}`, name: `Data Song ${i}`,
    }));
    const state = {
      ...emptyState(),
      playlists: [
        { id: "favorites", name: "我喜欢的音乐", cover: "/assets/icon.png", songs: [], source: "local" },
        { id: "big_data", name: "大数据歌单", cover: "/assets/icon.png", songs: manySongs, source: "local" },
      ],
    };
    await replaceServerSharedState(page, state);
    await page.addInitScript(({ key, value }) => {
      localStorage.setItem(key, JSON.stringify(value));
    }, { key: storageKey, value: state });
    await mockHomeApi(page);

    const end = mark("hydrate_100_ms");
    await page.goto("/");
    await page.getByRole("navigation").getByRole("button", { name: "我的" }).click();
    await expect(page.getByRole("button", { name: /大数据歌单 100 首歌曲/ })).toBeVisible({ timeout: 5000 });
    const t = end();
    console.log(`[PERF-DATA-01] 100 首状态: ${t}ms`);
    expect(t).toBeLessThan(3000);
  });

  test("PERF-DATA-02 大歌单状态 (1000 首)", async ({ page }) => {
    const manySongs = Array.from({ length: 1000 }, (_, i) => ({
      ...testSongs[0], id: `bigdata_${i}`, name: `Big Data Song ${i}`,
    }));
    const state = {
      ...emptyState(),
      playlists: [
        { id: "favorites", name: "我喜欢的音乐", cover: "/assets/icon.png", songs: [], source: "local" },
        { id: "huge_data", name: "海量歌单", cover: "/assets/icon.png", songs: manySongs, source: "local" },
      ],
    };
    await replaceServerSharedState(page, state);
    await page.addInitScript(({ key, value }) => {
      localStorage.setItem(key, JSON.stringify(value));
    }, { key: storageKey, value: state });
    await mockHomeApi(page);

    const end = mark("hydrate_1000_ms");
    await page.goto("/");
    await page.getByRole("navigation").getByRole("button", { name: "我的" }).click();
    await expect(page.getByRole("button", { name: /海量歌单 1000 首歌曲/ })).toBeVisible({ timeout: 10000 });
    const t = end();
    console.log(`[PERF-DATA-02] 1000 首状态: ${t}ms`);
    expect(t).toBeLessThan(5000);
  });

  test("PERF-DATA-04 orphan 恢复 57 条", async ({ page }) => {
    const COUNT = 57;
    const orphanSongs = Array.from({ length: COUNT }, (_, i) => ({
      id: `orphan_${i}`, name: `Orphan Song ${i}`, artist: "Orphan Artist",
      pic: "/assets/icon.png", cover: "/assets/icon.png",
      url: `/api/flac/stream/orphan-${i}?format=flac&bitrate=2000&time=to${i}&sign=so${i}`,
      source: "flac", remotePlayable: true, verifiedPlayable: true,
      durationMs: 65000, br: 2000000, level: "flac", type: "flac", audioType: "flac", quality: "flac",
      localKey: `download_flac_flac_orphan_${i}`,
    }));
    const state = { ...emptyState(), downloadHistory: orphanSongs };
    await replaceServerSharedState(page, state);
    await page.addInitScript(({ key, value }) => {
      localStorage.setItem(key, JSON.stringify(value));
    }, { key: storageKey, value: state });
    await mockHomeApi(page);
    await page.goto("/");
    // 在页面上注入 IDB blob
    await page.evaluate(async (count) => {
      const resp = await fetch("/assets/full-song-65s.wav");
      const audioBlob = await resp.blob();
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open("jianyin-web-clean-audio", 1);
        req.onupgradeneeded = () => req.result.createObjectStore("files");
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      for (let i = 0; i < count; i++) {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction("files", "readwrite");
          tx.objectStore("files").put(audioBlob, `download_flac_flac_orphan_${i}`);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      }
      db.close();
    }, COUNT);

    // 重新打开页面测恢复
    const end = mark("orphan_57_ms");
    await page.goto("/");
    await page.getByRole("navigation").getByRole("button", { name: "我的" }).click();
    await page.locator(".section-title .section-action").first().click();
    await expect(page.locator(".detail .song-row").first()).toBeVisible({ timeout: 5000 });
    const t = end();
    const localFileCount = await page.evaluate((key) => {
      const raw = localStorage.getItem(key);
      if (!raw) return 0;
      const st = JSON.parse(raw);
      return st.downloadHistory?.filter((s: any) => s.url?.startsWith("local-file:")).length ?? 0;
    }, storageKey);
    console.log(`[PERF-DATA-04] orphan ${COUNT} 条恢复: ${t}ms, local-file count: ${localFileCount}`);
    expect(t).toBeLessThan(4000);
    expect(localFileCount).toBeGreaterThan(0);
  });

  test("PERF-DATA-05 orphan 恢复 200 条", async ({ page }) => {
    const COUNT = 200;
    const orphanSongs = Array.from({ length: COUNT }, (_, i) => ({
      id: `orphan_big_${i}`, name: `Big Orphan ${i}`, artist: "Orphan Artist",
      pic: "/assets/icon.png", cover: "/assets/icon.png",
      url: `/api/flac/stream/big-orphan-${i}?format=flac&bitrate=2000&time=t${i}&sign=s${i}`,
      source: "flac", remotePlayable: true, verifiedPlayable: true,
      durationMs: 65000, br: 2000000, level: "flac", type: "flac", audioType: "flac", quality: "flac",
      localKey: `download_flac_flac_big-orphan_${i}`,
    }));
    const state = { ...emptyState(), downloadHistory: orphanSongs };
    await replaceServerSharedState(page, state);
    await page.addInitScript(({ key, value }) => {
      localStorage.setItem(key, JSON.stringify(value));
    }, { key: storageKey, value: state });
    await mockHomeApi(page);
    await page.goto("/");
    await page.evaluate(async (count) => {
      const resp = await fetch("/assets/full-song-65s.wav");
      const audioBlob = await resp.blob();
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open("jianyin-web-clean-audio", 1);
        req.onupgradeneeded = () => req.result.createObjectStore("files");
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      for (let i = 0; i < count; i++) {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction("files", "readwrite");
          tx.objectStore("files").put(audioBlob, `download_flac_flac_big-orphan_${i}`);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      }
      db.close();
    }, COUNT);

    const end = mark("orphan_200_ms");
    await page.goto("/");
    await page.getByRole("navigation").getByRole("button", { name: "我的" }).click();
    await page.locator(".section-title .section-action").first().click();
    await expect(page.locator(".detail .song-row").first()).toBeVisible({ timeout: 10000 });
    const t = end();
    const localFileCount = await page.evaluate((key) => {
      const raw = localStorage.getItem(key);
      if (!raw) return 0;
      const st = JSON.parse(raw);
      return st.downloadHistory?.filter((s: any) => s.url?.startsWith("local-file:")).length ?? 0;
    }, storageKey);
    console.log(`[PERF-DATA-05] orphan ${COUNT} 条恢复: ${t}ms, local-file count: ${localFileCount}`);
    expect(t).toBeLessThan(8000);
    expect(localFileCount).toBeGreaterThan(0);
  });
});

/* ============================================================
   模块 6: UI 渲染与交互响应性能 (PERF-UI-*)
   ============================================================ */

test.describe("PERF-UI UI 渲染与交互响应性能", () => {

  test.beforeEach(async ({ page }) => {
    await reset(page);
  });

  test("PERF-UI-01 我的页 1000 首", async ({ page }) => {
    const manySongs = Array.from({ length: 1000 }, (_, i) => ({
      ...testSongs[0], id: `ui_big_${i}`, name: `UI Big Song ${i}`,
    }));
    const state = {
      ...emptyState(),
      playlists: [
        { id: "favorites", name: "我喜欢的音乐", cover: "/assets/icon.png", songs: [], source: "local" },
        { id: "ui_huge", name: "UI 海量歌单", cover: "/assets/icon.png", songs: manySongs, source: "local" },
      ],
    };
    await replaceServerSharedState(page, state);
    await page.addInitScript(({ key, value }) => {
      localStorage.setItem(key, JSON.stringify(value));
    }, { key: storageKey, value: state });
    await mockHomeApi(page);
    await page.goto("/");

    const end = mark("mine_1000_ms");
    await page.getByRole("navigation").getByRole("button", { name: "我的" }).click();
    await expect(page.getByRole("button", { name: /UI 海量歌单 1000 首歌曲/ })).toBeVisible({ timeout: 8000 });
    const t = end();
    console.log(`[PERF-UI-01] 我的页 1000 首: ${t}ms`);
    expect(t).toBeLessThan(3000);
  });

  test("PERF-UI-02 歌单详情 1000 首", async ({ page }) => {
    const manySongs = Array.from({ length: 1000 }, (_, i) => ({
      ...testSongs[0], id: `detail_big_${i}`, name: `Detail Song ${i}`,
    }));
    const state = {
      ...emptyState(),
      playlists: [
        { id: "favorites", name: "我喜欢的音乐", cover: "/assets/icon.png", songs: [], source: "local" },
        { id: "detail_huge", name: "详情海量歌单", cover: "/assets/icon.png", songs: manySongs, source: "local" },
      ],
    };
    await replaceServerSharedState(page, state);
    await page.addInitScript(({ key, value }) => {
      localStorage.setItem(key, JSON.stringify(value));
    }, { key: storageKey, value: state });
    await mockHomeApi(page);
    await page.goto("/");

    await page.getByRole("navigation").getByRole("button", { name: "我的" }).click();
    const values: number[] = [];
    for (let sample = 0; sample < sampleCount; sample += 1) {
      const key = `detail-1000-${sample}`;
      const playlistButton = page.getByRole("button", { name: /详情海量歌单 1000 首歌曲/ });
      await armDomPhaseCapture(playlistButton, key, { selector: ".detail .song-row", text: "Detail Song 0" });
      await playlistButton.click();
      await expect(page.locator(".detail .song-row")).toHaveCount(1000, { timeout: 8000 });
      let elapsed: number | null = null;
      await expect.poll(async () => {
        elapsed = await readDomPhaseCapture(page, key);
        return elapsed;
      }).not.toBeNull();
      values.push(Math.round(elapsed!));
      await page.getByRole("dialog", { name: "详情海量歌单" }).getByRole("button", { name: "返回" }).click();
    }
    metrics.detail_1000_ms = values;
    expectPerformance("PERF-UI-02", values, 3000);
  });

  test("PERF-UI-05 播放进度更新时保持 1000 首详情响应", async ({ page }) => {
    const manySongs = Array.from({ length: 1000 }, (_, i) => ({
      ...testSongs[0], id: `progress_big_${i}`, name: `Progress Song ${i}`,
    }));
    const state = {
      ...emptyState(),
      playlists: [
        { id: "favorites", name: "我喜欢的音乐", cover: "/assets/icon.png", songs: [], source: "local" },
        { id: "progress_huge", name: "进度性能歌单", cover: "/assets/icon.png", songs: manySongs, source: "local" },
      ],
    };
    await replaceServerSharedState(page, state);
    await page.addInitScript(({ key, value }) => {
      localStorage.setItem(key, JSON.stringify(value));
    }, { key: storageKey, value: state });
    await mockHomeApi(page);
    await page.goto("/");

    await playLocalSong(page);
    await page.getByRole("navigation").getByRole("button", { name: "我的" }).click();
    await page.getByRole("button", { name: /进度性能歌单 1000 首歌曲/ }).click();
    await expect(page.locator(".detail .song-row")).toHaveCount(1000);
    await startLongTaskCapture(page);
    await page.evaluate(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      (window as any).__perf_long_tasks = [];
    });
    const values: number[] = [];
    const phaseLongTasks: Array<{ duration: number; start: number }> = [];
    for (let sample = 0; sample < sampleCount; sample += 1) {
      await page.evaluate(() => { (window as any).__perf_long_tasks = []; });
      const elapsed = await page.locator("audio").evaluate(async (audio: HTMLAudioElement, sampleIndex) => {
        const start = performance.now();
        for (let index = 1; index <= 20; index += 1) {
          audio.currentTime = sampleIndex * 20 + index;
          audio.dispatchEvent(new Event("timeupdate"));
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        }
        return performance.now() - start;
      }, sample);
      values.push(Math.round(elapsed));
      phaseLongTasks.push(...await getLongTasks(page));
    }
    metrics.progress_1000_updates_ms = values;
    console.log(`[PERF-UI-05] 1000 首详情下 20 次进度更新: ${values.join(",")}ms, longTasks=${phaseLongTasks.length}`);
    expectPerformance("PERF-UI-05", values, 600);
    expect(phaseLongTasks.filter((entry) => entry.duration > 50)).toHaveLength(0);
  });

  test("PERF-UI-03 歌单内搜索", async ({ page }) => {
    const manySongs = Array.from({ length: 200 }, (_, i) => ({
      ...testSongs[0], id: `filter_${i}`, name: `Filter Song ${i}`,
    }));
    manySongs.push({ ...testSongs[0], id: "filter_target", name: "Target Song 999" });
    const state = {
      ...emptyState(),
      playlists: [
        { id: "favorites", name: "我喜欢的音乐", cover: "/assets/icon.png", songs: [], source: "local" },
        { id: "filter_pl", name: "过滤歌单", cover: "/assets/icon.png", songs: manySongs, source: "local" },
      ],
    };
    await replaceServerSharedState(page, state);
    await page.addInitScript(({ key, value }) => {
      localStorage.setItem(key, JSON.stringify(value));
    }, { key: storageKey, value: state });
    await mockHomeApi(page);
    await page.goto("/");

    await page.getByRole("navigation").getByRole("button", { name: "我的" }).click();
    await page.getByRole("button", { name: /过滤歌单 201 首歌曲/ }).click();
    const end = mark("filter_ms");
    await page.locator(".detail [placeholder*='搜索'], .detail input[type='text']").fill("Target");
    await expect(page.locator(".detail")).toContainText("Target Song 999");
    const t = end();
    console.log(`[PERF-UI-03] 歌单内搜索: ${t}ms`);
    expect(t).toBeLessThan(1000);
  });

  test("PERF-UI-06 设置弹窗", async ({ page }) => {
    const end = mark("settings_open_ms");
    await page.getByRole("navigation").getByRole("button", { name: "我的" }).click();
    await page.getByRole("button", { name: "设置" }).first().click();
    await expect(page.getByRole("dialog", { name: "设置" })).toBeVisible({ timeout: 3000 });
    const t = end();
    console.log(`[PERF-UI-06] 设置弹窗: ${t}ms`);
    expect(t).toBeLessThan(1000);
  });
});
