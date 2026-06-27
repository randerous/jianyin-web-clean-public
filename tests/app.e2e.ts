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

async function mockHome(page: Page) {
  await page.route("**/api/netease/home**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        radarSongs: [
          { id: "home-1", name: "Home Radar Song", artist: "Home Artist", pic: "/assets/icon.png", url: "/assets/full-song-65s.wav", durationMs: 65000, verifiedPlayable: true, br: 320000, level: "exhigh", type: "mp3" }
        ],
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
  await page.request.delete("/api/state");
  await mockHome(page);
  await page.goto("/");
  await page.evaluate(async (key) => {
    localStorage.removeItem(key);
    await indexedDB.deleteDatabase("jianyin-web-clean-audio");
  }, storageKey);
  await page.reload();
}

async function selectSearchSource(page: Page, index: number) {
  await page.locator(".search-toolbar .segmented button").nth(index).click();
}

async function selectNeteaseSource(page: Page) {
  await selectSearchSource(page, 0);
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
  await page.locator("nav button").nth(2).click();
  await page.locator(".playlist-row").nth(1).locator("button").first().click();
  await page.locator(".detail .song-row").first().locator(".song-hit").click();
  await page.locator(".detail-head .plain-button").click();
}

async function importLocalTone(page: Page) {
  await page.getByRole("navigation").getByRole("button", { name: "鎴戠殑" }).click();
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "瀵煎叆鏈湴闊充箰" }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles(toneFile);
  await expect(page.getByRole("dialog", { name: "鏈湴姝屽崟_1棣?" })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await reset(page);
});

test("home shows Android 5 recommendation sections", async ({ page }) => {
  await expect(page.getByRole("heading", { name: "浠婃棩鎺ㄨ崘" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "鐑瓕鎺ㄨ崘" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "涓€у寲鎺ㄨ崘" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Home Radar Song/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Home Hot Song/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Home Playlist/ })).toBeVisible();
});

test("home song plays and opens player lyrics", async ({ page }) => {
  await playFirstHomeSong(page);
  await expect(page.locator(".now-playing")).toContainText("鍛ㄦ澃浼?鏈湴璇曞惉");
  await expectAudioPlaying(page);
  await expectAudioLongerThan(page, 60);
  await page.locator(".now-playing").click();
  const player = page.getByRole("dialog", { name: "鍛ㄦ澃浼?鏈湴璇曞惉" });
  await expect(player).toBeVisible();
  await expect(player).toContainText("浠?Android 5.0.0 鏍稿績浣撻獙閲嶅缓");
});

test("player more menu changes speed, progress style, and floating lyric", async ({ page }) => {
  await playFirstHomeSong(page);
  await expectAudioPlaying(page);
  await page.locator(".now-playing").click();
  const player = page.getByRole("dialog", { name: "鍛ㄦ澃浼?鏈湴璇曞惉" });
  await expect(player).toBeVisible();
  await player.getByRole("button", { name: "鏇村閫夐」" }).click();
  await player.getByRole("button", { name: "1.5x" }).click();
  await expect.poll(() => page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.playbackRate)).toBe(1.5);
  await player.getByLabel("杩涘害鏉℃牱寮?").selectOption("audio");
  await expect(player.locator(".wave-progress")).toBeVisible();
  await player.getByRole("button", { name: "寮€鍚闈㈡瓕璇?" }).first().click();
  await expect(page.getByRole("dialog", { name: "妗岄潰姝岃瘝" })).toBeVisible();
});

