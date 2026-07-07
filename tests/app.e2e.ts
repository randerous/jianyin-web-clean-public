import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "playwright/test";

const storageKey = "jianyin-web-clean-state-v1";
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const toneFile = path.join(projectRoot, "public", "assets", "demo-tone.wav");
const coverFile = path.join(projectRoot, "public", "assets", "miku_9.png");
const fullSongFile = path.join(projectRoot, "public", "assets", "full-song-65s.wav");
const lrcFile = path.join(projectRoot, "tests", "fixtures", "custom.lrc");

const testSongs = [
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

function testState() {
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
    androidStatusNotificationEnabled: false
  };
}

async function mockHome(page: Page) {
  await page.route("**/api/netease/home**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        radarSongs: testSongs.slice(0, 2),
        hotSongs: [
          { id: "home-2", name: "Home Hot Song", artist: "Hot Artist", pic: "/assets/icon.png", url: "/assets/full-song-65s.wav", durationMs: 65000, verifiedPlayable: true, br: 999000, level: "lossless", type: "flac" }
        ],
        recommendedPlaylists: [
          { id: "3778678", name: "Home Playlist", cover: "/assets/icon.png", trackCount: 1, creatorNickname: "Mock Creator" }
        ]
      })
    });
  });
}

async function reset(page: Page) {
  const state = testState();
  await page.request.post("/api/state", { data: { state } });
  await mockHome(page);
  const initScript = await page.addInitScript(({ key, value }) => {
    localStorage.setItem(key, JSON.stringify(value));
  }, { key: storageKey, value: state });
  await page.goto("/");
  await initScript.dispose();
}

async function expectAudioPlaying(page: Page) {
  await expect.poll(() => page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(false);
  await expect.poll(() => page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThan(0);
}

async function expectAudioPaused(page: Page) {
  await expect.poll(() => page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(true);
}

async function expectAudioLongerThan(page: Page, seconds: number) {
  await expect.poll(() => page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.duration)).toBeGreaterThan(seconds);
}

async function playFirstHomeSong(page: Page) {
  await page.getByRole("navigation").getByRole("button", { name: "首页" }).click();
  await page.getByRole("main").getByRole("button", { name: /周杰伦 本地试听/ }).click();
}

async function openPlayer(page: Page) {
  await page.locator(".now-playing").click();
  const player = page.locator(".player-sheet");
  await expect(player).toBeVisible();
  return player;
}

async function importLocalTone(page: Page) {
  await page.getByRole("navigation").getByRole("button", { name: "我的" }).click();
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "导入本地音乐" }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles(toneFile);
  await expect(page.getByRole("dialog", { name: "本地歌单_1首" })).toBeVisible();
}

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
  await page.route(/\/api\/netease\/playlist\/3778678.*/, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        playlist: {
          id: "netease_playlist_3778678",
          name: "Home Playlist",
          cover: "/assets/icon.png",
          source: "netease",
          songs: [{
            id: "321",
            name: "Home Playlist Song",
            artist: "Cloud Artist",
            pic: "/assets/icon.png",
            url: "/assets/full-song-65s.wav",
            source: "netease",
            durationMs: 65000,
            verifiedPlayable: true
          }]
        }
      })
    });
  });

  await page.getByRole("button", { name: /Home Playlist/ }).click();
  const playlist = page.getByRole("dialog", { name: "Home Playlist" });
  await expect(playlist).toBeVisible();
  await expect(playlist).toContainText("Home Playlist Song");
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

test("player more menu changes speed, progress style, and floating lyric", async ({ page }) => {
  await playFirstHomeSong(page);
  await expectAudioPlaying(page);
  const player = await openPlayer(page);
  await player.getByRole("button", { name: "更多选项" }).click();
  await player.getByRole("button", { name: "1.5x" }).click();
  await expect.poll(() => page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.playbackRate)).toBe(1.5);
  await player.getByLabel("进度条样式").selectOption("audio");
  await expect(player.locator(".wave-progress")).toBeVisible();
  await player.getByRole("button", { name: "开启桌面歌词" }).first().click();
  await expect(page.getByRole("dialog", { name: "桌面歌词" })).toBeVisible();
});

