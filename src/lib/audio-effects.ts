import type { AudioEffectsPreset } from "../types";

/**
 * WebAudio 音效系统（10 段 ISO 均衡）。
 *
 * 设计要点：
 * - 模块级单例持有全部 WebAudio 状态；顶层不触碰 window/AudioContext，
 *   每个 DOM 调用都有守卫，因此本模块可在 Node（node:test）中直接 import。
 * - AudioContext 懒创建，只在用户播放手势内接线（ensureAudioEffects），
 *   非手势播放（启动自动播放等）由 userActivation 门控延迟到下一个真实手势，
 *   避免 suspended AudioContext 导致整体静音的回归。
 * - 旁路（"原声/关闭"）是拓扑切换：source → destination 直连。
 *   附注：0 dB 的 peaking biquad 数学上恰为恒等（分子=分母），
 *   因此强度 0 时即使链连接也逐位透明。
 * - createMediaElementSource 对同一元素调用两次会抛错，因此接线以元素同一性
 *   做幂等守卫，且绝不在 React mount effect 中调用（StrictMode 双跑安全）。
 */

export const EQ_BAND_FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export const EQ_BAND_COUNT = 10;
/** 每段 peaking 滤波的 Q 值（约 1 倍频程带宽） */
export const EQ_Q = 1.0;
export const EQ_INTENSITY_MIN = 0;
export const EQ_INTENSITY_MAX = 100;
export const DEFAULT_EQ_PRESET: AudioEffectsPreset = "hiFi";
export const DEFAULT_EQ_INTENSITY = 100;

export type EqPresetDef = { id: AudioEffectsPreset; label: string; gains: number[] };

/**
 * 预设 dB 表（10 段，中心频率见 EQ_BAND_FREQUENCIES）。
 * 取值克制（±4 dB 内）：hiFi=微笑曲线；full=饱满；vocal=人声前置；
 * classical=平滑近直；rock=低频+高频冲击。none=原声（全 0）。
 */
