import { expect, test } from "playwright/test";
import { fs, storageKey, projectRoot, toneFile, coverFile, fullSongFile, lrcFile, testSongs, testState, mockHome, reset, expectAudioPlaying, expectAudioPaused, expectAudioLongerThan, expectReadableToast, playFirstHomeSong, openPlayer, importLocalTone, openSettings, storedState, songNamesIn } from "../helpers/app-fixture";

test.beforeEach(async ({ page }) => {
  await reset(page);
});

test("settings modal changes persist after reload", async ({ page }) => {
  let dialog = await openSettings(page);
  await dialog.getByLabel("播放音质").selectOption("lossless");
  await dialog.getByLabel("下载音质").selectOption("lossless");
  await dialog.getByLabel("歌词来源").selectOption("embedded");
  await dialog.getByLabel("主题").selectOption("dark");
  await dialog.getByLabel("自动获取歌词").setChecked(false);
  await dialog.getByLabel("歌曲淡入淡出").setChecked(true);
  await dialog.getByLabel("自动缓存").setChecked(true);
  await dialog.getByLabel("离开后保留列表").setChecked(true);
  await dialog.getByLabel("启动时播放").setChecked(true);
  await dialog.getByLabel("显示既见状态栏通知").setChecked(true);

  await expect.poll(async () => {
    const state = await storedState(page);
    return {
      playQuality: state.playQuality,
      downloadQuality: state.downloadQuality,
      lyricSource: state.lyricSource,
      theme: state.theme,
      autoLyricsEnabled: state.autoLyricsEnabled,
      fadeEnabled: state.fadeEnabled,
      autoCacheEnabled: state.autoCacheEnabled,
      keepQueueOnExit: state.keepQueueOnExit,
      autoPlayOnStart: state.autoPlayOnStart,
      autoUpdateEnabled: state.autoUpdateEnabled,
      androidStatusNotificationEnabled: state.androidStatusNotificationEnabled
    };
  }).toEqual({
    playQuality: "lossless",
    downloadQuality: "lossless",
    lyricSource: "embedded",
    theme: "dark",
    autoLyricsEnabled: false,
    fadeEnabled: true,
    autoCacheEnabled: true,
    keepQueueOnExit: true,
    autoPlayOnStart: true,
    autoUpdateEnabled: false,
    androidStatusNotificationEnabled: true
  });
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");

  await page.reload();
  dialog = await openSettings(page);
  await expect(dialog.getByLabel("播放音质")).toHaveValue("lossless");
  await expect(dialog.getByLabel("下载音质")).toHaveValue("lossless");
  await expect(dialog.getByLabel("歌词来源")).toHaveValue("embedded");
  await expect(dialog.getByLabel("主题")).toHaveValue("dark");
  await expect(dialog.getByLabel("自动获取歌词")).not.toBeChecked();
  await expect(dialog.getByLabel("歌曲淡入淡出")).toBeChecked();
  await expect(dialog.getByLabel("自动缓存")).toBeChecked();
  await expect(dialog.getByLabel("离开后保留列表")).toBeChecked();
  await expect(dialog.getByLabel("启动时播放")).toBeChecked();
  await expect(dialog.getByLabel("自动检查更新")).not.toBeChecked();
  await expect(dialog.getByLabel("显示既见状态栏通知")).toBeChecked();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
});

test("automatic update checks only run after the switch is enabled", async ({ page }) => {
  let updateCalls = 0;
  await page.route("**/api/update/latest", async (route) => {
    updateCalls += 1;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        currentVersion: "1.0.20",
        latestVersion: "1.0.22",
        tag: "v1.0.22",
        available: true,
        releaseUrl: "https://github.com/randerous/jianyin-web-clean-public/releases/tag/v1.0.22",
        publishedAt: null,
        notes: "",
        releaseNotes: [
          { version: "1.0.21", tag: "v1.0.21", publishedAt: null, notes: "修复播放恢复" },
          { version: "1.0.22", tag: "v1.0.22", publishedAt: null, notes: "新增自动更新说明" }
        ],
        canApply: false,
        assets: { apk: null, windowsLauncher: null }
      })
    });
  });
  const settings = await openSettings(page);
  await page.waitForTimeout(300);
  expect(updateCalls).toBe(0);
  await settings.getByLabel("自动检查更新").setChecked(true);
  await expect.poll(() => updateCalls).toBe(1);
  await expect(settings).toContainText("发现 v1.0.22");
  await expect(settings.getByRole("region", { name: "更新说明" })).toContainText("v1.0.21");
  await expect(settings.getByRole("region", { name: "更新说明" })).toContainText("修复播放恢复");
  await expect(settings.getByRole("region", { name: "更新说明" })).toContainText("v1.0.22");
  await expect(settings.getByRole("region", { name: "更新说明" })).toContainText("新增自动更新说明");
  await expect.poll(async () => (await storedState(page)).autoUpdateEnabled).toBe(true);

  await page.reload();
  const reloadedSettings = await openSettings(page);
  await expect(reloadedSettings.getByLabel("自动检查更新")).toBeChecked();
});

test("verified Android update is installed only after an explicit user action", async ({ page }) => {
  const expectedSha256 = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  await page.addInitScript((sha256) => {
    (window as Window & { __updateCalls?: unknown[] }).__updateCalls = [];
    window.JianyinAndroid = {
      downloadAndInstallUpdate: (...args: unknown[]) => {
        (window as Window & { __updateCalls?: unknown[] }).__updateCalls?.push(args);
      }
    };
  }, expectedSha256);
  await page.route("**/api/update/latest", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        currentVersion: "1.0.20",
        latestVersion: "1.0.22",
        tag: "v1.0.22",
        available: true,
        releaseUrl: "https://github.com/randerous/jianyin-web-clean-public/releases/tag/v1.0.22",
        publishedAt: null,
        notes: "",
        releaseNotes: [
          { version: "1.0.21", tag: "v1.0.21", publishedAt: null, notes: "修复播放恢复" },
          { version: "1.0.22", tag: "v1.0.22", publishedAt: null, notes: "新增自动更新说明" }
        ],
        canApply: false,
        assets: {
          apk: {
            name: "app-release.apk",
            url: "https://github.com/randerous/jianyin-web-clean-public/releases/download/v1.0.22/app-release.apk",
            sha256: expectedSha256,
            size: 1
          },
          windowsLauncher: null
        }
      })
    });
  });
  await page.reload();
  const settings = await openSettings(page);
  await settings.getByLabel("自动检查更新").setChecked(true);
  await expect(settings).toContainText("发现 v1.0.22");
  await expect.poll(() => page.evaluate(() => (window as Window & { __updateCalls?: unknown[] }).__updateCalls?.length ?? 0)).toBe(0);
  await settings.getByRole("button", { name: "下载并安装 APK" }).click();
  await expect.poll(() => page.evaluate(() => (window as Window & { __updateCalls?: unknown[] }).__updateCalls?.length ?? 0)).toBe(1);
  expect(await page.evaluate(() => (window as Window & { __updateCalls?: unknown[] }).__updateCalls?.[0])).toEqual([
    "https://github.com/randerous/jianyin-web-clean-public/releases/download/v1.0.22/app-release.apk",
    "app-release.apk",
    expectedSha256,
    "v1.0.22"
  ]);
});

