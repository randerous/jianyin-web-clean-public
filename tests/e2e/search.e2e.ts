import { expect, test } from "playwright/test";
import { fs, storageKey, projectRoot, toneFile, coverFile, fullSongFile, lrcFile, testSongs, testState, mockHome, reset, expectAudioPlaying, expectAudioPaused, expectAudioLongerThan, expectReadableToast, playFirstHomeSong, openPlayer, importLocalTone, openSettings, storedState, songNamesIn } from "../helpers/app-fixture";

test.beforeEach(async ({ page }) => {
  await reset(page);
});

test("slow search response cannot overwrite newer search results", async ({ page }) => {
  await page.route("**/api/flac/search**", async (route) => {
    const keyword = new URL(route.request().url()).searchParams.get("keyword");
    if (keyword === "slow") await new Promise((resolve) => setTimeout(resolve, 220));
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        songs: [{
          id: keyword === "slow" ? "flac_slow-id" : "flac_fast-id",
          name: keyword === "slow" ? "Slow Result" : "Fast Result",
          artist: "Race Artist",
          pic: "/assets/icon.png",
          cover: "/assets/icon.png",
          url: `/api/flac/stream/${keyword}?format=mp3&bitrate=320&time=t${keyword}&sign=s${keyword}`,
          source: "flac",
          remotePlayable: true,
          durationMs: 65000,
          verifiedPlayable: true,
          br: 320000,
          level: "320k",
          type: "mp3",
          audioType: "mp3",
          quality: "320k"
        }],
        page: 1,
        limit: 30,
        total: 1,
        hasMore: false
      })
    });
  });
  await page.getByRole("navigation").getByRole("button", { name: "搜索" }).click();
  await page.getByPlaceholder("搜索音乐/歌手").fill("slow");
  await page.keyboard.press("Enter");
  await page.getByPlaceholder("搜索音乐/歌手").fill("fast");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Fast Result Race Artist · 测试源" })).toBeVisible();
  await expect(page.getByText("Slow Result")).toHaveCount(0);
});

test("new flac search clears stale results and ignores old responses", async ({ page }) => {
  await page.route("**/api/flac/search**", async (route) => {
    const keyword = new URL(route.request().url()).searchParams.get("keyword");
    if (keyword === "slow-cloud") await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        songs: [{
          id: keyword === "slow-cloud" ? "flac_slow-cloud-id" : "flac_fresh-id",
          name: keyword === "slow-cloud" ? "Slow Cloud Result" : "Fresh Result",
          artist: "Test Artist",
          pic: "/assets/icon.png",
          cover: "/assets/icon.png",
          url: `/api/flac/stream/${keyword}?format=mp3&bitrate=320&time=t${keyword}&sign=s${keyword}`,
          source: "flac",
          remotePlayable: true,
          durationMs: 65000,
          verifiedPlayable: true,
          br: 320000,
          level: "320k",
          type: "mp3",
          audioType: "mp3",
          quality: "320k"
        }],
        page: 1,
        limit: 30,
        total: 1,
        hasMore: false
      })
    });
  });

  await page.getByRole("navigation").getByRole("button", { name: "搜索" }).click();
  await page.getByPlaceholder("搜索音乐/歌手").fill("fresh");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Fresh Result Test Artist · 测试源" })).toBeVisible();

  await page.getByPlaceholder("搜索音乐/歌手").fill("slow-cloud");
  await page.keyboard.press("Enter");
  await expect(page.getByText("Fresh Result")).toHaveCount(0);
  await page.getByPlaceholder("搜索音乐/歌手").fill("fresh");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Fresh Result Test Artist · 测试源" })).toBeVisible();
  await expect(page.getByText("Slow Cloud Result")).toHaveCount(0);
});

test("empty keyword sends no search request", async ({ page }) => {
  let searchCalls = 0;
  await page.route(/\/api\/(netease|bili|flac)\/search.*/, async (route) => {
    searchCalls += 1;
    await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "should not search blank keyword" }) });
  });

  await page.getByRole("navigation").getByRole("button", { name: "搜索" }).click();
  await page.getByPlaceholder("搜索音乐/歌手").fill("   ");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main").getByRole("button", { name: "搜索" })).toBeVisible();

  expect(searchCalls).toBe(0);
  await expect(page.getByText("should not search blank keyword")).toHaveCount(0);
});

test("toast stays readable above mobile search pagination", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/flac/search**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        songs: testSongs.map((song) => ({ ...song, id: `flac_${song.id}`, source: "flac", remotePlayable: true })),
        page: 1,
        limit: 3,
        total: 9,
        hasMore: true
      })
    });
  });

  await page.getByRole("navigation").getByRole("button", { name: "搜索" }).click();
  await page.getByPlaceholder("搜索音乐/歌手").fill("toast");
  await page.keyboard.press("Enter");
  await expect(page.locator(".pagination-bar-bottom")).toBeVisible();
  await page.locator(".song-row", { hasText: "周杰伦 本地试听" }).getByRole("button", { name: "添加到喜欢" }).click();
  await expectReadableToast(page, "已添加到我喜欢的音乐");
});

test("new search clears stale loading immediately", async ({ page }) => {
  await page.route("**/api/flac/search**", async (route) => {
    const keyword = new URL(route.request().url()).searchParams.get("keyword");
    if (keyword === "stale") await new Promise((resolve) => setTimeout(resolve, 600));
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        songs: [{
          id: keyword === "stale" ? "flac_stale" : "flac_fresh-loading",
          name: keyword === "stale" ? "Stale Loading Result" : "Fresh Loading Result",
          artist: "Test Artist",
          pic: "/assets/icon.png",
          cover: "/assets/icon.png",
          url: `/api/flac/stream/${keyword}?format=mp3&bitrate=320&time=t${keyword}&sign=s${keyword}`,
          source: "flac",
          remotePlayable: true,
          durationMs: 65000,
          verifiedPlayable: true,
          br: 320000,
          level: "320k",
          type: "mp3",
          audioType: "mp3",
          quality: "320k"
        }],
        page: 1,
        limit: 30,
        total: 1,
        hasMore: false
      })
    });
  });

  await page.getByRole("navigation").getByRole("button", { name: "搜索" }).click();
  await page.getByPlaceholder("搜索音乐/歌手").fill("stale");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "搜索中" })).toBeVisible();
  await page.getByPlaceholder("搜索音乐/歌手").fill("fresh-loading");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Fresh Loading Result Test Artist · 测试源" })).toBeVisible();
  await expect(page.getByText("Stale Loading Result")).toHaveCount(0);
});