test("player controls pause, resume, seek, and move through full-length queue", async ({ page }) => {
  await playFirstHomeSong(page);
  await expectAudioPlaying(page);
  await page.locator(".now-playing").click();
  const player = page.getByRole("dialog", { name: "鍛ㄦ澃浼?鏈湴璇曞惉" });
  await expect(player).toBeVisible();

  await player.getByRole("button", { name: "鏆傚仠" }).click();
  await expectAudioPaused(page);
  await player.locator(".round-play").click();
  await expectAudioPlaying(page);

  await player.getByLabel("鎾斁杩涘害").fill("10");
  await expect.poll(() => page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThan(9);

  await player.getByRole("button", { name: "涓嬩竴棣?" }).click();
  await expect(page.locator(".now-playing")).toContainText("闄堝杩?鏈湴璇曞惉");
  await expectAudioPlaying(page);
  await expectAudioLongerThan(page, 60);

  await page.getByRole("dialog", { name: "闄堝杩?鏈湴璇曞惉" }).getByRole("button", { name: "涓婁竴棣?" }).click();
  await expect(page.locator(".now-playing")).toContainText("鍛ㄦ澃浼?鏈湴璇曞惉");
  await expectAudioPlaying(page);
  await expectAudioLongerThan(page, 60);

  const currentPlayer = page.getByRole("dialog", { name: "鍛ㄦ澃浼?鏈湴璇曞惉" });
  await currentPlayer.getByRole("button", { name: "鍒囨崲鎾斁妯″紡" }).click();
  await currentPlayer.getByRole("button", { name: "鍒囨崲鎾斁妯″紡" }).click();
  await currentPlayer.getByRole("button", { name: "鍒囨崲鎾斁妯″紡" }).click();
  await expect(currentPlayer.getByRole("button", { name: "涓嬩竴棣?" })).toBeEnabled();
});

test("searches local library and adds selections to a new playlist", async ({ page }) => {
  await page.getByRole("navigation").getByRole("button", { name: "鎴戠殑" }).click();
  await page.getByRole("button", { name: "鍒涘缓姝屽崟" }).click();
  await page.getByRole("dialog", { name: "鍒涘缓鏂版瓕鍗?" }).getByPlaceholder("姝屽崟鍚嶇О").fill("娴嬭瘯姝屽崟");
  await page.getByRole("dialog", { name: "鍒涘缓鏂版瓕鍗?" }).getByRole("button", { name: "鍒涘缓" }).click();
  await expect(page.getByRole("dialog", { name: "娴嬭瘯姝屽崟" })).toBeVisible();
  await page.getByRole("button", { name: "杩斿洖" }).click();

  await page.getByRole("navigation").getByRole("button", { name: "鎼滅储" }).click();
  await page.getByPlaceholder("鎼滅储闊充箰/姝屾墜").fill("璇曞惉");
  await page.keyboard.press("Enter");
  await page.locator(".song-row", { hasText: "鍛ㄦ澃浼?鏈湴璇曞惉" }).getByRole("button", { name: "閫夋嫨姝屾洸" }).click();
  await page.locator(".song-row", { hasText: "闄堝杩?鏈湴璇曞惉" }).getByRole("button", { name: "閫夋嫨姝屾洸" }).click();
  await expect(page.locator(".selection-bar")).toContainText("宸查€夋嫨 2 棣?");
  await page.locator(".selection-bar select").selectOption({ label: "娴嬭瘯姝屽崟" });

  await page.getByRole("navigation").getByRole("button", { name: "鎴戠殑" }).click();
  await page.getByRole("button", { name: "娴嬭瘯姝屽崟 2 棣栨瓕鏇?" }).click();
  await expect(page.getByRole("dialog", { name: "娴嬭瘯姝屽崟" })).toContainText("鍛ㄦ澃浼?鏈湴璇曞惉");
  await expect(page.getByRole("dialog", { name: "娴嬭瘯姝屽崟" })).toContainText("闄堝杩?鏈湴璇曞惉");
  await page.getByRole("button", { name: "杩斿洖" }).click();
  await expect(page.getByRole("button", { name: "娴嬭瘯姝屽崟 2 棣栨瓕鏇?" })).toBeVisible();
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
          name: "璺ㄦ祻瑙堝櫒杩滅▼姝屽崟",
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
  await page.getByRole("navigation").getByRole("button", { name: "鎴戠殑" }).click();
  await page.getByRole("button", { name: "瀵煎叆缃戞槗浜戞瓕鍗?" }).click();
  const importDialog = page.getByRole("dialog", { name: "瀵煎叆缃戞槗浜戞瓕鍗?" });
  await importDialog.getByPlaceholder("姝屽崟 ID 鎴栧垎浜摼鎺?").fill("3778678");
  await importDialog.getByRole("button", { name: "瀵煎叆" }).click();
  await page.getByRole("dialog", { name: "璺ㄦ祻瑙堝櫒杩滅▼姝屽崟" }).getByRole("button", { name: "杩斿洖" }).click();
  await expect(page.getByRole("button", { name: "璺ㄦ祻瑙堝櫒杩滅▼姝屽崟 1 棣栨瓕鏇?" })).toBeVisible();
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
  await cleanPage.getByRole("navigation").getByRole("button", { name: "鎴戠殑" }).click();
  await expect(cleanPage.getByRole("button", { name: "璺ㄦ祻瑙堝櫒杩滅▼姝屽崟 1 棣栨瓕鏇?" })).toBeVisible();
  await cleanPage.getByRole("button", { name: "璺ㄦ祻瑙堝櫒杩滅▼姝屽崟 1 棣栨瓕鏇?" }).click();
  const playlist = cleanPage.getByRole("dialog", { name: "璺ㄦ祻瑙堝櫒杩滅▼姝屽崟" });
  await expect(playlist).toContainText("Remote Playlist Song");
  await playlist.getByRole("button", { name: "Remote Playlist Song Cloud Artist 路 缃戞槗浜?" }).click();
  await expectAudioPlaying(cleanPage);
  await expectAudioLongerThan(cleanPage, 60);
  await clean.close();
});

test("playlist detail searches visible songs and downloads selected", async ({ page }) => {
  await page.getByRole("navigation").getByRole("button", { name: "鎴戠殑" }).click();
  await page.getByRole("button", { name: "鐑瓕鎺ㄨ崘 4 棣栨瓕鏇?" }).click();
  const playlist = page.getByRole("dialog", { name: "鐑瓕鎺ㄨ崘" });
  await expect(playlist).toBeVisible();
  await playlist.getByPlaceholder("鎼滅储姝屾洸").fill("闄堝杩?");
  await expect(playlist).toContainText("闄堝杩?鏈湴璇曞惉");
  await expect(playlist).not.toContainText("閭撶传妫?鏈湴璇曞惉");
  await playlist.getByRole("button", { name: "鍏ㄩ€夊彲瑙?" }).click();
  await expect(playlist.getByRole("button", { name: "涓嬭浇鎵€閫?" })).toBeEnabled();
  const downloadPromise = page.waitForEvent("download");
  await playlist.getByRole("button", { name: "涓嬭浇鎵€閫?" }).click();
  await downloadPromise;
});

test("local import persists across reload", async ({ page }) => {
  await importLocalTone(page);
  await expect(page.getByRole("button", { name: /demo-tone/ })).toBeVisible();
  await page.reload();
  await page.getByRole("navigation").getByRole("button", { name: "鎴戠殑" }).click();
  await page.getByRole("button", { name: "鏈湴姝屽崟_1棣?" }).click();
  await expect(page.getByRole("dialog", { name: "鏈湴姝屽崟_1棣?" })).toContainText("demo-tone");
  await expect(page.getByText("闇€閲嶆柊瀵煎叆")).toHaveCount(0);
  await page.getByRole("dialog", { name: "鏈湴姝屽崟_1棣?" }).getByRole("button", { name: /demo-tone/ }).click();
  await expectAudioPlaying(page);
});

test("backup restores local audio in a clean context", async ({ page, browser }) => {
  await importLocalTone(page);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "杩斿洖" }).click();
  await page.getByRole("button", { name: "澶囦唤鏁版嵁" }).click();
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
  await cleanPage.getByRole("navigation").getByRole("button", { name: "鎴戠殑" }).click();
  const chooserPromise = cleanPage.waitForEvent("filechooser");
  await cleanPage.getByRole("button", { name: "鎭㈠澶囦唤" }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles(backupPath!);
  await expect(cleanPage.getByRole("button", { name: "鏈湴姝屽崟_1棣?" })).toBeVisible();
  await cleanPage.getByRole("button", { name: "鏈湴姝屽崟_1棣?" }).click();
  await cleanPage.getByRole("button", { name: /demo-tone/ }).click();
  await expectAudioPlaying(cleanPage);
  await clean.close();
});