test("desktop update is applied only after the explicit update button is pressed", async ({ page }) => {
  let applyCalls = 0;
  await page.route("**/api/update/latest", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        currentVersion: "1.0.20",
        latestVersion: "1.0.22",
        tag: "v1.0.22",
        available: true,
        releaseUrl: "https://github.com/randerous/jianyin-web-clean-public/releases/tag/v1.0.22",
        publishedAt: null,
        notes: "桌面更新",
        releaseNotes: [],
        canApply: true,
        assets: { apk: null, windowsLauncher: null }
      })
    });
  });
  await page.route("**/api/update/apply", async (route) => {
    applyCalls += 1;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, updated: false, message: "测试更新" }) });
  });

  const settings = await openSettings(page);
  await settings.getByLabel("自动检查更新").setChecked(true);
  await expect(settings).toContainText("发现 v1.0.22");
  expect(applyCalls).toBe(0);
  await settings.getByRole("button", { name: "更新桌面版" }).click();
  await expect.poll(() => applyCalls).toBe(1);
});

test("lyric source honors embedded priority and network priority", async ({ page }) => {
  let lyricCalls = 0;
  const remoteSong = {
    ...testSongs[0],
    id: "netease_lyrics_priority",
    name: "Lyrics Priority Song",
    artist: "Lyrics Artist",
    source: "netease",
    remotePlayable: true,
    lrc: "[00:00.00]embedded lyrics"
  };
  const state = {
    ...testState(),
    queue: [remoteSong],
    queueIndex: 0,
    lyricSource: "embedded",
    autoLyricsEnabled: false
  };
  await page.route("**/api/lyrics**", async (route) => {
    lyricCalls += 1;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ lrc: "[00:00.00]network lyrics" }) });
  });
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

  const settings = await openSettings(page);
  await settings.getByLabel("歌词来源").selectOption("embedded");
  await settings.getByLabel("自动获取歌词").setChecked(true);
  await page.waitForTimeout(300);
  expect(lyricCalls).toBe(0);
  await settings.getByLabel("歌词来源").selectOption("network");
  await expect.poll(() => lyricCalls).toBe(1);
  await expect.poll(async () => (await storedState(page)).queue[0].lrc).toBe("[00:00.00]network lyrics");
});

test("enabled fade animates volume while switching active songs", async ({ page }) => {
  const fadeSongs = [
    { ...testSongs[0], id: "fade_first", name: "Fade First", url: "/assets/full-song-65s.wav" },
    { ...testSongs[1], id: "fade_second", name: "Fade Second", url: "/assets/demo-tone.wav" }
  ];
  const state = {
    ...testState(),
    playlists: [
      { id: "favorites", name: "我喜欢的音乐", cover: "/assets/icon.png", songs: [], source: "local" },
      { id: "fade_playlist", name: "Fade Playlist", cover: "/assets/icon.png", songs: fadeSongs, source: "local" }
    ],
    fadeEnabled: true,
    autoLyricsEnabled: false,
    updatedAt: Date.now() + 1_000_000
  };
  const stateScript = await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: storageKey, value: state });
  await page.reload();
  await stateScript.dispose();
  await page.getByRole("navigation").getByRole("button", { name: "我的" }).click();
  await page.getByRole("button", { name: "Fade Playlist 2 首歌曲" }).click();
  const playlist = page.getByRole("dialog", { name: "Fade Playlist" });
  await playlist.getByRole("button", { name: "Fade First 测试曲库 · 本地" }).click();
  await expectAudioPlaying(page);
  await page.locator("audio").evaluate((audio: HTMLAudioElement) => {
    (window as Window & { __fadeVolumes?: number[] }).__fadeVolumes = [];
    audio.addEventListener("volumechange", () => (window as Window & { __fadeVolumes?: number[] }).__fadeVolumes?.push(audio.volume));
  });

  await playlist.getByRole("button", { name: "Fade Second 测试曲库 · 本地" }).click();
  await expect.poll(() => page.evaluate(() => (window as Window & { __fadeVolumes?: number[] }).__fadeVolumes ?? [])).toEqual(expect.arrayContaining([expect.any(Number)]));
  await expect.poll(() => page.evaluate(() => ((window as Window & { __fadeVolumes?: number[] }).__fadeVolumes ?? []).some((value) => value < 0.99))).toBe(true);
  await expectAudioPlaying(page);
  await expect.poll(() => page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.volume)).toBe(1);
});

test("legacy custom backend settings are discarded and cannot receive API traffic", async ({ page }) => {
  const legacyBase = "http://192.168.1.10:5188";
  const legacyRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().startsWith(legacyBase)) legacyRequests.push(request.url());
  });
  await page.evaluate((value) => localStorage.setItem("jianyin_api_base_url", value), legacyBase);
  await page.reload();

  await expect.poll(() => page.evaluate(() => localStorage.getItem("jianyin_api_base_url"))).toBeNull();
  expect(legacyRequests).toEqual([]);
  const settings = await openSettings(page);
  await expect(settings.getByLabel("API backend URL")).toHaveCount(0);
});

test("settings download quality is used for netease downloads", async ({ page }) => {
  const songRequests: string[] = [];
  let dialog = await openSettings(page);
  await dialog.getByLabel("下载音质").selectOption("lossless");
  await dialog.getByRole("button", { name: "关闭" }).click();

  await page.route(/\/api\/netease\/playlist\/3778678.*/, async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        playlist: {
          id: "netease_playlist_3778678",
          name: "Download Quality Playlist",
          cover: "/assets/icon.png",
          source: "netease",
          songs: [{
            id: "321",
            name: "Download Quality Song",
            artist: "Quality Artist",
            pic: "/assets/icon.png",
            source: "netease",
            remotePlayable: true,
            verifiedPlayable: false
          }]
        }
      })
    });
  });
  await page.route("**/api/netease/song/321**", async (route) => {
    songRequests.push(new URL(route.request().url()).searchParams.toString());
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        url: "/assets/full-song-65s.wav",
        durationMs: 65000,
        verifiedPlayable: true,
        br: 999000,
        level: "lossless",
        type: "flac",
        audioType: "flac",
        quality: "lossless"
      })
    });
  });

  await page.getByRole("navigation").getByRole("button", { name: "首页" }).click();
  await page.getByRole("button", { name: /Home Playlist/ }).click();
  dialog = page.getByRole("dialog", { name: "Download Quality Playlist" });
  await expect(dialog).toContainText("Download Quality Song");
  const downloadPromise = page.waitForEvent("download");
  await dialog.locator(".song-row", { hasText: "Download Quality Song" }).getByRole("button", { name: "下载" }).click();
  await downloadPromise;

  expect(songRequests).toContain("quality=lossless");
});

