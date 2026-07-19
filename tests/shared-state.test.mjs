import assert from "node:assert/strict";
import { test } from "node:test";

import { applySharedTombstoneClears, applySharedTombstones, deriveSharedTombstoneClears, deriveSharedTombstones, sharedSongIdentity, sharedStateSignature, stableLegacySharedId, toSharedState } from "../src/lib/shared-state.ts";

const remoteSong = {
  id: "bili_BV1_test_42",
  name: "Shared Song",
  artist: "Shared Artist",
  url: "/api/bili/stream/BV1_test?cid=42&sign=temporary",
  cover: "blob:temporary-cover",
  source: "bili",
  localKey: "download_bili_BV1_test_42",
  coverKey: "cover_bili_BV1_test_42",
  lrc: "temporary lyrics",
  verifiedPlayable: true,
  durationMs: 65_000,
  quality: "lossless",
  time: 123,
  sign: "temporary",
  bvid: "BV1_test",
  cid: 42
};

function persistedState() {
  return {
    playlists: [
      { id: "favorites", name: "我喜欢的音乐", cover: "", songs: [remoteSong], source: "local" },
      { id: "shared", name: "Shared Playlist", cover: "blob:playlist-cover", songs: [remoteSong], source: "local" }
    ],
    favorites: [remoteSong],
    history: [remoteSong],
    downloadHistory: [remoteSong],
    queue: [remoteSong],
    queueIndex: 0,
    searchHistory: ["local search"],
    theme: "dark",
    playQuality: "lossless",
    downloadQuality: "standard",
    progressStyle: "round",
    lyricSource: "embedded",
    autoLyricsEnabled: false,
    playbackSpeed: 1.25,
    fadeEnabled: true,
    autoCacheEnabled: true,
    keepQueueOnExit: true,
    autoPlayOnStart: true,
    autoUpdateEnabled: true,
    androidStatusNotificationEnabled: true,
    updatedAt: 123
  };
}

test("shared state contains only stable playlist and favorite data", () => {
  const shared = toSharedState(persistedState());
  assert.deepEqual(Object.keys(shared).sort(), ["favorites", "playlists", "revision", "schemaVersion", "tombstones", "updatedAt"]);
  assert.equal(shared.schemaVersion, 2);
  assert.equal(shared.revision, 0);
  assert.deepEqual(shared.tombstones, { playlistIds: [], favorites: [], playlistSongs: {} });

  const song = shared.playlists[1].songs[0];
  assert.equal(song.url, "");
  assert.equal(song.cover, "");
  assert.equal(song.bvid, "BV1_test");
  assert.equal(song.cid, 42);
  for (const field of ["localKey", "coverKey", "lrc", "quality", "time", "sign"]) {
    assert.equal(field in song, false, `${field} must stay device-local`);
  }

  const local = { ...remoteSong, id: "local_secret-name.wav_1700000000000_123456_0", source: "local" };
  const projectedLocal = toSharedState({ playlists: [{ id: "local", name: "Local", cover: "", songs: [local], source: "local" }], favorites: [] }).playlists[0].songs[0];
  assert.match(projectedLocal.id, /^shared_song_legacy_[0-9a-f]+$/);
  assert.doesNotMatch(projectedLocal.id, /secret-name|1700000000000|123456/);
});

test("playback runtime changes do not change the shared playlist signature", () => {
  const original = persistedState();
  const runtimeOnly = persistedState();
  runtimeOnly.playlists = runtimeOnly.playlists.map((playlist) => ({
    ...playlist,
    songs: playlist.songs.map((song) => ({ ...song, url: "/new-signed-url", verifiedPlayable: false, quality: "standard", lrc: "new lyrics" }))
  }));
  runtimeOnly.history = [];
  runtimeOnly.queue = [];
  runtimeOnly.queueIndex = -1;
  runtimeOnly.theme = "light";

  assert.equal(sharedStateSignature(toSharedState(runtimeOnly)), sharedStateSignature(toSharedState(original)));

  const changedLibrary = persistedState();
  changedLibrary.playlists[1] = { ...changedLibrary.playlists[1], songs: [] };
  assert.notEqual(sharedStateSignature(toSharedState(changedLibrary)), sharedStateSignature(toSharedState(original)));

  const flacPlaceholder = { ...remoteSong, id: "flac_search_placeholder", source: "flac", name: "Same FLAC", artist: "Same Artist" };
  const flacResolved = { ...flacPlaceholder, id: "flac_123456", url: "/api/flac/stream/123456?sign=new" };
  const flacState = (song) => toSharedState({ playlists: [{ id: "flac", name: "FLAC", cover: "", songs: [song], source: "flac" }], favorites: [] });
  assert.equal(sharedStateSignature(flacState(flacPlaceholder)), sharedStateSignature(flacState(flacResolved)));
});

