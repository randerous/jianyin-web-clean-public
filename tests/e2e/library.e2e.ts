import { expect, test } from "playwright/test";
import { fs, storageKey, projectRoot, toneFile, coverFile, fullSongFile, lrcFile, testSongs, testState, mockHome, reset, expectAudioPlaying, expectAudioPaused, expectAudioLongerThan, expectReadableToast, playFirstHomeSong, openPlayer, importLocalTone, openSettings, storedState, songNamesIn } from "../helpers/app-fixture";

test.beforeEach(async ({ page }) => {
  await reset(page);
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

test("playlist detail play all button starts the full playlist queue", async ({ page }) => {
  await page.getByRole("navigation").getByRole("button", { name: "我的" }).click();
  await page.getByRole("button", { name: "热歌推荐 3 首歌曲" }).click();
  const playlist = page.getByRole("dialog", { name: "热歌推荐" });
  await playlist.getByRole("button", { name: "播放全部" }).click();

  await expect(page.locator(".now-playing")).toContainText("邓紫棋 本地试听");
  await expectAudioPlaying(page);
  await expect.poll(async () => {
    const state = await storedState(page);
    return {
      queueIndex: state.queueIndex,
      queueNames: state.queue.map((song: { name: string }) => song.name)
    };
  }).toEqual({
    queueIndex: 0,
    queueNames: ["邓紫棋 本地试听", "陈奕迅 本地试听", "周杰伦 本地试听"]
  });
});

test("switching playlists ignores a stale playback resolve from the previous playlist", async ({ page }) => {
  const song = (id: string, name: string) => ({
    id: `netease_${id}`,
    name,
    artist: "竞态测试",
    cover: "/assets/icon.png",
    url: "",
    source: "netease",
    remotePlayable: true
  });
  const first = song("playlist_a_song", "歌单 A 歌曲");
  const second = song("playlist_b_song", "歌单 B 歌曲");
  const state = {
    ...testState(),
    playlists: [
      { id: "favorites", name: "我喜欢的音乐", cover: "/assets/icon.png", songs: [], source: "local" },
      { id: "playlist_a", name: "歌单 A", cover: "/assets/icon.png", songs: [first], source: "local" },
      { id: "playlist_b", name: "歌单 B", cover: "/assets/icon.png", songs: [second], source: "local" }
    ]
  };
  await page.route("**/api/netease/song/*", async (route) => {
    const id = new URL(route.request().url()).pathname.split("/").pop();
    await new Promise((resolve) => setTimeout(resolve, id === "playlist_a_song" ? 800 : 40));
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ url: "/assets/full-song-65s.wav", durationMs: 65000, verifiedPlayable: true, quality: "exhigh" })
    });
  });
  await page.request.post("/api/state", { data: { state } });
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: storageKey, value: state });
  await page.reload();

  await page.getByRole("navigation").getByRole("button", { name: "我的" }).click();
  await page.getByRole("button", { name: "歌单 A 1 首歌曲" }).click();
  await page.getByRole("dialog", { name: "歌单 A" }).getByRole("button", { name: /歌单 A 歌曲/ }).click();
  await page.getByRole("dialog", { name: "歌单 A" }).getByRole("button", { name: "返回" }).click();
  await page.getByRole("button", { name: "歌单 B 1 首歌曲" }).click();
  await page.getByRole("dialog", { name: "歌单 B" }).getByRole("button", { name: /歌单 B 歌曲/ }).click();

  await page.waitForTimeout(1000);
  await expect.poll(async () => (await storedState(page)).queue.map((item: { name: string }) => item.name)).toEqual(["歌单 B 歌曲"]);
  await expect.poll(async () => (await storedState(page)).queueIndex).toBe(0);
});

