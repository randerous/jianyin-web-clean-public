import { expect, test } from "playwright/test";
import { fs, storageKey, projectRoot, toneFile, coverFile, fullSongFile, lrcFile, testSongs, testState, mockHome, reset, expectAudioPlaying, expectAudioPaused, expectAudioLongerThan, expectReadableToast, playFirstHomeSong, openPlayer, importLocalTone, openSettings, storedState, songNamesIn } from "../helpers/app-fixture";

test.beforeEach(async ({ page }) => {
  await reset(page);
});

test("flac mocked search resolves url and lyrics", async ({ page }) => {
  await page.route("**/api/flac/search**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        songs: [
          {
            id: "flac_12345",
            name: "MockFullSong",
            artist: "Mock Artist",
            pic: "/assets/icon.png",
            cover: "/assets/icon.png",
            url: "/api/flac/stream/12345?format=mp3&bitrate=320&time=t12345&sign=s12345",
            source: "flac",
            remotePlayable: true,
            lrc: "[00:00.00]mock lyric line",
            durationMs: 65000,
            verifiedPlayable: true,
            br: 320000,
            level: "320k",
            type: "mp3",
            audioType: "mp3",
            quality: "320k",
            time: "t12345",
            sign: "s12345"
          }
        ],
        page: 1,
        limit: 30,
        total: 1,
        hasMore: false,
        filtered: 3
      })
    });
  });
  await page.route("**/api/flac/song/12345**", async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        url: `/api/flac/stream/12345?format=flac&bitrate=2000&time=${url.searchParams.get("time")}&sign=${url.searchParams.get("sign")}`,
        durationMs: 65000,
        verifiedPlayable: true,
        br: 2000000,
        level: "flac",
        type: "flac",
        audioType: "flac",
        quality: "flac"
      })
    });
  });
  await page.route("**/api/flac/stream/12345**", async (route) => {
    await route.fulfill({ path: fullSongFile, headers: { "content-type": "audio/wav" } });
  });
  await page.route("**/api/lyrics**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ lrc: "[00:00.00]mock lyric line" })
    });
  });

  await page.getByRole("navigation").getByRole("button", { name: "搜索" }).click();
  await page.getByPlaceholder("搜索音乐/歌手").fill("MockFullSong");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "MockFullSong Mock Artist · 测试源" }).click();
  await expect(page.locator(".now-playing")).toContainText("MockFullSong");
  await expectAudioPlaying(page);
  await expectAudioLongerThan(page, 60);
  await expect.poll(() => page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.src)).toContain("format=flac");
  const player = await openPlayer(page);
  await expect(player).toContainText("mock lyric line");
  await expect(page.getByText("TrialOnly")).toHaveCount(0);
  await expect(page.getByText("ThirtySecond")).toHaveCount(0);
  await expect(page.getByText("NoUrl")).toHaveCount(0);
});

test("flac search hides unplayable, trial, and 30 second songs", async ({ page }) => {
  await page.route("**/api/flac/search**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        songs: [
          {
            id: "flac_ok-song",
            name: "OnlyFullSong",
            artist: "Verified Artist",
            pic: "/assets/icon.png",
            cover: "/assets/icon.png",
            url: "/api/flac/stream/ok-song?format=mp3&bitrate=320&time=tok&sign=sok",
            source: "flac",
            remotePlayable: true,
            durationMs: 65000,
            verifiedPlayable: true,
            br: 320000,
            level: "320k",
            type: "mp3",
            audioType: "mp3",
            quality: "320k"
          }
        ],
        page: 1,
        limit: 30,
        total: 1,
        hasMore: false,
        filtered: 3
      })
    });
  });

  await page.getByRole("navigation").getByRole("button", { name: "搜索" }).click();
  await page.getByPlaceholder("搜索音乐/歌手").fill("OnlyFullSong");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "OnlyFullSong Verified Artist · 测试源" })).toBeVisible();
  await expect(page.getByText("TrialOnly")).toHaveCount(0);
  await expect(page.getByText("ThirtySecond")).toHaveCount(0);
  await expect(page.getByText("NoUrl")).toHaveCount(0);
});

