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
  await expect(dialog.getByLabel("显示既见状态栏通知")).toBeChecked();
  await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe("dark");
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
  await page.route(/\/api\/state$/, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ state: persisted }) });
      return;
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  await page.reload();
  await expect(page.locator(".now-playing")).toContainText("Startup Autoplay Song");
  await expect.poll(() => page.evaluate(() => {
    const audio = document.querySelector("audio") as HTMLAudioElement | null;
    return Boolean(audio && !audio.paused) || Boolean(document.querySelector(".toast")?.textContent?.includes("浏览器阻止了自动播放"));
  })).toBe(true);
});

test("rapid settings changes persist locally and batch shared state writes", async ({ page }) => {
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
  await expect.poll(() => sharedWrites.length).toBeGreaterThanOrEqual(1);
  await page.waitForTimeout(400);
  expect(sharedWrites).toHaveLength(1);
  expect(sharedWrites[0]).toMatchObject({
    state: {
      playQuality: "lossless",
      downloadQuality: "standard",
      lyricSource: "embedded",
      theme: "dark"
    }
  });
});

test("shared state writes stay single-flight and keep only the latest pending settings", async ({ page }) => {
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

  const settings = await openSettings(page);
  await settings.getByLabel("播放音质").selectOption("standard");
  await expect.poll(() => sharedWrites.length).toBe(1);
  await settings.getByLabel("歌词来源").selectOption("embedded");
  await settings.getByLabel("主题").selectOption("dark");

  try {
    await page.waitForTimeout(350);
    expect(sharedWrites).toHaveLength(1);
    expect(maxActiveWrites).toBe(1);
  } finally {
    releaseFirstWrite();
  }

  await expect.poll(() => sharedWrites.length).toBe(2);
  expect(maxActiveWrites).toBe(1);
  expect(sharedWrites[1]).toMatchObject({
    state: { playQuality: "standard", lyricSource: "embedded", theme: "dark" }
  });
});

test("pagehide flushes the latest debounced shared settings immediately", async ({ page }) => {
  await expect(page.getByRole("button", { name: "刷新推荐" })).toBeEnabled();
  await page.waitForLoadState("networkidle");

  const sharedWrites: Array<{ at: number; body: Record<string, any> }> = [];
  await page.route(/\/api\/state$/, async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }
    sharedWrites.push({ at: Date.now(), body: route.request().postDataJSON() });
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });

  const settings = await openSettings(page);
  await settings.getByLabel("主题").selectOption("dark");
  await expect.poll(async () => (await storedState(page)).theme).toBe("dark");
  const dispatchedAt = Date.now();
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false })));
  await expect.poll(() => sharedWrites.length).toBeGreaterThan(0);

  expect(sharedWrites[0].at - dispatchedAt).toBeLessThan(225);
  expect(sharedWrites[0].body).toMatchObject({ state: { theme: "dark" } });
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

test("smaller non-empty shared state cannot overwrite a populated local library", async ({ page }) => {
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
  await expect(page.getByRole("button", { name: /Remote Small Playlist/ })).toHaveCount(0);
  const state = await storedState(page);
  expect(JSON.stringify(state)).toContain("Protected Large Playlist");
  expect(JSON.stringify(state)).not.toContain("Remote Small Playlist");
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
  const merged = await storedState(page);
  expect(merged.favorites.map((song: { id: string }) => song.id).sort()).toEqual(["merge_song_a", "merge_song_c"]);
  expect(merged.history.map((song: { id: string }) => song.id).sort()).toEqual(["merge_song_a", "merge_song_b"]);
  expect(merged.downloadHistory.map((song: { id: string }) => song.id)).toEqual(["merge_song_c"]);
  expect(merged.searchHistory).toEqual(["local merge", "remote merge"]);
});
