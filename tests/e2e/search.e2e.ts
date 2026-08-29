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

test("failed online search keeps matching local-library results visible", async ({ page }) => {
  const localSong = {
    ...testSongs[0],
    id: "offline_library_song",
    name: "Offline Library Match",
    artist: "Offline Artist"
  };
  const state = {
    ...testState(),
    playlists: [
      { id: "favorites", name: "我喜欢的音乐", cover: "/assets/icon.png", songs: [], source: "local" },
      { id: "offline_library", name: "Offline Library", cover: "/assets/icon.png", songs: [localSong], source: "local" }
    ],
    history: [localSong]
  };
  await page.route(/\/api\/state$/, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ state }) });
      return;
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  const stateScript = await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: storageKey, value: state });
  await page.reload();
  await stateScript.dispose();
  await expect.poll(async () => (await storedState(page)).playlists.map((playlist: { id: string }) => playlist.id)).toContain("offline_library");
  await page.route("**/api/flac/search**", async (route) => {
    await route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ message: "测试源暂不可用" }) });
  });
  for (const pattern of ["**/api/netease/search**", "**/api/bili/search**"]) {
    await page.route(pattern, async (route) => {
      await route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ message: "在线源暂不可用" }) });
    });
  }

  await page.getByRole("navigation").getByRole("button", { name: "搜索" }).click();
  await page.getByPlaceholder("搜索音乐/歌手").fill("offline library");
  await page.keyboard.press("Enter");

  await expect(page.getByRole("button", { name: "Offline Library Match Offline Artist · 本地" })).toBeVisible();
  await expect(page.getByText("离线本地结果 · 1 首")).toBeVisible();
  await expect(page.getByText("没有找到结果")).toHaveCount(0);
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

test("empty flac results fall back to the Netease original", async ({ page }) => {  const neteaseSong = {
    id: "netease_original_same",
    name: "Same Song",
    artist: "Same Artist",
    pic: "/assets/icon.png",
    cover: "/assets/icon.png",
    url: "/api/netease/stream/original",
    source: "netease",
    remotePlayable: true,
    durationMs: 65000,
    verifiedPlayable: true,
    br: 320000,
    level: "320k",
    type: "mp3",
    audioType: "mp3",
    quality: "320k"
  };
  await page.route("**/api/flac/search**", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ songs: [], page: 1, limit: 100, total: 0, hasMore: false }) });
  });
  await page.route("**/api/netease/search**", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ songs: [neteaseSong] }) });
  });
  await page.route("**/api/bili/search**", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ songs: [] }) });
  });

  await page.getByRole("navigation").getByRole("button", { name: "搜索" }).click();
  await page.getByPlaceholder("搜索音乐/歌手").fill("same song");
  await page.keyboard.press("Enter");

  await expect(page.getByRole("button", { name: "Same Song Same Artist · 网易云" })).toBeVisible();
});

test("flac results alone never trigger fallback source requests", async ({ page }) => {
  let fallbackCalls = 0;
  await page.route("**/api/flac/search**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        songs: [{
          id: "flac_main_result",
          name: "Main Result",
          artist: "Main Artist",
          pic: "/assets/icon.png",
          cover: "/assets/icon.png",
          url: "/api/flac/stream/main?format=mp3&bitrate=320&time=t&sign=s",
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
        limit: 100,
        total: 1,
        hasMore: false
      })
    });
  });
  for (const pattern of ["**/api/netease/search**", "**/api/bili/search**"]) {
    await page.route(pattern, async (route) => {
      fallbackCalls += 1;
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ songs: [] }) });
    });
  }

  await page.getByRole("navigation").getByRole("button", { name: "搜索" }).click();
  await page.getByPlaceholder("搜索音乐/歌手").fill("main result");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Main Result Main Artist · 测试源" })).toBeVisible();
  await page.waitForTimeout(600);

  expect(fallbackCalls).toBe(0);
});
