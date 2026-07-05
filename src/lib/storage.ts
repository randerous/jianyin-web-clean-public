import { FAVORITES_ID, LOCAL_DB_NAME, LOCAL_STORE_NAME, RECENT_HISTORY_LIMIT, STORAGE_KEY, cover } from "../data/seed";
import type { BackupPayload, LocalFileBackup, PersistedState, Playlist, Song } from "../types";
import { apiUrl } from "./api";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function asSong(value: unknown): Song | null {
  if (!isRecord(value)) return null;
  const id = asString(value.id);
  const localKey = asString(value.localKey) || (asString(value.url).startsWith("local-file:") ? asString(value.url).slice(11) : "");
  const coverKey = asString(value.coverKey) || (asString(value.cover).startsWith("local-file:") ? asString(value.cover).slice(11) : "");
  if (!id && !localKey) return null;
  const source = value.source === "netease" || value.source === "bili" || value.source === "flac" || value.source === "local" ? value.source : localKey ? "local" : "netease";
  return {
    id: id || localKey,
    name: asString(value.name, "未知歌曲"),
    artist: asString(value.artist, "未知歌手"),
    url: asString(value.url),
    cover: asString(value.cover),
    source,
    lrc: typeof value.lrc === "string" ? value.lrc : undefined,
    localKey: localKey || undefined,
    coverKey: coverKey || undefined,
    remotePlayable: Boolean(value.remotePlayable) || source === "netease" || source === "bili" || source === "flac",
    verifiedPlayable: Boolean(value.verifiedPlayable) || Boolean(asString(value.url)),
    durationMs: typeof value.durationMs === "number" && Number.isFinite(value.durationMs) ? value.durationMs : undefined,
    br: typeof value.br === "number" && Number.isFinite(value.br) ? value.br : null,
    level: typeof value.level === "string" ? value.level : null,
    audioType: typeof value.audioType === "string" ? value.audioType : typeof value.type === "string" ? value.type : null,
    quality: typeof value.quality === "string" ? value.quality : undefined,
    time: typeof value.time === "string" || typeof value.time === "number" ? value.time : undefined,
    sign: typeof value.sign === "string" ? value.sign : undefined,
    needsImport: Boolean(value.needsImport),
    bvid: typeof value.bvid === "string" ? value.bvid : undefined,
    cid: typeof value.cid === "number" && Number.isFinite(value.cid) ? value.cid : undefined
  };
}

function isDemoSong(song: Song) {
  return song.id.startsWith("demo_") || song.artist.includes("示例曲库") || song.artist.includes("绀轰緥鏇插簱");
}

function removeDemoSongs(songs: Song[]) {
  return songs.filter((song) => !isDemoSong(song));
}

function isDemoPlaylist(playlist: Playlist) {
  return playlist.id === "daily" || playlist.id === "hot";
}

function asPlaylist(value: unknown): Playlist | null {
  if (!isRecord(value)) return null;
  const id = asString(value.id);
  const name = asString(value.name);
  if (!id || !name) return null;
  const songs = Array.isArray(value.songs) ? removeDemoSongs(value.songs.map(asSong).filter((song): song is Song => Boolean(song))) : [];
  return {
    id,
    name,
    cover: asString(value.cover, songs[0]?.cover ?? ""),
    songs,
    source: value.source === "netease" || value.source === "bili" || value.source === "flac" ? value.source : "local",
    trackCount: typeof value.trackCount === "number" && Number.isFinite(value.trackCount) ? value.trackCount : songs.length,
    creatorNickname: asString(value.creatorNickname)
  };
}

export function songKey(song: Song) {
  if (song.source !== "local" && song.id) return song.id;
  return song.localKey || song.id || song.url;
}