test("player controls pause, resume, seek, and move through full-length queue", async ({ page }) => {
  await playFirstHomeSong(page);
  await expectAudioPlaying(page);
  const player = await openPlayer(page);

  await player.getByRole("button", { name: "暂停" }).click();
  await expectAudioPaused(page);
  await player.locator(".round-play").click();
  await expectAudioPlaying(page);

  await player.getByLabel("播放进度").fill("10");
  await expect.poll(() => page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThan(9);

  await player.getByRole("button", { name: "下一首" }).click();
  await expect(page.locator(".now-playing")).toContainText("陈奕迅 本地试听");
  await expectAudioPlaying(page);
  await expectAudioLongerThan(page, 60);

  await player.getByRole("button", { name: "上一首" }).click();
  await expect(page.locator(".now-playing")).toContainText("周杰伦 本地试听");
  await expectAudioPlaying(page);
  await expectAudioLongerThan(page, 60);

  const currentPlayer = page.locator(".player-sheet");
  await currentPlayer.getByRole("button", { name: "单曲循环" }).click();
  await currentPlayer.getByRole("button", { name: "随机播放" }).click();
  await currentPlayer.getByRole("button", { name: "列表循环" }).click();
  await expect(currentPlayer.getByRole("button", { name: "下一首" })).toBeEnabled();
});

test("searches local library and adds selections to a new playlist", async ({ page }) => {
  await page.route("**/api/flac/search**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        songs: [
          {
            id: "flac_select_1",
            name: "Search Pick One",
            artist: "Batch Artist",
            pic: "/assets/icon.png",
            cover: "/assets/icon.png",
            url: "/api/flac/stream/select-1?format=mp3&bitrate=320&time=t1&sign=s1",
            source: "flac",
            remotePlayable: true,
            verifiedPlayable: true,
            durationMs: 65000,
            br: 320000,
            level: "320k",
            type: "mp3",
            audioType: "mp3",
            quality: "320k"
          },
          {
            id: "flac_select_2",
            name: "Search Pick Two",
            artist: "Batch Artist",
            pic: "/assets/icon.png",
            cover: "/assets/icon.png",
            url: "/api/flac/stream/select-2?format=mp3&bitrate=320&time=t2&sign=s2",
            source: "flac",
            remotePlayable: true,
            verifiedPlayable: true,
            durationMs: 65000,
            br: 320000,
            level: "320k",
            type: "mp3",
            audioType: "mp3",
            quality: "320k"
          }
        ],
        page: 1,
        limit: 30,
        total: 2,
        hasMore: false
      })
    });
  });

  await page.getByRole("navigation").getByRole("button", { name: "我的" }).click();
  await page.getByRole("button", { name: "创建歌单" }).click();
  await page.getByRole("dialog", { name: "创建新歌单" }).getByPlaceholder("歌单名称").fill("测试歌单");
  await page.getByRole("dialog", { name: "创建新歌单" }).getByRole("button", { name: "创建" }).click();
  await expect(page.getByRole("dialog", { name: "测试歌单" })).toBeVisible();
  await page.getByRole("button", { name: "返回" }).click();

  await page.getByRole("navigation").getByRole("button", { name: "搜索" }).click();
  await page.getByPlaceholder("搜索音乐/歌手").fill("batch");
  await page.keyboard.press("Enter");
  await page.locator(".song-row", { hasText: "Search Pick One" }).getByRole("button", { name: "选择歌曲" }).click();
  await page.locator(".song-row", { hasText: "Search Pick Two" }).getByRole("button", { name: "选择歌曲" }).click();
  await expect(page.locator(".selection-bar")).toContainText("已选择 2 首");
  await page.locator(".selection-bar select").selectOption({ label: "测试歌单" });

  await page.getByRole("navigation").getByRole("button", { name: "我的" }).click();
  await page.getByRole("button", { name: /测试歌单 2 首歌曲/ }).click();
  await expect(page.getByRole("dialog", { name: "测试歌单" })).toContainText("Search Pick One");
  await expect(page.getByRole("dialog", { name: "测试歌单" })).toContainText("Search Pick Two");
  await page.getByRole("button", { name: "返回" }).click();
  await expect(page.getByRole("button", { name: /测试歌单 2 首歌曲/ })).toBeVisible();
});

