import { FAVORITES_ID, LOCAL_DB_NAME, LOCAL_STORE_NAME, RECENT_HISTORY_LIMIT, STORAGE_KEY, cover } from "../data/seed.ts";
import type { BackupPayload, BackupPreview, LocalFileBackup, PersistedState, Playlist, SharedState, SharedTombstones, Song } from "../types";
import { apiUrl } from "./api.ts";
import { clampIntensity, normalizeEqPreset } from "./audio-effects.ts";
import { applySharedTombstones, canonicalSharedId, mergeSharedTombstones, normalizeSharedTombstones, sharedPlaylistIdentity, sharedSongIdentity, stableFlacSharedId, stableLegacySharedId, toSharedState } from "./shared-state.ts";
export { deriveSharedTombstones, sharedStateSignature, toSharedState } from "./shared-state.ts";

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
  const canonicalId = id || localKey;
  const legacyLocal = canonicalId.startsWith("local_");
  const spoofedLegacyLocal = legacyLocal && value.source !== undefined && value.source !== "local";
  const source = legacyLocal
    ? "local"
    : value.source === "netease" || value.source === "bili" || value.source === "flac" || value.source === "local" ? value.source : localKey ? "local" : "netease";
  const name = asString(value.name, "未知歌曲");
  const artist = asString(value.artist, "未知歌手");
  const explicitSharedId = spoofedLegacyLocal ? "" : canonicalSharedId("shared_song", asString(value.sharedId));
  const sharedId = explicitSharedId || (source === "local" && canonicalId.startsWith("local_")
    ? stableLegacySharedId("shared_song", canonicalId)
    : source === "local" && canonicalId.startsWith("shared_song")
      ? canonicalId
      : source === "flac" ? stableFlacSharedId(name, artist) : "");
  return {
    id: canonicalId,
    sharedId: sharedId || undefined,
    name,
    artist,
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

function isDownloadedSong(song: Song) {
  return Boolean(song.localKey?.startsWith("download_") || song.url.startsWith("local-file:download_"));
}

function candidateDownloadKey(song: Song) {
  if (!song.id || (song.source !== "netease" && song.source !== "bili" && song.source !== "flac")) return "";
  return `download_${song.source}_${song.id}`.replace(/[^a-zA-Z0-9_.-]/g, "_");
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
  const legacyLocal = id.startsWith("local_");
  const spoofedLegacyLocal = legacyLocal && value.source !== undefined && value.source !== "local";
  const source = legacyLocal
    ? "local"
    : value.source === "netease" || value.source === "bili" || value.source === "flac" ? value.source : "local";
  const explicitSharedId = spoofedLegacyLocal ? "" : canonicalSharedId("shared_playlist", asString(value.sharedId));
  const sharedId = explicitSharedId || (source === "local" && id.startsWith("local_")
    ? stableLegacySharedId("shared_playlist", id)
    : source === "local" && id.startsWith("shared_playlist") ? id : "");
  return {
    id,
    sharedId: sharedId || undefined,
    name,
    cover: asString(value.cover, songs[0]?.cover ?? ""),
    songs,
    source,
    trackCount: typeof value.trackCount === "number" && Number.isFinite(value.trackCount) ? value.trackCount : songs.length,
    creatorNickname: asString(value.creatorNickname)
  };
}

export function songKey(song: Song) {
  if (song.source !== "local" && song.id) return song.id;
  return song.localKey || song.id || song.url;
}

export function downloadSongKey(song: Song) {
  if (song.source === "flac") return sharedSongIdentity(song);
  return songKey(song);
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
  return Boolean(song.localKey || (song.url && !song.url.startsWith("blob:")) || song.remotePlayable || song.needsImport);
}

function serializeSongs(songs: Song[]) {
  return removeDemoSongs(songs).filter(persistableSong).map(serializeSong);
}

function serializePlaylist(playlist: Playlist): Playlist {
  return { ...playlist, songs: serializeSongs(playlist.songs) };
}

export function serializeState(state: PersistedState): PersistedState {
  const queue = serializeSongs(state.queue);
  const currentKey = state.queue[state.queueIndex] ? songKey(state.queue[state.queueIndex]) : "";
  const queueIndex = currentKey ? queue.findIndex((song) => songKey(song) === currentKey) : -1;
  return {
    playlists: state.playlists.map(serializePlaylist),
    favorites: serializeSongs(state.favorites),
    history: serializeSongs(state.history),
    downloadHistory: serializeSongs(state.downloadHistory),
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
    eqPreset: state.eqPreset,
    eqIntensity: state.eqIntensity,
    autoCacheEnabled: state.autoCacheEnabled,
    keepQueueOnExit: state.keepQueueOnExit,
    autoPlayOnStart: state.autoPlayOnStart,
    autoUpdateEnabled: state.autoUpdateEnabled,
    androidStatusNotificationEnabled: state.androidStatusNotificationEnabled,
    sharedSyncPending: Boolean(state.sharedSyncPending),
    sharedRevision: state.sharedRevision,
    sharedTombstones: normalizeSharedTombstones(state.sharedTombstones),
    sharedTombstoneClears: normalizeSharedTombstones(state.sharedTombstoneClears),
    updatedAt: state.updatedAt
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
  const explicitDownloadHistory = Array.isArray(raw.downloadHistory) ? removeDemoSongs(raw.downloadHistory.map(asSong).filter((song): song is Song => Boolean(song))) : [];
  const inferredDownloadHistory = removeDemoSongs([...withFavorites.flatMap((playlist) => playlist.songs), ...favorites, ...history, ...queue].filter(isDownloadedSong));
  const downloadHistory = uniqueByKey([...explicitDownloadHistory, ...inferredDownloadHistory], songKey).slice(0, RECENT_HISTORY_LIMIT);
  const searchHistory = Array.isArray(raw.searchHistory) ? raw.searchHistory.filter((item): item is string => typeof item === "string").slice(0, 12) : [];
  const theme = raw.theme === "dark" ? "dark" : "light";
  const playQuality = ["jymaster", "sky", "jyeffect", "hires", "lossless", "exhigh", "standard"].includes(String(raw.playQuality)) ? raw.playQuality as PersistedState["playQuality"] : "exhigh";
  const downloadQuality = ["jymaster", "sky", "jyeffect", "hires", "lossless", "exhigh", "standard"].includes(String(raw.downloadQuality)) ? raw.downloadQuality as PersistedState["downloadQuality"] : "exhigh";
  const progressStyle = raw.progressStyle === "round" || raw.progressStyle === "audio" ? raw.progressStyle : "default";
  const lyricSource = raw.lyricSource === "embedded" ? "embedded" : "network";
  const autoLyricsEnabled = raw.autoLyricsEnabled !== false;
  const playbackSpeed = typeof raw.playbackSpeed === "number" && Number.isFinite(raw.playbackSpeed) ? Math.min(4, Math.max(0.25, raw.playbackSpeed)) : 1;
  const updatedAt = typeof raw.updatedAt === "number" && Number.isFinite(raw.updatedAt) && raw.updatedAt > 0 ? raw.updatedAt : undefined;
  const sharedRevision = typeof raw.sharedRevision === "number" && Number.isInteger(raw.sharedRevision) && raw.sharedRevision >= 0 ? raw.sharedRevision : undefined;
  return {
    playlists: withFavorites.map((playlist) => playlist.id === FAVORITES_ID ? { ...playlist, songs: favorites } : playlist),
    favorites,
    history,
    downloadHistory,
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
    eqPreset: normalizeEqPreset(raw.eqPreset),
    eqIntensity: clampIntensity(raw.eqIntensity),
    autoCacheEnabled: Boolean(raw.autoCacheEnabled),
    keepQueueOnExit: raw.keepQueueOnExit !== false,
    autoPlayOnStart: Boolean(raw.autoPlayOnStart),
    autoUpdateEnabled: Boolean(raw.autoUpdateEnabled),
    androidStatusNotificationEnabled: Boolean(raw.androidStatusNotificationEnabled),
    sharedSyncPending: Boolean(raw.sharedSyncPending),
    sharedRevision,
    sharedTombstones: normalizeSharedTombstones(raw.sharedTombstones),
    sharedTombstoneClears: normalizeSharedTombstones(raw.sharedTombstoneClears),
    updatedAt
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

function sharedSongMergeKey(song: Song) {
  return sharedSongIdentity(song);
}

function mergeSharedSongs(local: Song[], remote: Song[]) {
  const result: Song[] = [];
  const indexes = new Map<string, number>();
  const deviceScore = (song: Song) => (song.localKey ? 8 : 0) + (song.url ? 4 : 0) + (!song.needsImport ? 2 : 0) + (song.verifiedPlayable ? 1 : 0);
  for (const song of [...local, ...remote]) {
    const key = sharedSongMergeKey(song);
    const index = indexes.get(key);
    if (index === undefined) {
      indexes.set(key, result.length);
      result.push(song);
      continue;
    }
    if (deviceScore(song) > deviceScore(result[index])) result[index] = song;
  }
  return result;
}

function mergeSharedPlaylists(local: Playlist[], remote: Playlist[]) {
  const merged = new Map(local.map((playlist) => [sharedPlaylistIdentity(playlist), playlist]));
  for (const playlist of remote) {
    const identity = sharedPlaylistIdentity(playlist);
    const existing = merged.get(identity);
    if (!existing) {
      merged.set(identity, playlist);
      continue;
    }
    const songs = mergeSharedSongs(existing.songs, playlist.songs);
    merged.set(identity, {
      ...existing,
      ...playlist,
      id: existing.id,
      sharedId: existing.sharedId || playlist.sharedId || identity,
      cover: playlist.cover || existing.cover || songs[0]?.cover || "",
      songs,
      trackCount: Math.max(existing.trackCount ?? 0, playlist.trackCount ?? 0, songs.length)
    });
  }
  return Array.from(merged.values());
}

function applyTombstonesToLibrary(playlists: Playlist[], favorites: Song[], tombstonesValue: SharedTombstones | undefined) {
  const tombstones = normalizeSharedTombstones(tombstonesValue);
  const deletedPlaylists = new Set(tombstones.playlistIds);
  const filteredPlaylists = playlists
    .filter((playlist) => !deletedPlaylists.has(sharedPlaylistIdentity(playlist)))
    .map((playlist) => {
      const deletedSongs = new Set(tombstones.playlistSongs[sharedPlaylistIdentity(playlist)] ?? []);
      return { ...playlist, songs: playlist.songs.filter((song) => !deletedSongs.has(sharedSongIdentity(song))) };
    });
  const deletedFavorites = new Set(tombstones.favorites);
  return {
    playlists: filteredPlaylists,
    favorites: favorites.filter((song) => !deletedFavorites.has(sharedSongIdentity(song)))
  };
}

function replaceSharedSongs(local: Song[], remote: Song[]) {
  const localSongs = new Map(local.map((song) => [sharedSongMergeKey(song), song]));
  const localMetadata = new Map<string, Song | null>();
  for (const song of local) {
    if (song.source !== "local") continue;
    const key = `${song.name.trim()}\u0000${song.artist.trim()}\u0000${song.durationMs ?? ""}`;
    localMetadata.set(key, localMetadata.has(key) ? null : song);
  }
  return remote.map((song) => {
    const metadataKey = `${song.name.trim()}\u0000${song.artist.trim()}\u0000${song.durationMs ?? ""}`;
    const deviceSong = localSongs.get(sharedSongMergeKey(song))
      ?? (song.source === "local" ? localMetadata.get(metadataKey) ?? undefined : undefined);
    if (!deviceSong) return song;
    return {
      ...song,
      id: song.source === "local" ? deviceSong.id : song.id,
      sharedId: song.source === "local"
        ? song.sharedId || (song.id.startsWith("shared_song") ? song.id : deviceSong.sharedId)
        : song.sharedId,
      url: deviceSong.url,
      cover: deviceSong.cover || song.cover,
      lrc: deviceSong.lrc,
      localKey: deviceSong.localKey,
      coverKey: deviceSong.coverKey,
      remotePlayable: deviceSong.remotePlayable || song.remotePlayable,
      verifiedPlayable: deviceSong.verifiedPlayable,
      br: deviceSong.br,
      level: deviceSong.level,
      audioType: deviceSong.audioType,
      quality: deviceSong.quality,
      time: deviceSong.time,
      sign: deviceSong.sign,
      needsImport: deviceSong.localKey || deviceSong.url ? false : song.needsImport
    };
  });
}

export function mergeStates(local: PersistedState, remote: PersistedState): PersistedState {
  const playlists = mergeSharedPlaylists(local.playlists, remote.playlists);
  const favorites = mergeSharedSongs(local.favorites, remote.favorites);
  const updatedAt = Math.max(local.updatedAt ?? 0, remote.updatedAt ?? 0);
  const useRemoteSettings = Boolean(remote.updatedAt && (!local.updatedAt || remote.updatedAt > local.updatedAt));
  return normalizeState({
    ...remote,
    ...local,
    playlists,
    favorites,
    history: mergeSharedSongs(local.history, remote.history).slice(0, RECENT_HISTORY_LIMIT),
    downloadHistory: mergeSharedSongs(local.downloadHistory, remote.downloadHistory).slice(0, RECENT_HISTORY_LIMIT),
    queue: local.queue.length ? local.queue : remote.queue,
    queueIndex: local.queue.length ? local.queueIndex : remote.queueIndex,
    searchHistory: uniqueByKey([...local.searchHistory, ...remote.searchHistory], (item) => item).slice(0, 12),
    ...(useRemoteSettings ? {
      theme: remote.theme,
      playQuality: remote.playQuality,
      downloadQuality: remote.downloadQuality,
      progressStyle: remote.progressStyle,
      lyricSource: remote.lyricSource,
      autoLyricsEnabled: remote.autoLyricsEnabled,
      playbackSpeed: remote.playbackSpeed,
      fadeEnabled: remote.fadeEnabled,
      eqPreset: remote.eqPreset,
      eqIntensity: remote.eqIntensity,
      autoCacheEnabled: remote.autoCacheEnabled,
      keepQueueOnExit: remote.keepQueueOnExit,
      autoPlayOnStart: remote.autoPlayOnStart,
      autoUpdateEnabled: remote.autoUpdateEnabled,
      androidStatusNotificationEnabled: remote.androidStatusNotificationEnabled
    } : {}),
    ...(updatedAt > 0 ? { updatedAt } : {})
  });
}

export function mergeSharedState(local: PersistedState, remote: SharedState): PersistedState {
  const tombstones = mergeSharedTombstones(local.sharedTombstones, remote.tombstones);
  const localLibrary = applyTombstonesToLibrary(local.playlists, local.favorites, tombstones);
  const remoteLibrary = applyTombstonesToLibrary(remote.playlists, remote.favorites, tombstones);
  return normalizeState({
    ...local,
    playlists: applyTombstonesToLibrary(mergeSharedPlaylists(localLibrary.playlists, remoteLibrary.playlists), [], tombstones).playlists,
    favorites: applyTombstonesToLibrary([], mergeSharedSongs(localLibrary.favorites, remoteLibrary.favorites), tombstones).favorites,
    sharedRevision: remote.revision,
    sharedTombstones: tombstones,
    updatedAt: Math.max(local.updatedAt ?? 0, remote.updatedAt ?? 0) || undefined
  });
}

export function replaceSharedState(local: PersistedState, remote: SharedState): PersistedState {
  const remoteLibrary = applyTombstonesToLibrary(remote.playlists, remote.favorites, remote.tombstones);
  const localPlaylists = new Map(local.playlists.map((playlist) => [sharedPlaylistIdentity(playlist), playlist]));
  const localSongs = [
    ...local.playlists.flatMap((playlist) => playlist.songs),
    ...local.favorites,
    ...local.history,
    ...local.downloadHistory,
    ...local.queue
  ];
  const playlists = remoteLibrary.playlists.map((playlist) => {
    const identity = sharedPlaylistIdentity(playlist);
    const devicePlaylist = localPlaylists.get(identity);
    const songs = replaceSharedSongs(localSongs, playlist.songs);
    if (!devicePlaylist) return { ...playlist, songs };
    return {
      ...playlist,
      id: devicePlaylist.id,
      sharedId: devicePlaylist.sharedId || playlist.sharedId || identity,
      cover: playlist.cover || devicePlaylist.cover || songs[0]?.cover || "",
      songs,
      trackCount: Math.max(playlist.trackCount ?? 0, songs.length)
    };
  });
  return normalizeState({
    ...local,
    playlists,
    favorites: replaceSharedSongs(localSongs, remoteLibrary.favorites),
    sharedRevision: remote.revision,
    sharedTombstones: remote.tombstones,
    sharedSyncPending: false,
    updatedAt: Math.max(local.updatedAt ?? 0, remote.updatedAt ?? 0) || undefined
  });
}

function normalizeSharedStatePayload(value: unknown): SharedState {
  const raw = isRecord(value) ? value : {};
  const revision = typeof raw.revision === "number" && Number.isInteger(raw.revision) && raw.revision >= 0 ? raw.revision : 0;
  const tombstones = normalizeSharedTombstones(raw.tombstones);
  const normalized = normalizeState(raw);
  const projected = toSharedState({ ...normalized, sharedRevision: revision, sharedTombstones: tombstones });
  return applySharedTombstones({
    ...projected,
    revision,
    tombstones,
    ...(typeof raw.lastWriteId === "string" && raw.lastWriteId ? { lastWriteId: raw.lastWriteId } : {}),
    ...(typeof raw.updatedAt === "number" && Number.isFinite(raw.updatedAt) && raw.updatedAt > 0 ? { updatedAt: raw.updatedAt } : {})
  });
}

export class SharedStateConflictError extends Error {
  state: SharedState;

  constructor(message: string, state: SharedState) {
    super(message);
    this.name = "SharedStateConflictError";
    this.state = state;
  }
}

export async function loadSharedState() {
  const response = await fetch(apiUrl("/api/state"));
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.message === "string" ? data.message : "共享歌单读取失败");
  return data.state ? normalizeSharedStatePayload(data.state) : null;
}

export async function saveSharedState(state: SharedState, options: { keepalive?: boolean; baseRevision: number; writeId: string }) {
  const body = JSON.stringify({ state, baseRevision: options.baseRevision, writeId: options.writeId });
  let response: Response;
  try {
    response = await fetch(apiUrl("/api/state"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: Boolean(options.keepalive && new TextEncoder().encode(body).byteLength <= 60_000)
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`无法连接共享服务：${detail}`);
  }
  const data = await response.json().catch(() => ({}));
  if (response.status === 409 && data.state) {
    throw new SharedStateConflictError(typeof data.message === "string" ? data.message : "共享歌单已有更新", normalizeSharedStatePayload(data.state));
  }
  if (!response.ok) throw new Error(typeof data.message === "string" ? data.message : `共享歌单保存失败（HTTP ${response.status}）`);
  return data.state
    ? normalizeSharedStatePayload(data.state)
    : { ...state, revision: options.baseRevision + 1, lastWriteId: options.writeId };
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

export async function deleteLocalFile(key: string) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(LOCAL_STORE_NAME, "readwrite");
    tx.objectStore(LOCAL_STORE_NAME).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function hydrateLocalSongs(state: PersistedState) {
  const urls: string[] = [];
  const cache = new Map<string, string>();
  const loading = new Map<string, Promise<string | null>>();
  const missingKeys = new Set<string>();
  const stateSongs = [
    ...state.playlists.flatMap((playlist) => playlist.songs),
    ...state.favorites,
    ...state.history,
    ...state.downloadHistory,
    ...state.queue
  ];
  const downloadLocalKeys = new Map<string, string>();
  const downloadHistoryKeys = new Set(state.downloadHistory.map(downloadSongKey));
  for (const song of stateSongs) {
    const identity = downloadSongKey(song);
    if (!isDownloadedSong(song) && !downloadHistoryKeys.has(identity)) continue;
    const key = song.localKey || candidateDownloadKey(song);
    if (!key) continue;
    if (isDownloadedSong(song) || !downloadLocalKeys.has(identity)) downloadLocalKeys.set(identity, key);
  }

  async function loadObjectUrl(key: string) {
    let url = cache.get(key);
    if (url || missingKeys.has(key)) return url ?? null;
    const active = loading.get(key);
    if (active) return active;
    const task = (async () => {
      const blob = await loadLocalFile(key).catch(() => null);
      if (!blob) {
        missingKeys.add(key);
        return null;
      }
      const objectUrl = URL.createObjectURL(blob);
      urls.push(objectUrl);
      cache.set(key, objectUrl);
      return objectUrl;
    })();
    loading.set(key, task);
    try {
      return await task;
    } finally {
      loading.delete(key);
    }
  }

  async function hydrate(song: Song): Promise<Song> {
    let next = song;
    if (!song.localKey) {
      const key = downloadLocalKeys.get(downloadSongKey(song));
      const url = key ? await loadObjectUrl(key) : null;
      if (url) next = { ...next, localKey: key, url, needsImport: false, remotePlayable: true, verifiedPlayable: true };
    }
    if (next.localKey && !next.url.startsWith("blob:")) {
      const url = await loadObjectUrl(next.localKey);
      if (!url) return { ...next, url: "", needsImport: true, name: next.name.includes("需重新导入") ? next.name : `${next.name}（需重新导入）` };
      next = { ...next, url, needsImport: false, name: next.name.replace(/（需重新导入）$/, "") };
    }
    if (next.coverKey && next.cover.startsWith("local-file:")) {
      const cover = await loadObjectUrl(next.coverKey);
      if (cover) next = { ...next, cover };
    }
    return next;
  }

  const playlists = await Promise.all(state.playlists.map(async (playlist) => ({ ...playlist, songs: await Promise.all(playlist.songs.map(hydrate)) })));
  const favorites = await Promise.all(state.favorites.map(hydrate));
  const history = await Promise.all(state.history.map(hydrate));
  const downloadHistory = await Promise.all(state.downloadHistory.map(hydrate));
  const queue = await Promise.all(state.queue.map(hydrate));
  return { state: { ...state, playlists, favorites, history, downloadHistory, queue }, urls };
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

export const MAX_BACKUP_LOCAL_FILES = 200;
export const MAX_BACKUP_LOCAL_FILE_BYTES = 64 * 1024 * 1024;
export const MAX_BACKUP_LOCAL_BYTES = 256 * 1024 * 1024;
const MAX_BACKUP_LOCAL_KEY_LENGTH = 240;
const BACKUP_DATA_URL_PATTERN = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/i;

function stateLocalFileKeys(state: PersistedState) {
  const songs = [...state.playlists.flatMap((playlist) => playlist.songs), ...state.favorites, ...state.history, ...state.downloadHistory, ...state.queue];
  return new Set(songs.flatMap((song) => [song.localKey, song.coverKey]).filter((key): key is string => Boolean(key)));
}

function isSupportedBackupMimeType(value: string) {
  return /^audio\/[a-z0-9.+-]+$/i.test(value) || /^image\/[a-z0-9.+-]+$/i.test(value) || value === "application/octet-stream";
}

function base64ByteLength(value: string) {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return value.length / 4 * 3 - padding;
}

function validateBackupState(raw: Record<string, unknown>) {
  const requiredArrayFields = ["playlists", "favorites", "history", "downloadHistory", "queue", "searchHistory"];
  if (raw.app !== "jianyin-web-clean") throw new Error("不是既见备份文件");
  if (typeof raw.exportedAt !== "string" || !Number.isFinite(Date.parse(raw.exportedAt))) throw new Error("备份导出时间无效");
  if (requiredArrayFields.some((field) => !Array.isArray(raw[field]))) throw new Error("备份状态结构不完整");
  return normalizeState(raw);
}

export function validateBackup(data: unknown): BackupPreview {
  if (!isRecord(data)) throw new Error("备份内容不是 JSON 对象");
  const state = validateBackupState(data);
  const rawFiles = data.localFiles === undefined ? [] : data.localFiles;
  if (!Array.isArray(rawFiles)) throw new Error("本地文件列表无效");
  if (rawFiles.length > MAX_BACKUP_LOCAL_FILES) throw new Error(`本地文件数量超过 ${MAX_BACKUP_LOCAL_FILES} 个上限`);

  const referencedKeys = stateLocalFileKeys(state);
  const seenKeys = new Set<string>();
  const localFiles: LocalFileBackup[] = [];
  let localFileBytes = 0;
  for (const rawFile of rawFiles) {
    if (!isRecord(rawFile)) throw new Error("本地文件条目无效");
    const key = asString(rawFile.key);
    const type = asString(rawFile.type);
    const dataUrl = asString(rawFile.dataUrl);
    if (!key || key.length > MAX_BACKUP_LOCAL_KEY_LENGTH || /[\u0000-\u001f]/.test(key)) throw new Error("本地文件键无效");
    if (!referencedKeys.has(key)) throw new Error("备份包含未引用的本地文件");
    if (seenKeys.has(key)) throw new Error("备份包含重复的本地文件");
    const dataUrlMatch = dataUrl.match(BACKUP_DATA_URL_PATTERN);
    if (!dataUrlMatch) throw new Error("本地文件编码无效");
    const mime = dataUrlMatch[1].toLowerCase();
    const encoded = dataUrlMatch[2];
    if (!isSupportedBackupMimeType(mime) || type.toLowerCase() !== mime) throw new Error("本地文件类型不受支持");
    if (encoded.length % 4 !== 0) throw new Error("本地文件编码无效");
    const byteLength = base64ByteLength(encoded);
    if (!Number.isFinite(byteLength) || byteLength < 0 || byteLength > MAX_BACKUP_LOCAL_FILE_BYTES) throw new Error("单个本地文件超过大小上限");
    localFileBytes += byteLength;
    if (localFileBytes > MAX_BACKUP_LOCAL_BYTES) throw new Error("本地文件总大小超过上限");
    seenKeys.add(key);
    localFiles.push({ key, type: mime, dataUrl });
  }

  return {
    state,
    localFiles,
    exportedAt: asString(data.exportedAt),
    playlistCount: state.playlists.length,
    songCount: state.playlists.reduce((count, playlist) => count + playlist.songs.length, 0),
    localFileCount: localFiles.length,
    localFileBytes
  };
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
    localFiles: await collectLocalFileBackups([...state.playlists.flatMap((playlist) => playlist.songs), ...state.history, ...state.downloadHistory, ...state.queue]),
    exportedAt: new Date().toISOString(),
    app: "jianyin-web-clean"
  };
}

export async function restoreBackup(backup: BackupPreview) {
  for (const item of backup.localFiles) {
    await saveLocalFile(item.key, dataUrlToBlob(item.dataUrl));
  }
  return backup.state;
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
