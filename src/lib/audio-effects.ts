import type { AudioEffectsPreset } from "../types";

/**
 * WebAudio 10 段 ISO 均衡器（默认关闭，opt-in）。
 *
 * 设计约束（吸取 1.0.32–1.0.38 反复横跳的教训）：
 * 1. `createMediaElementSource` 是单行道：元素一旦接管，无法恢复直通。
 *    因此本模块只接线一次，之后只改参数，绝不“拆图/重接”。
 * 2. “原声（关闭）”在未接线时保持纯 HTMLAudioElement 直通；若已经接线，
 *    则把所有频段增益归零并把压缩器/trim 置为线性（等效透明旁路），不切换拓扑。
 * 3. 只在用户手势内接线；播放中途首次开启 EQ 时采用“保存进度 → pause →
 *    同步接线 → 恢复进度 → play”，避免直接接管正在播放的元素。
 * 4. Android WebView 上完全禁用 EQ（元素直通），从根上避免 APK 端
 *    时钟冻结/静音/爆音问题。
 * 5. 增加 -1dB trim + DynamicsCompressor，防止多频段正增益叠加削波。
 * 6. 模块顶层不访问 window/AudioContext，保证 Node 测试可 import。
 */

export const EQ_BAND_FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export const EQ_BAND_COUNT = 10;
export const EQ_Q = 1.41;
export const EQ_INTENSITY_MIN = 0;
export const EQ_INTENSITY_MAX = 100;
/** 默认关闭：绝不替用户启用 WebAudio。 */
export const DEFAULT_EQ_PRESET: AudioEffectsPreset = "none";
export const DEFAULT_EQ_INTENSITY = 100;
const TRIM_GAIN_ACTIVE = 0.9;
const TRIM_GAIN_BYPASS = 1.0;
const RAMP_TIME = 0.05;

export type EqPresetDef = { id: AudioEffectsPreset; label: string; gains: number[] };

/** Apple Music 同款经典曲线；取值克制（±5 dB 内）。 */
export const EQ_PRESETS: EqPresetDef[] = [
  { id: "none", label: "原声（关闭）", gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { id: "hiFi", label: "流行 Pop", gains: [-1, 1, 2, 3, 3, 1, 0, -1, -1, 0] },
  { id: "full", label: "饱满 Full", gains: [5, 4, 3, 1, 0, 0, -1, -1, 0, 0] },
  { id: "vocal", label: "人声 Vocal", gains: [-2, -1, 0, 1, 3, 4, 3, 1, 0, -1] },
  { id: "classical", label: "古典 Classical", gains: [0, 0, 0, 0, 0, 0, -1, -2, -3, -4] },
  { id: "rock", label: "摇滚 Rock", gains: [4, 3, 2, 0, -1, -1, 0, 2, 3, 4] }
];

export type AudioEffectsSupport = {
  supported: boolean;
  reason: "ok" | "android" | "unsupported";
};

export function normalizeEqPreset(value: unknown): AudioEffectsPreset {
  const candidate = typeof value === "string" ? value : "";
  return EQ_PRESETS.some((preset) => preset.id === candidate)
    ? (candidate as AudioEffectsPreset)
    : DEFAULT_EQ_PRESET;
}

/** 非法（非有限数/缺失）→ 100；夹取到 0..100 */
export function clampIntensity(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.min(EQ_INTENSITY_MAX, Math.max(EQ_INTENSITY_MIN, value));
  }
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return clampIntensity(Number(value));
  }
  return DEFAULT_EQ_INTENSITY;
}

/** 强度缩放：gain_db[i] = preset.gains[i] * (intensity / 100)；none → 全 0。 */
export function scaledBandGains(preset: AudioEffectsPreset, intensity: number): number[] {
  const def = EQ_PRESETS.find((item) => item.id === preset) ?? EQ_PRESETS[0];
  if (def.id === "none") return EQ_BAND_FREQUENCIES.map(() => 0);
  const ratio = clampIntensity(intensity) / 100;
  return def.gains.map((gain) => gain * ratio + 0);
}

export type AudioEffectsDebugInfo = {
  supported: boolean;
  supportReason: string;
  contextState: string | null;
  wired: boolean;
  preset: AudioEffectsPreset;
  intensity: number;
  bypass: boolean;
  bandGains: number[];
  bandFrequencies: number[];
};

// ---- 图状态（浏览器内有效；Node 下保持空） ----
type EqGraph = {
  ctx: AudioContext;
  source: MediaElementAudioSourceNode;
  filters: BiquadFilterNode[];
  trim: GainNode;
  compressor: DynamicsCompressorNode;
  element: HTMLAudioElement;
};

