import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeStates, normalizeState, serializeState } from "../src/lib/storage.ts";

test("normalizeState(null): produces a playable base state with EQ defaulted off", () => {
  const state = normalizeState(null);
  assert.equal(state.eqPreset, "none");
  assert.equal(state.eqIntensity, 100);
  assert.equal(state.theme, "light");
  assert.equal(state.fadeEnabled, false);
});

test("normalizeState: legacy eq fields from old backups are normalized instead of dropped", () => {
  const state = normalizeState({ eqPreset: "vocal", eqIntensity: 50 });
  assert.equal(state.eqPreset, "vocal");
  assert.equal(state.eqIntensity, 50);
  const invalid = normalizeState({ eqPreset: "broken", eqIntensity: 999 });
  assert.equal(invalid.eqPreset, "none");
  assert.equal(invalid.eqIntensity, 100);
});

test("serializeState round-trip keeps eq and non-eq fields intact", () => {
  const base = normalizeState({ theme: "dark", playbackSpeed: 1.5, fadeEnabled: true, eqPreset: "rock", eqIntensity: 60 });
  const serialized = serializeState(base);
  assert.equal(serialized.theme, "dark");
  assert.equal(serialized.playbackSpeed, 1.5);
  assert.equal(serialized.fadeEnabled, true);
  assert.equal(serialized.eqPreset, "rock");
  assert.equal(serialized.eqIntensity, 60);
  const roundTripped = normalizeState(serialized);
  assert.equal(roundTripped.theme, "dark");
  assert.equal(roundTripped.playbackSpeed, 1.5);
  assert.equal(roundTripped.fadeEnabled, true);
  assert.equal(roundTripped.eqPreset, "rock");
  assert.equal(roundTripped.eqIntensity, 60);
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
