import type { LyricLine } from "../types";

export function parseLrc(lrc = ""): LyricLine[] {
  return lrc
    .split(/\r?\n/)
    .flatMap((line) => {
      const tags = Array.from(line.matchAll(/\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?]/g));
      const text = line.replace(/\[(\d{2}):(\d{2})(?:\.(\d{2,3}))?]/g, "").trim();
      return tags.map((tag) => {
        const mins = Number(tag[1]);
        const secs = Number(tag[2]);
        const millis = Number((tag[3] ?? "0").padEnd(3, "0"));
        return { time: mins * 60 + secs + millis / 1000, text };
      });
    })
    .filter((line) => line.text)
    .sort((a, b) => a.time - b.time);
}

export function activeLyricIndex(lines: LyricLine[], position: number) {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].time <= position) return index;
  }
  return -1;
}

export function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
  const min = Math.floor(seconds / 60);
  const sec = Math.floor(seconds % 60);
  return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}