test("local audio shared metadata in clean context requires reimport", async ({ page, browser }) => {
  await importLocalTone(page);
  await page.getByRole("button", { name: "杩斿洖" }).click();
  await expect.poll(async () => {
    const state = await page.request.get("/api/state");
    return JSON.stringify((await state.json()).state ?? {}).includes("local-file:");
  }).toBe(true);

  const clean = await browser.newContext();
  const cleanPage = await clean.newPage();
  await mockHome(cleanPage);
  await cleanPage.goto("/");
  await cleanPage.getByRole("navigation").getByRole("button", { name: "鎴戠殑" }).click();
  await expect(cleanPage.getByRole("button", { name: "鏈湴姝屽崟_1棣?" })).toBeVisible();
  await cleanPage.getByRole("button", { name: "鏈湴姝屽崟_1棣?" }).click();
  const dialog = cleanPage.getByRole("dialog", { name: "鏈湴姝屽崟_1棣?" });
  await expect(dialog).toContainText("闇€閲嶆柊瀵煎叆");
  await dialog.locator(".song-row", { hasText: "demo-tone" }).getByRole("button", { name: /demo-tone/ }).click();
  await expect(cleanPage.locator(".toast")).toContainText("鏈湴鏂囦欢涓嶅湪褰撳墠娴忚鍣紝璇烽噸鏂板鍏?");
  await expectAudioPaused(cleanPage);
  await expect.poll(() => cleanPage.locator("audio").evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBe(0);

  await dialog.getByRole("button", { name: "鍏ㄩ€夊彲瑙?" }).click();
  await dialog.getByRole("button", { name: "鍔犲叆闃熷垪" }).click();
  await expect(cleanPage.locator(".toast")).toContainText("娌℃湁鍙姞鍏ユ挱鏀鹃槦鍒楃殑姝屾洸");
  await clean.close();
});

test("netease mocked search resolves url and lyrics", async ({ page }) => {
  await page.route("**/api/netease/search**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        songs: [
          {
            id: "12345",
            name: "MockFullSong",
            artist: "Mock Artist",
            pic: "/assets/icon.png",
            url: "/assets/full-song-65s.wav",
            lrc: "[00:00.00]mock lyric line",
            durationMs: 65000,
            verifiedPlayable: true
          }
        ],
        filtered: 3
      })
    });
  });
  await page.route("**/api/netease/song/12345**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        url: "/assets/full-song-65s.wav",
        lrc: "[00:00.00]mock lyric line",
        durationMs: 65000,
        verifiedPlayable: true,
        br: 999000,
        level: "lossless",
        type: "flac",
        audioType: "flac"
      })
    });
  });

  await page.getByRole("navigation").getByRole("button", { name: "鎼滅储" }).click();
  await selectNeteaseSource(page);
  await page.getByPlaceholder("鎼滅储闊充箰/姝屾墜").fill("MockFullSong");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "MockFullSong Mock Artist 路 缃戞槗浜?" }).click();
  await expect(page.locator(".now-playing")).toContainText("MockFullSong");
  await expectAudioPlaying(page);
  await expectAudioLongerThan(page, 60);
  await page.locator(".now-playing").click();
  await expect(page.getByRole("dialog", { name: "MockFullSong" })).toContainText("mock lyric line");
  await expect(page.getByText("TrialOnly")).toHaveCount(0);
  await expect(page.getByText("ThirtySecond")).toHaveCount(0);
  await expect(page.getByText("NoUrl")).toHaveCount(0);
});