let graph: EqGraph | null = null;
let recordedPreset: AudioEffectsPreset = DEFAULT_EQ_PRESET;
let recordedIntensity = DEFAULT_EQ_INTENSITY;
let fallbackListenersAttached = false;

function isBrowser() {
  return typeof window !== "undefined";
}

export function getAudioEffectsSupport(): AudioEffectsSupport {
  if (!isBrowser()) return { supported: false, reason: "unsupported" };
  try {
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes("android")) return { supported: false, reason: "android" };
  } catch {
    // navigator unavailable in exotic contexts; fall through to WebAudio check
  }
  const AudioCtor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return AudioCtor ? { supported: true, reason: "ok" } : { supported: false, reason: "unsupported" };
}

function currentGains() {
  return scaledBandGains(recordedPreset, recordedIntensity);
}

function teardownGraph() {
  if (!graph) return;
  try {
    graph.source.disconnect();
  } catch {
    // already disconnected
  }
  for (const filter of graph.filters) {
    try {
      filter.disconnect();
    } catch {
      // already disconnected
    }
  }
  try {
    graph.trim.disconnect();
    graph.compressor.disconnect();
  } catch {
    // already disconnected
  }
  void graph.ctx.close().catch(() => undefined);
  graph = null;
}

function attachFallbackGestureListeners(audio: HTMLAudioElement) {
  if (fallbackListenersAttached || !isBrowser()) return;
  fallbackListenersAttached = true;
  const retry = () => {
    ensureAudioEffects(audio);
    window.removeEventListener("pointerdown", retry, true);
    window.removeEventListener("keydown", retry, true);
    window.removeEventListener("touchstart", retry, true);
    fallbackListenersAttached = false;
  };
  window.addEventListener("pointerdown", retry, true);
  window.addEventListener("keydown", retry, true);
  window.addEventListener("touchstart", retry, true);
}

function pushCurrentParameters() {
  if (!isBrowser() || !graph || !graph.filters.length) return;
  if (graph.ctx.state === "suspended") {
    void graph.ctx.resume().catch(() => undefined);
  }
  const bypass = recordedPreset === "none";
  const gains = currentGains();
  const now = graph.ctx.currentTime;
  graph.filters.forEach((filter, index) => {
    const param = filter.gain;
    param.cancelScheduledValues(now);
    param.setTargetAtTime(gains[index], now, RAMP_TIME);
  });
  graph.trim.gain.cancelScheduledValues(now);
  graph.trim.gain.setTargetAtTime(bypass ? TRIM_GAIN_BYPASS : TRIM_GAIN_ACTIVE, now, RAMP_TIME);
  graph.compressor.threshold.cancelScheduledValues(now);
  graph.compressor.threshold.setTargetAtTime(bypass ? 0 : -6, now, RAMP_TIME);
  graph.compressor.knee.cancelScheduledValues(now);
  graph.compressor.knee.setTargetAtTime(bypass ? 0 : 6, now, RAMP_TIME);
  graph.compressor.ratio.cancelScheduledValues(now);
  graph.compressor.ratio.setTargetAtTime(bypass ? 1 : 3, now, RAMP_TIME);
}

function createGraph(audio: HTMLAudioElement): { ok: boolean; reason: string } {
  try {
    const AudioCtor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return { ok: false, reason: "unsupported" };
    const ctx = new AudioCtor({ latencyHint: "playback" });
    const source = ctx.createMediaElementSource(audio);
    const filters = EQ_BAND_FREQUENCIES.map((frequency) => {
      const filter = ctx.createBiquadFilter();
      filter.type = "peaking";
      filter.frequency.value = frequency;
      filter.Q.value = EQ_Q;
      filter.gain.value = 0;
      return filter;
    });
    const trim = ctx.createGain();
    trim.gain.value = TRIM_GAIN_BYPASS;
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = 0;
    compressor.knee.value = 0;
    compressor.ratio.value = 1;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.25;

    let node: AudioNode = source;
    for (const filter of filters) {
      node.connect(filter);
      node = filter;
    }
    node.connect(trim);
    trim.connect(compressor);
    compressor.connect(ctx.destination);

    graph = { ctx, source, filters, trim, compressor, element: audio };
    if (ctx.state === "suspended") {
      void ctx.resume().catch(() => undefined);
    }
    pushCurrentParameters();
    return { ok: true, reason: "wired" };
  } catch {
    if (graph?.element === audio) teardownGraph();
    return { ok: false, reason: "failed" };
  }
}

export type EnsureAudioEffectsResult = {
  ok: boolean;
  wired: boolean;
  reason: "none" | "android" | "unsupported" | "wired" | "already-wired" | "pending-gesture" | "failed" | "no-audio";
};