test("remote playlists persist across clean browser contexts", async ({ page, browser }) => {
  const statePosts: unknown[] = [];
  await page.route(/\/api\/state$/, async (route) => {
    if (route.request().method() === "POST") {
      statePosts.push(route.request().postDataJSON());
    }
    await route.fallback();
  });
  await page.route(/\/api\/netease\/playlist\/3778678.*/, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        playlist: {
          id: "netease_playlist_3778678",
          name: "跨浏览器远程歌单",
          cover: "/assets/icon.png",
          source: "netease",
          songs: [{
            id: "321",
            name: "Remote Playlist Song",
            artist: "Cloud Artist",
            pic: "/assets/icon.png",
            url: "/api/netease/stream/321?quality=exhigh",
            source: "netease",
            durationMs: 65000,
            verifiedPlayable: true,
            remotePlayable: true
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
        type: "mp3",
        audioType: "mp3"
      })
    });
  });
  await page.route("**/api/netease/stream/321**", async (route) => {
    await route.fulfill({ path: fullSongFile });
  });
  await page.getByRole("navigation").getByRole("button", { name: "我的" }).click();
  await page.getByRole("button", { name: "导入网易云歌单" }).click();
  const importDialog = page.getByRole("dialog", { name: "导入网易云歌单" });
  await importDialog.getByPlaceholder("歌单 ID 或分享链接").fill("3778678");
  await importDialog.getByRole("button", { name: "导入" }).click();
  await page.getByRole("dialog", { name: "跨浏览器远程歌单" }).getByRole("button", { name: "返回" }).click();
  await expect(page.getByRole("button", { name: "跨浏览器远程歌单 1 首歌曲" })).toBeVisible();
  await expect.poll(() => statePosts.some((body) => JSON.stringify(body).includes("netease_playlist_3778678"))).toBe(true);

  const clean = await browser.newContext();
  const cleanPage = await clean.newPage();
  await mockHome(cleanPage);
  await cleanPage.route("**/api/netease/song/321**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        url: "/assets/full-song-65s.wav",
        durationMs: 65000,
        verifiedPlayable: true,
        br: 320000,
        level: "exhigh",
        type: "mp3",
        audioType: "mp3"
      })
    });
  });
  await cleanPage.route("**/api/netease/stream/321**", async (route) => {
    await route.fulfill({ path: fullSongFile });
  });
  await cleanPage.goto("/");
  await cleanPage.getByRole("navigation").getByRole("button", { name: "我的" }).click();
  await expect(cleanPage.getByRole("button", { name: "跨浏览器远程歌单 1 首歌曲" })).toBeVisible();
  await cleanPage.getByRole("button", { name: "跨浏览器远程歌单 1 首歌曲" }).click();
  const playlist = cleanPage.getByRole("dialog", { name: "跨浏览器远程歌单" });
  await expect(playlist).toContainText("Remote Playlist Song");
  await playlist.getByRole("button", { name: "Remote Playlist Song Cloud Artist · 网易云" }).click();
  await expectAudioPlaying(cleanPage);
  await expectAudioLongerThan(cleanPage, 60);
  await clean.close();
});

test("playlist detail searches visible songs and downloads selected", async ({ page }) => {
  await page.getByRole("navigation").getByRole("button", { name: "我的" }).click();
  await page.getByRole("button", { name: "热歌推荐 3 首歌曲" }).click();
  const playlist = page.getByRole("dialog", { name: "热歌推荐" });
  await expect(playlist).toBeVisible();
  await playlist.getByPlaceholder("搜索歌曲").fill("陈奕迅");
  await expect(playlist).toContainText("陈奕迅 本地试听");
  await expect(playlist).not.toContainText("邓紫棋 本地试听");
  await playlist.getByRole("button", { name: "全选可见" }).click();
  await expect(playlist.getByRole("button", { name: "下载所选" })).toBeEnabled();
  const downloadPromise = page.waitForEvent("download");
  await playlist.getByRole("button", { name: "下载所选" }).click();
  await downloadPromise;
});