function serializeSong(song: Song): Song {
  const serialized = { ...song };
  if (song.localKey) serialized.url = `local-file:${song.localKey}`;
  if (song.coverKey) serialized.cover = `local-file:${song.coverKey}`;
  if (song.cover?.startsWith("blob:") && !song.coverKey) serialized.cover = "";
  if (song.url?.startsWith("blob:") && !song.localKey) serialized.url = "";
  if (song.localKey || song.coverKey) return serialized;
  return song;
}

function persistableSong(song: Song) {
  return Boolean(song.localKey || (song.url && !song.url.startsWith("blob:")) || song.remotePlayable);
}

function serializeSongs(songs: Song[]) {
  return removeDemoSongs(songs).filter(persistableSong).map(serializeSong);
}

function serializePlaylist(playlist: Playlist): Playlist {
  return { ...playlist, songs: serializeSongs(playlist.songs) };
}

function serializeState(state: PersistedState): PersistedState {
  const queue = serializeSongs(state.queue);
  const currentKey = state.queue[state.queueIndex] ? songKey(state.queue[state.queueIndex]) : "";
  const queueIndex = currentKey ? queue.findIndex((song) => songKey(song) === currentKey) : -1;
  return {
    playlists: state.playlists.map(serializePlaylist),
    favorites: serializeSongs(state.favorites),
    history: serializeSongs(state.history),
    queue,
    queueIndex: queueIndex >= 0 ? queueIndex : clampQueueIndex(queue, state.queueIndex),
    searchHistory: state.searchHistory,
    theme: state.theme,
    playQuality: state.playQuality,
    downloadQuality: state.downloadQuality,
    progressStyle: state.progressStyle,
    lyricSource: state.lyricSource,
    autoLyricsEnabled: state.autoLyricsEnabled,
    playbackSpeed: state.playbackSpeed,
    fadeEnabled: state.fadeEnabled,
    autoCacheEnabled: state.autoCacheEnabled,
    keepQueueOnExit: state.keepQueueOnExit,
    autoPlayOnStart: state.autoPlayOnStart,
    androidStatusNotificationEnabled: state.androidStatusNotificationEnabled
  };
}

function clampQueueIndex(queue: Song[], queueIndex: unknown) {
  if (!queue.length) return -1;
  if (typeof queueIndex !== "number" || !Number.isFinite(queueIndex)) return 0;
  return Math.min(Math.max(0, Math.trunc(queueIndex)), queue.length - 1);
}

function emptyFavoritesPlaylist(): Playlist {
  return {
    id: FAVORITES_ID,
    name: "我喜欢的音乐",
    cover: cover(1),
    songs: [],
    source: "local"
  };
}