test("netease search hides unplayable, trial, and 30 second songs", async ({ page }) => {
  await page.route("**/api/netease/search**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        songs: [
          {
            id: "ok-song",
            name: "OnlyFullSong",
            artist: "Verified Artist",
            pic: "/assets/icon.png",
            url: "/assets/full-song-65s.wav",
            durationMs: 65000,
            verifiedPlayable: true
          }
        ],
        filtered: 3
      })
    });
  });

  await page.getByRole("navigation").getByRole("button", { name: "鎼滅储" }).click();
  await selectNeteaseSource(page);
  await page.getByPlaceholder("鎼滅储闊充箰/姝屾墜").fill("OnlyFullSong");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "OnlyFullSong Verified Artist 路 缃戞槗浜?" })).toBeVisible();
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

  await page.getByRole("navigation").getByRole("button", { name: "鎴戠殑" }).click();
  await page.getByRole("button", { name: "瀵煎叆缃戞槗浜戞瓕鍗?" }).click();
  const dialog = page.getByRole("dialog", { name: "瀵煎叆缃戞槗浜戞瓕鍗?" });
  await dialog.getByPlaceholder("姝屽崟 ID 鎴栧垎浜摼鎺?").fill("https://music.163.com/#/playlist?id=3778678");
  await dialog.getByRole("button", { name: "瀵煎叆" }).click();
  const playlist = page.getByRole("dialog", { name: "Mock Playlist" });
  await expect(playlist).toBeVisible();
  await playlist.getByRole("button", { name: "Playlist Song Playlist Artist 路 缃戞槗浜?" }).click();
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
        message: "杩欎釜鍏紑姝屽崟娌℃湁鍙畬鏁存挱鏀炬瓕鏇?"
      })
    });
  });

  await page.getByRole("navigation").getByRole("button", { name: "鎴戠殑" }).click();
  const playlistCount = await page.locator(".playlist-row").count();
  await page.getByRole("button", { name: "瀵煎叆缃戞槗浜戞瓕鍗?" }).click();
  const dialog = page.getByRole("dialog", { name: "瀵煎叆缃戞槗浜戞瓕鍗?" });
  await dialog.getByPlaceholder("姝屽崟 ID 鎴栧垎浜摼鎺?").fill("3778678");
  await dialog.getByRole("button", { name: "瀵煎叆" }).click();

  await expect(dialog).toContainText("杩欎釜鍏紑姝屽崟娌℃湁鍙畬鏁存挱鏀炬瓕鏇?");
  await expect(page.locator(".playlist-row")).toHaveCount(playlistCount);
  await expect(page.getByRole("dialog", { name: "瀵煎叆缃戞槗浜戞瓕鍗?" })).toBeVisible();
});

