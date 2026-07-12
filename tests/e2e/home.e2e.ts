import { expect, test } from "playwright/test";
import { fs, storageKey, projectRoot, toneFile, coverFile, fullSongFile, lrcFile, testSongs, testState, mockHome, reset, expectAudioPlaying, expectAudioPaused, expectAudioLongerThan, expectReadableToast, playFirstHomeSong, openPlayer, importLocalTone, openSettings, storedState, songNamesIn } from "../helpers/app-fixture";

test.beforeEach(async ({ page }) => {
  await reset(page);
});

test("home shows Android 5 recommendation sections", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "今日推荐" })).toBeVisible();
  await expect(page.getByRole("button", { name: /周杰伦 本地试听/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Home Hot Song/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Home Playlist/ })).toBeVisible();
});

test("home recommended playlist opens from homepage state", async ({ page }) => {
  await page.route("**/api/netease/home**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        radarSongs: [],
        hotSongs: [],
        recommendedPlaylists: [{
          id: "homepage-local",
          name: "Homepage Filled Playlist",
          cover: "/assets/icon.png",
          source: "netease",
          trackCount: 1,
          creatorNickname: "Mock Creator",
          songs: [{
            id: "homepage-song",
            name: "Homepage Playlist Song",
            artist: "Cloud Artist",
            pic: "/assets/icon.png",
            url: "/assets/full-song-65s.wav",
            source: "netease",
            durationMs: 65000,
            verifiedPlayable: true
          }]
        }]
      })
    });
  });
  await page.reload();

  await page.getByRole("button", { name: /Homepage Filled Playlist/ }).click();
  const playlist = page.getByRole("dialog", { name: "Homepage Filled Playlist" });
  await expect(playlist).toBeVisible();
  await expect(playlist).toContainText("Homepage Playlist Song");
});

test("home recommended playlist imports remote detail before opening", async ({ page }) => {
  const songs = Array.from({ length: 25 }, (_item, index) => ({
    id: String(321 + index),
    name: `Home Playlist Song ${index + 1}`,
    artist: "Cloud Artist",
    pic: "/assets/icon.png",
    url: "/assets/full-song-65s.wav",
    source: "netease",
    durationMs: 65000,
    verifiedPlayable: true
  }));
  await page.route(/\/api\/netease\/playlist\/3778678.*/, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        playlist: {
          id: "netease_playlist_3778678",
          name: "Home Playlist",
          cover: "/assets/icon.png",
          source: "netease",
          trackCount: songs.length,
          songs
        }
      })
    });
  });

  await page.getByRole("button", { name: /Home Playlist/ }).click();
  const playlist = page.getByRole("dialog", { name: "Home Playlist" });
  await expect(playlist).toBeVisible();
  await expect(playlist).toContainText("Home Playlist Song 25");
  await expect(playlist.locator(".song-row")).toHaveCount(25);
});

test("home refresh button reloads recommendation content", async ({ page }) => {
  const requests: string[] = [];
  await page.route("**/api/netease/home**", async (route) => {
    const url = new URL(route.request().url());
    requests.push(url.searchParams.toString());
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        radarSongs: [{
          id: `refresh-${requests.length}`,
          name: "Refreshed Home Song",
          artist: "Refresh Artist",
          pic: "/assets/icon.png",
          url: "/assets/full-song-65s.wav",
          durationMs: 65000,
          verifiedPlayable: true
        }],
        hotSongs: [],
        recommendedPlaylists: []
      })
    });
  });

  await page.getByRole("button", { name: "刷新推荐" }).click();
  await expect(page.getByRole("button", { name: /Refreshed Home Song/ })).toBeVisible();
  expect(requests.some((query) => query.includes("refresh=1"))).toBe(true);
});