test("local import persists across reload", async ({ page }) => {
  await importLocalTone(page);
  await expect(page.getByRole("button", { name: /demo-tone/ })).toBeVisible();
  await page.reload();
  await page.getByRole("navigation").getByRole("button", { name: "我的" }).click();
  await page.getByRole("button", { name: "本地歌单_1首" }).click();
  await expect(page.getByRole("dialog", { name: "本地歌单_1首" })).toContainText("demo-tone");
  await expect(page.getByText("需重新导入")).toHaveCount(0);
  await page.getByRole("dialog", { name: "本地歌单_1首" }).getByRole("button", { name: /demo-tone/ }).click();
  await expectAudioPlaying(page);
});

test("backup restores local audio in a clean context", async ({ page, browser }) => {
  await importLocalTone(page);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "返回" }).click();
  await page.getByRole("button", { name: "备份数据" }).click();
  const download = await downloadPromise;
  const backupPath = await download.path();
  expect(backupPath).toBeTruthy();
  const backup = JSON.parse(await fs.readFile(backupPath!, "utf8"));
  expect(backup.app).toBe("jianyin-web-clean");
  expect(JSON.stringify(backup)).not.toMatch(/blob:|MUSIC_U|SESSDATA|bili_jct|cookie|token|credential/i);
  expect(backup.localFiles.length).toBeGreaterThan(0);
  expect(backup.localFiles[0].dataUrl).toMatch(/^data:audio\//);
  expect(JSON.stringify(backup.playlists)).toContain("local-file:");

  const clean = await browser.newContext();
  const cleanPage = await clean.newPage();
  await cleanPage.goto("/");
  await cleanPage.getByRole("navigation").getByRole("button", { name: "我的" }).click();
  const chooserPromise = cleanPage.waitForEvent("filechooser");
  await cleanPage.getByRole("button", { name: "恢复备份" }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles(backupPath!);
  await expect(cleanPage.getByRole("button", { name: "本地歌单_1首" })).toBeVisible();
  await cleanPage.getByRole("button", { name: "本地歌单_1首" }).click();
  await cleanPage.getByRole("button", { name: /demo-tone/ }).click();
  await expectAudioPlaying(cleanPage);
  await clean.close();
});