test("automatic cache stores a playing remote song without interrupting playback", async ({ page }) => {
  const remoteSong = {
    id: "flac_9001",
    name: "Automatic Cache Song",
    artist: "Cache Artist",
    pic: "/assets/icon.png",
    cover: "/assets/icon.png",
    url: "/api/flac/stream/9001?format=flac&bitrate=2000&time=t9001&sign=s9001",
    source: "flac",
    remotePlayable: true,
    verifiedPlayable: true,
    durationMs: 65000,
    br: 2000000,
    level: "flac",
    type: "flac",
    audioType: "flac",
    quality: "flac",
    time: "t9001",
    sign: "s9001"
  };
  await page.route("**/api/netease/home**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ radarSongs: [remoteSong], hotSongs: [], recommendedPlaylists: [] })
    });
  });
  await page.route("**/api/flac/stream/9001**", async (route) => {
    await route.fulfill({ path: fullSongFile, headers: { "content-type": "audio/wav" } });
  });

  const settings = await openSettings(page);
  await settings.getByLabel("自动缓存").setChecked(true);
  await settings.getByRole("button", { name: "关闭" }).click();
  await page.reload();
  await page.getByRole("main").getByRole("button", { name: /Automatic Cache Song/ }).click();
  await expectAudioPlaying(page);

  const before = await page.locator("audio").evaluate((audio: HTMLAudioElement) => ({ src: audio.src, currentTime: audio.currentTime }));
  await expect.poll(() => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("jianyin-web-clean-audio", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (!db.objectStoreNames.contains("files")) {
      db.close();
      return false;
    }
    const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
      const tx = db.transaction("files", "readonly");
      const request = tx.objectStore("files").getAllKeys();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return keys.includes("download_flac_flac_9001");
  })).toBe(true);
  await expect.poll(async () => {
    const state = await storedState(page);
    return state.downloadHistory.some((song: { id: string; localKey?: string }) => song.id === "flac_9001" && song.localKey === "download_flac_flac_9001");
  }).toBe(true);
  await expect.poll(() => page.locator("audio").evaluate((audio: HTMLAudioElement) => ({ src: audio.src, paused: audio.paused, currentTime: audio.currentTime }))).toMatchObject({ src: before.src, paused: false });
  await expect.poll(() => page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThan(before.currentTime);
});

test("startup autoplay attempts to resume the persisted queue when enabled", async ({ page }) => {
  const state = await storedState(page);
  const song = { ...testSongs[0], id: "startup_autoplay_song", name: "Startup Autoplay Song", remotePlayable: true };
  const persisted = { ...state, queue: [song], queueIndex: 0, autoPlayOnStart: true, keepQueueOnExit: true, updatedAt: (state.updatedAt ?? Date.now()) + 1_000_000 };
  const stateScript = await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: storageKey, value: persisted });
  await page.route(/\/api\/state$/, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ state: persisted }) });
      return;
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  await page.reload();
  await stateScript.dispose();
  await expect(page.locator(".now-playing")).toContainText("Startup Autoplay Song");
  await expect.poll(() => page.evaluate(() => {
    const audio = document.querySelector("audio") as HTMLAudioElement | null;
    return Boolean(audio && !audio.paused) || Boolean(document.querySelector(".toast")?.textContent?.includes("浏览器阻止了自动播放"));
  })).toBe(true);
});

test("rapid settings changes persist locally without saving shared playlists", async ({ page }) => {
  await expect(page.getByRole("button", { name: "刷新推荐" })).toBeEnabled();
  await page.waitForLoadState("networkidle");

  const sharedWrites: Array<Record<string, unknown>> = [];
  let captureWrites = false;
  page.on("request", (request) => {
    if (!captureWrites || request.method() !== "POST" || new URL(request.url()).pathname !== "/api/state") return;
    sharedWrites.push(request.postDataJSON());
  });

  const dialog = await openSettings(page);
  captureWrites = true;
  await dialog.getByLabel("播放音质").selectOption("lossless");
  await dialog.getByLabel("下载音质").selectOption("standard");
  await dialog.getByLabel("歌词来源").selectOption("embedded");
  await dialog.getByLabel("主题").selectOption("dark");

  await expect.poll(async () => {
    const state = await storedState(page);
    return {
      playQuality: state.playQuality,
      downloadQuality: state.downloadQuality,
      lyricSource: state.lyricSource,
      theme: state.theme
    };
  }).toEqual({
    playQuality: "lossless",
    downloadQuality: "standard",
    lyricSource: "embedded",
    theme: "dark"
  });
  await page.waitForTimeout(400);
  expect(sharedWrites).toHaveLength(0);
});

test("playing a local song does not save shared state", async ({ page }) => {
  await expect(page.getByRole("button", { name: "刷新推荐" })).toBeEnabled();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);

  const sharedSaves: Record<string, unknown>[] = [];
  await page.route(/\/api\/state$/, async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    sharedSaves.push(route.request().postDataJSON());
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });

  await playFirstHomeSong(page);
  await expectAudioPlaying(page);
  await page.waitForTimeout(350);

  expect(sharedSaves).toHaveLength(0);
});

test("a failed shared save does not interrupt local playback", async ({ page }) => {
  await expect(page.getByRole("button", { name: "刷新推荐" })).toBeEnabled();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);

  const sharedWrites: Array<Record<string, any>> = [];
  await page.route(/\/api\/state$/, async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    sharedWrites.push(route.request().postDataJSON());
    await route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "state_write_failed", message: "测试磁盘写入失败" })
    });
  });

  await playFirstHomeSong(page);
  await expectAudioPlaying(page);
  const before = await page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.currentTime);
  await page.getByRole("navigation").getByRole("button", { name: "我的" }).click();
  await page.getByRole("button", { name: "创建歌单" }).click();
  await page.getByRole("dialog", { name: "创建新歌单" }).getByPlaceholder("歌单名称").fill("保存失败测试歌单");
  await page.getByRole("dialog", { name: "创建新歌单" }).getByRole("button", { name: "创建" }).click();

  await expect.poll(() => sharedWrites.length).toBe(1);
  await expectReadableToast(page, "共享歌单保存失败：测试磁盘写入失败");
  await expectAudioPlaying(page);
  await expect.poll(() => page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThan(before);
  expect(Object.keys(sharedWrites[0].state).sort()).toEqual(["favorites", "playlists", "revision", "schemaVersion", "tombstones", "updatedAt"]);
  expect(sharedWrites[0].state).not.toHaveProperty("queue");
  expect(sharedWrites[0].state).not.toHaveProperty("history");
});

test("shared playlist writes stay single-flight and keep only the latest pending library", async ({ page }) => {
  await expect(page.getByRole("button", { name: "刷新推荐" })).toBeEnabled();
  await page.waitForLoadState("networkidle");

  const sharedWrites: Array<Record<string, any>> = [];
  let activeWrites = 0;
  let maxActiveWrites = 0;
  let releaseFirstWrite: () => void = () => {};
  const firstWriteGate = new Promise<void>((resolve) => { releaseFirstWrite = resolve; });
  await page.route(/\/api\/state$/, async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    activeWrites += 1;
    maxActiveWrites = Math.max(maxActiveWrites, activeWrites);
    sharedWrites.push(route.request().postDataJSON());
    if (sharedWrites.length === 1) await firstWriteGate;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true }) }).catch(() => {});
    activeWrites -= 1;
  });

  await page.getByRole("navigation").getByRole("button", { name: "我的" }).click();
  await page.getByRole("button", { name: "创建歌单" }).click();
  await page.getByRole("dialog", { name: "创建新歌单" }).getByPlaceholder("歌单名称").fill("共享歌单一");
  await page.getByRole("dialog", { name: "创建新歌单" }).getByRole("button", { name: "创建" }).click();
  await expect.poll(() => sharedWrites.length).toBe(1);
  await page.getByRole("dialog", { name: "共享歌单一" }).getByRole("button", { name: "返回" }).click();
  await page.getByRole("button", { name: "创建歌单" }).click();
  await page.getByRole("dialog", { name: "创建新歌单" }).getByPlaceholder("歌单名称").fill("共享歌单二");
  await page.getByRole("dialog", { name: "创建新歌单" }).getByRole("button", { name: "创建" }).click();

  try {
    await page.waitForTimeout(100);
    expect(sharedWrites).toHaveLength(1);
    expect(maxActiveWrites).toBe(1);
  } finally {
    releaseFirstWrite();
  }

  await expect.poll(() => sharedWrites.length).toBe(2);
  expect(maxActiveWrites).toBe(1);
  expect(JSON.stringify(sharedWrites[1])).toContain("共享歌单一");
  expect(JSON.stringify(sharedWrites[1])).toContain("共享歌单二");
  expect(Object.keys(sharedWrites[1].state).sort()).toEqual(["favorites", "playlists", "revision", "schemaVersion", "tombstones", "updatedAt"]);
});