export const EQ_PRESETS: EqPresetDef[] = [
  { id: "none", label: "原声（关闭）", gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { id: "hiFi", label: "均衡·原声 Hi-Fi", gains: [3, 3, 2, 1, 0, -1.5, 0, 1.5, 3, 4] },
  { id: "full", label: "均衡·饱满", gains: [4, 4, 3, 2, 1, 0, 0, 0, 1, 1] },
  { id: "vocal", label: "均衡·人声", gains: [-2, -1, 0, 1, 2, 3, 3, 2, 1, 0] },
  { id: "classical", label: "均衡·古典", gains: [-2, -1, 0, 1, 1.5, 1.5, 1, 1, 0.5, 0] },
  { id: "rock", label: "均衡·摇滚", gains: [3, 4, 3, 1, 0, 0, 1.5, 3, 3, 2] }
];

/** 非法/未知预设（含缺失）→ 默认 "hiFi" */
export function normalizeEqPreset(value: unknown): AudioEffectsPreset {
  const candidate = typeof value === "string" ? value : "";
  return EQ_PRESETS.some((preset) => preset.id === candidate) ? (candidate as AudioEffectsPreset) : DEFAULT_EQ_PRESET;
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

/** 强度缩放：gain_db[i] = preset.gains[i] * (intensity / 100) */
export function scaledBandGains(preset: AudioEffectsPreset, intensity: number): number[] {
  const def = EQ_PRESETS.find((item) => item.id === preset) ?? EQ_PRESETS[1];
  const ratio = clampIntensity(intensity) / 100;
  return def.gains.map((gain) => gain * ratio + 0);
}

export type AudioEffectsDebugInfo = {
  contextState: string | null;
  preset: AudioEffectsPreset;
  intensity: number;
  bypass: boolean;
  bandGains: number[];
  bandFrequencies: number[];
};

// ---- 图状态（浏览器内有效；Node 下保持空） ----
let ctx: AudioContext | null = null;
let source: MediaElementAudioSourceNode | null = null;
let filters: BiquadFilterNode[] = [];
let wiredElement: HTMLAudioElement | null = null;
let bypassActive = false;
let recordedPreset: AudioEffectsPreset = DEFAULT_EQ_PRESET;
let recordedIntensity = DEFAULT_EQ_INTENSITY;
let fallbackListenersAttached = false;
let visibilityListenerAttached = false;

function isBrowser() {
  return typeof window !== "undefined";
}

function teardownGraph() {
  if (source) {
    try {
      source.disconnect();
    } catch {
      // already disconnected
    }
  }
  for (const filter of filters) {
    try {
      filter.disconnect();
    } catch {
      // already disconnected
    }
  }
  if (ctx) {
    void ctx.close().catch(() => undefined);
  }
  ctx = null;
  source = null;
  filters = [];
  wiredElement = null;
  bypassActive = false;
}

function attachVisibilityHandler() {
  if (visibilityListenerAttached || !isBrowser()) return;
  visibilityListenerAttached = true;
  document.addEventListener("visibilitychange", () => {
    if (!ctx) return;
    if (document.visibilityState === "hidden") {
      void ctx.suspend().catch(() => undefined);
    } else if (ctx.state === "suspended") {
      void ctx.resume().catch(() => undefined);
    }
  });
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

/**
 * 幂等接线：把 audio 元素包进 WebAudio 图。
 * - 已接线且元素相同 → 尝试 resume 并返回 true。
 * - 元素不同 → 返回 false（本应用只有一个静态元素，正常不会发生；
 *   这也是第二次 createMediaElementSource 会抛错的唯一情形）。
 * - 非浏览器 / 无元素 → false。
 * - 非手势（navigator.userActivation.hasBeenActive 为 false）→ 挂一次性
 *   手势监听延迟接线，返回 false（保证"启动自动播放"等非手势路径零回归）。
 * - 正常路径 → 建 AudioContext + source + 10 段 biquad 链，应用当前预设。
 */
export function ensureAudioEffects(audio: HTMLAudioElement | null): boolean {
  if (!isBrowser() || !audio) return false;
  // 原声（关闭）不需要任何图：不接线、不挂延迟监听。
  // （MediaElementSource 接管元素在部分环境有副作用，none 时应完全零介入）
  if (recordedPreset === "none") return false;
  if (ctx && wiredElement === audio) {
    if (ctx.state === "suspended") {
      void ctx.resume().catch(() => undefined);
    }
    return true;
  }
  if (wiredElement && wiredElement !== audio) return false;
  if (typeof navigator.userActivation === "object" && navigator.userActivation !== null && !navigator.userActivation.hasBeenActive) {
    attachFallbackGestureListeners(audio);
    return false;
  }
  try {
    const AudioCtor: typeof AudioContext = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return false;
    ctx = new AudioCtor();
    source = ctx.createMediaElementSource(audio);
    filters = EQ_BAND_FREQUENCIES.map((frequency, index) => {
      const filter = ctx!.createBiquadFilter();
      filter.type = "peaking";
      filter.frequency.value = frequency;
      filter.Q.value = EQ_Q;
      // 首次接线直设增益，避免爬升伪影
      filter.gain.value = scaledBandGains(recordedPreset, recordedIntensity)[index];
      return filter;
    });
    filters.reduce((previous, current) => {
      previous.connect(current);
      return current;
    });
    // recordedPreset 在此不可能为 "none"（函数开头已 early return）
    filters[filters.length - 1].connect(ctx.destination);
    bypassActive = false;
    wiredElement = audio;
    attachVisibilityHandler();
    return true;
  } catch {
    // NotSupportedError 等：不接线，保持直通（与未启用音效时行为一致）
    if (ctx) {
      void ctx.close().catch(() => undefined);
      ctx = null;
    }
    source = null;
    filters = [];
    wiredElement = null;
    return false;
  }
}

/**
 * 把最新预设/强度推送到已有图（无图则只记录，稍后接线时生效）。
 * 旁路切换只在该标志翻转时调整拓扑；增益用 setTargetAtTime 防拉链噪声。
 */
export function applyAudioEffects(): void {
  if (!isBrowser() || !ctx || !source) return;
  const bypass = recordedPreset === "none";
  if (bypass !== bypassActive) {
    const chainEnd = filters[filters.length - 1];
    if (bypass) {
      chainEnd.disconnect(ctx.destination);
      source.connect(ctx.destination);
    } else {
      // 只断开直连，保留 source → filters[0] 的链连接
      source.disconnect(ctx.destination);
      chainEnd.connect(ctx.destination);
    }
    bypassActive = bypass;
  }
  if (bypass) return;
  const gains = scaledBandGains(recordedPreset, recordedIntensity);
  const now = ctx.currentTime;
  filters.forEach((filter, index) => {
    filter.gain.setTargetAtTime(gains[index], now, 0.02);
  });
}

/** 记录最新设置并应用（图已存在时立即生效）。 */
export function setAudioEffects(preset: AudioEffectsPreset, intensity: number): void {
  recordedPreset = normalizeEqPreset(preset);
  recordedIntensity = clampIntensity(intensity);
  applyAudioEffects();
}

/** 测试钩子：Node 下 contextState=null、bandGains 全 0，不抛错。 */
export function getAudioEffectsDebugInfo(): AudioEffectsDebugInfo {
  return {
    contextState: ctx ? ctx.state : null,
    preset: recordedPreset,
    intensity: recordedIntensity,
    bypass: bypassActive,
    bandGains: filters.length ? filters.map((filter) => filter.gain.value) : Array.from({ length: EQ_BAND_COUNT }, () => 0),
    bandFrequencies: [...EQ_BAND_FREQUENCIES]
  };
}

/** 暴露 window.JianyinAudioEffects 调试钩子（e2e 使用，同 window.JianyinAndroid 惯例）。 */
export function setDebugHook(enabled: boolean): void {
  if (!isBrowser()) return;
  if (enabled) {
    (window as unknown as Record<string, unknown>).JianyinAudioEffects = { getDebugInfo: getAudioEffectsDebugInfo };
  } else {
    delete (window as unknown as Record<string, unknown>).JianyinAudioEffects;
  }
}

// 便于热更新/页面卸载时回收（HMR 重建元素时旧接线随旧元素 GC）
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => teardownGraph(), { once: true });
}
