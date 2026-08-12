import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeStates, normalizeState, serializeState } from "../src/lib/storage.ts";
import { DEFAULT_EQ_INTENSITY, DEFAULT_EQ_PRESET } from "../src/lib/audio-effects.ts";

test("normalizeState(null): eq fields default to hiFi/100", () => {
  const state = normalizeState(null);
  assert.equal(state.eqPreset, DEFAULT_EQ_PRESET);
  assert.equal(state.eqIntensity, DEFAULT_EQ_INTENSITY);
});

test("normalizeState: valid eq fields preserved", () => {
  const state = normalizeState({ eqPreset: "vocal", eqIntensity: 50 });
  assert.equal(state.eqPreset, "vocal");
  assert.equal(state.eqIntensity, 50);
});

test("normalizeState: garbage eq fields fall back to defaults", () => {
  const state = normalizeState({ eqPreset: "garbage", eqIntensity: 999 });
  assert.equal(state.eqPreset, DEFAULT_EQ_PRESET);
  assert.equal(state.eqIntensity, DEFAULT_EQ_INTENSITY);
});

test("normalizeState: out-of-range intensity clamped", () => {
  const state = normalizeState({ eqIntensity: -3 });
  assert.equal(state.eqIntensity, 0);
});

test("serializeState round-trip preserves eq fields", () => {
  const base = normalizeState({ eqPreset: "classical", eqIntensity: 70 });
  const serialized = serializeState(base);
  assert.equal(serialized.eqPreset, "classical");
  assert.equal(serialized.eqIntensity, 70);
  const roundTripped = normalizeState(serialized);
  assert.equal(roundTripped.eqPreset, "classical");
  assert.equal(roundTripped.eqIntensity, 70);
});

test("mergeStates: newer remote settings win, older remote keep local", () => {
  const local = normalizeState({ eqPreset: "hiFi", eqIntensity: 100, updatedAt: 2000 });
  const newerRemote = normalizeState({ eqPreset: "rock", eqIntensity: 30, updatedAt: 3000 });
  const mergedNewer = mergeStates(local, newerRemote);
  assert.equal(mergedNewer.eqPreset, "rock");
  assert.equal(mergedNewer.eqIntensity, 30);

  const olderRemote = normalizeState({ eqPreset: "full", eqIntensity: 10, updatedAt: 1000 });
  const mergedOlder = mergeStates(local, olderRemote);
  assert.equal(mergedOlder.eqPreset, "hiFi");
  assert.equal(mergedOlder.eqIntensity, 100);
});