export function normalizeState(value: unknown): PersistedState {
  const raw = isRecord(value) ? value : {};
  const playlists = Array.isArray(raw.playlists)
    ? raw.playlists.map(asPlaylist).filter((playlist): playlist is Playlist => Boolean(playlist)).filter((playlist) => !isDemoPlaylist(playlist))
    : [];
  const withFavorites = playlists.some((playlist) => playlist.id === FAVORITES_ID) ? playlists : [emptyFavoritesPlaylist(), ...playlists];
  const favorites = Array.isArray(raw.favorites)
    ? removeDemoSongs(raw.favorites.map(asSong).filter((song): song is Song => Boolean(song)))
    : withFavorites.find((playlist) => playlist.id === FAVORITES_ID)?.songs ?? [];
  const history = Array.isArray(raw.history) ? removeDemoSongs(raw.history.map(asSong).filter((song): song is Song => Boolean(song))).slice(0, RECENT_HISTORY_LIMIT) : [];
  const queue = Array.isArray(raw.queue) ? removeDemoSongs(raw.queue.map(asSong).filter((song): song is Song => Boolean(song))) : [];
  const searchHistory = Array.isArray(raw.searchHistory) ? raw.searchHistory.filter((item): item is string => typeof item === "string").slice(0, 12) : [];
  const theme = raw.theme === "dark" ? "dark" : "light";
  const playQuality = ["jymaster", "sky", "jyeffect", "hires", "lossless", "exhigh", "standard"].includes(String(raw.playQuality)) ? raw.playQuality as PersistedState["playQuality"] : "exhigh";
  const downloadQuality = ["jymaster", "sky", "jyeffect", "hires", "lossless", "exhigh", "standard"].includes(String(raw.downloadQuality)) ? raw.downloadQuality as PersistedState["downloadQuality"] : "exhigh";
  const progressStyle = raw.progressStyle === "round" || raw.progressStyle === "audio" ? raw.progressStyle : "default";
  const lyricSource = raw.lyricSource === "embedded" ? "embedded" : "network";
  const autoLyricsEnabled = raw.autoLyricsEnabled !== false;
  const playbackSpeed = typeof raw.playbackSpeed === "number" && Number.isFinite(raw.playbackSpeed) ? Math.min(4, Math.max(0.25, raw.playbackSpeed)) : 1;
  return {
    playlists: withFavorites.map((playlist) => playlist.id === FAVORITES_ID ? { ...playlist, songs: favorites } : playlist),
    favorites,
    history,
    queue,
    queueIndex: clampQueueIndex(queue, raw.queueIndex),
    searchHistory,
    theme,
    playQuality,
    downloadQuality,
    progressStyle,
    lyricSource,
    autoLyricsEnabled,
    playbackSpeed,
    fadeEnabled: Boolean(raw.fadeEnabled),
    autoCacheEnabled: Boolean(raw.autoCacheEnabled),
    keepQueueOnExit: raw.keepQueueOnExit !== false,
    autoPlayOnStart: Boolean(raw.autoPlayOnStart),
    androidStatusNotificationEnabled: Boolean(raw.androidStatusNotificationEnabled)
  };
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return normalizeState(raw ? JSON.parse(raw) : null);
  } catch {
    return normalizeState(null);
  }
}

export function saveState(state: PersistedState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(serializeState(state)));
}

function mergeSongs(a: Song[], b: Song[]) {
  return uniqueByKey([...a, ...b], songKey);
}

function uniqueByKey<T>(items: T[], keyOf: (item: T) => string) {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function mergePlaylists(local: Playlist[], remote: Playlist[]) {
  const merged = new Map<string, Playlist>();
  for (const playlist of [...remote, ...local]) {
    const existing = merged.get(playlist.id);
    if (!existing) {
      merged.set(playlist.id, playlist);
      continue;
    }
    const songs = mergeSongs(existing.songs, playlist.songs);
    merged.set(playlist.id, {
      ...existing,
      ...playlist,
      cover: playlist.cover || existing.cover || songs[0]?.cover || "",
      songs,
      trackCount: Math.max(existing.trackCount ?? 0, playlist.trackCount ?? 0, songs.length)
    });
  }
  return Array.from(merged.values());
}

export function mergeStates(local: PersistedState, remote: PersistedState): PersistedState {
  const playlists = mergePlaylists(local.playlists, remote.playlists);
  const favorites = mergeSongs(local.favorites, remote.favorites);
  return normalizeState({
    ...remote,
    ...local,
    playlists,
    favorites,
    history: mergeSongs(local.history, remote.history).slice(0, RECENT_HISTORY_LIMIT),
    queue: local.queue.length ? local.queue : remote.queue,
    queueIndex: local.queue.length ? local.queueIndex : remote.queueIndex,
    searchHistory: uniqueByKey([...local.searchHistory, ...remote.searchHistory], (item) => item).slice(0, 12)
  });
}

export async function loadSharedState() {
  const response = await fetch(apiUrl("/api/state"));
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.message === "string" ? data.message : "共享歌单读取失败");
  return data.state ? normalizeState(data.state) : null;
}

