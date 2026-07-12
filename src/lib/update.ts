import packageJson from "../../package.json";
import { apiUrl } from "./api";

export const CURRENT_VERSION = packageJson.version;
export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export type UpdateAsset = {
  name: string;
  url: string;
  sha256: string;
  size: number | null;
};

export type LatestUpdate = {
  currentVersion: string;
  latestVersion: string;
  tag: string;
  available: boolean;
  releaseUrl: string;
  publishedAt: string | null;
  notes: string;
  canApply: boolean;
  assets: {
    apk: UpdateAsset | null;
    windowsLauncher: UpdateAsset | null;
  };
};

export async function fetchLatestUpdate(signal?: AbortSignal) {
  const response = await fetch(apiUrl("/api/update/latest"), {
    cache: "no-store",
    signal
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof data?.message === "string" ? data.message : "更新检查失败";
    throw new Error(message);
  }
  return data as LatestUpdate;
}

export async function applyDesktopUpdate(tag: string, signal?: AbortSignal) {
  const response = await fetch(apiUrl("/api/update/apply"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tag }),
    signal
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof data?.message === "string" ? data.message : "桌面版更新失败";
    throw new Error(message);
  }
  return data as { ok: boolean; updated: boolean; tag?: string; message?: string };
}