test("quality selector controls search, immediate playback, and download quality", async ({ page }) => {
  const searchRequests: string[] = [];
  const songRequests: string[] = [];
  await page.route("**/api/netease/search**", async (route) => {
    searchRequests.push(new URL(route.request().url()).searchParams.get("quality") || "");
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        songs: [{
          id: "quality-song",
          name: "Quality Song",
          artist: "Quality Artist",
          pic: "/assets/icon.png",
          url: "/api/netease/stream/quality-song?quality=lossless",
          durationMs: 65000,
          verifiedPlayable: true,
          br: 999000,
          level: "lossless",
          type: "flac"
        }]
      })
    });
  });
  await page.route("**/api/netease/song/quality-song**", async (route) => {
    songRequests.push(new URL(route.request().url()).searchParams.get("quality") || "");
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        url: "/assets/full-song-65s.wav",
        lrc: "[00:00.00]quality lyric",
        durationMs: 65000,
        verifiedPlayable: true,
        br: songRequests.at(-1) === "standard" ? 128000 : 999000,
        level: songRequests.at(-1),
        type: "mp3",
        audioType: "mp3"
      })
    });
  });
  await page.route("**/api/netease/stream/quality-song**", async (route) => {
    await route.fulfill({ path: fullSongFile });
  });

  await page.getByRole("navigation").getByRole("button", { name: "鎼滅储" }).click();
  await selectNeteaseSource(page);
  await page.locator(".search-toolbar").getByRole("combobox").selectOption("lossless");
  await page.getByPlaceholder("鎼滅储闊充箰/姝屾墜").fill("Quality Song");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Quality Song Quality Artist 路 缃戞槗浜?" })).toBeVisible();
  expect(searchRequests).toContain("lossless");
  await page.getByRole("button", { name: "Quality Song Quality Artist 路 缃戞槗浜?" }).click();
  await expect(page.locator(".now-playing")).toContainText("Quality Song");
  await expectAudioPlaying(page);
  await expectAudioLongerThan(page, 60);
  expect(songRequests).not.toContain("lossless");

  await page.getByRole("navigation").getByRole("button", { name: "鎴戠殑" }).click();
  await page.locator(".action-grid").getByRole("button", { name: "璁剧疆" }).click();
  await page.getByRole("dialog", { name: "璁剧疆" }).getByLabel("涓嬭浇闊宠川").selectOption("standard");
  await page.getByRole("dialog", { name: "璁剧疆" }).getByRole("button", { name: "鍏抽棴" }).click();
  const downloadPromise = page.waitForEvent("download");
  await page.locator(".now-playing").click();
  const player = page.getByRole("dialog", { name: "Quality Song" });
  await player.getByRole("button", { name: "鏇村閫夐」" }).click();
  await player.getByRole("button", { name: "涓嬭浇姝屾洸" }).click();
  await downloadPromise;
  expect(songRequests).toContain("standard");
});

test("slow search response cannot overwrite newer search results", async ({ page }) => {
  await page.route("**/api/netease/search**", async (route) => {
    const keyword = new URL(route.request().url()).searchParams.get("keyword");
    if (keyword === "slow") await new Promise((resolve) => setTimeout(resolve, 220));
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        songs: [{
          id: keyword === "slow" ? "slow-id" : "fast-id",
          name: keyword === "slow" ? "Slow Result" : "Fast Result",
          artist: "Race Artist",
          pic: "/assets/icon.png",
          url: "/assets/full-song-65s.wav",
          durationMs: 65000,
          verifiedPlayable: true
        }]
      })
    });
  });
  await page.getByRole("navigation").getByRole("button", { name: "鎼滅储" }).click();
  await selectNeteaseSource(page);
  await page.getByPlaceholder("鎼滅储闊充箰/姝屾墜").fill("slow");
  await page.keyboard.press("Enter");
  await page.getByPlaceholder("鎼滅储闊充箰/姝屾墜").fill("fast");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Fast Result Race Artist 路 缃戞槗浜?" })).toBeVisible();
  await expect(page.getByText("Slow Result")).toHaveCount(0);
});

test("switching search source clears stale results and ignores old source responses", async ({ page }) => {
  await page.route("**/api/netease/search**", async (route) => {
    const keyword = new URL(route.request().url()).searchParams.get("keyword");
    if (keyword === "slow-cloud") await new Promise((resolve) => setTimeout(resolve, 250));
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        songs: [{
          id: keyword === "slow-cloud" ? "slow-cloud-id" : "cloud-id",
          name: keyword === "slow-cloud" ? "Slow Cloud Result" : "Cloud Result",
          artist: "Cloud Artist",
          pic: "/assets/icon.png",
          url: "/assets/full-song-65s.wav",
          durationMs: 65000,
          verifiedPlayable: true
        }]
      })
    });
  });
  await page.route("**/api/bili/search**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ songs: [{ id: "bili_fast_123", name: "Bili Fresh Result", artist: "Bili UP", pic: "/assets/icon.png", url: "/assets/full-song-65s.wav", durationMs: 65000, verifiedPlayable: true, source: "bili", bvid: "BVfresh", cid: 123 }] })
    });
  });

  await page.getByRole("navigation").getByRole("button", { name: "鎼滅储" }).click();
  await selectNeteaseSource(page);
  await page.getByPlaceholder("鎼滅储闊充箰/姝屾墜").fill("cloud");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Cloud Result Cloud Artist 路 缃戞槗浜?" })).toBeVisible();
  await page.locator(".search-toolbar").getByRole("button", { name: "Bili" }).click();
  await expect(page.getByText("Cloud Result")).toHaveCount(0);

  await page.locator(".search-toolbar").getByRole("button", { name: "缃戞槗浜?" }).click();
  await page.getByPlaceholder("鎼滅储闊充箰/姝屾墜").fill("slow-cloud");
  await page.keyboard.press("Enter");
  await page.locator(".search-toolbar").getByRole("button", { name: "Bili" }).click();
  await page.getByPlaceholder("鎼滅储闊充箰/姝屾墜").fill("bili");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Bili Fresh Result Bili UP 路 Bilibili" })).toBeVisible();
  await expect(page.getByText("Slow Cloud Result")).toHaveCount(0);
});

