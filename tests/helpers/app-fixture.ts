export { default as fs } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, type Locator, type Page } from "playwright/test";

export const storageKey = "jianyin-web-clean-state-v1";
export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const toneFile = path.join(projectRoot, "public", "assets", "demo-tone.wav");
export const coverFile = path.join(projectRoot, "public", "assets", "miku_9.png");
export const fullSongFile = path.join(projectRoot, "public", "assets", "full-song-65s.wav");
export const lrcFile = path.join(projectRoot, "tests", "fixtures", "custom.lrc");

export const testSongs = [
  {
    id: "test-local-jay",
    name: "周杰伦 本地试听",
    artist: "测试曲库",
    pic: "/assets/icon.png",
    cover: "/assets/icon.png",
    url: "/assets/full-song-65s.wav",
    source: "local",
    durationMs: 65000,
    verifiedPlayable: true,
    br: 320000,
    level: "exhigh",
    type: "mp3",
    audioType: "mp3",
    quality: "exhigh",
    lrc: "[00:00.00]搜索、播放、队列、歌词和歌单"
  },
  {
    id: "test-local-eason",
    name: "陈奕迅 本地试听",
    artist: "测试曲库",
    pic: "/assets/icon.png",
    cover: "/assets/icon.png",
    url: "/assets/full-song-65s.wav",
    source: "local",
    durationMs: 65000,
    verifiedPlayable: true,
    br: 320000,
    level: "exhigh",
    type: "mp3",
    audioType: "mp3",
    quality: "exhigh"
  },
  {
    id: "test-local-gem",
    name: "邓紫棋 本地试听",
    artist: "测试曲库",
    pic: "/assets/icon.png",
    cover: "/assets/icon.png",
    url: "/assets/full-song-65s.wav",
    source: "local",
    durationMs: 65000,
    verifiedPlayable: true,
    br: 320000,
    level: "exhigh",
    type: "mp3",
    audioType: "mp3",
    quality: "exhigh"
  }
];

export function testState() {
  const songs = testSongs.map((song) => ({
    ...song,
    remotePlayable: true
  }));
  return {
    playlists: [
      { id: "favorites", name: "我喜欢的音乐", cover: "/assets/icon.png", songs: [], source: "local" },
      { id: "test_hot", name: "热歌推荐", cover: "/assets/icon.png", songs: [songs[2], songs[1], songs[0]], source: "local" }
    ],
    favorites: [],
    history: [],
    downloadHistory: [],
    queue: [],
    queueIndex: -1,
    searchHistory: [],
    theme: "light",
    playQuality: "exhigh",
    downloadQuality: "exhigh",
    progressStyle: "default",
    lyricSource: "network",
    autoLyricsEnabled: true,
    playbackSpeed: 1,
    fadeEnabled: false,
    autoCacheEnabled: false,
    keepQueueOnExit: true,
    autoPlayOnStart: false,
    autoUpdateEnabled: false,
    androidStatusNotificationEnabled: false
  };
}

export async function mockHome(page: Page) {
  await page.route("**/api/netease/home**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        radarSongs: testSongs.slice(0, 2),
        hotSongs: [
          { id: "home-2", name: "Home Hot Song", artist: "Hot Artist", pic: "/assets/icon.png", url: "/assets/full-song-65s.wav", source: "netease", quality: "exhigh", durationMs: 65000, verifiedPlayable: true, br: 999000, level: "lossless", type: "flac" }
        ],
        recommendedPlaylists: [
          { id: "3778678", name: "Home Playlist", cover: "/assets/icon.png", trackCount: 1, creatorNickname: "Mock Creator" }
        ]
      })
    });
  });
}

export async function reset(page: Page) {
  const state = testState();
  await replaceSharedStateForTest(page, state);
  await mockHome(page);
  const initScript = await page.addInitScript(({ key, value }) => {
    localStorage.setItem(key, JSON.stringify(value));
  }, { key: storageKey, value: state });
  await page.goto("/");
  await initScript.dispose();
}