test("pagehide does not save local settings or playback data as shared playlists", async ({ page }) => {
  await expect(page.getByRole("button", { name: "刷新推荐" })).toBeEnabled();
  await page.waitForLoadState("networkidle");

  const sharedWrites: Array<Record<string, any>> = [];
  await page.route(/\/api\/state$/, async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    sharedWrites.push(route.request().postDataJSON());
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });

  const settings = await openSettings(page);
  await settings.getByLabel("主题").selectOption("dark");
  await expect.poll(async () => (await storedState(page)).theme).toBe("dark");
  await settings.getByRole("button", { name: "关闭" }).click();
  await playFirstHomeSong(page);
  await expectAudioPlaying(page);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false })));
  await page.waitForTimeout(250);
  expect(sharedWrites).toHaveLength(0);
});

test("pagehide does not duplicate the same dirty playlist write already in flight", async ({ page }) => {
  await page.waitForLoadState("networkidle");
  const sharedWrites: Array<Record<string, any>> = [];
  let releaseFirstWrite: () => void = () => {};
  const firstWriteGate = new Promise<void>((resolve) => { releaseFirstWrite = resolve; });
  await page.route(/\/api\/state$/, async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    sharedWrites.push(route.request().postDataJSON());
    if (sharedWrites.length === 1) await firstWriteGate;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true }) }).catch(() => {});
  });

  await page.getByRole("navigation").getByRole("button", { name: "我的" }).click();
  await page.getByRole("button", { name: "创建歌单" }).click();
  await page.getByRole("dialog", { name: "创建新歌单" }).getByPlaceholder("歌单名称").fill("后台刷写歌单");
  await page.getByRole("dialog", { name: "创建新歌单" }).getByRole("button", { name: "创建" }).click();
  await expect.poll(() => sharedWrites.length).toBe(1);
  try {
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false })));
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false })));
    await page.waitForTimeout(100);
    expect(sharedWrites).toHaveLength(1);
    expect(JSON.stringify(sharedWrites[0])).toContain("后台刷写歌单");
    expect(Object.keys(sharedWrites[0].state).sort()).toEqual(["favorites", "playlists", "revision", "schemaVersion", "tombstones", "updatedAt"]);
  } finally {
    releaseFirstWrite();
  }
});

test("a failed shared playlist deletion stays pending and survives reload", async ({ page }) => {
  let rejectWrites = true;
  const sharedWrites: Array<Record<string, any>> = [];
  page.on("dialog", (dialog) => void dialog.accept());
  await page.route(/\/api\/state$/, async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    sharedWrites.push(route.request().postDataJSON());
    if (rejectWrites) {
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "测试写入失败" }) });
      return;
    }
    await route.fallback();
  });

  await page.getByRole("navigation").getByRole("button", { name: "我的" }).click();
  const row = page.locator(".playlist-row", { hasText: "热歌推荐" });
  await row.getByRole("button", { name: "删除歌单" }).click();
  await expect(row).toHaveCount(0);
  await expectReadableToast(page, "共享歌单保存失败：测试写入失败");
  await expect.poll(async () => Boolean((await storedState(page)).sharedSyncPending)).toBe(true);

  await page.reload();
  await page.getByRole("navigation").getByRole("button", { name: "我的" }).click();
  await expect(page.getByRole("button", { name: /热歌推荐/ })).toHaveCount(0);
  await expect.poll(async () => Boolean((await storedState(page)).sharedSyncPending)).toBe(true);
  rejectWrites = false;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(() => sharedWrites.length).toBeGreaterThanOrEqual(2);
  await expect.poll(async () => Boolean((await storedState(page)).sharedSyncPending)).toBe(false);
  await expect.poll(async () => {
    const response = await page.request.get("/api/state");
    const body = await response.json();
    return body.state.playlists.some((playlist: { id: string }) => playlist.id === "test_hot");
  }).toBe(false);
});

