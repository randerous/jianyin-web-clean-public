import type { PersistedState, Playlist, SharedState, SharedTombstones, Song } from "../types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function sharedCover(value: string) {
  return value.startsWith("blob:") || value.startsWith("data:") || value.startsWith("local-file:") ? "" : value;
}

const MAX_SHARED_ID_LENGTH = 512;

export function stableLegacySharedId(prefix: "shared_song" | "shared_playlist", value: string) {
  let first = 2166136261;
  let second = 2654435769;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 16777619);
    second = Math.imul(second ^ code, 2246822519);
  }
  const suffix = `${(first >>> 0).toString(16).padStart(8, "0")}${(second >>> 0).toString(16).padStart(8, "0")}`;
  return `${prefix}_legacy_${suffix}`;
}

export function canonicalSharedId(prefix: "shared_song" | "shared_playlist", value: string) {
  const normalized = value.trim();
  if (!normalized) return "";
  return normalized.length > MAX_SHARED_ID_LENGTH ? stableLegacySharedId(prefix, normalized) : normalized;
}

export function stableFlacSharedId(name: string, artist: string) {
  return canonicalSharedId("shared_song", `flac\u0000${name.trim()}\u0000${artist.trim()}`);
}

function localSharedSongId(song: Song) {
  const spoofedLegacyLocal = song.id.startsWith("local_") && song.source !== "local";
  if (song.sharedId && !spoofedLegacyLocal) return song.sharedId;
  if (song.id.startsWith("local_")) return stableLegacySharedId("shared_song", song.id);
  if (song.id.startsWith("shared_song")) return song.id;
  return stableLegacySharedId("shared_song", song.id);
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((item): item is string => typeof item === "string" && item.length > 0))).sort();
}

export function emptySharedTombstones(): SharedTombstones {
  return { playlistIds: [], favorites: [], playlistSongs: {} };
}

export function normalizeSharedTombstones(value: unknown): SharedTombstones {
  const raw = isRecord(value) ? value : {};
  const playlistSongs: Record<string, string[]> = {};
  if (isRecord(raw.playlistSongs)) {
    for (const [playlistId, songIds] of Object.entries(raw.playlistSongs)) {
      const normalized = stringArray(songIds);
      if (playlistId && normalized.length) playlistSongs[playlistId] = normalized;
    }
  }
  return {
    playlistIds: stringArray(raw.playlistIds),
    favorites: stringArray(raw.favorites),
    playlistSongs: Object.fromEntries(Object.entries(playlistSongs).sort(([left], [right]) => left.localeCompare(right)))
  };
}

export function sharedPlaylistIdentity(playlist: Playlist) {
  const spoofedLegacyLocal = playlist.id.startsWith("local_") && playlist.source !== "local";
  if (playlist.sharedId && !spoofedLegacyLocal) return playlist.sharedId;
  if (playlist.id !== "favorites" && playlist.id.startsWith("local_")) {
    return stableLegacySharedId("shared_playlist", playlist.id);
  }
  return playlist.id;
}

export function sharedSongIdentity(song: Song) {
  if (song.id.startsWith("local_") || song.source === "local") {
    return localSharedSongId(song);
  }
  if (song.source === "flac") {
    return canonicalSharedId("shared_song", song.sharedId ?? "") || stableFlacSharedId(song.name, song.artist);
  }
  return canonicalSharedId("shared_song", `${song.source}\u0000${song.id}`);
}

function sharedSong(song: Song): Song {
  const source = song.id.startsWith("local_") ? "local" : song.source;
  const remotePlayable = source !== "local";
  const sharedId = source === "flac"
    ? canonicalSharedId("shared_song", song.sharedId ?? "") || stableFlacSharedId(song.name, song.artist)
    : undefined;
  return {
    id: remotePlayable ? song.id : localSharedSongId(song),
    sharedId,
    name: song.name,
    artist: song.artist,
    url: "",
    cover: sharedCover(song.cover),
    source,
    remotePlayable,
    verifiedPlayable: false,
    durationMs: song.durationMs,
    bvid: song.bvid,
    cid: song.cid,
    needsImport: !remotePlayable
  };
}