test("playlist card and detail use the same total track count", async ({ page }) => {
  const song = { ...testSongs[0], id: "counted_song", name: "已加载歌曲" };
  const state = {
    ...testState(),
    playlists: [
      { id: "favorites", name: "我喜欢的音乐", cover: "/assets/icon.png", songs: [], source: "local" },
      { id: "counted_playlist", name: "总数歌单", cover: "/assets/icon.png", songs: [song], trackCount: 8, source: "netease" }
    ]
  };
  await page.request.post("/api/state", { data: { state } });
  await page.addInitScript(({ key, value }) => localStorage.setItem(key, JSON.stringify(value)), { key: storageKey, value: state });
  await page.reload();

  await page.getByRole("navigation").getByRole("button", { name: "我的" }).click();
  await expect(page.getByRole("button", { name: "总数歌单 8 首歌曲" })).toBeVisible();
  await page.getByRole("button", { name: "总数歌单 8 首歌曲" }).click();
  await expect(page.getByRole("dialog", { name: "总数歌单" })).toContainText("8 首歌曲");
});

test("playlist detail selects only visible songs after filtering", async ({ page }) => {
  await page.getByRole("navigation").getByRole("button", { name: "我的" }).click();
  await page.getByRole("button", { name: "热歌推荐 3 首歌曲" }).click();
  const playlist = page.getByRole("dialog", { name: "热歌推荐" });
  await playlist.getByPlaceholder("搜索歌曲").fill("陈奕迅");
  await playlist.getByRole("button", { name: "全选可见" }).click();
  await playlist.getByRole("button", { name: "清空搜索" }).click();

  const selectionStates = await playlist.locator(".song-row").evaluateAll((rows) => rows.map((row) => ({
    name: row.querySelector("strong")?.textContent?.trim(),
    selected: row.querySelector('button[aria-label="选择歌曲"]')?.getAttribute("aria-pressed")
  })));
  expect(selectionStates).toEqual([
    { name: "邓紫棋 本地试听", selected: "false" },
    { name: "陈奕迅 本地试听", selected: "true" },
    { name: "周杰伦 本地试听", selected: "false" }
  ]);
  await playlist.getByRole("button", { name: "加入队列" }).click();
  await expectReadableToast(page, "已添加 1 首歌曲到播放队列");
});

test("playlist detail reverse sorting persists after reload", async ({ page }) => {
  await page.getByRole("navigation").getByRole("button", { name: "我的" }).click();
  await page.getByRole("button", { name: "热歌推荐 3 首歌曲" }).click();
  let playlist = page.getByRole("dialog", { name: "热歌推荐" });
  await expect.poll(() => songNamesIn(playlist)).toEqual(["邓紫棋 本地试听", "陈奕迅 本地试听", "周杰伦 本地试听"]);
  await playlist.getByRole("button", { name: "反转排序" }).click();
  await expect.poll(() => songNamesIn(playlist)).toEqual(["周杰伦 本地试听", "陈奕迅 本地试听", "邓紫棋 本地试听"]);
  await expect.poll(async () => {
    const state = await storedState(page);
    return state.playlists.find((item: { id: string }) => item.id === "test_hot")?.songs.map((song: { name: string }) => song.name);
  }).toEqual(["周杰伦 本地试听", "陈奕迅 本地试听", "邓紫棋 本地试听"]);

  await page.reload();
  await page.getByRole("navigation").getByRole("button", { name: "我的" }).click();
  await page.getByRole("button", { name: "热歌推荐 3 首歌曲" }).click();
  playlist = page.getByRole("dialog", { name: "热歌推荐" });
  await expect.poll(() => songNamesIn(playlist)).toEqual(["周杰伦 本地试听", "陈奕迅 本地试听", "邓紫棋 本地试听"]);
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

test("mine page shows recent, downloads, favorites, actions, and playlists", async ({ page }) => {
  const favoriteSong = { ...testSongs[0], id: "mine_favorite", name: "Mine Favorite Song", artist: "Mine Artist" };
  const recentSong = { ...testSongs[1], id: "mine_recent", name: "Mine Recent Song", artist: "Mine Artist" };
  const downloadedSong = {
    ...testSongs[2],
    id: "mine_download",
    name: "Mine Download Song",
    artist: "Mine Artist",
    localKey: "download_local_mine_download",
    url: "local-file:download_local_mine_download"
  };
  const state = {
    ...testState(),
    playlists: [
      { id: "favorites", name: "我喜欢的音乐", cover: "/assets/icon.png", songs: [favoriteSong], source: "local" },
      { id: "mine_basic", name: "Mine Basic Playlist", cover: "/assets/icon.png", songs: [recentSong], source: "local" }
    ],
    favorites: [favoriteSong],
    history: [recentSong],
    downloadHistory: [downloadedSong]
  };

  await mockHome(page);
  await page.route(/\/api\/state$/, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ state }) });
      return;
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  await page.addInitScript(({ key, value }) => {
    localStorage.setItem(key, JSON.stringify(value));
  }, { key: storageKey, value: state });
  await page.goto("/");

  await page.getByRole("navigation").getByRole("button", { name: "我的" }).click();
  await expect(page.getByRole("heading", { name: "我的音乐" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "最近播放" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "下载管理" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "最近最爱" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "我的歌单" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Mine Recent Song/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Mine Download Song/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Mine Favorite Song/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Mine Basic Playlist 1 首歌曲/ })).toBeVisible();
  for (const name of ["创建歌单", "导入本地音乐", "导入网易云歌单", "账号同步", "备份数据", "恢复备份", "设置"]) {
    await expect(page.getByRole("button", { name }).first()).toBeVisible();
  }
});

