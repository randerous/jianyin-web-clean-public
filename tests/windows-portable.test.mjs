import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("Windows package is a portable executable with no console", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.main, "electron-main.mjs");
  assert.equal(pkg.build.win.target, "portable");
  assert.equal(pkg.build.win.signAndEditExecutable, false);
  assert.equal(pkg.build.beforePack, "scripts/electron-builder-hooks.mjs");
  assert.equal(pkg.build.afterPack, "scripts/electron-builder-hooks.mjs");
  assert.match(pkg.build.artifactName, /windows-portable\.\$\{ext\}$/);
});

test("desktop window does not expose Node APIs to web content", async () => {
  const source = await readFile(new URL("../electron-main.mjs", import.meta.url), "utf8");
  assert.match(source, /contextIsolation:\s*true/);
  assert.match(source, /nodeIntegration:\s*false/);
  assert.match(source, /sandbox:\s*true/);
});
