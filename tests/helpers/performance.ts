import type { Locator, Page } from "playwright/test";

type AudioPhaseCapture = {
  start: number | null;
  canplay: number | null;
  playing: number | null;
};

type DomPhaseCapture = {
  start: number | null;
  end: number | null;
};

type PerformanceWindow = Window & {
  __jianyinPerformance?: {
    longTasks: Array<{ duration: number; start: number }>;
    errors: string[];
  };
  __jianyinAudioPhases?: Record<string, AudioPhaseCapture>;
  __jianyinDomPhases?: Record<string, DomPhaseCapture>;
};

export async function installPerformanceCapture(page: Page) {
  await page.addInitScript(() => {
    const typedWindow = window as PerformanceWindow;
    typedWindow.__jianyinPerformance = { longTasks: [], errors: [] };
    try {
      const observer = new PerformanceObserver((list) => {
        const capture = typedWindow.__jianyinPerformance;
        if (!capture) return;
        for (const entry of list.getEntries()) {
          capture.longTasks.push({ duration: entry.duration, start: entry.startTime });
        }
      });
      observer.observe({ type: "longtask", buffered: true });
    } catch {
      // Long Task API is optional in some browser engines.
    }
    window.addEventListener("error", (event) => {
      typedWindow.__jianyinPerformance?.errors.push(event.message || "window error");
    });
    window.addEventListener("unhandledrejection", (event) => {
      const reason = event.reason instanceof Error ? event.reason.message : String(event.reason ?? "unhandled rejection");
      typedWindow.__jianyinPerformance?.errors.push(reason);
    });
    const originalConsoleError = console.error.bind(console);
    console.error = (...args: unknown[]) => {
      typedWindow.__jianyinPerformance?.errors.push(args.map((value) => String(value)).join(" "));
      originalConsoleError(...args);
    };
  });
}

export async function readPerformanceDiagnostics(page: Page) {
  return page.evaluate(() => {
    const capture = (window as PerformanceWindow).__jianyinPerformance;
    return capture ?? { longTasks: [], errors: [] };
  });
}

export async function armAudioPhaseCapture(trigger: Locator, key: string) {
  await trigger.evaluate((element, captureKey) => {
    const typedWindow = window as PerformanceWindow;
    const audio = document.querySelector("audio");
    if (!(audio instanceof HTMLAudioElement)) throw new Error("audio element not found");
    typedWindow.__jianyinAudioPhases ??= {};
    const capture: AudioPhaseCapture = { start: null, canplay: null, playing: null };
    typedWindow.__jianyinAudioPhases[captureKey] = capture;
    element.addEventListener("click", () => {
      capture.start = performance.now();
      if (audio.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) capture.canplay = capture.start;
    }, { capture: true, once: true });
    audio.addEventListener("canplay", () => {
      if (capture.start !== null && capture.canplay === null) capture.canplay = performance.now();
    }, { once: true });
    audio.addEventListener("playing", () => {
      if (capture.start !== null) capture.playing = performance.now();
    }, { once: true });
  }, key);
}

export async function readAudioPhaseCapture(page: Page, key: string) {
  return page.evaluate((captureKey) => {
    const capture = (window as PerformanceWindow).__jianyinAudioPhases?.[captureKey];
    if (!capture || capture.start === null || capture.playing === null) return null;
    return {
      canplayMs: capture.canplay === null ? null : capture.canplay - capture.start,
      playingMs: capture.playing - capture.start
    };
  }, key);
}

export async function armDomPhaseCapture(trigger: Locator, key: string, completion: { selector: string; text?: string; event?: "click" | "keydown"; keyValue?: string }) {
  await trigger.evaluate((element, options) => {
    const typedWindow = window as PerformanceWindow;
    typedWindow.__jianyinDomPhases ??= {};
    const capture: DomPhaseCapture = { start: null, end: null };
    typedWindow.__jianyinDomPhases[options.captureKey] = capture;
    const complete = () => {
      if (capture.start === null || capture.end !== null) return;
      const candidates = [...document.querySelectorAll(options.selector)];
      const matched = options.text
        ? candidates.some((candidate) => candidate.textContent?.includes(options.text!))
        : candidates.length > 0;
      if (matched) capture.end = performance.now();
    };
    const observer = new MutationObserver(() => {
      complete();
      if (capture.end !== null) observer.disconnect();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    const eventName = options.event ?? "click";
    element.addEventListener(eventName, (event) => {
      if (eventName === "keydown" && options.keyValue && event instanceof KeyboardEvent && event.key !== options.keyValue) return;
      capture.start = performance.now();
      complete();
    }, { capture: true, once: true });
  }, { captureKey: key, ...completion });
}

export async function readDomPhaseCapture(page: Page, key: string) {
  return page.evaluate((captureKey) => {
    const capture = (window as PerformanceWindow).__jianyinDomPhases?.[captureKey];
    if (!capture || capture.start === null || capture.end === null) return null;
    return capture.end - capture.start;
  }, key);
}