test("local audio shared metadata in clean context requires reimport", async ({ page, browser }) => {
  await importLocalTone(page);
  await page.getByRole("button", { name: "返回" }).click();
  await expect.poll(async () => {
    const state = await page.request.get("/api/state");
    return JSON.stringify((await state.json()).state ?? {}).includes("local-file:");
  }).toBe(true);

  const clean = await browser.newContext();
  const cleanPage = await clean.newPage();
  await mockHome(cleanPage);
  await cleanPage.goto("/");
  await cleanPage.getByRole("navigation").getByRole("button", { name: "我的" }).click();
  await expect(cleanPage.getByRole("button", { name: "本地歌单_1首" })).toBeVisible();
  await cleanPage.getByRole("button", { name: "本地歌单_1首" }).click();
  const dialog = cleanPage.getByRole("dialog", { name: "本地歌单_1首" });
  await expect(dialog).toContainText("需重新导入");
  await dialog.locator(".song-row", { hasText: "demo-tone" }).getByRole("button", { name: /demo-tone/ }).click();
  await expect(cleanPage.locator(".toast")).toContainText("本地文件不在当前浏览器，请重新导入");
  await expectAudioPaused(cleanPage);
  await expect.poll(() => cleanPage.locator("audio").evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBe(0);

  await dialog.getByRole("button", { name: "全选可见" }).click();
  await dialog.getByRole("button", { name: "加入队列" }).click();
  await expect(cleanPage.locator(".toast")).toContainText("没有可加入播放队列的歌曲");
  await clean.close();
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

test("imports mocked netease playlist", async ({ page }) => {
  await page.route(/\/api\/netease\/playlist\/3778678.*/, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        playlist: {
          id: "netease_playlist_3778678",
          name: "Mock Playlist",
          cover: "/assets/icon.png",
          songs: [{
            id: "321",
            name: "Playlist Song",
            artist: "Playlist Artist",
            pic: "/assets/icon.png",
            url: "/assets/full-song-65s.wav",
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
        lrc: "[00:00.00]playlist lyric",
        durationMs: 65000,
        verifiedPlayable: true,
        br: 320000,
        level: "exhigh",
        type: "mp3",
        audioType: "mp3"
      })
    });
  });

  await page.getByRole("navigation").getByRole("button", { name: "我的" }).click();
  await page.getByRole("button", { name: "导入网易云歌单" }).click();
  const dialog = page.getByRole("dialog", { name: "导入网易云歌单" });
  await dialog.getByPlaceholder("歌单 ID 或分享链接").fill("https://music.163.com/#/playlist?id=3778678");
  await dialog.getByRole("button", { name: "导入" }).click();
  const playlist = page.getByRole("dialog", { name: "Mock Playlist" });
  await expect(playlist).toBeVisible();
  await playlist.getByRole("button", { name: "Playlist Song Playlist Artist · 网易云" }).click();
  await expect(page.locator(".now-playing")).toContainText("Playlist Song");
  await expectAudioPlaying(page);
  await expectAudioLongerThan(page, 60);
});

test("failed netease playlist import shows error and does not add playlist", async ({ page }) => {
  await page.route(/\/api\/netease\/playlist\/3778678.*/, async (route) => {
    await route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({
        error: "playlist_empty",
        message: "这个公开歌单没有可完整播放歌曲"
      })
    });
  });

  await page.getByRole("navigation").getByRole("button", { name: "我的" }).click();
  const playlistCount = await page.locator(".playlist-row").count();
  await page.getByRole("button", { name: "导入网易云歌单" }).click();
  const dialog = page.getByRole("dialog", { name: "导入网易云歌单" });
  await dialog.getByPlaceholder("歌单 ID 或分享链接").fill("3778678");
  await dialog.getByRole("button", { name: "导入" }).click();

  await expect(dialog).toContainText("这个公开歌单没有可完整播放歌曲");
  await expect(page.locator(".playlist-row")).toHaveCount(playlistCount);
  await expect(page.getByRole("dialog", { name: "导入网易云歌单" })).toBeVisible();
});

test("flac search controls immediate playback and download cache", async ({ page }) => {
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

  const downloadPromise = page.waitForEvent("download");
  const player = await openPlayer(page);
  await player.getByRole("button", { name: "更多选项" }).click();
  await player.getByRole("button", { name: "下载歌曲" }).click();
  await downloadPromise;
  await page.getByRole("button", { name: "返回" }).click();
  await page.getByRole("navigation").getByRole("button", { name: "我的" }).click();
  await page.locator(".section-title .section-action").first().click();
  await expect(page.locator(".detail")).toContainText("Quality Song");
});