test("mine page deletes a local playlist without removing favorites", async ({ page }) => {
  page.on("dialog", (dialog) => void dialog.accept());

  await page.getByRole("navigation").getByRole("button", { name: "我的" }).click();
  await expect(page.getByRole("button", { name: /热歌推荐 3 首歌曲/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /我喜欢的音乐 0 首歌曲/ })).toBeVisible();
  await page.locator(".playlist-row", { hasText: "热歌推荐" }).getByRole("button", { name: "删除歌单" }).click();

  await expect(page.getByRole("button", { name: /热歌推荐/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /我喜欢的音乐 0 首歌曲/ })).toBeVisible();
  await expect.poll(async () => {
    const state = await storedState(page);
    return state.playlists.map((playlist: { id: string }) => playlist.id);
  }).toEqual(["favorites"]);
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
  const preview = cleanPage.getByRole("dialog", { name: "恢复备份预览" });
  await expect(preview).toContainText("本地音频");
  await preview.getByRole("button", { name: "合并恢复（推荐）" }).click();
  await expect(cleanPage.getByRole("button", { name: "本地歌单_1首" })).toBeVisible();
  await cleanPage.getByRole("button", { name: "本地歌单_1首" }).click();
  await cleanPage.getByRole("button", { name: /demo-tone/ }).click();
  await expectAudioPlaying(cleanPage);
  await clean.close();
});