test("flac download caches the current song without interrupting playback", async ({ page }) => {
  const searchRequests: URLSearchParams[] = [];
  const songRequests: string[] = [];
  await page.route("**/api/flac/search**", async (route) => {
    searchRequests.push(new URL(route.request().url()).searchParams);
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        songs: [{
          id: "flac_quality-song",
          name: "Quality Song",
          artist: "Quality Artist",
          pic: "/assets/icon.png",
          cover: "/assets/icon.png",
          url: "/api/flac/stream/quality-song?format=mp3&bitrate=320&time=tquality&sign=squality",
          source: "flac",
          remotePlayable: true,
          durationMs: 65000,
          verifiedPlayable: true,
          br: 320000,
          level: "320k",
          type: "mp3",
          audioType: "mp3",
          quality: "320k",
          time: "tquality",
          sign: "squality"
        }],
        page: 1,
        limit: 30,
        total: 1,
        hasMore: false
      })
    });
  });
  await page.route("**/api/flac/song/quality-song**", async (route) => {
    songRequests.push(new URL(route.request().url()).searchParams.toString());
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        url: "/api/flac/stream/quality-song?format=mp3&bitrate=320&time=tquality&sign=squality",
        durationMs: 65000,
        verifiedPlayable: true,
        br: 320000,
        level: "320k",
        type: "mp3",
        audioType: "mp3",
        quality: "320k"
      })
    });
  });
  await page.route("**/api/flac/stream/quality-song**", async (route) => {
    await route.fulfill({ path: fullSongFile, headers: { "content-type": "audio/wav" } });
  });

  await page.getByRole("navigation").getByRole("button", { name: "搜索" }).click();
  await page.getByPlaceholder("搜索音乐/歌手").fill("Quality Song");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Quality Song Quality Artist · 测试源" })).toBeVisible();
  expect(searchRequests.some((params) => params.get("keyword") === "Quality Song" && params.get("limit") === "30")).toBe(true);
  await page.getByRole("button", { name: "Quality Song Quality Artist · 测试源" }).click();
  await expect(page.locator(".now-playing")).toContainText("Quality Song");
  await expectAudioPlaying(page);
  await expectAudioLongerThan(page, 60);
  expect(songRequests.every((query) => query.includes("sign=squality"))).toBe(true);

  await expect.poll(() => page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThan(1);
  const playbackBeforeDownload = await page.locator("audio").evaluate((audio: HTMLAudioElement) => {
    audio.dataset.downloadEmptiedEvents = "0";
    audio.addEventListener("emptied", () => {
      audio.dataset.downloadEmptiedEvents = String(Number(audio.dataset.downloadEmptiedEvents ?? "0") + 1);
    });
    return { src: audio.src, currentTime: audio.currentTime };
  });

  const downloadPromise = page.waitForEvent("download");
  const player = await openPlayer(page);
  await player.getByRole("button", { name: "更多选项" }).click();
  await player.getByRole("button", { name: "下载歌曲" }).click();
  await downloadPromise;
  await expect.poll(() => page.locator("audio").evaluate((audio: HTMLAudioElement) => ({
    src: audio.src,
    paused: audio.paused,
    currentTime: audio.currentTime,
    emptiedEvents: Number(audio.dataset.downloadEmptiedEvents ?? "0")
  }))).toMatchObject({
    src: playbackBeforeDownload.src,
    paused: false,
    emptiedEvents: 0
  });
  await expect.poll(() => page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThan(playbackBeforeDownload.currentTime);
  await page.getByRole("button", { name: "返回" }).click();
  await page.getByRole("navigation").getByRole("button", { name: "我的" }).click();
  await page.locator(".section-title .section-action").first().click();
  await expect(page.locator(".detail")).toContainText("Quality Song");
});

test("flac explicit search resolves and plays through flac stream endpoint", async ({ page }) => {
  await page.route("**/api/flac/search**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        songs: [{
          id: "flac_explicit_123",
          name: "FLAC Full Song",
          artist: "FLAC Artist",
          pic: "/assets/icon.png",
          cover: "/assets/icon.png",
          url: "/api/flac/stream/explicit-123?format=mp3&bitrate=320&time=texplicit&sign=sexplicit",
          durationMs: 65000,
          verifiedPlayable: true,
          source: "flac",
          remotePlayable: true,
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
  await page.route("**/api/flac/stream/explicit-123**", async (route) => {
    await route.fulfill({ path: fullSongFile, headers: { "content-type": "audio/wav" } });
  });

  await page.getByRole("navigation").getByRole("button", { name: "搜索" }).click();
  await page.getByPlaceholder("搜索音乐/歌手").fill("FLAC Full Song");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "FLAC Full Song FLAC Artist · 测试源" }).click();
  await expect(page.locator(".now-playing")).toContainText("FLAC Full Song");
  await expectAudioPlaying(page);
  await expectAudioLongerThan(page, 60);
});