test("an intentional favorite re-add survives a stale tombstone conflict and reload", async ({ page }) => {
  const favoriteSong = {
    ...testSongs[0],
    id: "netease_readd_conflict",
    name: "Re-add Conflict Song",
    artist: "Conflict Artist",
    source: "netease",
    remotePlayable: true
  };
  const initialState = {
    ...testState(),
    playlists: [
      { id: "favorites", name: "我喜欢的音乐", cover: "/assets/icon.png", songs: [favoriteSong], source: "local" },
      { id: "readd_conflict", name: "Re-add Conflict Playlist", cover: "/assets/icon.png", songs: [favoriteSong], source: "local" }
    ],
    favorites: [favoriteSong],
    sharedSyncPending: false,
    sharedRevision: 10,
    sharedTombstones: { playlistIds: [], favorites: [], playlistSongs: {} },
    sharedTombstoneClears: { playlistIds: [], favorites: [], playlistSongs: {} },
    updatedAt: 100
  };
  let serverState: Record<string, any> = {
    ...initialState,
    schemaVersion: 2,
    revision: 10,
    tombstones: { playlistIds: [], favorites: [], playlistSongs: {} }
  };
  const sharedWrites: Array<Record<string, any>> = [];
  let deletedFavoriteTombstone = "";
  let captureWrites = false;
  let conflictReturned = false;
  let retryFailed = false;
  let allowRetrySuccess = false;
  await page.route(/\/api\/state$/, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ state: serverState }) });
      return;
    }
    const payload = route.request().postDataJSON();
    if (!captureWrites) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({ ok: true, state: { ...payload.state, revision: 10, lastWriteId: payload.writeId } })
      });
      return;
    }
    sharedWrites.push(payload);
    const includesFavorite = payload.state.favorites.some((song: { id: string }) => song.id === favoriteSong.id);
    if (!includesFavorite && !conflictReturned) {
      deletedFavoriteTombstone = payload.state.tombstones.favorites[0] ?? "";
      serverState = { ...payload.state, revision: 11, lastWriteId: payload.writeId };
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, state: serverState }) });
      return;
    }
    if (includesFavorite && !conflictReturned) {
      conflictReturned = true;
      const concurrentSong = { ...favoriteSong, id: "netease_concurrent_addition", name: "Concurrent Addition Song" };
      serverState = {
        ...serverState,
        revision: 12,
        updatedAt: Math.max(Number(serverState.updatedAt) || 0, Date.now()),
        playlists: [
          ...serverState.playlists,
          { id: "concurrent_addition", name: "Concurrent Addition Playlist", cover: "/assets/icon.png", songs: [concurrentSong], source: "local" }
        ]
      };
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({ message: "concurrent shared update", state: serverState })
      });
      return;
    }
    if (conflictReturned && !retryFailed) {
      retryFailed = true;
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "retry after reload" }) });
      return;
    }
    if (!allowRetrySuccess) {
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "waiting for reload" }) });
      return;
    }
    serverState = { ...payload.state, revision: 13, lastWriteId: payload.writeId };
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, state: serverState }) });
  });
  const stateScript = await page.addInitScript(({ key, value }) => {
    localStorage.setItem(key, JSON.stringify(value));
  }, { key: storageKey, value: initialState });
  await page.reload();
  await stateScript.dispose();

  await page.getByRole("navigation").getByRole("button", { name: "我的" }).click();
  await page.getByRole("button", { name: /Re-add Conflict Playlist/ }).click();
  const dialog = page.getByRole("dialog", { name: "Re-add Conflict Playlist" });
  const row = dialog.locator(".song-row", { hasText: "Re-add Conflict Song" });
  await page.waitForTimeout(200);
  captureWrites = true;
  await row.getByRole("button", { name: "取消喜欢" }).click();
  await expect.poll(() => deletedFavoriteTombstone).not.toBe("");

  await row.getByRole("button", { name: "添加到喜欢" }).click();
  await expect.poll(() => ({ conflictReturned, retryFailed })).toEqual({ conflictReturned: true, retryFailed: true });
  await expect(row.getByRole("button", { name: "取消喜欢" })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => {
    const state = await storedState(page);
    return {
      favoritePresent: state.favorites.some((song: { id: string }) => song.id === favoriteSong.id),
      clearPersisted: state.sharedTombstoneClears?.favorites?.includes(deletedFavoriteTombstone) ?? false,
      pending: Boolean(state.sharedSyncPending)
    };
  }).toEqual({ favoritePresent: true, clearPersisted: true, pending: true });
  const readdWrite = sharedWrites.find((write) => write.state.favorites.some((song: { id: string }) => song.id === favoriteSong.id));
  if (!readdWrite) throw new Error("Expected an intentional re-add shared write");
  expect(readdWrite.state).not.toHaveProperty("sharedTombstoneClears");

  allowRetrySuccess = true;
  await page.reload();
  await page.getByRole("navigation").getByRole("button", { name: "我的" }).click();
  await expect(page.getByRole("button", { name: /Concurrent Addition Playlist/ })).toBeVisible();
  await page.getByRole("button", { name: /Re-add Conflict Playlist/ }).click();
  const reloadedRow = page.getByRole("dialog", { name: "Re-add Conflict Playlist" }).locator(".song-row", { hasText: "Re-add Conflict Song" });
  await expect(reloadedRow.getByRole("button", { name: "取消喜欢" })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => {
    const state = await storedState(page);
    return {
      pending: Boolean(state.sharedSyncPending),
      clears: state.sharedTombstoneClears,
      favoritePresent: state.favorites.some((song: { id: string }) => song.id === favoriteSong.id)
    };
  }).toEqual({
    pending: false,
    clears: { playlistIds: [], favorites: [], playlistSongs: {} },
    favoritePresent: true
  });
  const successfulRetry = sharedWrites.at(-1);
  if (!successfulRetry) throw new Error("Expected a successful post-reload shared retry");
  expect(successfulRetry.state.favorites.some((song: { id: string }) => song.id === favoriteSong.id)).toBe(true);
  expect(successfulRetry.state.playlists.some((playlist: { name: string }) => playlist.name === "Concurrent Addition Playlist")).toBe(true);
  expect(successfulRetry.state.tombstones.favorites).not.toContain(deletedFavoriteTombstone);
  expect(successfulRetry.state).not.toHaveProperty("sharedTombstoneClears");
});

test("a stale browser cannot resurrect a deleted playlist while adding another", async ({ page, browser }) => {
  const stale = await browser.newContext();
  const stalePage = await stale.newPage();
  await mockHome(stalePage);
  const staleStateScript = await stalePage.addInitScript(({ key, value }) => {
    localStorage.setItem(key, JSON.stringify(value));
  }, { key: storageKey, value: testState() });
  await stalePage.goto("/");
  await staleStateScript.dispose();
  await expect(stalePage.getByRole("button", { name: "刷新推荐" })).toBeEnabled();

  page.on("dialog", (dialog) => void dialog.accept());
  await page.getByRole("navigation").getByRole("button", { name: "我的" }).click();
  const deletedRow = page.locator(".playlist-row", { hasText: "热歌推荐" });
  await deletedRow.getByRole("button", { name: "删除歌单" }).click();
  await expect(deletedRow).toHaveCount(0);
  await expect.poll(async () => {
    const response = await page.request.get("/api/state");
    const body = await response.json();
    return body.state.playlists.some((playlist: { id: string }) => playlist.id === "test_hot");
  }).toBe(false);

  await stalePage.getByRole("navigation").getByRole("button", { name: "我的" }).click();
  await stalePage.getByRole("button", { name: "创建歌单" }).click();
  await stalePage.getByRole("dialog", { name: "创建新歌单" }).getByPlaceholder("歌单名称").fill("并发新增歌单");
  await stalePage.getByRole("dialog", { name: "创建新歌单" }).getByRole("button", { name: "创建" }).click();

  await expect.poll(async () => {
    const response = await page.request.get("/api/state");
    const body = await response.json();
    return {
      deletedPresent: body.state.playlists.some((playlist: { id: string }) => playlist.id === "test_hot"),
      additionPresent: body.state.playlists.some((playlist: { name: string }) => playlist.name === "并发新增歌单")
    };
  }).toEqual({ deletedPresent: false, additionPresent: true });
  await stale.close();
});

test("sparse shared state still applies remote tombstones without dropping unrelated local playlists", async ({ page }) => {
  const localState = {
    ...testState(),
    playlists: [
      ...testState().playlists,
      { id: "local_keep", name: "Keep Local Playlist", cover: "/assets/icon.png", songs: [testSongs[0]], source: "local" }
    ],
    updatedAt: 200
  };
  const remoteState = {
    schemaVersion: 2,
    revision: 7,
    playlists: [
      { id: "remote_add", name: "Sparse Remote Addition", cover: "/assets/icon.png", songs: [testSongs[1]], source: "local" }
    ],
    favorites: [],
    tombstones: { playlistIds: ["test_hot"], favorites: [], playlistSongs: {} },
    updatedAt: 300
  };
  const sharedWrites: Array<Record<string, any>> = [];
  await page.route(/\/api\/state$/, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ state: remoteState }) });
      return;
    }
    const payload = route.request().postDataJSON();
    sharedWrites.push(payload);
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ok: true, state: { ...payload.state, revision: 8, lastWriteId: payload.writeId } })
    });
  });
  const stateScript = await page.addInitScript(({ key, value }) => {
    localStorage.setItem(key, JSON.stringify(value));
  }, { key: storageKey, value: localState });
  await page.reload();
  await stateScript.dispose();

  await page.getByRole("navigation").getByRole("button", { name: "我的" }).click();
  await expect(page.getByRole("button", { name: /热歌推荐/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Keep Local Playlist/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Sparse Remote Addition/ })).toBeVisible();
  await expect.poll(() => sharedWrites.length).toBeGreaterThan(0);
  const latestSharedWrite = sharedWrites.at(-1);
  if (!latestSharedWrite) throw new Error("Expected the merged shared state to be written");
  expect(latestSharedWrite.state.playlists.some((playlist: { name: string }) => playlist.name === "热歌推荐")).toBe(false);
  expect(latestSharedWrite.state.playlists.some((playlist: { name: string }) => playlist.name === "Keep Local Playlist")).toBe(true);
  expect(latestSharedWrite.state.playlists.some((playlist: { name: string }) => playlist.name === "Sparse Remote Addition")).toBe(true);
  expect(latestSharedWrite.state.tombstones.playlistIds).toContain("test_hot");
});