test("download manager deletes cached songs", async ({ page }) => {
  await page.route("**/api/flac/search**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        songs: [{
          id: "flac_777",
          name: "Delete Cache Song",
          artist: "Cache Artist",
          pic: "/assets/icon.png",
          cover: "/assets/icon.png",
          url: "/api/flac/stream/777?format=mp3&bitrate=320&time=t777&sign=s777",
          source: "flac",
          remotePlayable: true,
          verifiedPlayable: true,
          durationMs: 65000,
          br: 320000,
          level: "320k",
          type: "mp3",
          audioType: "mp3",
          quality: "320k",
          time: "t777",
          sign: "s777"
        }],
        page: 1,
        limit: 30,
        total: 1,
        hasMore: false
      })
    });
  });
  await page.route("**/api/flac/song/777**", async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        url: `/api/flac/stream/777?format=flac&bitrate=2000&time=${url.searchParams.get("time")}&sign=${url.searchParams.get("sign")}`,
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
  await page.route("**/api/flac/stream/777**", async (route) => {
    await route.fulfill({ path: fullSongFile, headers: { "content-type": "audio/wav" } });
  });
  page.on("dialog", (dialog) => void dialog.accept());

  await page.getByRole("navigation").getByRole("button").nth(1).click();
  await page.locator(".search-box input[name='keyword']").fill("Delete Cache Song");
  await page.keyboard.press("Enter");
  await expect(page.locator(".song-row", { hasText: "Delete Cache Song" })).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.locator(".song-row", { hasText: "Delete Cache Song" }).locator(".song-actions .icon-button").last().click();
  await downloadPromise;
  await expect.poll(() => page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw).downloadHistory?.length ?? 0 : 0;
  }, storageKey)).toBe(1);
  await expect.poll(() => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("jianyin-web-clean-audio", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
      const tx = db.transaction("files", "readonly");
      const request = tx.objectStore("files").getAllKeys();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return keys.some((key) => String(key).startsWith("download_flac_") && String(key).includes("777"));
  })).toBe(true);

  await page.getByRole("navigation").getByRole("button").nth(2).click();
  await page.locator(".section-title .section-action").first().click();
  const manager = page.locator(".detail");
  await expect(manager.locator(".song-row", { hasText: "Delete Cache Song" })).toHaveCount(1);
  await manager.locator(".song-row", { hasText: "Delete Cache Song" }).locator(".song-actions .danger").click();
  await expect(manager.locator(".song-row", { hasText: "Delete Cache Song" })).toHaveCount(0);
  await expect.poll(() => page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw).downloadHistory?.length ?? 0 : 0;
  }, storageKey)).toBe(0);
  await expect.poll(() => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("jianyin-web-clean-audio", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
      const tx = db.transaction("files", "readonly");
      const request = tx.objectStore("files").getAllKeys();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return keys.some((key) => String(key).startsWith("download_flac_") && String(key).includes("777"));
  })).toBe(false);
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

test("player queue can reorder songs and local lrc/cover persist", async ({ page }) => {
  await playFirstHomeSong(page);
  await page.locator(".now-playing").click();
  const player = page.locator(".player-sheet");
  await expect(player).toBeVisible();
  await player.locator(".more-menu > .icon-button").click();
  const lrcChooserPromise = page.waitForEvent("filechooser");
  await player.getByRole("button", { name: "选择 LRC 文件" }).click();
  const lrcChooser = await lrcChooserPromise;
  await lrcChooser.setFiles(lrcFile);
  await expect(player).toContainText("custom lrc line");

  await player.locator(".more-menu > .icon-button").click();
  const coverChooserPromise = page.waitForEvent("filechooser");
  await player.getByRole("button", { name: "选择封面" }).click();
  const coverChooser = await coverChooserPromise;
  await coverChooser.setFiles(coverFile);
  await expect.poll(() => player.locator(".album-stage img").evaluate((img: HTMLImageElement) => img.src.startsWith("blob:"))).toBe(true);

  await expect(player.locator(".queue-row")).toHaveCount(0);
  await player.locator(".control-row button").last().click();
  const queueDialog = page.locator(".queue-drawer");
  await expect(queueDialog).toBeVisible();
  const movedTitle = (await queueDialog.locator(".queue-row").nth(1).locator(".queue-hit strong").innerText()).trim();
  await queueDialog.locator(".queue-row").nth(1).locator(".queue-inline-actions button").nth(1).click();
  await expect(queueDialog.locator(".queue-row").first().locator(".queue-hit strong")).toHaveText(movedTitle);
  await queueDialog.locator(".queue-drawer-head button").click();
  await expect(queueDialog).toHaveCount(0);

  await page.reload();
  await expect(page.locator(".now-playing")).toContainText("周杰伦 本地试听");
  await page.locator(".now-playing").click();
  await expect(page.locator(".player-sheet")).toContainText("custom lrc line");
});