test("legacy cached 320k flac result refreshes to FLAC before playback", async ({ page }) => {
  const songRequests: string[] = [];
  await page.route("**/api/flac/search**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        songs: [{
          id: "flac_4242",
          name: "Legacy Cached Song",
          artist: "FLAC Artist",
          pic: "/assets/icon.png",
          cover: "/assets/icon.png",
          url: "/api/flac/stream/4242?format=mp3&bitrate=320&time=told&sign=sold",
          durationMs: 65000,
          verifiedPlayable: true,
          source: "flac",
          remotePlayable: true,
          br: 320000,
          level: "320k",
          type: "mp3",
          audioType: "mp3",
          quality: "320k",
          time: "told",
          sign: "sold"
        }],
        page: 1,
        limit: 30,
        total: 1,
        hasMore: false
      })
    });
  });
  await page.route("**/api/flac/song/4242**", async (route) => {
    const url = new URL(route.request().url());
    songRequests.push(url.searchParams.toString());
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        url: `/api/flac/stream/4242?format=flac&bitrate=2000&time=${url.searchParams.get("time")}&sign=${url.searchParams.get("sign")}`,
        durationMs: 65000,
        verifiedPlayable: true,
        br: 2000000,
        level: "flac",
        type: "flac",
        audioType: "flac",
        quality: "flac"
      })
    });
  });
  await page.route("**/api/flac/stream/4242**", async (route) => {
    await route.fulfill({ path: fullSongFile, headers: { "content-type": "audio/wav" } });
  });

  await page.getByRole("navigation").getByRole("button", { name: "搜索" }).click();
  await page.getByPlaceholder("搜索音乐/歌手").fill("Legacy Cached Song");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Legacy Cached Song FLAC Artist · 测试源" }).click();

  await expect(page.locator(".now-playing")).toContainText("Legacy Cached Song");
  await expectAudioPlaying(page);
  expect(songRequests).toContain("format=flac&bitrate=2000&time=told&sign=sold");
  await expect.poll(() => page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.src)).toContain("format=flac");
});