test("playlist edits made during delayed initial hydration survive the remote response", async ({ page }) => {
  const localState = { ...testState(), updatedAt: 100 };
  const remoteState = {
    ...testState(),
    schemaVersion: 2,
    revision: 4,
    tombstones: { playlistIds: [], favorites: [], playlistSongs: {} },
    updatedAt: Date.now() + 60_000
  };
  const sharedWrites: Array<Record<string, any>> = [];
  let sharedReadStarted = false;
  let releaseSharedRead: () => void = () => {};
  const sharedReadGate = new Promise<void>((resolve) => { releaseSharedRead = resolve; });
  await page.route(/\/api\/state$/, async (route) => {
    if (route.request().method() === "GET") {
      sharedReadStarted = true;
      await sharedReadGate;
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ state: remoteState }) });
      return;
    }
    const payload = route.request().postDataJSON();
    sharedWrites.push(payload);
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ok: true, state: { ...payload.state, revision: 5, lastWriteId: payload.writeId } })
    });
  });
  const stateScript = await page.addInitScript(({ key, value }) => {
    localStorage.setItem(key, JSON.stringify(value));
  }, { key: storageKey, value: localState });
  await page.reload();
  await stateScript.dispose();

  try {
    await expect.poll(() => sharedReadStarted).toBe(true);
    await page.getByRole("navigation").getByRole("button", { name: "我的" }).click();
    await page.getByRole("button", { name: "创建歌单" }).click();
    await page.getByRole("dialog", { name: "创建新歌单" }).getByPlaceholder("歌单名称").fill("Hydration Pending Playlist");
    await page.getByRole("dialog", { name: "创建新歌单" }).getByRole("button", { name: "创建" }).click();
    await expect.poll(async () => (await storedState(page)).playlists.some((playlist: { name: string }) => playlist.name === "Hydration Pending Playlist")).toBe(true);
  } finally {
    releaseSharedRead();
  }

  await expect.poll(async () => (await storedState(page)).sharedRevision ?? 0).toBeGreaterThanOrEqual(4);
  await expect(page.getByRole("button", { name: /Hydration Pending Playlist/ })).toBeVisible();
  await expect.poll(() => sharedWrites.some((write) => write.state.playlists.some((playlist: { name: string }) => playlist.name === "Hydration Pending Playlist"))).toBe(true);
});

test("online retries a failed initial shared read before syncing pending library edits", async ({ page }) => {
  const localState = { ...testState(), updatedAt: 100 };
  const remoteState = {
    ...testState(),
    schemaVersion: 2,
    revision: 9,
    tombstones: { playlistIds: [], favorites: [], playlistSongs: {} },
    updatedAt: 200
  };
  let sharedReadAttempts = 0;
  let rejectSharedReads = true;
  const sharedWrites: Array<Record<string, any>> = [];
  await page.route(/\/api\/state$/, async (route) => {
    if (route.request().method() === "GET") {
      sharedReadAttempts += 1;
      if (rejectSharedReads) {
        await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "temporary shared read failure" }) });
        return;
      }
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ state: remoteState }) });
      return;
    }
    const payload = route.request().postDataJSON();
    sharedWrites.push(payload);
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ok: true, state: { ...payload.state, revision: 10, lastWriteId: payload.writeId } })
    });
  });
  const stateScript = await page.addInitScript(({ key, value }) => {
    localStorage.setItem(key, JSON.stringify(value));
  }, { key: storageKey, value: localState });
  await page.reload();
  await stateScript.dispose();

  await expect.poll(() => sharedReadAttempts).toBeGreaterThan(0);
  await page.waitForTimeout(200);
  const attemptsBeforeOnline = sharedReadAttempts;
  await page.getByRole("navigation").getByRole("button", { name: "我的" }).click();
  await page.getByRole("button", { name: "创建歌单" }).click();
  await page.getByRole("dialog", { name: "创建新歌单" }).getByPlaceholder("歌单名称").fill("Recovered Shared Playlist");
  await page.getByRole("dialog", { name: "创建新歌单" }).getByRole("button", { name: "创建" }).click();
  await expect.poll(async () => Boolean((await storedState(page)).sharedSyncPending)).toBe(true);
  expect(sharedWrites).toHaveLength(0);

  rejectSharedReads = false;
  await page.evaluate(() => window.dispatchEvent(new Event("online")));

  await expect.poll(() => sharedReadAttempts).toBeGreaterThan(attemptsBeforeOnline);
  await expect.poll(() => sharedWrites.some((write) => write.state.playlists.some((playlist: { name: string }) => playlist.name === "Recovered Shared Playlist"))).toBe(true);
  await expect.poll(async () => Boolean((await storedState(page)).sharedSyncPending)).toBe(false);
});

test("slow shared hydration does not roll back playback or settings changed meanwhile", async ({ page }) => {
  let releaseSharedRead: () => void = () => {};
  const sharedReadGate = new Promise<void>((resolve) => { releaseSharedRead = resolve; });
  await page.route(/\/api\/state$/, async (route) => {
    if (route.request().method() !== "GET") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true }) });
      return;
    }
    await sharedReadGate;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ state: testState() }) });
  });
  const stateScript = await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: storageKey, value: testState() });
  await page.reload();
  await stateScript.dispose();

  try {
    await playFirstHomeSong(page);
    await expectAudioPlaying(page);
    const settings = await openSettings(page);
    await settings.getByLabel("主题").selectOption("dark");
    await expect.poll(async () => (await storedState(page)).theme).toBe("dark");
  } finally {
    releaseSharedRead();
  }

  await expect(page.locator(".now-playing")).toContainText("周杰伦 本地试听");
  await expectAudioPlaying(page);
  await expect.poll(async () => {
    const state = await storedState(page);
    return { theme: state.theme, queue: state.queue.map((song: { name: string }) => song.name) };
  }).toEqual({ theme: "dark", queue: ["周杰伦 本地试听", "陈奕迅 本地试听"] });
});

