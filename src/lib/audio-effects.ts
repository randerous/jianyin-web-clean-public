import type { AudioEffectsPreset } from "../types";

/**
 * WebAudio 音效系统（10 段 ISO 均衡）。
 *
 * 实现方式：用 `createMediaElementSource(audio)` 把元素的音频**接管**进
 * WebAudio 图（元素不再直出声音，无需任何 volume/muted 静音技巧）：
 * element → 10 段 peaking biquad 链 → destination。
 *
 * 为什么是 createMediaElementSource 而不是 captureStream：
 * - Android WebView 的 `captureStream()` 抓的是**音量/静音之后**的音频
 *   （实测 volume=0 或 muted=true 时流内能量都是 0，桌面 Chrome 却不是），
 *   因此"captureStream + 静音直通路径"在 Android 上会把流也静音掉 → 无声音。
 * - createMediaElementSource 直接接管元素，无需静音，桌面与 Android 行为一致。
 *
 * 关于"切换音效卡死"（元素时钟冻结）：
 * - 冻结只在 **AudioContext 处于 suspended 时**发生：createMediaElementSource
 *   接管后元素时钟由 WebAudio 图驱动，图被挂起就没人消费音频 → 时钟停住。
 * - 因此本模块只做两件事保证不冻结：① 仅在真实用户手势内接线（AudioContext
 *   以 running 创建）；② 一旦 ctx 被挂起立即 resume，并且**从不主动 suspend**
 *   （音乐播放器需要在后台继续播放，visibilitychange 只负责恢复）。
 *
 * 设计要点：
 * - createMediaElementSource 对同一元素只能调用一次，且换 src 无需重接
 *   （源节点绑定的是元素本身，src 变化自动跟随），所以接线以「元素同一性」
 *   幂等，不跟踪 src。
 * - "原声（关闭）" 预设 = 全 0 增益（peaking 0dB 完全透明），图保持连接，
 *   切换预设只改增益，不会出现双路叠加或静音。
 * - 模块级单例；顶层不触碰 window/AudioContext，Node（node:test）可 import。
 */

export const EQ_BAND_FREQUENCIES = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
export const EQ_BAND_COUNT = 10;
/**
 * 每段 peaking 滤波的 Q 值。取 √2 ≈ 1.41（倍频程图形均衡的标准值）：
 * 相邻频段重叠适度、叠加平滑，避免 Q=1.0 时相邻频段过量叠加导致的
 * 浑浊/发闷与高频毛刺。
 */
export const EQ_Q = 1.41;
export const EQ_INTENSITY_MIN = 0;
export const EQ_INTENSITY_MAX = 100;
export const DEFAULT_EQ_PRESET: AudioEffectsPreset = "hiFi";
export const DEFAULT_EQ_INTENSITY = 100;

export type EqPresetDef = { id: AudioEffectsPreset; label: string; gains: number[] };

/**
 * 预设 dB 表（10 段，中心频率见 EQ_BAND_FREQUENCIES）。
 * 采用 Apple Music / 主流播放器已验证的经典预设曲线（成熟方案，非随手调参）：
 * 流行=中频前凸、摇滚=V 形、饱满=低频暖+高频微收、人声=1–4kHz 存在感、
 * 古典=高频衰减、原声=全 0（透明旁路）。取值克制（±5 dB 内）避免削波发硬。
 */
