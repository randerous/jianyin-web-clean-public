import { expect, test } from "playwright/test";
import { fs, storageKey, projectRoot, toneFile, coverFile, fullSongFile, lrcFile, testSongs, testState, mockHome, reset, expectAudioPlaying, expectAudioPaused, expectAudioLongerThan, expectReadableToast, playFirstHomeSong, openPlayer, importLocalTone, openSettings, storedState, songNamesIn } from "../helpers/app-fixture";

test.beforeEach(async ({ page }) => {
  await reset(page);
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

test("toast stays readable above mobile playback controls", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await playFirstHomeSong(page);
  await expectAudioPlaying(page);
  await page.getByRole("navigation").getByRole("button", { name: "我的" }).click();
  await page.getByRole("button", { name: "创建歌单" }).click();
  await page.getByRole("dialog", { name: "创建新歌单" }).getByRole("button", { name: "创建" }).click();
  await expectReadableToast(page, "请输入歌单名称");
});

test("mobile playback controls do not push page content down", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await playFirstHomeSong(page);
  await expectAudioPlaying(page);
  await page.getByRole("navigation").getByRole("button", { name: "我的" }).click();

  const metrics = await page.evaluate(() => {
    const root = document.querySelector(".app-shell");
    const workspace = document.querySelector(".workspace");
    const topbar = document.querySelector(".topbar");
    const heading = document.querySelector(".topbar h1");
    const rectOf = (element: Element | null) => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return { top: rect.top, bottom: rect.bottom, paddingTop: parseFloat(style.paddingTop), marginTop: parseFloat(style.marginTop) };
    };
    return {
      rootClass: root?.className ?? "",
      workspace: rectOf(workspace),
      topbar: rectOf(topbar),
      heading: rectOf(heading)
    };
  });

  expect(metrics.rootClass).toContain("has-mini-player");
  expect(metrics.rootClass).not.toContain("has-live-player");
  expect(metrics.workspace?.paddingTop ?? 0).toBeLessThan(80);
  expect(Math.abs(metrics.topbar?.marginTop ?? 0)).toBeLessThan(80);
  expect(metrics.heading?.top ?? 999).toBeLessThan(130);
});

test("recent playback is newest-first and replay moves a song to the top", async ({ page }) => {
  await page.getByRole("navigation").getByRole("button", { name: "我的" }).click();
  await page.getByRole("button", { name: "热歌推荐 3 首歌曲" }).click();
  const playlist = page.getByRole("dialog", { name: "热歌推荐" });
  for (const name of ["邓紫棋 本地试听", "陈奕迅 本地试听", "周杰伦 本地试听"]) {
    await playlist.locator(".song-row", { hasText: name }).locator(".song-hit").click();
    await expect(page.locator(".now-playing")).toContainText(name);
  }
  await playlist.getByRole("button", { name: "返回" }).click();

  const recentShelf = page.locator(".shelf-row").first();
  await expect.poll(() => recentShelf.locator(".cover-caption strong").allInnerTexts()).toEqual([
    "周杰伦 本地试听",
    "陈奕迅 本地试听",
    "邓紫棋 本地试听"
  ]);

  await recentShelf.getByRole("button", { name: /邓紫棋 本地试听/ }).click();
  await expect(page.locator(".now-playing")).toContainText("邓紫棋 本地试听");
  await expect.poll(() => recentShelf.locator(".cover-caption strong").allInnerTexts()).toEqual([
    "邓紫棋 本地试听",
    "周杰伦 本地试听",
    "陈奕迅 本地试听"
  ]);
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