test("account panel validates and syncs netease and bili playlists without fake success", async ({ page }) => {
  await page.route("**/api/netease/account/login", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ loggedIn: true, nickname: "Netease User", userId: "123" }) });
  });
  await page.route("**/api/netease/account/playlists**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ playlists: [{ id: "netease_playlist_800", name: "Synced Netease", cover: "/assets/icon.png", source: "netease", songs: [{ id: "8001", name: "Synced Netease Song", artist: "Cloud Artist", pic: "/assets/icon.png", url: "/assets/full-song-65s.wav", durationMs: 65000, verifiedPlayable: true }] }] })
    });
  });
  await page.route("**/api/bili/account/login", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ loggedIn: true, nickname: "Bili User", userId: "456" }) });
  });
  await page.route("**/api/bili/account/playlists**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ playlists: [{ id: "bili_playlist_88", name: "Synced Bili", cover: "/assets/icon.png", source: "bili", songs: [{ id: "bili_BV1_123", name: "Synced Bili Song", artist: "UP", pic: "/assets/icon.png", url: "/assets/full-song-65s.wav", durationMs: 65000, verifiedPlayable: true, source: "bili", bvid: "BV1", cid: 123 }] }] })
    });
  });

  await page.getByRole("navigation").getByRole("button", { name: "我的" }).click();
  await page.getByRole("button", { name: "账号同步" }).click();
  const dialog = page.getByRole("dialog", { name: "账号管理" });
  await dialog.getByPlaceholder(/MUSIC_U/).fill("MUSIC_U=mock");
  await dialog.getByRole("button", { name: "验证并同步" }).click();
  await expect(page.getByRole("button", { name: "Synced Netease 1 首歌曲" })).toBeVisible();
  await page.getByRole("dialog", { name: "Synced Netease" }).getByRole("button", { name: "返回" }).click();

  await page.getByRole("button", { name: "账号同步" }).click();
  const biliDialog = page.getByRole("dialog", { name: "账号管理" });
  await biliDialog.getByRole("button", { name: "Bili", exact: true }).click();
  await biliDialog.getByPlaceholder(/SESSDATA/).fill("SESSDATA=mock; DedeUserID=456; bili_jct=csrf");
  await biliDialog.getByRole("button", { name: "验证并同步" }).click();
  await expect(page.getByRole("button", { name: "Synced Bili 1 首歌曲" })).toBeVisible();
});

test("account panel shows auth and sync errors without adding fake playlists", async ({ page }) => {
  let neteaseLoginMode = "invalid";
  let biliLoginMode = "invalid";
  await page.route("**/api/netease/account/login", async (route) => {
    if (neteaseLoginMode === "valid") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ loggedIn: true, nickname: "Netease User", userId: "123" }) });
      return;
    }
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: "netease_login_invalid", message: "网易云 Cookie 无法验证" })
    });
  });
  await page.route("**/api/netease/account/playlists**", async (route) => {
    await route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: "netease_sync_failed", message: "网易云同步失败 mock" })
    });
  });
  await page.route("**/api/bili/account/login", async (route) => {
    if (biliLoginMode === "valid") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ loggedIn: true, nickname: "Bili User", userId: "456" }) });
      return;
    }
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      body: JSON.stringify({ error: "bili_login_invalid", message: "Bili Cookie 无法验证" })
    });
  });
  await page.route("**/api/bili/account/playlists**", async (route) => {
    await route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: "bili_sync_failed", message: "Bili 收藏夹同步失败 mock" })
    });
  });

  await page.getByRole("navigation").getByRole("button", { name: "我的" }).click();
  const startingCount = await page.locator(".playlist-row").count();
  await page.getByRole("button", { name: "账号同步" }).click();
  const dialog = page.getByRole("dialog", { name: "账号管理" });
  await dialog.getByPlaceholder(/MUSIC_U/).fill("MUSIC_U=fake");
  await dialog.getByRole("button", { name: "验证并同步" }).click();
  await expect(dialog).toContainText("网易云 Cookie 无法验证");
  await expect(page.locator(".playlist-row")).toHaveCount(startingCount);
  await expect(page.getByText("Invalid Netease")).toHaveCount(0);

  neteaseLoginMode = "valid";
  await dialog.getByPlaceholder(/MUSIC_U/).fill("MUSIC_U=mock-valid");
  await dialog.getByRole("button", { name: "验证并同步" }).click();
  await expect(dialog).toContainText("网易云同步失败 mock");
  await expect(page.locator(".playlist-row")).toHaveCount(startingCount);
  await expect(page.getByRole("button", { name: /Synced Netease/ })).toHaveCount(0);

  await dialog.getByRole("button", { name: "Bili", exact: true }).click();
  await dialog.getByPlaceholder(/SESSDATA/).fill("SESSDATA=fake; DedeUserID=456");
  await dialog.getByRole("button", { name: "验证并同步" }).click();
  await expect(dialog).toContainText("Bili Cookie 无法验证");
  await expect(page.locator(".playlist-row")).toHaveCount(startingCount);

  biliLoginMode = "valid";
  await dialog.getByPlaceholder(/SESSDATA/).fill("SESSDATA=mock-valid; DedeUserID=456; bili_jct=csrf");
  await dialog.getByRole("button", { name: "验证并同步" }).click();
  await expect(dialog).toContainText("Bili 收藏夹同步失败 mock");
  await expect(page.locator(".playlist-row")).toHaveCount(startingCount);
  await expect(page.getByRole("button", { name: /Synced Bili/ })).toHaveCount(0);
});

