import type { Song } from "../types";

export function downloadCacheKey(song: Song) {
  if (song.localKey?.startsWith("download_")) return song.localKey;
  if (song.url.startsWith("local-file:download_")) return song.url.slice("local-file:".length);
  return "";
}

export function isDownloadCachedSong(song: Song) {
  return Boolean(downloadCacheKey(song));
}