test("flac test source searches, filters, resolves, and plays full songs", async ({ page }) => {
  const searchRequests: URLSearchParams[] = [];
  const songRequests: string[] = [];
  const streamRequests: string[] = [];
  await page.route("**/api/flac/search**", async (route) => {
    const url = new URL(route.request().url());
    const searchPage = url.searchParams.get("page") ?? "1";
    searchRequests.push(url.searchParams);
    const songs = searchPage === "1" ? [{
      id: "flac_15368606",
      name: "September",
      artist: "Earth, Wind & Fire",
      pic: "/assets/icon.png",
      cover: "/assets/icon.png",
      url: "/api/flac/stream/15368606?format=flac&bitrate=2000&time=12345&sign=signed",
      source: "flac",
      remotePlayable: true,
      verifiedPlayable: true,
      durationMs: 213000,
      br: 2000000,
      level: "flac",
      type: "flac",
      audioType: "flac",
      quality: "flac",
      time: "12345",
      sign: "signed"
    }] : [{
      id: "flac_20000000",
      name: "Boogie Wonderland",
      artist: "Earth, Wind & Fire",
      pic: "/assets/icon.png",
      cover: "/assets/icon.png",
      url: "/api/flac/stream/20000000?format=flac&bitrate=2000&time=23456&sign=signed2",
      source: "flac",
      remotePlayable: true,
      verifiedPlayable: true,
      durationMs: 213000,
      br: 2000000,
      level: "flac",
      type: "flac",
      audioType: "flac",
      quality: "flac",
      time: "23456",
      sign: "signed2"
    }];
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        songs,
        filtered: 0,
        page: Number(searchPage),
        limit: 30,
        total: 200,
        hasMore: searchPage === "1"
      })
    });
  });
  await page.route(/\/api\/flac\/song\/(15368606|20000000).*/, async (route) => {
    const url = new URL(route.request().url());
    const id = url.pathname.split("/").pop();
    songRequests.push(url.searchParams.toString());
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        url: `/api/flac/stream/${id}?format=flac&bitrate=2000&time=${url.searchParams.get("time")}&sign=${url.searchParams.get("sign")}`,
        durationMs: 65000,
        verifiedPlayable: true,
        br: 2000000,
        level: "flac",
        type: "flac",
        audioType: "flac",
        quality: "flac"
      })
    });
  });
  await page.route(/\/api\/flac\/stream\/(15368606|20000000).*/, async (route) => {
    const url = new URL(route.request().url());
    streamRequests.push(url.searchParams.toString());
    await route.fulfill({
      path: fullSongFile,
      headers: {
        "content-type": "audio/wav",
        "accept-ranges": "bytes"
      }
    });
  });
  await page.route("**/api/lyrics**", async (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get("name")).toBe("Boogie Wonderland");
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ lrc: "[00:00.00]dance with me", provider: "netease", id: "netease_91" })
    });
  });

  await page.locator("nav button").nth(1).click();
  await expect(page.locator(".network-line")).toContainText("默认优先 FLAC");
  await page.locator('.search-box input[name="keyword"]').fill("September Earth Wind Fire");
  await page.keyboard.press("Enter");
  await expect(page.locator(".song-row", { hasText: "September" })).toBeVisible();
  await expect(page.locator(".result-actions")).toContainText("当前页 1 首");
  await page.getByRole("button", { name: "全选当前页" }).click();
  await expect(page.locator(".selection-bar")).toContainText("已选择 1 首");
  await expect(page.getByRole("button", { name: "取消全选当前页" })).toBeVisible();
  await expect(page.locator(".pagination-bar-top")).toContainText("第 1 页");
  await expect(page.locator(".pagination-bar-top")).toContainText("1-1 / 200");
  await page.locator('.pagination-bar-top button[aria-label="下一页"]').click();
  await expect(page.locator(".song-row", { hasText: "Boogie Wonderland" })).toBeVisible();
  await expect(page.locator(".pagination-bar-top")).toContainText("第 2 页");
  await expect(page.locator(".selection-bar")).toHaveCount(0);
  await page.getByRole("button", { name: "全选当前页" }).click();
  await expect(page.locator(".selection-bar")).toContainText("已选择 1 首");
  await page.getByRole("button", { name: "取消全选当前页" }).click();
  await expect(page.locator(".selection-bar")).toHaveCount(0);
  await page.getByRole("button", { name: "全选当前页" }).click();
  await expect(page.getByText("ThirtySecond")).toHaveCount(0);
  expect(searchRequests.map((params) => params.get("keyword"))).toEqual(["September Earth Wind Fire", "September Earth Wind Fire"]);
  expect(searchRequests.map((params) => params.get("limit"))).toEqual(["30", "30"]);
  expect(searchRequests.map((params) => params.get("page"))).toEqual(["1", "2"]);
  await page.getByRole("button", { name: "取消全选当前页" }).click();
  await expect(page.locator(".selection-bar")).toHaveCount(0);

  await page.locator(".song-row", { hasText: "Boogie Wonderland" }).locator(".song-hit").click();
  await expect(page.locator(".now-playing")).toContainText("Boogie Wonderland");
  await expectAudioPlaying(page);
  await expectAudioLongerThan(page, 60);
  expect(songRequests).toContain("format=flac&bitrate=2000&time=23456&sign=signed2");
  expect(streamRequests.some((query) => query.includes("sign=signed2"))).toBe(true);
  await expect.poll(() => page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.src)).toContain("/api/flac/stream/20000000");
  await page.locator(".now-playing").click();
  await expect(page.locator(".player-sheet")).toContainText("dance with me");
});

test("flac playback refreshes expired search signature after fast-path stream fails", async ({ page }) => {
  const searchRequests: URLSearchParams[] = [];
  const songRequests: string[] = [];
  const streamRequests: string[] = [];
  await page.route("**/api/flac/search**", async (route) => {
    const url = new URL(route.request().url());
    searchRequests.push(url.searchParams);
    const isRefresh = searchRequests.length > 1;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        songs: [{
          id: "flac_15368606",
          name: "September",
          artist: "Earth, Wind & Fire",
          pic: "/assets/icon.png",
          cover: "/assets/icon.png",
          url: `/api/flac/stream/15368606?format=flac&bitrate=2000&time=${isRefresh ? "fresh-time" : "old-time"}&sign=${isRefresh ? "fresh-sign" : "old-sign"}`,
          source: "flac",
          remotePlayable: true,
          verifiedPlayable: true,
          durationMs: 213000,
          br: 2000000,
          level: "flac",
          type: "flac",
          audioType: "flac",
          quality: "flac",
          time: isRefresh ? "fresh-time" : "old-time",
          sign: isRefresh ? "fresh-sign" : "old-sign"
        }],
        filtered: 0,
        page: 1,
        limit: 30,
        total: 1,
        hasMore: false
      })
    });
  });
  await page.route(/\/api\/flac\/song\/15368606.*/, async (route) => {
    const url = new URL(route.request().url());
    songRequests.push(url.searchParams.toString());
    const sign = url.searchParams.get("sign");
    if (sign === "old-sign") {
      await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "flac_song_unavailable", message: "请求已过期" }) });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        url: `/api/flac/stream/15368606?format=flac&bitrate=2000&time=${url.searchParams.get("time")}&sign=${sign}`,
        durationMs: 65000,
        verifiedPlayable: true,
        br: 2000000,
        level: "flac",
        type: "flac",
        audioType: "flac",
        quality: "flac"
      })
    });
  });
  await page.route("**/api/flac/stream/15368606**", async (route) => {
    const url = new URL(route.request().url());
    streamRequests.push(url.searchParams.toString());
    await route.fulfill({
      path: fullSongFile,
      headers: {
        "content-type": "audio/wav",
        "accept-ranges": "bytes"
      }
    });
  });

  await page.locator("nav button").nth(1).click();
  await page.locator('.search-box input[name="keyword"]').fill("September Earth Wind Fire");
  await page.keyboard.press("Enter");
  await expect(page.locator(".song-row", { hasText: "September" })).toBeVisible();
  await page.locator(".song-row", { hasText: "September" }).locator(".song-hit").click();

  await expect(page.locator(".now-playing")).toContainText("September");
  await expectAudioPlaying(page);
  expect(searchRequests.length).toBeGreaterThanOrEqual(2);
  expect(searchRequests.map((params) => params.get("limit"))).toEqual(expect.arrayContaining(["30", "1"]));
  expect(songRequests.some((query) => query.includes("sign=old-sign"))).toBe(true);
  expect(songRequests.some((query) => query.includes("sign=fresh-sign"))).toBe(true);
  expect(streamRequests.some((query) => query.includes("sign=old-sign"))).toBe(false);
  expect(streamRequests.some((query) => query.includes("sign=fresh-sign"))).toBe(true);
});