function sharedPlaylist(playlist: Playlist): Playlist {
  const source = playlist.id.startsWith("local_") ? "local" : playlist.source;
  return {
    id: sharedPlaylistIdentity(playlist),
    name: playlist.name,
    cover: sharedCover(playlist.cover),
    songs: playlist.songs.map(sharedSong),
    source,
    trackCount: playlist.trackCount,
    creatorNickname: playlist.creatorNickname
  };
}

export function applySharedTombstones(state: SharedState): SharedState {
  const tombstones = normalizeSharedTombstones(state.tombstones);
  const deletedPlaylists = new Set(tombstones.playlistIds);
  const playlists = state.playlists
    .filter((playlist) => !deletedPlaylists.has(sharedPlaylistIdentity(playlist)))
    .map((playlist) => {
      const deletedSongs = new Set(tombstones.playlistSongs[sharedPlaylistIdentity(playlist)] ?? []);
      return { ...playlist, songs: playlist.songs.filter((song) => !deletedSongs.has(sharedSongIdentity(song))) };
    });
  const deletedFavorites = new Set(tombstones.favorites);
  return {
    ...state,
    playlists,
    favorites: state.favorites.filter((song) => !deletedFavorites.has(sharedSongIdentity(song))),
    tombstones
  };
}

export function mergeSharedTombstones(...values: Array<SharedTombstones | undefined>): SharedTombstones {
  const playlistIds = new Set<string>();
  const favorites = new Set<string>();
  const playlistSongs = new Map<string, Set<string>>();
  for (const value of values) {
    const normalized = normalizeSharedTombstones(value);
    normalized.playlistIds.forEach((id) => playlistIds.add(id));
    normalized.favorites.forEach((id) => favorites.add(id));
    for (const [playlistId, songIds] of Object.entries(normalized.playlistSongs)) {
      const target = playlistSongs.get(playlistId) ?? new Set<string>();
      songIds.forEach((id) => target.add(id));
      playlistSongs.set(playlistId, target);
    }
  }
  return normalizeSharedTombstones({
    playlistIds: [...playlistIds],
    favorites: [...favorites],
    playlistSongs: Object.fromEntries([...playlistSongs].map(([playlistId, songs]) => [playlistId, [...songs]]))
  });
}

function subtractSharedTombstones(previousValue: SharedTombstones | undefined, currentValue: SharedTombstones | undefined) {
  const previous = normalizeSharedTombstones(previousValue);
  const current = normalizeSharedTombstones(currentValue);
  const currentPlaylists = new Set(current.playlistIds);
  const currentFavorites = new Set(current.favorites);
  const playlistSongs: Record<string, string[]> = {};
  for (const [playlistId, songIds] of Object.entries(previous.playlistSongs)) {
    const currentSongs = new Set(current.playlistSongs[playlistId] ?? []);
    const removed = songIds.filter((songId) => !currentSongs.has(songId));
    if (removed.length) playlistSongs[playlistId] = removed;
  }
  return normalizeSharedTombstones({
    playlistIds: previous.playlistIds.filter((id) => !currentPlaylists.has(id)),
    favorites: previous.favorites.filter((id) => !currentFavorites.has(id)),
    playlistSongs
  });
}

export function applySharedTombstoneClears(tombstonesValue: SharedTombstones | undefined, clearsValue: SharedTombstones | undefined) {
  const tombstones = normalizeSharedTombstones(tombstonesValue);
  const clears = normalizeSharedTombstones(clearsValue);
  const clearedPlaylists = new Set(clears.playlistIds);
  const clearedFavorites = new Set(clears.favorites);
  const playlistSongs: Record<string, string[]> = {};
  for (const [playlistId, songIds] of Object.entries(tombstones.playlistSongs)) {
    if (clearedPlaylists.has(playlistId)) continue;
    const clearedSongs = new Set(clears.playlistSongs[playlistId] ?? []);
    const remaining = songIds.filter((songId) => !clearedSongs.has(songId));
    if (remaining.length) playlistSongs[playlistId] = remaining;
  }
  return normalizeSharedTombstones({
    playlistIds: tombstones.playlistIds.filter((id) => !clearedPlaylists.has(id)),
    favorites: tombstones.favorites.filter((id) => !clearedFavorites.has(id)),
    playlistSongs
  });
}