test("empty keyword sends no search request", async ({ page }) => {
  let searchCalls = 0;
  await page.route(/\/api\/(netease|bili|flac)\/search.*/, async (route) => {
    searchCalls += 1;
    await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "should not search blank keyword" }) });
  });

  await page.getByRole("navigation").getByRole("button", { name: "鎼滅储" }).click();
  for (const source of ["缃戞槗浜?", "Bili", "娴嬭瘯婧?"]) {
    await page.locator(".search-toolbar").getByRole("button", { name: source }).click().catch(() => undefined);
    await page.getByPlaceholder("鎼滅储闊充箰/姝屾墜").fill("   ");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("main").getByRole("button", { name: "鎼滅储" })).toBeVisible();
  }

  expect(searchCalls).toBe(0);
  await expect(page.getByText("should not search blank keyword")).toHaveCount(0);
});

test("source switch clears stale loading immediately", async ({ page }) => {
  await page.route("**/api/netease/search**", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 600));
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ songs: [{ id: "stale", name: "Stale Loading Result", artist: "Cloud", pic: "/assets/icon.png", url: "/assets/full-song-65s.wav", durationMs: 65000, verifiedPlayable: true }] })
    });
  });

  await page.getByRole("navigation").getByRole("button", { name: "鎼滅储" }).click();
  await page.getByPlaceholder("鎼滅储闊充箰/姝屾墜").fill("stale");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "鎼滅储涓?" })).toBeVisible();
  await page.locator(".search-toolbar").getByRole("button", { name: "Bili" }).click();
  await expect(page.getByRole("main").getByRole("button", { name: "鎼滅储" })).toBeVisible();
  await expect(page.getByText("Stale Loading Result")).toHaveCount(0);
});

