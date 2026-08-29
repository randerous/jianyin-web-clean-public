import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

test("packaged Windows launcher can self-update from a verified GitHub Release asset", () => {
  assert.match(source, /JIANYIN_PACKAGED_LAUNCHER/);
  assert.match(source, /api\.github\.com\/repos\/randerous\/jianyin-web-clean-public\/releases\/latest/);
  assert.match(source, /sha256/i);
  assert.match(source, /apply-launcher-update\.cmd/);
  assert.match(source, /copy \/y/i);
});

test("launcher stores state and logs under LocalAppData", () => {
  assert.match(source, /SpecialFolder\.LocalApplicationData/);
  assert.match(source, /JIANYIN_STATE_PATH/);
});

test("launcher ignores the 1.0.20 runtime cache after upgrading to 1.0.43", async (t) => {
  const versionMatch = source.match(/private const string RuntimeVersion = "([^"]+)";/);
  assert.ok(versionMatch, "launcher must declare an embedded runtime version");
  const runtimeVersion = versionMatch[1];
  assert.equal(runtimeVersion, "1.0.43");
  assert.match(
    source,
    /var target = Path\.Combine\(DataDir, "runtime", RuntimeVersion, "app"\);\s+var marker = Path\.Combine\(target, "\.ready"\);\s+if \(File\.Exists\(marker\)\) return target;/,
  );

  const dataDir = await mkdtemp(join(tmpdir(), "jianyin-launcher-"));
  t.after(() => rm(dataDir, { recursive: true, force: true }));

  const staleTarget = join(dataDir, "runtime", "1.0.20", "app");
  await mkdir(staleTarget, { recursive: true });
  await writeFile(join(staleTarget, ".ready"), "1.0.20");

  const selectedTarget = join(dataDir, "runtime", runtimeVersion, "app");
  assert.notEqual(selectedTarget, staleTarget);
  await assert.rejects(readFile(join(selectedTarget, ".ready")), { code: "ENOENT" });
});

test("build embeds only backend runtime dependencies", async () => {
  const build = await readFile(new URL("../scripts/build-windows-launcher.ps1", import.meta.url), "utf8");
  assert.match(build, /express@5\.2\.1 NeteaseCloudMusicApi@4\.32\.0/);
  assert.doesNotMatch(build, /npm ci --omit=dev/);
});