export async function saveSharedState(state: PersistedState) {
  const response = await fetch(apiUrl("/api/state"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state: serializeState(state) })
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(typeof data.message === "string" ? data.message : "共享歌单保存失败");
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(LOCAL_DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(LOCAL_STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveLocalFile(key: string, file: Blob) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(LOCAL_STORE_NAME, "readwrite");
    tx.objectStore(LOCAL_STORE_NAME).put(file, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function loadLocalFile(key: string) {
  const db = await openDb();
  const blob = await new Promise<Blob | null>((resolve, reject) => {
    const tx = db.transaction(LOCAL_STORE_NAME, "readonly");
    const request = tx.objectStore(LOCAL_STORE_NAME).get(key);
    request.onsuccess = () => resolve((request.result as Blob | undefined) ?? null);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return blob;
}

export async function hydrateLocalSongs(state: PersistedState) {
  const urls: string[] = [];
  const cache = new Map<string, string>();

  async function hydrate(song: Song): Promise<Song> {
    let next = song;
    if (song.localKey && song.url.startsWith("local-file:")) {
      let url = cache.get(song.localKey);
      if (!url) {
        const blob = await loadLocalFile(song.localKey).catch(() => null);
        if (!blob) return { ...song, url: "", needsImport: true, name: song.name.includes("需重新导入") ? song.name : `${song.name}（需重新导入）` };
        url = URL.createObjectURL(blob);
        urls.push(url);
        cache.set(song.localKey, url);
      }
      next = { ...next, url, needsImport: false };
    }
    if (song.coverKey && song.cover.startsWith("local-file:")) {
      let cover = cache.get(song.coverKey);
      if (!cover) {
        const blob = await loadLocalFile(song.coverKey).catch(() => null);
        if (blob) {
          cover = URL.createObjectURL(blob);
          urls.push(cover);
          cache.set(song.coverKey, cover);
        }
      }
      if (cover) next = { ...next, cover };
    }
    return next;
  }

  const playlists = await Promise.all(state.playlists.map(async (playlist) => ({ ...playlist, songs: await Promise.all(playlist.songs.map(hydrate)) })));
  const favorites = await Promise.all(state.favorites.map(hydrate));
  const history = await Promise.all(state.history.map(hydrate));
  const queue = await Promise.all(state.queue.map(hydrate));
  return { state: { ...state, playlists, favorites, history, queue }, urls };
}

function blobToDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function dataUrlToBlob(dataUrl: string) {
  const [header, body] = dataUrl.split(",");
  const mime = header.match(/^data:(.*?);base64$/)?.[1] || "application/octet-stream";
  const binary = atob(body || "");
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mime });
}

async function collectLocalFileBackups(songs: Song[]): Promise<LocalFileBackup[]> {
  const keys = Array.from(new Set(songs.flatMap((song) => [song.localKey, song.coverKey]).filter((key): key is string => Boolean(key))));
  const backups: LocalFileBackup[] = [];
  for (const key of keys) {
    const blob = await loadLocalFile(key).catch(() => null);
    if (blob) backups.push({ key, type: blob.type || "application/octet-stream", dataUrl: await blobToDataUrl(blob) });
  }
  return backups;
}

export async function makeBackup(state: PersistedState): Promise<BackupPayload> {
  return {
    ...serializeState(state),
    localFiles: await collectLocalFileBackups([...state.playlists.flatMap((playlist) => playlist.songs), ...state.history, ...state.queue]),
    exportedAt: new Date().toISOString(),
    app: "jianyin-web-clean"
  };
}

export async function restoreBackup(data: unknown) {
  const raw = isRecord(data) ? data : {};
  if (Array.isArray(raw.localFiles)) {
    for (const item of raw.localFiles) {
      if (!isRecord(item)) continue;
      const key = asString(item.key);
      const dataUrl = asString(item.dataUrl);
      if (key && dataUrl.startsWith("data:")) await saveLocalFile(key, dataUrlToBlob(dataUrl));
    }
  }
  return normalizeState(data);
}

export function downloadJson(name: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}
