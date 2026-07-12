import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("first-run dependency install hides audit and deprecation noise", async () => {
  const source = await readFile(new URL("../scripts/start-desktop.mjs", import.meta.url), "utf8");
  assert.match(source, /\["ci", "--loglevel=error", "--no-audit", "--no-fund"\]/);
});

test("launcher CI does not preinstall dependencies before testing the launcher", async () => {
  const workflow = await readFile(new URL("../.github/workflows/desktop-launchers.yml", import.meta.url), "utf8");
  assert.doesNotMatch(workflow, /^\s*- run: npm ci\s*$/m);
});
