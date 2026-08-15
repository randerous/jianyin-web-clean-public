import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeStates, normalizeState, serializeState } from "../src/lib/storage.ts";

test("normalizeState(null): produces a playable base state without eq fields", () => {
  const state = normalizeState(null);
  assert.equal("eqPreset" in state, false);
  assert.equal("eqIntensity" in state, false);
  assert.equal(state.theme, "light");
  assert.equal(state.fadeEnabled, false);
});

test("normalizeState: legacy eq fields from old backups are ignored", () => {
  const state = normalizeState({ eqPreset: "vocal", eqIntensity: 50 });
  assert.equal("eqPreset" in state, false);
  assert.equal("eqIntensity" in state, false);
});

test("serializeState round-trip keeps non-eq fields intact", () => {
  const base = normalizeState({ theme: "dark", playbackSpeed: 1.5, fadeEnabled: true });
  const serialized = serializeState(base);
  assert.equal(serialized.theme, "dark");
  assert.equal(serialized.playbackSpeed, 1.5);
  assert.equal(serialized.fadeEnabled, true);
  const roundTripped = normalizeState(serialized);
  assert.equal(roundTripped.theme, "dark");
  assert.equal(roundTripped.playbackSpeed, 1.5);
  assert.equal(roundTripped.fadeEnabled, true);
});

test("mergeStates: newer remote settings win, older remote keep local", () => {
  const local = normalizeState({ theme: "light", fadeEnabled: false, updatedAt: 2000 });
  const newerRemote = normalizeState({ theme: "dark", fadeEnabled: true, updatedAt: 3000 });
  const mergedNewer = mergeStates(local, newerRemote);
  assert.equal(mergedNewer.theme, "dark");
  assert.equal(mergedNewer.fadeEnabled, true);

  const olderRemote = normalizeState({ theme: "dark", fadeEnabled: true, updatedAt: 1000 });
  const mergedOlder = mergeStates(local, olderRemote);
  assert.equal(mergedOlder.theme, "light");
  assert.equal(mergedOlder.fadeEnabled, false);
});
