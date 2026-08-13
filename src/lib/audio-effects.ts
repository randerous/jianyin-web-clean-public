import type { AudioEffectsPreset } from "../types";

/**
 * WebAudio 音效系统（10 段 ISO 均衡）。
 *
 * 实现方式：**不接管 audio 元素**，而是用 `audio.captureStream()` 取元素
 * 的音频流副本 → `MediaStreamAudioSourceNode` → 10 段 peaking biquad → destination；
 * 同时把元素音量置 0（元素直通静音，用户听到的是经过 EQ 的流）。
 *
 * 为什么不用 createMediaElementSource：
 * - Chromium 系（桌面 Chrome/Edge/Android WebView）中，createMediaElementSource
 *   接管元素后元素时钟会**永久冻结**（切换音效后播放位置停住，pause/resume
 *   均无法恢复）；captureStream 只是复制流，不接管元素，时钟完全正常。
 * - 已验证：captureStream + volume=0 时流内仍有完整音频能量（volume 不影响
 *   captureStream 的数据），EQ 后声音正常；none 旁路时 volume=1 恢复原声直通。
 *
 * 设计要点：
 * - 模块级单例持有全部 WebAudio 状态；顶层不触碰 window/AudioContext，
 *   每个 DOM 调用都有守卫，因此本模块可在 Node（node:test）中直接 import。
 * - AudioContext 懒创建，只在用户播放手势内接线（ensureAudioEffects），
 *   非手势播放由 userActivation 门控延迟到下一个真实手势。
 * - 旁路（"原声/关闭"）：元素音量恢复 1（原声直通），WebAudio 输出保持
 *   但元素已静音，等于完全旁路。
 * - captureStream 对同一元素可重复调用（每次新流），接线以元素同一性做
 *   幂等守卫。
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
let source: MediaStreamAudioSourceNode | null = null;
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

/**
 * Android WebView 上 captureStream 的音频时钟同样会被 WebAudio 图冻结
 * （切换音效后播放位置停住），这是 WebView 环境限制而非代码 bug。
 * 桌面 Chrome/Edge/Safari 行为正常。因此 Android 端禁用 WebAudio 接线，
 * 播放保持直通（等同「原声」），避免切音效后播放卡死。
 */
function isAndroidWebView() {
  if (!isBrowser()) return false;
  const ua = String(navigator.userAgent || "");
  return /Android/i.test(ua);
}

/** 元素是否支持 captureStream（桌面 Chromium/Safari 均支持） */
function canCaptureStream(audio: HTMLAudioElement | null): audio is HTMLAudioElement {
  return audio !== null && typeof (audio as HTMLMediaElement & { captureStream?: () => MediaStream }).captureStream === "function";
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
  if (wiredElement) {
    // 恢复元素音量：图拆除后元素直通原声
    wiredElement.volume = 1;
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

/** 接线核心（不含手势门控；由 ensureAudioEffects 与测试钩子共用）。 */
function wireGraph(audio: HTMLAudioElement): boolean {
  try {
    const AudioCtor: typeof AudioContext = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return false;
    ctx = new AudioCtor();
    // 若 AudioContext 以 suspended 创建（非手势上下文），resume 可能被拒绝；
    // 但 captureStream 不接管元素时钟，即使 ctx suspended 也不影响播放。
    // 为让 EQ 生效仍尽量恢复；失败则本次接线保留（元素音量保持 0 时会静音，
    // 所以接线失败时要把音量恢复回去并放弃图）。
    if (ctx.state === "suspended") {
      void ctx.resume().catch(() => undefined);
    }
    const stream = (audio as HTMLMediaElement & { captureStream: () => MediaStream }).captureStream();
    source = ctx.createMediaStreamSource(stream);
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
    filters[filters.length - 1].connect(ctx.destination);
    bypassActive = false;
    wiredElement = audio;
    // 元素静音：用户听到的是经过 EQ 的流（captureStream 数据不受 volume 影响）
    audio.volume = 0;
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
    audio.volume = 1;
    return false;
  }
}

/**
 * 幂等接线：把 audio 元素的音频流接入 WebAudio EQ 图。
 * - 已接线且元素相同 → 尝试 resume 并返回 true。
 * - 元素不同 → 拆除旧图重接。
 * - 非浏览器 / 无元素 / 不支持 captureStream → false。
 * - 非手势（navigator.userActivation.hasBeenActive 为 false）→ 挂一次性
 *   手势监听延迟接线，返回 false（保证"启动自动播放"等非手势路径零回归）。
 * - 正常路径 → 建 AudioContext + captureStream 流 + 10 段 biquad 链，
 *   元素 volume=0（声音走 EQ 流），应用当前预设。
 */
export function ensureAudioEffects(audio: HTMLAudioElement | null): boolean {
  if (!isBrowser() || !audio) return false;
  // Android WebView 上 WebAudio 会冻结时钟 → 不接线，保持直通。
  if (isAndroidWebView()) return false;
  // 原声（关闭）不需要任何图：不接线、不挂延迟监听。
  if (recordedPreset === "none") return false;
  if (ctx && wiredElement === audio) {
    if (ctx.state === "suspended") {
      void ctx.resume().catch(() => undefined);
    }
    return true;
  }
  if (!canCaptureStream(audio)) return false;
  if (typeof navigator.userActivation === "object" && navigator.userActivation !== null && !navigator.userActivation.hasBeenActive) {
    attachFallbackGestureListeners(audio);
    return false;
  }
  return wireGraph(audio);
}

/**
 * 把最新预设/强度推送到已有图（无图则只记录，稍后接线时生效）。
 * 旁路切换只在该标志翻转时调整元素音量与拓扑；增益用 setTargetAtTime 防拉链噪声。
 */
export function applyAudioEffects(): void {
  if (!isBrowser() || !ctx || !source || !wiredElement) return;
  if (ctx.state === "suspended") {
    void ctx.resume().catch(() => undefined);
  }
  const bypass = recordedPreset === "none";
  if (bypass !== bypassActive) {
    if (bypass) {
      // 旁路：元素恢复原声直通；WebAudio 输出保持连接（元素已静音，
      // 但断开流避免多余处理）。这里仅恢复音量，流保持连接无妨。
      wiredElement.volume = 1;
    } else {
      // 启用 EQ：元素静音，声音走 EQ 流
      wiredElement.volume = 0;
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
    bypass: bypassActive,
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
      // 测试钩子：强制接线（绕过手势门控，用于验证接线后时钟行为）。
      forceWire: (audio: HTMLAudioElement | null): boolean => {
        if (!isBrowser() || !audio || recordedPreset === "none") return false;
        if (wiredElement === audio && ctx) return true;
        if (!canCaptureStream(audio)) return false;
        return wireGraph(audio);
      }
    };
  } else {
    delete (window as unknown as Record<string, unknown>).JianyinAudioEffects;
  }
}

// 便于热更新/页面卸载时回收（HMR 重建元素时旧接线随旧元素 GC）
if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => teardownGraph(), { once: true });
}