test("newer home quality request wins over a slower previous request", async ({ page }) => {
  await page.unroute("**/api/netease/home**");
  let releaseSlow: () => void = () => {};
  let markSlowStarted: () => void = () => {};
  let markSlowFinished: () => void = () => {};
  const slowGate = new Promise<void>((resolve) => { releaseSlow = resolve; });
  const slowStarted = new Promise<void>((resolve) => { markSlowStarted = resolve; });
  const slowFinished = new Promise<void>((resolve) => { markSlowFinished = resolve; });

  await page.route("**/api/netease/home**", async (route) => {
    const quality = new URL(route.request().url()).searchParams.get("quality");
    if (quality === "lossless") {
      markSlowStarted();
      await slowGate;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          radarSongs: [{ ...testSongs[0], id: "slow-old-home", name: "Slow Old Home", verifiedPlayable: true }],
          hotSongs: [],
          recommendedPlaylists: []
        })
      }).catch(() => {});
      markSlowFinished();
      return;
    }
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        radarSongs: [{ ...testSongs[1], id: "fast-new-home", name: "Fast New Home", verifiedPlayable: true }],
        hotSongs: [],
        recommendedPlaylists: []
      })
    });
  });

  const settings = await openSettings(page);
  await settings.getByLabel("播放音质").selectOption("lossless");
  await slowStarted;
  await settings.getByLabel("播放音质").selectOption("standard");
  await settings.getByRole("button", { name: "关闭" }).click();
  await page.getByRole("navigation").getByRole("button", { name: "首页" }).click();
  await expect(page.getByRole("button", { name: /Fast New Home/ })).toBeVisible();
  releaseSlow();
  await slowFinished;

  await expect(page.getByRole("button", { name: /Fast New Home/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Slow Old Home/ })).toHaveCount(0);
  await expect(page.locator(".field-error")).toHaveCount(0);
});

test("identical home API calls share one in-flight request", async ({ page }) => {
  let requestCount = 0;
  let releaseResponse: () => void = () => {};
  const responseGate = new Promise<void>((resolve) => { releaseResponse = resolve; });

  await page.route("**/api/netease/home**", async (route) => {
    const refresh = new URL(route.request().url()).searchParams.get("refresh");
    if (refresh !== "99") {
      await route.fallback();
      return;
    }
    requestCount += 1;
    await responseGate;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ radarSongs: [], hotSongs: [], recommendedPlaylists: [] })
    });
  });

  const calls = page.evaluate(async () => {
    const modulePath = "/src/lib/api.ts";
    const api = await import(modulePath);
    await Promise.all([
      api.fetchNeteaseHome("lossless", 99),
      api.fetchNeteaseHome("lossless", 99)
    ]);
  });
  await expect.poll(() => requestCount).toBeGreaterThan(0);
  releaseResponse();
  await calls;

  expect(requestCount).toBe(1);
});

test("home refresh 500 shows error without blanking the screen", async ({ page }) => {
  await page.route("**/api/netease/home**", async (route) => {
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ message: "mock home failed" })
    });
  });

  await page.getByRole("button", { name: "刷新推荐" }).click();
  await expect(page.locator(".field-error")).toContainText("mock home failed");
  await expect(page.getByRole("heading", { name: "既见" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "今日推荐" })).toBeVisible();
  await expect(page.getByRole("button", { name: "刷新推荐" })).toBeVisible();
});

