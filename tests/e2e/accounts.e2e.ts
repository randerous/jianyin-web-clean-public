import { expect, test } from "playwright/test";
import { fs, storageKey, projectRoot, toneFile, coverFile, fullSongFile, lrcFile, testSongs, testState, mockHome, reset, expectAudioPlaying, expectAudioPaused, expectAudioLongerThan, expectReadableToast, playFirstHomeSong, openPlayer, importLocalTone, openSettings, storedState, songNamesIn } from "../helpers/app-fixture";

test.beforeEach(async ({ page }) => {
  await reset(page);
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