export function deriveSharedTombstoneClears(
  existingValue: SharedTombstones | undefined,
  previousValue: SharedTombstones | undefined,
  currentValue: SharedTombstones | undefined
) {
  const current = normalizeSharedTombstones(currentValue);
  const merged = mergeSharedTombstones(existingValue, subtractSharedTombstones(previousValue, current));
  return subtractSharedTombstones(merged, current);
}

export function deriveSharedTombstones(previous: SharedState, current: SharedState, existing?: SharedTombstones): SharedTombstones {
  const tombstones = normalizeSharedTombstones(existing);
  const deletedPlaylists = new Set(tombstones.playlistIds);
  const deletedFavorites = new Set(tombstones.favorites);
  const deletedPlaylistSongs = new Map(
    Object.entries(tombstones.playlistSongs).map(([playlistId, songIds]) => [playlistId, new Set(songIds)])
  );
  const previousPlaylists = new Map(previous.playlists.map((playlist) => [sharedPlaylistIdentity(playlist), playlist]));
  const currentPlaylists = new Map(current.playlists.map((playlist) => [sharedPlaylistIdentity(playlist), playlist]));

  for (const playlistId of previousPlaylists.keys()) {
    if (!currentPlaylists.has(playlistId)) {
      deletedPlaylists.add(playlistId);
      deletedPlaylistSongs.delete(playlistId);
    }
  }
  for (const [playlistId, playlist] of currentPlaylists) {
    const before = previousPlaylists.get(playlistId);
    if (!before) {
      deletedPlaylists.delete(playlistId);
      deletedPlaylistSongs.delete(playlistId);
      continue;
    }
    const removed = deletedPlaylistSongs.get(playlistId) ?? new Set<string>();
    const beforeSongs = new Set(before.songs.map(sharedSongIdentity));
    const currentSongs = new Set(playlist.songs.map(sharedSongIdentity));
    beforeSongs.forEach((id) => { if (!currentSongs.has(id)) removed.add(id); });
    currentSongs.forEach((id) => { if (!beforeSongs.has(id)) removed.delete(id); });
    if (removed.size) deletedPlaylistSongs.set(playlistId, removed);
    else deletedPlaylistSongs.delete(playlistId);
  }

  const previousFavorites = new Set(previous.favorites.map(sharedSongIdentity));
  const currentFavorites = new Set(current.favorites.map(sharedSongIdentity));
  previousFavorites.forEach((id) => { if (!currentFavorites.has(id)) deletedFavorites.add(id); });
  currentFavorites.forEach((id) => { if (!previousFavorites.has(id)) deletedFavorites.delete(id); });

  return normalizeSharedTombstones({
    playlistIds: [...deletedPlaylists],
    favorites: [...deletedFavorites],
    playlistSongs: Object.fromEntries([...deletedPlaylistSongs].map(([playlistId, songs]) => [playlistId, [...songs]]))
  });
}

export function toSharedState(state: Pick<PersistedState, "playlists" | "favorites" | "sharedRevision" | "sharedTombstones" | "updatedAt">): SharedState {
  return {
    schemaVersion: 2,
    revision: Number.isInteger(state.sharedRevision) && Number(state.sharedRevision) >= 0 ? Number(state.sharedRevision) : 0,
    playlists: state.playlists.map(sharedPlaylist),
    favorites: state.favorites.map(sharedSong),
    tombstones: normalizeSharedTombstones(state.sharedTombstones),
    ...(state.updatedAt ? { updatedAt: state.updatedAt } : {})
  };
}

export function sharedStateSignature(state: SharedState) {
  const songIdentity = (song: Song) => song.source === "flac"
    ? { source: song.source, id: sharedSongIdentity(song) }
    : song.source === "local"
      ? { source: song.source, id: song.id, name: song.name, artist: song.artist, durationMs: song.durationMs }
      : { source: song.source, id: song.id, bvid: song.bvid, cid: song.cid };
  return JSON.stringify({
    playlists: state.playlists.map((playlist) => ({
      id: playlist.id,
      name: playlist.name,
      source: playlist.source,
      songs: playlist.songs.map(songIdentity)
    })),
    favorites: state.favorites.map(songIdentity),
    tombstones: normalizeSharedTombstones(state.tombstones)
  });
}