export async function replaceSharedStateForTest(page: Page, state: Record<string, unknown>) {
  let currentResponse = await page.request.get("/api/state");
  let current = await currentResponse.json();
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const baseRevision = Number.isInteger(current?.state?.revision) ? current.state.revision : 0;
    const response = await page.request.post("/api/state", {
      data: {
        state,
        baseRevision,
        writeId: `test-write-${globalThis.crypto.randomUUID()}`
      }
    });
    if (response.ok()) return;
    const body = await response.json().catch(() => ({}));
    if (response.status() !== 409 || !body.state) {
      throw new Error(`test shared state setup failed: HTTP ${response.status()} ${JSON.stringify(body)}`);
    }
    current = body;
    currentResponse = response;
  }
  throw new Error(`test shared state setup failed after CAS retries: HTTP ${currentResponse.status()}`);
}

export async function expectAudioPlaying(page: Page) {
  await expect.poll(() => page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(false);
  await expect.poll(() => page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThan(0);
}

export async function expectAudioPaused(page: Page) {
  await expect.poll(() => page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(true);
}

export async function expectAudioLongerThan(page: Page, seconds: number) {
  await expect.poll(() => page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.duration)).toBeGreaterThan(seconds);
}

export async function expectReadableToast(page: Page, expectedText: string) {
  const toast = page.locator(".toast");
  await expect(toast).toContainText(expectedText);
  const metrics = await toast.evaluate((element) => {
    const parseColor = (value: string) => {
      const rgbMatch = value.match(/rgba?\(([^)]+)\)/);
      if (rgbMatch) {
        const [r, g, b] = rgbMatch[1].split(",").slice(0, 3).map((item) => Number(item.trim()));
        return Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b) ? [r, g, b] : null;
      }
      const srgbMatch = value.match(/color\(srgb\s+([^)]+)\)/);
      if (!srgbMatch) return null;
      const [r, g, b] = srgbMatch[1]
        .split("/")
        .shift()!
        .trim()
        .split(/\s+/)
        .slice(0, 3)
        .map((item) => Number(item) * 255);
      return Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b) ? [r, g, b] : null;
    };
    const luminance = ([r, g, b]: number[]) => {
      const linear = [r, g, b].map((channel) => {
        const value = channel / 255;
        return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    };
    const contrast = (foreground: number[], background: number[]) => {
      const fg = luminance(foreground);
      const bg = luminance(background);
      return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
    };
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const foreground = parseColor(style.color);
    const background = parseColor(style.backgroundColor);
    return {
      rect: { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left },
      contrastRatio: foreground && background ? contrast(foreground, background) : 0
    };
  });
  expect(metrics.contrastRatio).toBeGreaterThanOrEqual(4.5);
  for (const selector of [".now-playing", ".mobile-nav", ".search-screen .pagination-bar-bottom"]) {
    const blocker = page.locator(selector).first();
    if (!(await blocker.isVisible().catch(() => false))) continue;
    const blockerBox = await blocker.boundingBox();
    if (!blockerBox) continue;
    const overlaps = !(
      metrics.rect.right <= blockerBox.x ||
      metrics.rect.left >= blockerBox.x + blockerBox.width ||
      metrics.rect.bottom <= blockerBox.y ||
      metrics.rect.top >= blockerBox.y + blockerBox.height
    );
    expect(overlaps, `.toast overlaps ${selector}`).toBe(false);
  }
}

export async function playFirstHomeSong(page: Page) {
  await page.getByRole("navigation").getByRole("button", { name: "首页" }).click();
  await page.getByRole("main").getByRole("button", { name: /周杰伦 本地试听/ }).click();
}

export async function openPlayer(page: Page) {
  await page.locator(".now-playing").click();
  const player = page.locator(".player-sheet");
  await expect(player).toBeVisible();
  return player;
}

export async function importLocalTone(page: Page) {
  await page.getByRole("navigation").getByRole("button", { name: "我的" }).click();
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "导入本地音乐" }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles(toneFile);
  await expect(page.getByRole("dialog", { name: "本地歌单_1首" })).toBeVisible();
}

export async function openSettings(page: Page) {
  await page.getByRole("navigation").getByRole("button", { name: "我的" }).click();
  await page.getByRole("button", { name: "设置" }).first().click();
  const dialog = page.getByRole("dialog", { name: "设置" });
  await expect(dialog).toBeVisible();
  return dialog;
}

export async function storedState(page: Page) {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }, storageKey);
}

export async function songNamesIn(container: Locator) {
  return (await container.locator(".song-row .song-hit strong").allInnerTexts()).map((name) => name.trim());
}