/**
 * 幂等接线：
 * - 预设为 none 且从未接线 → 不进入 WebAudio（元素直通）。
 * - 已接线同一元素 → 只刷参数（含透明旁路）。
 * - 首次接线尽量发生在用户手势内；否则挂一次性手势监听延迟接线。
 */
export function ensureAudioEffects(audio: HTMLAudioElement | null): EnsureAudioEffectsResult {
  if (!isBrowser() || !audio) return { ok: false, wired: false, reason: "no-audio" };
  const support = getAudioEffectsSupport();
  if (!support.supported) {
    return { ok: false, wired: false, reason: support.reason === "android" ? "android" : "unsupported" };
  }
  if (recordedPreset === "none") {
    return { ok: true, wired: graph?.element === audio, reason: "none" };
  }
  if (graph?.element === audio) {
    pushCurrentParameters();
    return { ok: true, wired: true, reason: "already-wired" };
  }
  if (graph && graph.element !== audio) {
    teardownGraph();
  }
  const hasActivation = typeof navigator.userActivation === "object"
    && navigator.userActivation !== null
    && (navigator.userActivation.isActive || navigator.userActivation.hasBeenActive);
  if (!hasActivation) {
    attachFallbackGestureListeners(audio);
    return { ok: true, wired: false, reason: "pending-gesture" };
  }
  return wireGraph(audio);
}

function wireGraph(audio: HTMLAudioElement): EnsureAudioEffectsResult {
  const support = getAudioEffectsSupport();
  if (!support.supported) {
    return { ok: false, wired: false, reason: support.reason === "android" ? "android" : "unsupported" };
  }
  if (graph?.element === audio) {
    pushCurrentParameters();
    return { ok: true, wired: true, reason: "already-wired" };
  }
  if (graph) teardownGraph();
  const wasPlaying = !audio.paused && !audio.ended;
  const resumeAt = wasPlaying ? Math.max(0, audio.currentTime) : 0;
  if (wasPlaying) audio.pause();
  const created = createGraph(audio);
  if (!created.ok) return { ok: false, wired: false, reason: "failed" };
  if (wasPlaying) {
    try {
      audio.currentTime = resumeAt;
    } catch {
      // The restored source may not have metadata yet; play from current position.
    }
    const play = audio.play();
    if (play && typeof play.catch === "function") {
      play.catch(() => {
        // Autoplay policies can reject; the next explicit play click resumes playback.
      });
    }
  }
  return { ok: true, wired: true, reason: "wired" };
}

/** 记录最新设置并应用（图已存在时立即生效）。 */
export function setAudioEffects(preset: AudioEffectsPreset, intensity: number): void {
  recordedPreset = normalizeEqPreset(preset);
  recordedIntensity = clampIntensity(intensity);
  pushCurrentParameters();
}

/** 指定 audio 元素是否已接入 WebAudio 图。 */
export function isAudioEffectsWired(audio: HTMLAudioElement | null): boolean {
  return isBrowser() && audio !== null && graph?.element === audio;
}

/** 测试/诊断钩子：Node 下返回空态，不抛错。 */
export function getAudioEffectsDebugInfo(): AudioEffectsDebugInfo {
  const support = getAudioEffectsSupport();
  return {
    supported: support.supported,
    supportReason: support.reason,
    contextState: graph ? graph.ctx.state : null,
    wired: Boolean(graph),
    preset: recordedPreset,
    intensity: recordedIntensity,
    bypass: recordedPreset === "none",
    bandGains: graph?.filters.length ? graph.filters.map((filter) => filter.gain.value) : Array.from({ length: EQ_BAND_COUNT }, () => 0),
    bandFrequencies: [...EQ_BAND_FREQUENCIES]
  };
}

/** 暴露 window.JianyinAudioEffects 调试钩子（e2e 使用）。 */
export function setDebugHook(enabled: boolean): void {
  if (!isBrowser()) return;
  if (enabled) {
    (window as unknown as Record<string, unknown>).JianyinAudioEffects = {
      getDebugInfo: getAudioEffectsDebugInfo,
      // 测试钩子：强制接线（绕过手势门控，用于验证接线后行为）。
      forceWire: (audio: HTMLAudioElement | null): EnsureAudioEffectsResult => {
        if (!isBrowser() || !audio) return { ok: false, wired: false, reason: "no-audio" };
        if (graph?.element === audio) return { ok: true, wired: true, reason: "already-wired" };
        return wireGraph(audio);
      }
    };
  } else {
    delete (window as unknown as Record<string, unknown>).JianyinAudioEffects;
  }
}