export const EQ_PRESETS: EqPresetDef[] = [
  { id: "none", label: "原声（关闭）", gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { id: "hiFi", label: "流行 Pop", gains: [-1, 1, 2, 3, 3, 1, 0, -1, -1, 0] },
  { id: "full", label: "饱满 Full", gains: [5, 4, 3, 1, 0, 0, -1, -1, 0, 0] },
  { id: "vocal", label: "人声 Vocal", gains: [-2, -1, 0, 1, 3, 4, 3, 1, 0, -1] },
  { id: "classical", label: "古典 Classical", gains: [0, 0, 0, 0, 0, 0, -1, -2, -3, -4] },
  { id: "rock", label: "摇滚 Rock", gains: [4, 3, 2, 0, -1, -1, 0, 2, 3, 4] }
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

/** 强度缩放：gain_db[i] = preset.gains[i] * (intensity / 100)；none → 全 0。 */
export function scaledBandGains(preset: AudioEffectsPreset, intensity: number): number[] {
  const def = EQ_PRESETS.find((item) => item.id === preset) ?? EQ_PRESETS[1];
  if (def.id === "none") return EQ_BAND_FREQUENCIES.map(() => 0);
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
let recordedPreset: AudioEffectsPreset = DEFAULT_EQ_PRESET;
let recordedIntensity = DEFAULT_EQ_INTENSITY;
let fallbackListenersAttached = false;
let visibilityListenerAttached = false;

function isBrowser() {
  return typeof window !== "undefined";
}

function currentGains(): number[] {
  return scaledBandGains(recordedPreset, recordedIntensity);
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
}

// 音乐播放器需要后台继续播放：只恢复、从不挂起（挂起会冻结被接管的元素时钟）。
function attachVisibilityHandler() {
  if (visibilityListenerAttached || !isBrowser()) return;
  visibilityListenerAttached = true;
  document.addEventListener("visibilitychange", () => {
    if (ctx && ctx.state === "suspended") {
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

/** 接线核心（不含手势门控；由 ensureAudioEffects 与测试钩子共用）。 */
function wireGraph(audio: HTMLAudioElement): boolean {
  try {
    const AudioCtor: typeof AudioContext = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return false;
    ctx = new AudioCtor();
    // 接管元素：createMediaElementSource 对同一元素仅可调用一次；
    // 接线后元素音频全部走 WebAudio 图（无需静音），换 src 自动跟随。
    source = ctx.createMediaElementSource(audio);
    filters = EQ_BAND_FREQUENCIES.map((frequency) => {
      const filter = ctx!.createBiquadFilter();
      filter.type = "peaking";
      filter.frequency.value = frequency;
      filter.Q.value = EQ_Q;
      filter.gain.value = 0;
      return filter;
    });
    let node: AudioNode = source;
    for (const filter of filters) {
      node.connect(filter);
      node = filter;
    }
    node.connect(ctx.destination);
    wiredElement = audio;
    // 首次接线直设增益，避免爬升伪影
    const gains = currentGains();
    filters.forEach((filter, index) => {
      filter.gain.value = gains[index];
    });
    if (ctx.state === "suspended") {
      void ctx.resume().catch(() => undefined);
    }
    attachVisibilityHandler();
    return true;
  } catch {
    // InvalidStateError（元素已被接管）等：放弃图，保持直通。
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
 * 幂等接线：把 audio 元素接入 WebAudio EQ 图。
 * - 已接线且元素相同 → resume（若挂起）并刷新增益。
 * - 元素不同 → 直接对新元素接线（旧元素随其生命周期结束）。
 * - 非浏览器 / 无元素 → false。
 * - 非手势（navigator.userActivation.hasBeenActive 为 false）→ 挂一次性
 *   手势监听延迟接线，返回 false（保证"启动自动播放"等非手势路径零回归）。
 * - 正常路径 → 建 AudioContext + createMediaElementSource + 10 段 biquad 链。
 */
export function ensureAudioEffects(audio: HTMLAudioElement | null): boolean {
  if (!isBrowser() || !audio) return false;
  // 原声（关闭）：本不应经过 WebAudio。若从未接线则直接返回 false（元素直通播放，
  // 零 WebAudio 介入，避免 createMediaElementSource 接管导致的爆音/断流）；
  // 若之前已接线（createMediaElementSource 无法解除接管），保持 0 增益透明即可。
  if (recordedPreset === "none") {
    if (!ctx || wiredElement !== audio) return false;
    if (ctx.state === "suspended") {
      void ctx.resume().catch(() => undefined);
    }
    applyAudioEffects();
    return true;
  }
  if (ctx && wiredElement === audio) {
    if (ctx.state === "suspended") {
      void ctx.resume().catch(() => undefined);
    }
    applyAudioEffects();
    return true;
  }
  if (typeof navigator.userActivation === "object" && navigator.userActivation !== null && !navigator.userActivation.hasBeenActive) {
    attachFallbackGestureListeners(audio);
    return false;
  }
  return wireGraph(audio);
}

/**
 * 把最新预设/强度推送到已有图（无图则只记录，稍后接线时生效）。
 * 增益用 setTargetAtTime 防拉链噪声；none 预设 = 全 0（透明旁路）。
 */
export function applyAudioEffects(): void {
  if (!isBrowser() || !ctx || !source || !wiredElement || !filters.length) return;
  if (ctx.state === "suspended") {
    void ctx.resume().catch(() => undefined);
  }
  const gains = currentGains();
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

/** 指定 audio 元素是否已接入 WebAudio 图（用于切换预设时的接线决策）。 */
export function isAudioEffectsWired(audio: HTMLAudioElement | null): boolean {
  return isBrowser() && audio !== null && wiredElement === audio && ctx !== null;
}

/** 测试钩子：Node 下 contextState=null、bandGains 全 0，不抛错。 */
export function getAudioEffectsDebugInfo(): AudioEffectsDebugInfo {
  return {
    contextState: ctx ? ctx.state : null,
    preset: recordedPreset,
    intensity: recordedIntensity,
    bypass: recordedPreset === "none",
    bandGains: filters.length ? filters.map((filter) => filter.gain.value) : Array.from({ length: EQ_BAND_COUNT }, () => 0),
    bandFrequencies: [...EQ_BAND_FREQUENCIES]
  };
}

/** 暴露 window.JianyinAudioEffects 调试钩子（e2e 使用，同 window.JianyinAndroid 惯例）。 */
export function setDebugHook(enabled: boolean): void {
  if (!isBrowser()) return;
  if (enabled) {
    (window as unknown as Record<string, unknown>).JianyinAudioEffects = {
      getDebugInfo: getAudioEffectsDebugInfo,
      // 测试钩子：强制接线（绕过手势门控，用于验证接线后行为）。
      forceWire: (audio: HTMLAudioElement | null): boolean => {
        if (!isBrowser() || !audio) return false;
        if (wiredElement === audio && ctx) return true;
        return wireGraph(audio);
      }
    };
  } else {
    delete (window as unknown as Record<string, unknown>).JianyinAudioEffects;
  }
}

// 页面卸载时回收（HMR 重建元素时旧接线随旧元素 GC）
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => teardownGraph(), { once: true });
}