test("late shared hydration keeps the active downloaded audio source and position", async ({ page }) => {
  const localKey = "download_flac_late-hydration";
  const cachedSong = {
    ...testSongs[0],
    id: "flac_late-hydration",
    name: "Late Hydration Cache",
    artist: "Offline Artist",
    source: "flac" as const,
    url: `local-file:${localKey}`,
    localKey,
    remotePlayable: true,
    verifiedPlayable: true
  };
  const state = {
    ...testState(),
    downloadHistory: [cachedSong],
    queue: [cachedSong],
    queueIndex: 0,
    updatedAt: Date.now() + 1_000_000
  };
  let releaseSharedRead: () => void = () => {};
  const sharedReadGate = new Promise<void>((resolve) => { releaseSharedRead = resolve; });
  await page.route(/\/api\/state$/, async (route) => {
    if (route.request().method() === "GET") {
      await sharedReadGate;
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ state }) });
      return;
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  await page.evaluate(async ({ key, value, cacheKey }) => {
    const blob = await fetch("/assets/full-song-65s.wav").then((response) => response.blob());
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("jianyin-web-clean-audio", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("files");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("files", "readwrite");
      tx.objectStore("files").put(blob, cacheKey);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    localStorage.setItem(key, JSON.stringify(value));
  }, { key: storageKey, value: state, cacheKey: localKey });
  await page.reload();

  try {
    await page.getByRole("button", { name: "播放", exact: true }).click();
    await expectAudioPlaying(page);
    const before = await page.locator("audio").evaluate((audio: HTMLAudioElement) => {
      audio.dataset.lateHydrationEmptied = "0";
      audio.addEventListener("emptied", () => {
        audio.dataset.lateHydrationEmptied = String(Number(audio.dataset.lateHydrationEmptied ?? "0") + 1);
      });
      audio.currentTime = 12;
      audio.dispatchEvent(new Event("timeupdate"));
      return { src: audio.src, currentTime: audio.currentTime };
    });
    releaseSharedRead();

    await expect.poll(() => page.locator("audio").evaluate((audio: HTMLAudioElement) => ({
      src: audio.src,
      emptied: Number(audio.dataset.lateHydrationEmptied ?? "0")
    }))).toEqual({ src: before.src, emptied: 0 });
    await expect.poll(() => page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThan(before.currentTime);
  } finally {
    releaseSharedRead();
  }
});

test("stale hydration revokes object URLs before retrying the latest state", async ({ page }) => {
  const keys = ["download_flac_stale-hydration-a", "download_flac_stale-hydration-b"];
  const songs = keys.map((localKey, index) => ({
    ...testSongs[index],
    id: `flac_stale-hydration-${index}`,
    name: `Stale Hydration ${index}`,
    source: "flac",
    url: `local-file:${localKey}`,
    localKey,
    remotePlayable: true,
    verifiedPlayable: true
  }));
  const state = {
    ...testState(),
    downloadHistory: songs,
    queue: songs,
    queueIndex: 0,
    updatedAt: 100
  };
  await page.route(/\/api\/state$/, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ state }) });
      return;
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  await page.addInitScript((delayedKeys) => {
    const scope = window as Window & {
      __hydrationUrlTest?: {
        created: string[];
        revoked: string[];
        releases: Record<string, () => void>;
        delayed: Set<string>;
      };
    };
    const state = {
      created: [] as string[],
      revoked: [] as string[],
      releases: {} as Record<string, () => void>,
      delayed: new Set<string>()
    };
    scope.__hydrationUrlTest = state;
    const originalCreateObjectURL = URL.createObjectURL.bind(URL);
    const originalRevokeObjectURL = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = (value: Blob | MediaSource) => {
      const url = originalCreateObjectURL(value);
      state.created.push(url);
      return url;
    };
    URL.revokeObjectURL = (url: string) => {
      state.revoked.push(url);
      originalRevokeObjectURL(url);
    };
    const originalGet = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function delayedHydrationGet(query: IDBValidKey | IDBKeyRange) {
      const key = String(query);
      const request = originalGet.call(this, query);
      if (!delayedKeys.includes(key) || state.delayed.has(key)) return request;
      state.delayed.add(key);
      const proxy = { result: undefined, error: null, onsuccess: null, onerror: null } as unknown as IDBRequest;
      request.onsuccess = () => {
        state.releases[key] = () => {
          Object.defineProperty(proxy, "result", { configurable: true, value: request.result });
          proxy.onsuccess?.(new Event("success") as Event & { target: IDBRequest });
        };
      };
      request.onerror = () => proxy.onerror?.(new Event("error") as Event & { target: IDBRequest });
      return proxy;
    };
  }, keys);
  await page.evaluate(async ({ storageKey, value, localKeys }) => {
    const blob = await fetch("/assets/full-song-65s.wav").then((response) => response.blob());
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("jianyin-web-clean-audio", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("files");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("files", "readwrite");
      localKeys.forEach((key) => tx.objectStore("files").put(blob, key));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
    localStorage.setItem(storageKey, JSON.stringify(value));
  }, { storageKey, value: state, localKeys: keys });
  await page.reload();

  await expect.poll(() => page.evaluate((key) => typeof (window as Window & { __hydrationUrlTest?: { releases: Record<string, () => void> } }).__hydrationUrlTest?.releases[key], keys[0])).toBe("function");
  await page.evaluate((key) => (window as Window & { __hydrationUrlTest?: { releases: Record<string, () => void> } }).__hydrationUrlTest?.releases[key]?.(), keys[0]);
  await expect.poll(() => page.evaluate(() => (window as Window & { __hydrationUrlTest?: { created: string[] } }).__hydrationUrlTest?.created.length ?? 0)).toBe(1);

  const settings = await openSettings(page);
  await settings.getByLabel("主题").selectOption("dark");
  await expect.poll(async () => (await storedState(page)).theme).toBe("dark");
  await settings.getByRole("button", { name: "关闭" }).click();
  await expect.poll(() => page.evaluate((key) => typeof (window as Window & { __hydrationUrlTest?: { releases: Record<string, () => void> } }).__hydrationUrlTest?.releases[key], keys[1])).toBe("function");
  await page.evaluate((key) => (window as Window & { __hydrationUrlTest?: { releases: Record<string, () => void> } }).__hydrationUrlTest?.releases[key]?.(), keys[1]);

  await expect.poll(() => page.evaluate(() => (window as Window & { __hydrationUrlTest?: { created: string[] } }).__hydrationUrlTest?.created.length ?? 0)).toBeGreaterThanOrEqual(4);
  const urls = await page.evaluate(() => {
    const value = (window as Window & { __hydrationUrlTest?: { created: string[]; revoked: string[] } }).__hydrationUrlTest;
    return value ?? { created: [], revoked: [] };
  });
  expect(urls.revoked).toEqual(expect.arrayContaining(urls.created.slice(0, 2)));
});

test("a failed shared-state read keeps local edits pending without attempting doomed saves", async ({ page }) => {
  let sharedWrites = 0;
  await page.route(/\/api\/state$/, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "测试读取失败" }) });
      return;
    }
    sharedWrites += 1;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  const stateScript = await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: storageKey, value: testState() });
  await page.reload();
  await stateScript.dispose();

  await page.getByRole("navigation").getByRole("button", { name: "我的" }).click();
  await page.getByRole("button", { name: "创建歌单" }).click();
  await page.getByRole("dialog", { name: "创建新歌单" }).getByPlaceholder("歌单名称").fill("等待共享恢复");
  await page.getByRole("dialog", { name: "创建新歌单" }).getByRole("button", { name: "创建" }).click();
  await expect.poll(async () => Boolean((await storedState(page)).sharedSyncPending)).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false })));
  await page.waitForTimeout(250);
  expect(sharedWrites).toBe(0);
  await expect(page.locator(".toast")).toHaveCount(0);
});