test("opening recommended playlist starts bounded FLAC prewarm without blocking detail", async ({ page }) => {
  const flacSearchRequests: string[] = [];
  await page.route(/\/api\/netease\/playlist\/3778678.*/, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        playlist: {
          id: "netease_playlist_3778678",
          name: "Home Playlist",
          cover: "/assets/icon.png",
          source: "netease",
          songs: [
            { id: "flac_search_1", name: "Prewarm One", artist: "Cloud Artist", pic: "/assets/icon.png", source: "flac", remotePlayable: true, verifiedPlayable: false },
            { id: "flac_search_2", name: "Prewarm Two", artist: "Cloud Artist", pic: "/assets/icon.png", source: "flac", remotePlayable: true, verifiedPlayable: false },
            { id: "flac_search_3", name: "Prewarm Three", artist: "Cloud Artist", pic: "/assets/icon.png", source: "flac", remotePlayable: true, verifiedPlayable: false },
            { id: "flac_search_4", name: "Prewarm Four", artist: "Cloud Artist", pic: "/assets/icon.png", source: "flac", remotePlayable: true, verifiedPlayable: false },
            { id: "flac_search_5", name: "Prewarm Five", artist: "Cloud Artist", pic: "/assets/icon.png", source: "flac", remotePlayable: true, verifiedPlayable: false }
          ]
        }
      })
    });
  });
  await page.route("**/api/flac/search**", async (route) => {
    const url = new URL(route.request().url());
    const keyword = url.searchParams.get("keyword") ?? "";
    flacSearchRequests.push(keyword);
    const match = keyword.match(/Prewarm (\w+)/);
    const idMap: Record<string, string> = { One: "101", Two: "102", Three: "103", Four: "104", Five: "105" };
    const id = idMap[match?.[1] ?? "One"] ?? "101";
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        songs: [{
          id: `flac_${id}`,
          name: keyword.replace(" Cloud Artist", "") || "Resolved Prewarm",
          artist: "Cloud Artist",
          pic: "/assets/icon.png",
          cover: "/assets/icon.png",
          url: `/api/flac/stream/${id}?format=mp3&bitrate=320&time=t${id}&sign=s${id}`,
          source: "flac",
          remotePlayable: true,
          verifiedPlayable: true,
          durationMs: 65000,
          br: 320000,
          level: "320k",
          type: "mp3",
          audioType: "mp3",
          quality: "320k",
          time: `t${id}`,
          sign: `s${id}`
        }],
        page: 1,
        limit: 5,
        total: 1,
        hasMore: false
      })
    });
  });
  await page.route(/\/api\/flac\/song\/10[1-5].*/, async (route) => {
    const id = new URL(route.request().url()).pathname.split("/").pop() ?? "101";
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        url: `/api/flac/stream/${id}?format=mp3&bitrate=320&time=t${id}&sign=s${id}`,
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

  await page.getByRole("button", { name: /Home Playlist/ }).click();
  const playlist = page.getByRole("dialog", { name: "Home Playlist" });
  await expect(playlist).toBeVisible();
  await expect(playlist).toContainText("Prewarm One");
  await expect.poll(() => flacSearchRequests.length).toBeGreaterThan(0);
  expect(flacSearchRequests.length).toBeLessThanOrEqual(4);
});

test("playing an imported homepage playlist song keeps other recommendation covers", async ({ page }) => {
  await page.route("**/api/netease/home**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        radarSongs: [],
        hotSongs: [],
        recommendedPlaylists: [
          { id: "3778678", name: "Home Playlist", cover: "/assets/miku_1.png", trackCount: 1, creatorNickname: "Mock Creator" },
          { id: "999", name: "Other Playlist", cover: "/assets/miku_2.png", trackCount: 1, creatorNickname: "Mock Creator" }
        ]
      })
    });
  });
  await page.route(/\/api\/netease\/playlist\/3778678.*/, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        playlist: {
          id: "netease_playlist_3778678",
          name: "Home Playlist",
          cover: "/assets/miku_1.png",
          source: "netease",
          songs: [{
            id: "321",
            name: "Home Playlist Song",
            artist: "Cloud Artist",
            pic: "/assets/miku_9.png",
            url: "/assets/full-song-65s.wav",
            source: "netease",
            durationMs: 65000,
            verifiedPlayable: true
          }]
        }
      })
    });
  });
  await page.route("**/api/netease/song/321**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        url: "/assets/full-song-65s.wav",
        durationMs: 65000,
        verifiedPlayable: true,
        br: 320000,
        level: "exhigh",
        audioType: "mp3",
        quality: "exhigh"
      })
    });
  });
  await page.reload();

  await expect(page.getByRole("button", { name: /Home Playlist/ }).locator("img")).toHaveAttribute("src", "/assets/miku_1.png");
  await expect(page.getByRole("button", { name: /Other Playlist/ }).locator("img")).toHaveAttribute("src", "/assets/miku_2.png");
  await page.getByRole("button", { name: /Home Playlist/ }).click();
  await page.locator(".detail .song-row .song-hit").first().click();
  await expect(page.locator(".now-playing")).toContainText("Home Playlist Song");
  await expectAudioPlaying(page);

  await expect(page.locator(".playlist-grid .playlist-card").nth(0).locator("img")).toHaveAttribute("src", "/assets/miku_1.png");
  await expect(page.locator(".playlist-grid .playlist-card").nth(1).locator("img")).toHaveAttribute("src", "/assets/miku_2.png");
});

test("home song plays and opens player lyrics", async ({ page }) => {
  await playFirstHomeSong(page);
  await expect(page.locator(".now-playing")).toContainText("周杰伦 本地试听");
  await expectAudioPlaying(page);
  await expectAudioLongerThan(page, 60);
  const player = await openPlayer(page);
  await expect(player).toContainText("搜索、播放、队列、歌词和歌单");
});