test("account errors and local storage do not expose credential material", async ({ page }) => {
  await page.route("**/api/netease/account/login", async (route) => {
    await route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: "netease_login_failed", message: "upstream [redacted]" })
    });
  });

  await page.getByRole("navigation").getByRole("button", { name: "我的" }).click();
  await page.getByRole("button", { name: "账号同步" }).click();
  const dialog = page.getByRole("dialog", { name: "账号管理" });
  await dialog.getByPlaceholder(/MUSIC_U/).fill("MUSIC_U=secret-token");
  await dialog.getByRole("button", { name: "验证并同步" }).click();
  await expect(dialog).toContainText("[redacted]");
  await expect(dialog).not.toContainText("secret-token");
  await expect(dialog.getByPlaceholder(/MUSIC_U/)).toHaveValue("");

  const local = await page.evaluate((key) => localStorage.getItem(key) ?? "", storageKey);
  expect(local).not.toMatch(/MUSIC_U|secret-token|SESSDATA|bili_jct|cookie|token|credential/i);
});

test("account panel logout removes bili synced playlists and disables resync", async ({ page }) => {
  await page.route("**/api/bili/account/login", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ loggedIn: true, nickname: "Bili User", userId: "456" }) });
  });
  await page.route("**/api/bili/account/playlists**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ playlists: [{ id: "bili_playlist_88", name: "Synced Bili Logout", cover: "/assets/icon.png", source: "bili", songs: [{ id: "bili_BV1_123", name: "Synced Bili Song", artist: "UP", pic: "/assets/icon.png", url: "/assets/full-song-65s.wav", durationMs: 65000, verifiedPlayable: true, source: "bili", bvid: "BV1", cid: 123 }] }] })
    });
  });
  await page.route("**/api/bili/account/logout", async (route) => {
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ loggedIn: false }) });
  });

  await page.getByRole("navigation").getByRole("button", { name: "我的" }).click();
  await page.getByRole("button", { name: "账号同步" }).click();
  let dialog = page.getByRole("dialog", { name: "账号管理" });
  await dialog.getByRole("button", { name: "Bili", exact: true }).click();
  await dialog.getByPlaceholder(/SESSDATA/).fill("SESSDATA=mock; DedeUserID=456; bili_jct=csrf");
  await dialog.getByRole("button", { name: "验证并同步" }).click();
  await expect(page.getByRole("button", { name: "Synced Bili Logout 1 首歌曲" })).toBeVisible();
  await page.getByRole("dialog", { name: "Synced Bili Logout" }).getByRole("button", { name: "返回" }).click();

  await page.getByRole("button", { name: "账号同步" }).click();
  dialog = page.getByRole("dialog", { name: "账号管理" });
  await dialog.getByRole("button", { name: "退出 Bili" }).click();
  await expect(page.getByRole("button", { name: "Synced Bili Logout 1 首歌曲" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "同步 Bili 收藏夹" })).toBeDisabled();
  await expect(dialog).toContainText("未登录");
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