test("player queue can reorder songs and local lrc/cover persist", async ({ page }) => {
  await playFirstHomeSong(page);
  await page.locator(".now-playing").click();
  const player = page.locator(".player-sheet");
  await expect(player).toBeVisible();
  await player.locator(".more-menu > .icon-button").click();
  const lrcChooserPromise = page.waitForEvent("filechooser");
  await player.locator(".more-panel button").nth(1).click();
  const lrcChooser = await lrcChooserPromise;
  await lrcChooser.setFiles(lrcFile);
  await expect(player).toContainText("custom lrc line");

  await player.locator(".more-menu > .icon-button").click();
  const coverChooserPromise = page.waitForEvent("filechooser");
  await player.locator(".more-panel button").nth(2).click();
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
  await playFirstHomeSong(page);
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

  await page.getByRole("navigation").getByRole("button", { name: "鎴戠殑" }).click();
  await page.getByRole("button", { name: "璐﹀彿鍚屾" }).click();
  const dialog = page.getByRole("dialog", { name: "璐﹀彿绠＄悊" });
  await dialog.getByPlaceholder(/MUSIC_U/).fill("MUSIC_U=mock");
  await dialog.getByRole("button", { name: "楠岃瘉骞跺悓姝?" }).click();
  await expect(page.getByRole("button", { name: "Synced Netease 1 棣栨瓕鏇?" })).toBeVisible();
  await page.getByRole("dialog", { name: "Synced Netease" }).getByRole("button", { name: "杩斿洖" }).click();

  await page.getByRole("button", { name: "璐﹀彿鍚屾" }).click();
  const biliDialog = page.getByRole("dialog", { name: "璐﹀彿绠＄悊" });
  await biliDialog.getByRole("button", { name: "Bili", exact: true }).click();
  await biliDialog.getByPlaceholder(/SESSDATA/).fill("SESSDATA=mock; DedeUserID=456; bili_jct=csrf");
  await biliDialog.getByRole("button", { name: "楠岃瘉骞跺悓姝?" }).click();
  await expect(page.getByRole("button", { name: "Synced Bili 1 棣栨瓕鏇?" })).toBeVisible();
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
      body: JSON.stringify({ error: "netease_login_invalid", message: "缃戞槗浜?Cookie 鏃犳硶楠岃瘉" })
    });
  });
  await page.route("**/api/netease/account/playlists**", async (route) => {
    await route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: "netease_sync_failed", message: "缃戞槗浜戝悓姝ュけ璐?mock" })
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
      body: JSON.stringify({ error: "bili_login_invalid", message: "Bili Cookie 鏃犳硶楠岃瘉" })
    });
  });
  await page.route("**/api/bili/account/playlists**", async (route) => {
    await route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: "bili_sync_failed", message: "Bili 鏀惰棌澶瑰悓姝ュけ璐?mock" })
    });
  });

  await page.getByRole("navigation").getByRole("button", { name: "鎴戠殑" }).click();
  const startingCount = await page.locator(".playlist-row").count();
  await page.getByRole("button", { name: "璐﹀彿鍚屾" }).click();
  const dialog = page.getByRole("dialog", { name: "璐﹀彿绠＄悊" });
  await dialog.getByPlaceholder(/MUSIC_U/).fill("MUSIC_U=fake");
  await dialog.getByRole("button", { name: "楠岃瘉骞跺悓姝?" }).click();
  await expect(dialog).toContainText("缃戞槗浜?Cookie 鏃犳硶楠岃瘉");
  await expect(page.locator(".playlist-row")).toHaveCount(startingCount);
  await expect(page.getByText("Invalid Netease")).toHaveCount(0);

  neteaseLoginMode = "valid";
  await dialog.getByPlaceholder(/MUSIC_U/).fill("MUSIC_U=mock-valid");
  await dialog.getByRole("button", { name: "楠岃瘉骞跺悓姝?" }).click();
  await expect(dialog).toContainText("缃戞槗浜戝悓姝ュけ璐?mock");
  await expect(page.locator(".playlist-row")).toHaveCount(startingCount);
  await expect(page.getByRole("button", { name: /Synced Netease/ })).toHaveCount(0);

  await dialog.getByRole("button", { name: "Bili", exact: true }).click();
  await dialog.getByPlaceholder(/SESSDATA/).fill("SESSDATA=fake; DedeUserID=456");
  await dialog.getByRole("button", { name: "楠岃瘉骞跺悓姝?" }).click();
  await expect(dialog).toContainText("Bili Cookie 鏃犳硶楠岃瘉");
  await expect(page.locator(".playlist-row")).toHaveCount(startingCount);

  biliLoginMode = "valid";
  await dialog.getByPlaceholder(/SESSDATA/).fill("SESSDATA=mock-valid; DedeUserID=456; bili_jct=csrf");
  await dialog.getByRole("button", { name: "楠岃瘉骞跺悓姝?" }).click();
  await expect(dialog).toContainText("Bili 鏀惰棌澶瑰悓姝ュけ璐?mock");
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

  await page.getByRole("navigation").getByRole("button", { name: "鎴戠殑" }).click();
  await page.getByRole("button", { name: "璐﹀彿鍚屾" }).click();
  const dialog = page.getByRole("dialog", { name: "璐﹀彿绠＄悊" });
  await dialog.getByPlaceholder(/MUSIC_U/).fill("MUSIC_U=secret-token");
  await dialog.getByRole("button", { name: "楠岃瘉骞跺悓姝?" }).click();
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

  await page.getByRole("navigation").getByRole("button", { name: "鎴戠殑" }).click();
  await page.getByRole("button", { name: "璐﹀彿鍚屾" }).click();
  let dialog = page.getByRole("dialog", { name: "璐﹀彿绠＄悊" });
  await dialog.getByRole("button", { name: "Bili", exact: true }).click();
  await dialog.getByPlaceholder(/SESSDATA/).fill("SESSDATA=mock; DedeUserID=456; bili_jct=csrf");
  await dialog.getByRole("button", { name: "楠岃瘉骞跺悓姝?" }).click();
  await expect(page.getByRole("button", { name: "Synced Bili Logout 1 棣栨瓕鏇?" })).toBeVisible();
  await page.getByRole("dialog", { name: "Synced Bili Logout" }).getByRole("button", { name: "杩斿洖" }).click();

  await page.getByRole("button", { name: "璐﹀彿鍚屾" }).click();
  dialog = page.getByRole("dialog", { name: "璐﹀彿绠＄悊" });
  await dialog.getByRole("button", { name: "閫€鍑?Bili" }).click();
  await expect(page.getByRole("button", { name: "Synced Bili Logout 1 棣栨瓕鏇?" })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "鍚屾 Bili 鏀惰棌澶?" })).toBeDisabled();
  await expect(dialog).toContainText("鏈櫥褰?");
});

test("bili explicit search resolves and plays through bili stream endpoint", async ({ page }) => {
  await page.route("**/api/bili/search**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ songs: [{ id: "bili_BV1abc_123", name: "Bili Full Song", artist: "Bili UP", pic: "/assets/icon.png", url: "/assets/full-song-65s.wav", durationMs: 65000, verifiedPlayable: true, source: "bili", bvid: "BV1abc", cid: 123 }] })
    });
  });
  await page.route("**/api/bili/song/BV1abc**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ url: "/assets/full-song-65s.wav", durationMs: 65000, verifiedPlayable: true, br: 192000, level: "high", audioType: "mp4a.40.2" })
    });
  });

  await page.getByRole("navigation").getByRole("button", { name: "鎼滅储" }).click();
  await page.locator(".search-toolbar").getByRole("button", { name: "Bili" }).click();
  await page.getByPlaceholder("鎼滅储闊充箰/姝屾墜").fill("Bili Full Song");
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: "Bili Full Song Bili UP 路 Bilibili" }).click();
  await expect(page.locator(".now-playing")).toContainText("Bili Full Song");
  await expectAudioPlaying(page);
  await expectAudioLongerThan(page, 60);
});