test("flac playback resumes from current time after mid-song signature refresh", async ({ page }) => {
  const searchRequests: string[] = [];
  const songRequests: string[] = [];
  await page.route("**/api/flac/search**", async (route) => {
    const url = new URL(route.request().url());
    searchRequests.push(url.searchParams.get("keyword") ?? "");
    const refreshCount = searchRequests.length - 1;
    const signature = `fresh-${refreshCount + 1}`;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        songs: [{
          id: "flac_15368606",
          name: "September",
          artist: "Earth, Wind & Fire",
          pic: "/assets/icon.png",
          cover: "/assets/icon.png",
          url: `/api/flac/stream/15368606?format=flac&bitrate=2000&time=${signature}-time&sign=${signature}-sign`,
          source: "flac",
          remotePlayable: true,
          verifiedPlayable: true,
          durationMs: 213000,
          br: 2000000,
          level: "flac",
          type: "flac",
          audioType: "flac",
          quality: "flac",
          time: `${signature}-time`,
          sign: `${signature}-sign`
        }],
        filtered: 0,
        page: 1,
        limit: 30,
        total: 1,
        hasMore: false
      })
    });
  });
  await page.route(/\/api\/flac\/song\/15368606.*/, async (route) => {
    const url = new URL(route.request().url());
    songRequests.push(url.searchParams.toString());
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        url: `/api/flac/stream/15368606?format=flac&bitrate=2000&time=${url.searchParams.get("time")}&sign=${url.searchParams.get("sign")}`,
        durationMs: 65000,
        verifiedPlayable: true,
        br: 2000000,
        level: "flac",
        type: "flac",
        audioType: "flac",
        quality: "flac"
      })
    });
  });
  await page.route("**/api/flac/stream/15368606**", async (route) => {
    await route.fulfill({
      path: fullSongFile,
      headers: {
        "content-type": "audio/wav",
        "accept-ranges": "bytes"
      }
    });
  });

  await page.locator("nav button").nth(1).click();
  await page.locator('.search-box input[name="keyword"]').fill("September Earth Wind Fire");
  await page.keyboard.press("Enter");
  await expect(page.locator(".song-row", { hasText: "September" })).toBeVisible();
  await page.locator(".song-row", { hasText: "September" }).locator(".song-hit").click();
  await expectAudioPlaying(page);
  await expect.poll(() => page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.src)).toContain("fresh-1-sign");
  await expect.poll(() => page.evaluate(() => typeof window.JianyinRecoverAudio)).toBe("function");

  await page.locator("audio").evaluate((audio: HTMLAudioElement) => {
    audio.currentTime = 37;
    audio.dispatchEvent(new Event("timeupdate"));
  });
  await page.evaluate(() => window.JianyinRecoverAudio?.());

  await expect.poll(() => page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.src)).toContain("fresh-2-sign");
  await expect.poll(() => page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThan(36);
  expect(searchRequests.length).toBeGreaterThanOrEqual(2);
  expect(songRequests.some((query) => query.includes("sign=fresh-2-sign"))).toBe(true);
});

