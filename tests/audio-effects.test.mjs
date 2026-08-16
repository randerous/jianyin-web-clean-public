import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_EQ_INTENSITY,
  DEFAULT_EQ_PRESET,
  EQ_BAND_COUNT,
  EQ_BAND_FREQUENCIES,
  EQ_INTENSITY_MAX,
  EQ_INTENSITY_MIN,
  EQ_PRESETS,
  clampIntensity,
  ensureAudioEffects,
  getAudioEffectsDebugInfo,
  getAudioEffectsSupport,
  normalizeEqPreset,
  scaledBandGains,
  setAudioEffects
} from "../src/lib/audio-effects.ts";

test("EQ_PRESETS table shape", () => {
  assert.equal(EQ_PRESETS.length, 6);
  assert.equal(EQ_PRESETS[0].id, "none");
  const ids = new Set(EQ_PRESETS.map((preset) => preset.id));
  assert.equal(ids.size, 6);
  for (const preset of EQ_PRESETS) {
    assert.equal(preset.gains.length, EQ_BAND_COUNT);
    for (const gain of preset.gains) {
      assert.ok(Math.abs(gain) <= 5, `${preset.id} band gain ${gain} exceeds ±5 dB`);
    }
  }
  const none = EQ_PRESETS.find((preset) => preset.id === "none");
  assert.ok(none.gains.every((gain) => gain === 0));
});

test("EQ_BAND_FREQUENCIES are the 10 ISO centers", () => {
  assert.deepEqual(EQ_BAND_FREQUENCIES, [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]);
});

test("scaledBandGains: full intensity matches table exactly", () => {
  assert.deepEqual(scaledBandGains("hiFi", 100), [-1, 1, 2, 3, 3, 1, 0, -1, -1, 0]);
  assert.deepEqual(scaledBandGains("full", 100), [5, 4, 3, 1, 0, 0, -1, -1, 0, 0]);
  assert.deepEqual(scaledBandGains("rock", 100), [4, 3, 2, 0, -1, -1, 0, 2, 3, 4]);
});

test("scaledBandGains: intensity scales linearly and clamps", () => {
  assert.deepEqual(scaledBandGains("hiFi", 50), [-0.5, 0.5, 1, 1.5, 1.5, 0.5, 0, -0.5, -0.5, 0]);
  assert.deepEqual(scaledBandGains("hiFi", 0), Array.from({ length: EQ_BAND_COUNT }, () => 0));
  assert.deepEqual(scaledBandGains("hiFi", 200), scaledBandGains("hiFi", 100), "over-100 intensity clamps to 100");
  assert.deepEqual(scaledBandGains("none", 100), Array.from({ length: EQ_BAND_COUNT }, () => 0), "none bypass stays flat at any intensity");
});

test("normalizeEqPreset: known ids pass through, unknown/missing default to none (off)", () => {
  assert.equal(DEFAULT_EQ_PRESET, "none");
  assert.equal(normalizeEqPreset("vocal"), "vocal");
  assert.equal(normalizeEqPreset("none"), "none");
  for (const bad of ["bogus", "EQ", 42, null, undefined, ""]) {
    assert.equal(normalizeEqPreset(bad), DEFAULT_EQ_PRESET);
  }
});

test("clampIntensity: valid passthrough, invalid default, out-of-range clamped", () => {
  assert.equal(clampIntensity(0), EQ_INTENSITY_MIN);
  assert.equal(clampIntensity(50), 50);
  assert.equal(clampIntensity(100), EQ_INTENSITY_MAX);
  assert.equal(clampIntensity(120), EQ_INTENSITY_MAX);
  assert.equal(clampIntensity(-5), EQ_INTENSITY_MIN);
  assert.equal(clampIntensity("40"), 40);
  for (const bad of [NaN, Infinity, undefined, null, "", "abc"]) {
    assert.equal(clampIntensity(bad), DEFAULT_EQ_INTENSITY);
  }
});

test("node environment (no window): support is false and all graph functions are safe no-ops", () => {
  assert.equal(typeof window, "undefined");
  assert.equal(getAudioEffectsSupport().supported, false);
  assert.doesNotThrow(() => setAudioEffects("rock", 60));
  assert.deepEqual(ensureAudioEffects(null), { ok: false, wired: false, reason: "no-audio" });
  const info = getAudioEffectsDebugInfo();
  assert.equal(info.supported, false);
  assert.equal(info.contextState, null);
  assert.equal(info.wired, false);
  assert.equal(info.preset, "rock");
  assert.equal(info.intensity, 60);
  assert.deepEqual(info.bandGains, Array.from({ length: EQ_BAND_COUNT }, () => 0));
  assert.deepEqual(info.bandFrequencies, EQ_BAND_FREQUENCIES);
});

test("android native bridge is preferred over WebAudio when present", () => {
  const calls = [];
  const bridge = {
    setEqualizer(preset, intensity) {
      calls.push([preset, intensity]);
      return JSON.stringify({ available: true, enabled: preset !== "none", preset, intensity });
    },
    getEqualizerStatus() {
      return JSON.stringify({ available: true, enabled: false, preset: "none", intensity: 100 });
    }
  };
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "window", { value: { JianyinAndroid: bridge }, configurable: true });
  try {
    Object.defineProperty(globalThis, "navigator", {
      value: { userAgent: "Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 Chrome/124.0 Mobile Safari/537.36" },
      configurable: true
    });
  } catch {
    // Node versions with a non-configurable navigator getter skip this optional assertion.
  }
  try {
    const support = getAudioEffectsSupport();
    assert.equal(support.reason, "android-native");
    assert.equal(support.supported, true);
    setAudioEffects("vocal", 60);
    assert.deepEqual(calls.at(-1), ["vocal", 60]);
    const result = ensureAudioEffects({});
    assert.deepEqual(result, { ok: true, wired: true, reason: "native" });
    setAudioEffects("none", 100);
    assert.deepEqual(calls.at(-1), ["none", 100]);
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else delete globalThis.window;
    if (previousNavigator) Object.defineProperty(globalThis, "navigator", previousNavigator);
    else delete globalThis.navigator;
  }
});
