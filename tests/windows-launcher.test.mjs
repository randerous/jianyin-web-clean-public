import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(new URL("../windows/Launcher.cs", import.meta.url), "utf8");

test("launcher opens the existing browser UI and never embeds a web window", () => {
  assert.match(source, /Process\.Start\(new ProcessStartInfo\("http:\/\/127\.0\.0\.1:/);
  assert.doesNotMatch(source, /WebView|BrowserWindow|Electron/i);
});

test("launcher preserves local changes and only performs fast-forward updates", () => {
  assert.match(source, /status --porcelain/);
  assert.match(source, /pull --ff-only/);
});

test("launcher stores state and logs under LocalAppData", () => {
  assert.match(source, /SpecialFolder\.LocalApplicationData/);
  assert.match(source, /JIANYIN_STATE_PATH/);
});

test("build embeds only backend runtime dependencies", async () => {
  const build = await readFile(new URL("../scripts/build-windows-launcher.ps1", import.meta.url), "utf8");
  assert.match(build, /express@5\.2\.1 NeteaseCloudMusicApi@4\.32\.0/);
  assert.doesNotMatch(build, /npm ci --omit=dev/);
});