test("flac playback refreshes stale signature after a long pause before resuming", async ({ page }) => {
  const searchRequests: URLSearchParams[] = [];
  const songRequests: string[] = [];
  await page.evaluate(() => {
    const realNow = Date.now();
    (window as typeof window & { __mockNow?: number }).__mockNow = realNow;
    Date.now = () => (window as typeof window & { __mockNow?: number }).__mockNow ?? realNow;
  });

  await page.route("**/api/flac/search**", async (route) => {
    const url = new URL(route.request().url());
    searchRequests.push(url.searchParams);
    const isRefresh = searchRequests.length > 1;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        songs: [{
          id: "flac_15368606",
          name: "September",
          artist: "Earth, Wind & Fire",
          pic: "/assets/icon.png",
          cover: "/assets/icon.png",
          url: `/api/flac/stream/15368606?format=flac&bitrate=2000&time=${isRefresh ? "fresh-time" : "old-time"}&sign=${isRefresh ? "fresh-sign" : "old-sign"}`,
          source: "flac",
          remotePlayable: true,
          verifiedPlayable: true,
          durationMs: 213000,
          br: 2000000,
          level: "flac",
          type: "flac",
          audioType: "flac",
          quality: "flac",
          time: isRefresh ? "fresh-time" : "old-time",
          sign: isRefresh ? "fresh-sign" : "old-sign"
        }],
        filtered: 0,
        page: 1,
        limit: 30,
        total: 1,
        hasMore: false
      })
    });
  });
  await page.route(/\/api\/flac\/song\/15368606.*/, async (route) => {
    const url = new URL(route.request().url());
    songRequests.push(url.searchParams.toString());
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        url: `/api/flac/stream/15368606?format=flac&bitrate=2000&time=${url.searchParams.get("time")}&sign=${url.searchParams.get("sign")}`,
        durationMs: 65000,
        verifiedPlayable: true,
        br: 2000000,
        level: "flac",
        type: "flac",
        audioType: "flac",
        quality: "flac"
      })
    });
  });
  await page.route("**/api/flac/stream/15368606**", async (route) => {
    await route.fulfill({
      path: fullSongFile,
      headers: {
        "content-type": "audio/wav",
        "accept-ranges": "bytes"
      }
    });
  });

  await page.locator("nav button").nth(1).click();
  await page.locator('.search-box input[name="keyword"]').fill("September Earth Wind Fire");
  await page.keyboard.press("Enter");
  await expect(page.locator(".song-row", { hasText: "September" })).toBeVisible();
  await page.locator(".song-row", { hasText: "September" }).locator(".song-hit").click();
  await expectAudioPlaying(page);
  await page.locator("audio").evaluate((audio: HTMLAudioElement) => {
    audio.currentTime = 22;
    audio.dispatchEvent(new Event("timeupdate"));
  });

  await page.evaluate(() => (window as typeof window & { JianyinAndroidMedia?: (command: "toggle") => void }).JianyinAndroidMedia?.("toggle"));
  await expectAudioPaused(page);
  await page.evaluate(() => {
    const typed = window as typeof window & { __mockNow?: number };
    typed.__mockNow = (typed.__mockNow ?? Date.now()) + 10 * 60 * 1000;
  });
  await page.evaluate(() => (window as typeof window & { JianyinAndroidMedia?: (command: "toggle") => void }).JianyinAndroidMedia?.("toggle"));

  await expectAudioPlaying(page);
  await expect.poll(() => page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.src)).toContain("fresh-sign");
  await expect.poll(() => page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThan(21);
  expect(searchRequests.map((params) => params.get("limit"))).toEqual(expect.arrayContaining(["30", "1"]));
  expect(songRequests.some((query) => query.includes("sign=old-sign"))).toBe(true);
  expect(songRequests.some((query) => query.includes("sign=fresh-sign"))).toBe(true);
});