test("shared tombstones encode deletions and prevent stale resurrection", () => {
  const before = toSharedState(persistedState());
  const current = toSharedState({
    ...persistedState(),
    playlists: persistedState().playlists.map((playlist) => playlist.id === "shared" ? { ...playlist, songs: [] } : playlist),
    favorites: []
  });
  const tombstones = deriveSharedTombstones(before, current);

  assert.deepEqual(tombstones.favorites, ["bili\u0000bili_BV1_test_42"]);
  assert.deepEqual(tombstones.playlistSongs.shared, ["bili\u0000bili_BV1_test_42"]);

  const reapplied = applySharedTombstones(toSharedState({
    ...persistedState(),
    sharedTombstones: tombstones
  }));
  assert.equal(reapplied.playlists.find((playlist) => playlist.id === "shared").songs.length, 0);
  assert.equal(reapplied.favorites.length, 0);
});

test("intentionally re-added songs clear their existing tombstones", () => {
  const before = toSharedState(persistedState());
  const withoutSong = toSharedState({
    ...persistedState(),
    playlists: persistedState().playlists.map((playlist) => playlist.id === "shared" ? { ...playlist, songs: [] } : playlist),
    favorites: []
  });
  const tombstones = deriveSharedTombstones(before, withoutSong);
  const deleted = applySharedTombstones({ ...withoutSong, tombstones });
  const readded = toSharedState({ ...persistedState(), sharedTombstones: tombstones });
  const cleared = deriveSharedTombstones(deleted, readded, tombstones);
  const visible = applySharedTombstones({ ...readded, tombstones: cleared });

  assert.deepEqual(cleared.favorites, []);
  assert.deepEqual(cleared.playlistSongs, {});
  assert.equal(visible.playlists.find((playlist) => playlist.id === "shared").songs.length, 1);
  assert.equal(visible.favorites.length, 1);
});

test("local deletion tombstones use opaque server-compatible identities", () => {
  const localSong = {
    id: "local_secret-name.wav_1700000000000_123456_0",
    name: "secret-name.wav",
    artist: "Private Artist",
    url: "local-file:local_secret-name.wav_1700000000000_123456_0",
    cover: "",
    source: "local",
    localKey: "local_secret-name.wav_1700000000000_123456_0",
    durationMs: 65_000
  };
  const state = toSharedState({
    playlists: [{ id: "local_private-playlist_1700000000000", name: "Private", cover: "", songs: [localSong], source: "local" }],
    favorites: [localSong]
  });
  const identity = sharedSongIdentity(state.playlists[0].songs[0]);
  const removed = deriveSharedTombstones(state, { ...state, playlists: [], favorites: [] });
  const serialized = JSON.stringify(removed);

  assert.equal(identity, state.playlists[0].songs[0].id);
  assert.match(identity, /^shared_song_legacy_[0-9a-f]{16}$/);
  assert.deepEqual(removed.favorites, [identity]);
  assert.doesNotMatch(serialized, /secret-name|Private Artist|1700000000000|123456/);
});

test("legacy local IDs ignore spoofed sources and retain device cache linkage", () => {
  const localSongId = "local_private-song_1700000000000";
  const localPlaylistId = "local_private-playlist_1700000000000";
  const localSong = {
    ...remoteSong,
    id: localSongId,
    source: "netease",
    url: `local-file:${localSongId}`,
    localKey: localSongId,
    remotePlayable: false
  };
  const projected = toSharedState({
    playlists: [{ id: localPlaylistId, name: "Private", cover: "", songs: [localSong], source: "netease" }],
    favorites: [localSong]
  });
  const sharedPlaylist = projected.playlists.find((playlist) => playlist.name === "Private");
  assert.ok(sharedPlaylist);
  assert.equal(sharedPlaylist.source, "local");
  assert.equal(sharedPlaylist.songs[0].source, "local");
  assert.equal(sharedPlaylist.id, stableLegacySharedId("shared_playlist", localPlaylistId));
  assert.equal(sharedPlaylist.songs[0].id, stableLegacySharedId("shared_song", localSongId));
  assert.equal(projected.favorites[0].id, stableLegacySharedId("shared_song", localSongId));
});

