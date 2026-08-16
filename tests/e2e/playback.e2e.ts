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

test("the first play click resumes audio paused by the browser in the background", async ({ page }) => {
  await playFirstHomeSong(page);
  await expectAudioPlaying(page);
  const before = await page.locator("audio").evaluate((audio: HTMLAudioElement) => {
    audio.currentTime = 12;
    audio.dispatchEvent(new Event("timeupdate"));
    audio.pause();
    return audio.currentTime;
  });
  await expectAudioPaused(page);

  await page.getByRole("button", { name: "暂停", exact: true }).click();

  await expectAudioPlaying(page);
  await expect.poll(() => page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.currentTime)).toBeGreaterThan(before);
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

  const miniPlayer = await page.locator(".now-playing").evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      height: element.getBoundingClientRect().height,
      gridRows: style.gridTemplateRows.split(" ").filter(Boolean),
      progressPosition: getComputedStyle(element.querySelector(".mini-progress")!).position
    };
  });
  expect(miniPlayer.height).toBeLessThanOrEqual(68);
  expect(miniPlayer.gridRows).toHaveLength(1);
  expect(miniPlayer.progressPosition).toBe("absolute");
});

test("mobile navigation stays at the top and playback is the only bottom bar", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await playFirstHomeSong(page);
  await expectAudioPlaying(page);

  const topNavigation = page.locator(".mobile-top-nav");
  const player = page.locator(".now-playing");
  await expect(topNavigation).toBeVisible();
  await expect(player).toBeVisible();
  await expect(page.locator(".mobile-nav")).toHaveCount(0);

  const layout = await page.evaluate(() => {
    const navigationRect = document.querySelector(".mobile-top-nav")!.getBoundingClientRect();
    const playerRect = document.querySelector(".now-playing")!.getBoundingClientRect();
    return {
      navigationTop: navigationRect.top,
      playerBottom: playerRect.bottom,
      viewportHeight: window.innerHeight
    };
  });

  expect(layout.navigationTop).toBeLessThan(24);
  expect(layout.playerBottom).toBeGreaterThan(layout.viewportHeight - 24);

  await topNavigation.getByRole("button", { name: "搜索" }).click();
  await expect(page.getByRole("heading", { name: "搜索" })).toBeVisible();
  await topNavigation.getByRole("button", { name: "我的" }).click();
  await expect(page.getByRole("heading", { name: "我的音乐" })).toBeVisible();
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

test("WebAudio EQ is opt-in, applies presets on desktop, and transparently bypasses without stopping playback", async ({ page }) => {
  type EqDebug = {
    supported: boolean;
    supportReason: string;
    contextState: string | null;
    wired: boolean;
    preset: string;
    intensity: number;
    bypass: boolean;
    bandGains: number[];
    bandFrequencies: number[];
  };
  const eqInfo = () => page.evaluate(() => {
    const hook = (window as unknown as { JianyinAudioEffects?: { getDebugInfo: () => EqDebug } }).JianyinAudioEffects;
    return hook ? hook.getDebugInfo() : null;
  });
  const expectElementPlaying = () => expect.poll(() => page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.paused)).toBe(false);

  await playFirstHomeSong(page);
  await expectElementPlaying();
  const player = await openPlayer(page);
  await player.getByRole("button", { name: "更多选项" }).click();

  // 默认关闭：未接线、旁路，元素直通。
  await expect.poll(eqInfo).toMatchObject({ supported: true, wired: false, preset: "none", bypass: true });

  // 打开 hiFi：在播放中同步接线并应用预设，播放不能停。
  await player.getByLabel("均衡器预设").selectOption("hiFi");
  await expect.poll(eqInfo).toMatchObject({ supported: true, contextState: "running", preset: "hiFi", intensity: 100, bypass: false, wired: true });
  await expect.poll(async () => (await eqInfo())?.bandGains).toEqual([-1, 1, 2, 3, 3, 1, 0, -1, -1, 0]);
  await expectElementPlaying();

  // 切到 vocal：只改增益，不重新接线。
  await player.getByLabel("均衡器预设").selectOption("vocal");
  await expect.poll(eqInfo).toMatchObject({ preset: "vocal", wired: true, bypass: false });
  await expect.poll(async () => (await eqInfo())?.bandGains).toEqual([-2, -1, 0, 1, 3, 4, 3, 1, 0, -1]);

  // 强度 50% 线性缩放。
  await player.getByLabel("均衡器强度").fill("50");
  await expect.poll(async () => (await eqInfo())?.bandGains).toEqual([-1, -0.5, 0, 0.5, 1.5, 2, 1.5, 0.5, 0, -0.5]);

  // 切回原声：图保留但参数归零（透明旁路），播放继续。
  await player.getByLabel("均衡器预设").selectOption("none");
  await expect.poll(eqInfo).toMatchObject({ preset: "none", wired: true, bypass: true });
  await expect.poll(async () => (await eqInfo())?.bandGains).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  await expectElementPlaying();
});