test("persisted flac search queue refreshes after reload on the first resume click", async ({ page }) => {
  const staleSong = {
    id: "flac_15368606",
    name: "Persisted September",
    artist: "Earth, Wind & Fire",
    url: "/api/flac/stream/15368606?format=flac&bitrate=2000&time=old-time&sign=old-sign",
    cover: "/assets/icon.png",
    source: "flac" as const,
    remotePlayable: true,
    verifiedPlayable: true,
    durationMs: 65000,
    br: 2000000,
    level: "flac",
    audioType: "flac",
    quality: "flac",
    time: "old-time",
    sign: "old-sign"
  };
  const persisted = { ...testState(), queue: [staleSong], queueIndex: 0 };
  const searchRequests: URLSearchParams[] = [];
  const songRequests: URLSearchParams[] = [];

  await page.route("**/api/flac/search**", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    searchRequests.push(params);
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        songs: [{
          ...staleSong,
          url: "/api/flac/stream/15368606?format=flac&bitrate=2000&time=fresh-time&sign=fresh-sign",
          time: "fresh-time",
          sign: "fresh-sign"
        }],
        page: 1,
        limit: Number(params.get("limit") ?? 1),
        total: 1,
        hasMore: false
      })
    });
  });
  await page.route("**/api/flac/song/15368606**", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    songRequests.push(params);
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        url: `/api/flac/stream/15368606?format=flac&bitrate=2000&time=${params.get("time")}&sign=${params.get("sign")}`,
        durationMs: 65000,
        verifiedPlayable: true,
        br: 2000000,
        level: "flac",
        audioType: "flac",
        quality: "flac"
      })
    });
  });
  await page.route("**/api/flac/stream/15368606**", async (route) => {
    const sign = new URL(route.request().url()).searchParams.get("sign");
    if (sign === "old-sign") {
      await route.fulfill({ status: 403, contentType: "text/plain", body: "expired signature" });
      return;
    }
    await route.fulfill({ path: fullSongFile, headers: { "content-type": "audio/wav", "accept-ranges": "bytes" } });
  });

  await page.route("**/api/state", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ state: persisted }) });
      return;
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  const persistedStateScript = await page.addInitScript(({ key, value }) => {
    localStorage.setItem(key, JSON.stringify(value));
  }, { key: storageKey, value: persisted });
  await page.addInitScript(() => {
    const originalPlay = HTMLMediaElement.prototype.play;
    let inUserGesture = false;
    document.addEventListener("click", () => {
      inUserGesture = true;
      setTimeout(() => { inUserGesture = false; }, 0);
    }, true);
    HTMLMediaElement.prototype.play = function playWithStrictGesture(this: HTMLMediaElement & { __playAuthorized?: boolean }) {
      if (inUserGesture) this.__playAuthorized = true;
      if (!this.__playAuthorized) {
        return Promise.reject(new DOMException("play() failed because the user did not interact with the document first", "NotAllowedError"));
      }
      return originalPlay.call(this);
    };
  });

  await page.reload();
  await persistedStateScript.dispose();
  await expect(page.locator(".now-playing")).toContainText("Persisted September");
  await page.getByRole("button", { name: "播放", exact: true }).click();

  await expect.poll(() => page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.src)).toContain("fresh-sign");
  expect(searchRequests.some((params) => params.get("keyword")?.includes("Persisted September"))).toBe(true);
  expect(songRequests.some((params) => params.get("sign") === "fresh-sign")).toBe(true);
  await expectAudioPlaying(page);
  await expect(page.locator(".toast")).not.toContainText("浏览器阻止了自动播放");
});

test("queue prewarms only the immediate previous and next FLAC songs", async ({ page }) => {
  const queueSongs = Array.from({ length: 5 }, (_, index) => ({
    id: `flac_${100 + index}`,
    name: `Adjacent Track ${index}`,
    artist: "Adjacent Artist",
    pic: "/assets/icon.png",
    cover: "/assets/icon.png",
    source: "flac",
    remotePlayable: true,
    verifiedPlayable: false,
    durationMs: 65000
  }));
  const state = {
    ...testState(),
    playlists: [{ id: "favorites", name: "我喜欢的音乐", cover: "/assets/icon.png", songs: [], source: "local" }],
    queue: queueSongs,
    queueIndex: 2
  };
  const resolvedIds: string[] = [];
  await page.route(/\/api\/flac\/song\/(10[0-4]).*/, async (route) => {
    const id = new URL(route.request().url()).pathname.split("/").pop()!;
    resolvedIds.push(id);
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        url: `/api/flac/stream/${id}?format=flac&bitrate=2000&time=time-${id}&sign=sign-${id}`,
        durationMs: 65000,
        verifiedPlayable: true,
        br: 2000000,
        level: "flac",
        type: "flac",
        audioType: "flac",
        quality: "flac"
      })
    });
  });
  await page.request.post("/api/state", { data: { state } });
  const initScript = await page.addInitScript(({ key, value }) => {
    localStorage.setItem(key, JSON.stringify(value));
  }, { key: storageKey, value: state });
  await page.reload();
  await initScript.dispose();

  await expect.poll(() => [...resolvedIds].sort()).toEqual(["101", "103"]);
  expect(resolvedIds).toHaveLength(2);
  await expect(page.locator("audio")).toHaveAttribute("preload", "metadata");
});