test("settings dialog remains topmost while mobile player is active", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await playFirstHomeSong(page);
  await expectAudioPlaying(page);
  const dialog = await openSettings(page);
  const closeButton = dialog.getByRole("button", { name: "关闭" });
  await expect(closeButton).toBeVisible();

  const metrics = await dialog.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const close = element.querySelector('button[aria-label="关闭"]');
    const closeRect = close?.getBoundingClientRect();
    const closeTopElement = closeRect
      ? document.elementFromPoint(closeRect.left + closeRect.width / 2, closeRect.top + closeRect.height / 2)
      : null;
    const centerTopElement = document.elementFromPoint(centerX, Math.min(rect.bottom - 12, rect.top + 32));
    return {
      top: rect.top,
      bottom: rect.bottom,
      viewportHeight: window.innerHeight,
      centerTopmostInsideDialog: Boolean(centerTopElement && element.contains(centerTopElement)),
      closeTopmostInsideDialog: Boolean(closeTopElement && element.contains(closeTopElement))
    };
  });
  expect(metrics.top).toBeGreaterThanOrEqual(0);
  expect(metrics.bottom).toBeLessThanOrEqual(metrics.viewportHeight);
  expect(metrics.centerTopmostInsideDialog).toBe(true);
  expect(metrics.closeTopmostInsideDialog).toBe(true);

  await closeButton.click();
  await expect(dialog).toHaveCount(0);
});

test("storage quota failure shows a readable toast", async ({ page }) => {
  const dialog = await openSettings(page);
  await page.evaluate((key) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function setItemWithQuotaFailure(this: Storage, name: string, value: string) {
      if (name === key) throw new DOMException("Quota exceeded", "QuotaExceededError");
      return original.call(this, name, value);
    };
  }, storageKey);

  await dialog.getByLabel("播放音质").selectOption("standard");
  await expectReadableToast(page, "浏览器存储空间不足，本次修改可能不会保存");
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

test("empty shared state cannot overwrite a populated local library", async ({ page }) => {
  const localSong = {
    ...testSongs[0],
    id: "local_protected_song",
    name: "Protected Local Song",
    artist: "Protected Artist"
  };
  const localState = {
    ...testState(),
    playlists: [
      { id: "favorites", name: "我喜欢的音乐", cover: "/assets/icon.png", songs: [localSong], source: "local" },
      { id: "protected_playlist", name: "Protected Playlist", cover: "/assets/icon.png", songs: [localSong], source: "local" }
    ],
    favorites: [localSong],
    history: [localSong],
    queue: [localSong],
    queueIndex: 0
  };

  await mockHome(page);
  await page.route(/\/api\/state$/, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          state: {
            ...testState(),
            playlists: [{ id: "favorites", name: "我喜欢的音乐", cover: "/assets/icon.png", songs: [], source: "local" }]
          }
        })
      });
      return;
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  await page.addInitScript(({ key, value }) => {
    localStorage.setItem(key, JSON.stringify(value));
  }, { key: storageKey, value: localState });
  await page.goto("/");

  await page.getByRole("navigation").getByRole("button", { name: "我的" }).click();
  await expect(page.getByRole("button", { name: /Protected Playlist 1 首歌曲/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /我喜欢的音乐 1 首歌曲/ })).toBeVisible();
});

test("smaller non-empty shared state merges without overwriting a populated local library", async ({ page }) => {
  const protectedSongs = testSongs.map((song, index) => ({
    ...song,
    id: `protected_song_${index}`,
    name: `Protected Song ${index + 1}`,
    artist: "Protected Artist"
  }));
  const remoteSong = {
    ...testSongs[0],
    id: "remote_small_song",
    name: "Remote Small Song",
    artist: "Remote Artist"
  };
  const localState = {
    ...testState(),
    playlists: [
      { id: "favorites", name: "我喜欢的音乐", cover: "/assets/icon.png", songs: protectedSongs, source: "local" },
      { id: "protected_large", name: "Protected Large Playlist", cover: "/assets/icon.png", songs: protectedSongs, source: "local" }
    ],
    favorites: protectedSongs,
    history: protectedSongs,
    queue: protectedSongs,
    queueIndex: 0
  };
  const smallSharedState = {
    ...testState(),
    playlists: [
      { id: "favorites", name: "我喜欢的音乐", cover: "/assets/icon.png", songs: [], source: "local" },
      { id: "remote_small", name: "Remote Small Playlist", cover: "/assets/icon.png", songs: [remoteSong], source: "local" }
    ],
    favorites: [],
    history: [],
    downloadHistory: [],
    queue: [],
    queueIndex: -1
  };

  await mockHome(page);
  await page.route(/\/api\/state$/, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ state: smallSharedState }) });
      return;
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  await page.addInitScript(({ key, value }) => {
    localStorage.setItem(key, JSON.stringify(value));
  }, { key: storageKey, value: localState });
  await page.goto("/");

  await page.getByRole("navigation").getByRole("button", { name: "我的" }).click();
  await expect(page.getByRole("button", { name: /Protected Large Playlist 3 首歌曲/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Remote Small Playlist/ })).toBeVisible();
  const state = await storedState(page);
  expect(JSON.stringify(state)).toContain("Protected Large Playlist");
  expect(JSON.stringify(state)).toContain("Remote Small Playlist");
});

test("shared state merges playlists and dedupes repeated songs", async ({ page }) => {
  const songA = {
    ...testSongs[0],
    id: "merge_song_a",
    name: "Merge Song A",
    artist: "Merge Artist"
  };
  const songB = {
    ...testSongs[1],
    id: "merge_song_b",
    name: "Merge Song B",
    artist: "Merge Artist"
  };
  const songC = {
    ...testSongs[2],
    id: "merge_song_c",
    name: "Merge Song C",
    artist: "Merge Artist"
  };
  const localState = {
    ...testState(),
    playlists: [
      { id: "favorites", name: "我喜欢的音乐", cover: "/assets/icon.png", songs: [songA], source: "local" },
      { id: "local_merge", name: "Local Merge Playlist", cover: "/assets/icon.png", songs: [songA], source: "local" }
    ],
    favorites: [songA],
    history: [songA],
    queue: [songA],
    queueIndex: 0,
    searchHistory: ["local merge"]
  };
  const sharedState = {
    ...testState(),
    playlists: [
      { id: "favorites", name: "我喜欢的音乐", cover: "/assets/icon.png", songs: [songA, songC], source: "local" },
      { id: "remote_merge", name: "Remote Merge Playlist", cover: "/assets/icon.png", songs: [songB], source: "local" }
    ],
    favorites: [songA, songC],
    history: [songB],
    downloadHistory: [songC],
    queue: [songB],
    queueIndex: 0,
    searchHistory: ["remote merge"]
  };

  await mockHome(page);
  await page.route(/\/api\/state$/, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ state: sharedState }) });
      return;
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  await page.addInitScript(({ key, value }) => {
    localStorage.setItem(key, JSON.stringify(value));
  }, { key: storageKey, value: localState });
  await page.goto("/");

  await page.getByRole("navigation").getByRole("button", { name: "我的" }).click();
  await expect(page.getByRole("button", { name: /Local Merge Playlist 1 首歌曲/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Remote Merge Playlist 1 首歌曲/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /我喜欢的音乐 2 首歌曲/ })).toBeVisible();
  await expect.poll(async () => (await storedState(page)).favorites.map((song: { name: string }) => song.name).sort()).toEqual(["Merge Song A", "Merge Song C"]);
  const merged = await storedState(page);
  expect(merged.history.map((song: { id: string }) => song.id)).toEqual(["merge_song_a"]);
  expect(merged.downloadHistory).toEqual([]);
  expect(merged.searchHistory).toEqual(["local merge"]);
});