test("normal local opaque IDs remain stable when an explicit shared ID is present", () => {
  const song = {
    ...remoteSong,
    id: "local_file_1",
    sharedId: "shared_song_device_1",
    source: "local"
  };
  const playlist = {
    id: "local_playlist_1",
    sharedId: "shared_playlist_device_1",
    name: "Local Playlist",
    cover: "",
    songs: [song],
    source: "local"
  };
  const shared = toSharedState({ playlists: [playlist], favorites: [song] });

  assert.equal(shared.playlists[0].id, "shared_playlist_device_1");
  assert.equal(shared.playlists[0].songs[0].id, "shared_song_device_1");
  assert.equal(shared.favorites[0].id, "shared_song_device_1");
});

test("long FLAC metadata uses one bounded identity for songs and tombstones", () => {
  const name = "N".repeat(600);
  const artist = "A".repeat(600);
  const flacSong = { ...remoteSong, id: "flac_long", source: "flac", name, artist };
  const before = toSharedState({
    playlists: [{ id: "flac", name: "FLAC", cover: "", songs: [flacSong], source: "flac" }],
    favorites: [flacSong]
  });
  const canonicalSong = before.playlists[0].songs[0];
  const expectedIdentity = stableLegacySharedId("shared_song", `flac\u0000${name}\u0000${artist}`);
  const resolved = { ...canonicalSong, id: "flac_resolved_after_reload" };

  assert.equal(canonicalSong.sharedId, expectedIdentity);
  assert.equal(sharedSongIdentity(canonicalSong), expectedIdentity);
  assert.equal(sharedSongIdentity(resolved), expectedIdentity);
  assert.ok(expectedIdentity.length <= 512);

  const removed = deriveSharedTombstones(before, {
    ...before,
    playlists: before.playlists.map((playlist) => ({ ...playlist, songs: [] })),
    favorites: []
  });
  assert.deepEqual(removed.favorites, [expectedIdentity]);
  assert.deepEqual(removed.playlistSongs, { flac: [expectedIdentity] });

  const visible = applySharedTombstones({ ...before, tombstones: removed });
  assert.equal(visible.playlists[0].songs.length, 0);
  assert.equal(visible.favorites.length, 0);
});

test("intentional re-add clears stale remote tombstones until the write succeeds", () => {
  const previous = {
    playlistIds: ["readded-playlist"],
    favorites: ["readded-favorite"],
    playlistSongs: { kept: ["readded-song"], "readded-playlist": ["old-song"] }
  };
  const current = { playlistIds: [], favorites: [], playlistSongs: {} };
  const clears = deriveSharedTombstoneClears(undefined, previous, current);
  const remote = {
    playlistIds: ["readded-playlist", "remote-delete"],
    favorites: ["readded-favorite", "remote-favorite-delete"],
    playlistSongs: {
      kept: ["readded-song", "remote-song-delete"],
      "readded-playlist": ["old-song"]
    }
  };

  assert.deepEqual(clears, previous);
  assert.deepEqual(applySharedTombstoneClears(remote, clears), {
    playlistIds: ["remote-delete"],
    favorites: ["remote-favorite-delete"],
    playlistSongs: { kept: ["remote-song-delete"] }
  });

  const deletedAgain = { playlistIds: [], favorites: ["readded-favorite"], playlistSongs: {} };
  const afterDeletingAgain = deriveSharedTombstoneClears(clears, current, deletedAgain);
  assert.deepEqual(afterDeletingAgain.favorites, []);
  assert.deepEqual(applySharedTombstoneClears(remote, afterDeletingAgain).favorites, ["readded-favorite", "remote-favorite-delete"]);
});