test("flac search queue uses prewarmed signatures when advancing", async ({ page }) => {
  const searchRequests: string[] = [];
  const songRequests: string[] = [];
  const streamRequests: string[] = [];
  const songsById = {
    "111": {
      id: "flac_111",
      name: "First Track",
      artist: "Queue Artist",
      pic: "/assets/icon.png",
      cover: "/assets/icon.png",
      source: "flac",
      remotePlayable: true,
      verifiedPlayable: true,
      durationMs: 65000,
      br: 2000000,
      level: "flac",
      type: "flac",
      audioType: "flac",
      quality: "flac"
    },
    "222": {
      id: "flac_222",
      name: "Second Track",
      artist: "Queue Artist",
      pic: "/assets/icon.png",
      cover: "/assets/icon.png",
      source: "flac",
      remotePlayable: true,
      verifiedPlayable: true,
      durationMs: 65000,
      br: 2000000,
      level: "flac",
      type: "flac",
      audioType: "flac",
      quality: "flac"
    }
  };
  const withSignature = (song: typeof songsById[keyof typeof songsById], signature: "old" | "fresh") => ({
    ...song,
    url: `/api/flac/stream/${song.id.replace(/^flac_/, "")}?format=flac&bitrate=2000&time=${signature}-time-${song.id}&sign=${signature}-sign-${song.id}`,
    time: `${signature}-time-${song.id}`,
    sign: `${signature}-sign-${song.id}`
  });

  await page.route("**/api/flac/search**", async (route) => {
    const url = new URL(route.request().url());
    const keyword = url.searchParams.get("keyword") ?? "";
    searchRequests.push(keyword);
    const songs = keyword === "First Track Queue Artist"
      ? [withSignature(songsById["111"], "fresh")]
      : keyword === "Second Track Queue Artist"
        ? [withSignature(songsById["222"], "fresh")]
        : [withSignature(songsById["111"], "old"), withSignature(songsById["222"], "old")];
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        songs,
        filtered: 0,
        page: 1,
        limit: 30,
        total: songs.length,
        hasMore: false
      })
    });
  });
  await page.route(/\/api\/flac\/song\/(111|222).*/, async (route) => {
    const url = new URL(route.request().url());
    songRequests.push(`${url.pathname}?${url.searchParams.toString()}`);
    if (url.searchParams.get("sign")?.startsWith("old-sign")) {
      await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "flac_song_unavailable", message: "请求已过期" }) });
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        url: `/api/flac/stream/${url.pathname.split("/").pop()}?format=flac&bitrate=2000&time=${url.searchParams.get("time")}&sign=${url.searchParams.get("sign")}`,
        durationMs: 65000,
        verifiedPlayable: true,
        br: 2000000,
        level: "flac",
        type: "flac",
        audioType: "flac",
        quality: "flac"
      })
    });
  });
  await page.route(/\/api\/flac\/stream\/(111|222).*/, async (route) => {
    const url = new URL(route.request().url());
    streamRequests.push(`${url.pathname}?${url.searchParams.toString()}`);
    await route.fulfill({
      path: fullSongFile,
      headers: {
        "content-type": "audio/wav",
        "accept-ranges": "bytes"
      }
    });
  });

  await page.locator("nav button").nth(1).click();
  await page.locator('.search-box input[name="keyword"]').fill("Queue Artist");
  await page.keyboard.press("Enter");
  await expect(page.locator(".song-row", { hasText: "First Track" })).toBeVisible();
  await expect.poll(() => searchRequests).toEqual(expect.arrayContaining(["First Track Queue Artist", "Second Track Queue Artist"]));
  await page.locator(".song-row", { hasText: "First Track" }).locator(".song-hit").click();
  await expect(page.locator(".now-playing")).toContainText("First Track");
  await expectAudioPlaying(page);

  await page.locator(".now-playing .icon-button").last().click();
  await expect(page.locator(".now-playing")).toContainText("Second Track");
  await expectAudioPlaying(page);

  await expect.poll(() => searchRequests).toEqual(expect.arrayContaining(["Queue Artist", "First Track Queue Artist", "Second Track Queue Artist"]));
  expect(songRequests.some((query) => query.includes("fresh-sign-flac_111"))).toBe(true);
  expect(songRequests.some((query) => query.includes("fresh-sign-flac_222"))).toBe(true);
  expect(streamRequests.some((query) => query.includes("old-sign"))).toBe(false);
  expect(streamRequests.some((query) => query.includes("fresh-sign-flac_222"))).toBe(true);
});