test("flac test source searches, filters, resolves, and plays full songs", async ({ page }) => {
  const searchRequests: URLSearchParams[] = [];
  const songRequests: string[] = [];
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
    songRequests.push(url.searchParams.toString());
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        url: "/assets/full-song-65s.wav",
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
  await page.route("**/api/lyrics**", async (route) => {
    const url = new URL(route.request().url());
    expect(url.searchParams.get("name")).toBe("Boogie Wonderland");
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ lrc: "[00:00.00]dance with me", provider: "netease", id: "netease_91" })
    });
  });

  await page.locator("nav button").nth(1).click();
  await page.locator(".search-toolbar .segmented button").nth(2).click();
  await expect(page.locator(".network-line")).toContainText("FLAC/320k");
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

  await page.locator(".song-row", { hasText: "Boogie Wonderland" }).locator(".song-hit").click();
  await expect(page.locator(".now-playing")).toContainText("Boogie Wonderland");
  await expectAudioPlaying(page);
  await expectAudioLongerThan(page, 60);
  expect(songRequests).toEqual(["format=flac&bitrate=2000&time=23456&sign=signed2"]);
  await expect.poll(() => page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.src)).toContain("full-song-65s.wav");
  await page.locator(".now-playing").click();
  await expect(page.locator(".player-sheet")).toContainText("dance with me");
});

test("flac playback refreshes expired search signature before playing", async ({ page }) => {
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
    if (url.searchParams.get("sign") === "old-sign") {
      await route.fulfill({ status: 410, contentType: "text/plain", body: "expired" });
      return;
    }
    await route.fulfill({
      path: fullSongFile,
      headers: {
        "content-type": "audio/wav",
        "accept-ranges": "bytes"
      }
    });
  });

  await page.locator("nav button").nth(1).click();
  await page.locator(".search-toolbar .segmented button").nth(2).click();
  await page.locator('.search-box input[name="keyword"]').fill("September Earth Wind Fire");
  await page.keyboard.press("Enter");
  await expect(page.locator(".song-row", { hasText: "September" })).toBeVisible();
  await page.locator(".song-row", { hasText: "September" }).locator(".song-hit").click();

  await expect(page.locator(".now-playing")).toContainText("September");
  await expectAudioPlaying(page);
  expect(searchRequests.length).toBeGreaterThanOrEqual(2);
  expect(songRequests.some((query) => query.includes("sign=old-sign"))).toBe(false);
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
  await page.locator(".search-toolbar .segmented button").nth(2).click();
  await page.locator('.search-box input[name="keyword"]').fill("September Earth Wind Fire");
  await page.keyboard.press("Enter");
  await expect(page.locator(".song-row", { hasText: "September" })).toBeVisible();
  await page.locator(".song-row", { hasText: "September" }).locator(".song-hit").click();
  await expectAudioPlaying(page);
  await expect.poll(() => page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.src)).toContain("fresh-2-sign");
  await expect.poll(() => page.evaluate(() => typeof window.JianyinRecoverAudio)).toBe("function");

  await page.locator("audio").evaluate((audio: HTMLAudioElement) => {
    audio.currentTime = 37;
    audio.dispatchEvent(new Event("timeupdate"));
  });
  await page.evaluate(() => window.JianyinRecoverAudio?.());

  await expect.poll(() => page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.src)).toContain("fresh-3-sign");
  await expect.poll(() => page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThan(36);
  expect(searchRequests.length).toBeGreaterThanOrEqual(3);
  expect(songRequests.some((query) => query.includes("sign=fresh-3-sign"))).toBe(true);
});

test("flac search queue refreshes expired signatures when advancing", async ({ page }) => {
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
    if (url.searchParams.get("sign")?.startsWith("old-sign")) {
      await route.fulfill({ status: 410, contentType: "text/plain", body: "expired" });
      return;
    }
    await route.fulfill({
      path: fullSongFile,
      headers: {
        "content-type": "audio/wav",
        "accept-ranges": "bytes"
      }
    });
  });

  await page.locator("nav button").nth(1).click();
  await page.locator(".search-toolbar .segmented button").nth(2).click();
  await page.locator('.search-box input[name="keyword"]').fill("Queue Artist");
  await page.keyboard.press("Enter");
  await expect(page.locator(".song-row", { hasText: "First Track" })).toBeVisible();
  await page.locator(".song-row", { hasText: "First Track" }).locator(".song-hit").click();
  await expect(page.locator(".now-playing")).toContainText("First Track");
  await expectAudioPlaying(page);

  await page.locator('button[aria-label="下一首"]').click();
  await expect(page.locator(".now-playing")).toContainText("Second Track");
  await expectAudioPlaying(page);

  expect(searchRequests).toContain("First Track Queue Artist");
  expect(searchRequests).toContain("Second Track Queue Artist");
  expect(songRequests.some((query) => query.includes("old-sign"))).toBe(false);
  expect(songRequests.some((query) => query.includes("fresh-sign-flac_111"))).toBe(true);
  expect(songRequests.some((query) => query.includes("fresh-sign-flac_222"))).toBe(true);
  expect(streamRequests.some((query) => query.includes("old-sign"))).toBe(false);
  expect(streamRequests.some((query) => query.includes("fresh-sign-flac_222"))).toBe(true);
});
