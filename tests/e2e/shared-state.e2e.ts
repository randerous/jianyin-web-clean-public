import { expect, test } from "playwright/test";
import { normalizeState, replaceSharedState } from "../../src/lib/storage";

test("legacy local identities stay stable across occurrences and preserve device cache linkage", () => {
  const rawSong = {
    id: "local_private.wav_1700000000000_123456_0",
    name: "private",
    artist: "Local",
    url: "local-file:local_private.wav_1700000000000_123456_0",
    cover: "",
    source: "local" as const,
    localKey: "local_private.wav_1700000000000_123456_0",
    durationMs: 65_000
  };
  const rawPlaylistId = "local_playlist_1700000000000";
  const local = normalizeState({
    playlists: [{ id: rawPlaylistId, name: "Legacy", cover: "", songs: [rawSong], source: "local" }],
    favorites: [rawSong],
    history: [rawSong],
    queue: [rawSong],
    queueIndex: 0
  });
  const localPlaylist = local.playlists.find((playlist) => playlist.id === rawPlaylistId)!;
  const occurrences = [localPlaylist.songs[0], local.favorites[0], local.history[0], local.queue[0]];
  const sharedSongId = occurrences[0].sharedId!;

  expect(sharedSongId).toMatch(/^shared_song_legacy_[0-9a-f]{16}$/);
  expect(localPlaylist.sharedId).toMatch(/^shared_playlist_legacy_[0-9a-f]{16}$/);
  expect(new Set(occurrences.map((song) => song.sharedId))).toEqual(new Set([sharedSongId]));

  const remote = {
    schemaVersion: 2 as const,
    revision: 1,
    playlists: [{
      id: "remote-container",
      name: "Moved remotely",
      cover: "",
      source: "local" as const,
      songs: [{ id: sharedSongId, name: "private", artist: "Local", url: "", cover: "", source: "local" as const, needsImport: true }]
    }],
    favorites: [{ id: sharedSongId, name: "private", artist: "Local", url: "", cover: "", source: "local" as const, needsImport: true }],
    tombstones: { playlistIds: [], favorites: [], playlistSongs: {} }
  };
  const replaced = replaceSharedState(local, remote);
  const moved = replaced.playlists.find((playlist) => playlist.id === "remote-container")!.songs[0];

  expect(moved.localKey).toBe(rawSong.localKey);
  expect(moved.url).toMatch(/^local-file:|^blob:/);
  expect(replaced.favorites[0].localKey).toBe(rawSong.localKey);
});

test("spoofed legacy local sources canonicalize without losing device cache linkage", () => {
  const rawSongId = "local_spoofed-private.wav_1700000000000";
  const rawPlaylistId = "local_spoofed-playlist_1700000000000";
  const rawSong = {
    id: rawSongId,
    name: "spoofed-private",
    artist: "Local",
    url: `local-file:${rawSongId}`,
    cover: "",
    source: "netease" as const,
    localKey: rawSongId,
    durationMs: 65_000
  };
  const local = normalizeState({
    playlists: [{ id: rawPlaylistId, name: "Spoofed Legacy", cover: "", songs: [rawSong], source: "netease" }],
    favorites: [rawSong],
    history: [rawSong],
    queue: [rawSong],
    queueIndex: 0
  });
  const localPlaylist = local.playlists.find((playlist) => playlist.id === rawPlaylistId)!;
  const localSong = localPlaylist.songs[0];

  expect(localPlaylist.source).toBe("local");
  expect(localSong.source).toBe("local");
  expect(localPlaylist.sharedId).toMatch(/^shared_playlist_legacy_[0-9a-f]{16}$/);
  expect(localSong.sharedId).toMatch(/^shared_song_legacy_[0-9a-f]{16}$/);

  const remote = {
    schemaVersion: 2 as const,
    revision: 1,
    playlists: [{
      id: localPlaylist.sharedId!,
      name: "Spoofed Legacy",
      cover: "",
      source: "local" as const,
      songs: [{ id: localSong.sharedId!, name: localSong.name, artist: localSong.artist, url: "", cover: "", source: "local" as const, needsImport: true }]
    }],
    favorites: [{ id: localSong.sharedId!, name: localSong.name, artist: localSong.artist, url: "", cover: "", source: "local" as const, needsImport: true }],
    tombstones: { playlistIds: [], favorites: [], playlistSongs: {} }
  };
  const replaced = replaceSharedState(local, remote);
  const restoredPlaylist = replaced.playlists.find((playlist) => playlist.id === rawPlaylistId)!;
  const restoredSong = restoredPlaylist.songs[0];

  expect(restoredSong.id).toBe(rawSongId);
  expect(restoredSong.localKey).toBe(rawSongId);
  expect(restoredSong.url).toMatch(/^local-file:|^blob:/);
  expect(replaced.favorites[0].localKey).toBe(rawSongId);
});