test("backup restore validates and previews data before explicit merge or overwrite", async ({ page }) => {
  const restoredSong = {
    ...testSongs[0],
    id: "restore_local_song",
    name: "Restored Local Song",
    source: "local",
    localKey: "local_restore_audio",
    url: "local-file:local_restore_audio"
  };
  const mergeBackup = {
    ...testState(),
    app: "jianyin-web-clean",
    exportedAt: "2026-07-13T00:00:00.000Z",
    playlists: [
      { id: "favorites", name: "我喜欢的音乐", cover: "/assets/icon.png", songs: [], source: "local" },
      { id: "restored_playlist", name: "Restored Playlist", cover: "/assets/icon.png", songs: [restoredSong], source: "local" }
    ],
    localFiles: [{ key: "local_restore_audio", type: "audio/wav", dataUrl: "data:audio/wav;base64,UklGRg==" }]
  };
  const idbHas = (key: string) => page.evaluate(async (fileKey) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("jianyin-web-clean-audio", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("files");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const found = await new Promise<boolean>((resolve, reject) => {
      const request = db.transaction("files", "readonly").objectStore("files").get(fileKey);
      request.onsuccess = () => resolve(Boolean(request.result));
      request.onerror = () => reject(request.error);
    });
    db.close();
    return found;
  }, key);

  await page.getByRole("navigation").getByRole("button", { name: "我的" }).click();
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "恢复备份" }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({ name: "merge-backup.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(mergeBackup)) });

  const preview = page.getByRole("dialog", { name: "恢复备份预览" });
  await expect(preview).toContainText("Restored Playlist");
  await expect(preview).toContainText("1 个本地音频");
  expect(await idbHas("local_restore_audio")).toBe(false);
  expect((await storedState(page)).playlists.some((playlist: { id: string }) => playlist.id === "restored_playlist")).toBe(false);

  await preview.getByRole("button", { name: "合并恢复（推荐）" }).click();
  await expect.poll(async () => (await storedState(page)).playlists.map((playlist: { id: string }) => playlist.id)).toContain("restored_playlist");
  await expect.poll(() => idbHas("local_restore_audio")).toBe(true);
  await expect.poll(async () => (await storedState(page)).playlists.map((playlist: { id: string }) => playlist.id)).toContain("test_hot");

  const overwriteBackup = {
    ...mergeBackup,
    playlists: [
      { id: "favorites", name: "我喜欢的音乐", cover: "/assets/icon.png", songs: [], source: "local" },
      { id: "overwrite_playlist", name: "Overwrite Playlist", cover: "/assets/icon.png", songs: [], source: "local" }
    ],
    localFiles: []
  };
  const overwriteChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "恢复备份" }).click();
  const overwriteChooser = await overwriteChooserPromise;
  await overwriteChooser.setFiles({ name: "overwrite-backup.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(overwriteBackup)) });
  const overwritePreview = page.getByRole("dialog", { name: "恢复备份预览" });
  await overwritePreview.getByRole("button", { name: "覆盖本机数据" }).click();
  await expect.poll(async () => (await storedState(page)).playlists.map((playlist: { id: string }) => playlist.id)).toContain("overwrite_playlist");
  await expect.poll(async () => (await storedState(page)).playlists.map((playlist: { id: string }) => playlist.id)).not.toContain("test_hot");
});

test("backup restore refuses foreign and over-limit local-file payloads without changing state", async ({ page }) => {
  const before = await storedState(page);
  await page.getByRole("navigation").getByRole("button", { name: "我的" }).click();
  const foreignChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "恢复备份" }).click();
  const foreignChooser = await foreignChooserPromise;
  await foreignChooser.setFiles({ name: "foreign.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ ...testState(), app: "other-app", exportedAt: "2026-07-13T00:00:00.000Z" })) });
  await expect(page.locator(".toast")).toContainText("备份文件无效");
  await expect(page.getByRole("dialog", { name: "恢复备份预览" })).toHaveCount(0);

  const overLimitChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "恢复备份" }).click();
  const overLimitChooser = await overLimitChooserPromise;
  const overLimitFiles = Array.from({ length: 201 }, (_, index) => ({ key: `local_over_limit_${index}`, type: "audio/wav", dataUrl: "data:audio/wav;base64,UklGRg==" }));
  await overLimitChooser.setFiles({
    name: "over-limit.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ ...testState(), app: "jianyin-web-clean", exportedAt: "2026-07-13T00:00:00.000Z", localFiles: overLimitFiles }))
  });
  await expect(page.locator(".toast")).toContainText("备份文件无效");
  expect((await storedState(page)).playlists.map((playlist: { id: string }) => playlist.id)).toEqual(before.playlists.map((playlist: { id: string }) => playlist.id));
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

test("download history reattaches orphaned cached audio", async ({ page }) => {
  const cachedSong = {
    id: "flac_888",
    name: "Cached Refresh Song",
    artist: "Cache Artist",
    pic: "/assets/icon.png",
    cover: "/assets/icon.png",
    url: "/api/flac/stream/888?format=mp3&bitrate=320&time=t888&sign=s888",
    source: "flac",
    remotePlayable: true,
    verifiedPlayable: true,
    durationMs: 65000,
    br: 2000000,
    level: "flac",
    type: "flac",
    audioType: "flac",
    quality: "flac"
  };
  const state = {
    ...testState(),
    playlists: [
      { id: "favorites", name: "我喜欢的音乐", cover: "/assets/icon.png", songs: [], source: "local" },
      { id: "cached_playlist", name: "Cached Playlist", cover: "/assets/icon.png", songs: [cachedSong], source: "local" }
    ],
    downloadHistory: [cachedSong]
  };
  let resolveRequests = 0;
  await page.request.post("/api/state", { data: { state } });
  await mockHome(page);
  await page.route("**/api/flac/song/888**", async (route) => {
    resolveRequests += 1;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        url: "/api/flac/stream/888?format=mp3&bitrate=320&time=t888&sign=s888",
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
  await page.evaluate(async ({ key, value }) => {
    const audioBlob = await fetch("/assets/full-song-65s.wav").then((response) => response.blob());
    localStorage.setItem(key, JSON.stringify(value));
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("jianyin-web-clean-audio", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("files");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("files", "readwrite");
      tx.objectStore("files").put(audioBlob, "download_flac_flac_888");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, { key: storageKey, value: state });
  await page.reload();

  await page.getByRole("navigation").getByRole("button", { name: "我的" }).click();
  await page.locator(".section-title .section-action").first().click();
  await page.locator(".detail .song-row", { hasText: "Cached Refresh Song" }).click();
  await expectAudioPlaying(page);
  expect(resolveRequests).toBe(0);

  await expect.poll(() => page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    const state = raw ? JSON.parse(raw) : {};
    const song = state.downloadHistory?.find((item: { id?: string }) => item.id === "flac_888");
    return { localKey: song?.localKey ?? "", url: song?.url ?? "" };
  }, storageKey)).toEqual({ localKey: "download_flac_flac_888", url: "local-file:download_flac_flac_888" });
  await expect.poll(() => page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.currentSrc.startsWith("blob:"))).toBe(true);
});

test("download manager removes uncached download history entries", async ({ page }) => {
  const song = {
    id: "flac_uncached_history",
    name: "Uncached Download History",
    artist: "Cache Artist",
    pic: "/assets/icon.png",
    cover: "/assets/icon.png",
    url: "/api/flac/stream/uncached?format=mp3&bitrate=320&time=tuncached&sign=suncached",
    source: "flac",
    remotePlayable: true,
    verifiedPlayable: true,
    durationMs: 65000,
    br: 320000,
    level: "320k",
    type: "mp3",
    audioType: "mp3",
    quality: "320k",
    time: "tuncached",
    sign: "suncached"
  };
  const state = { ...testState(), downloadHistory: [song] };
  page.on("dialog", (dialog) => void dialog.accept());
  let forwardStateWrites = false;
  await page.route(/\/api\/state$/, async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ state }) });
      return;
    }
    if (forwardStateWrites) {
      await route.continue();
      return;
    }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true }) });
  });
  await page.request.post("/api/state", { data: { state } });
  const stateScript = await page.addInitScript(({ key, value }) => {
    localStorage.setItem(key, JSON.stringify(value));
  }, { key: storageKey, value: state });
  await page.reload();
  await stateScript.dispose();

  await page.getByRole("navigation").getByRole("button", { name: "我的" }).click();
  await expect(page.getByRole("button", { name: "删除下载" })).toBeVisible();
  await page.locator(".section-title .section-action").first().click();
  const manager = page.locator(".detail");
  const row = manager.locator(".song-row", { hasText: "Uncached Download History" });
  await expect(row).toHaveCount(1);
  await expect(row.getByRole("button", { name: "删除下载" })).toBeVisible();
  forwardStateWrites = true;
  await row.getByRole("button", { name: "删除下载" }).click();
  await expect(row).toHaveCount(0);
  await expect.poll(() => page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw).downloadHistory?.length ?? 0 : 0;
  }, storageKey)).toBe(0);
  await expect.poll(async () => {
    const response = await page.request.get("/api/state");
    const body = await response.json();
    return body.state?.downloadHistory?.length ?? 0;
  }).toBe(0);
});
