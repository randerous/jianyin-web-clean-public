import { cover } from "../data/seed";
import type { AccountState, PlayQuality, Playlist, Song } from "../types";

const API_BASE_STORAGE_KEY = "jianyin_api_base_url";

function cleanApiBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

export function getApiBaseUrl() {
  if (typeof window !== "undefined" && ["127.0.0.1", "localhost"].includes(window.location.hostname) && window.location.port === "5188") {
    return "";
  }
  const configured = cleanApiBaseUrl(import.meta.env.VITE_API_BASE_URL || localStorage.getItem(API_BASE_STORAGE_KEY) || "");
  return configured;
}

export function setApiBaseUrl(value: string) {
  const cleaned = cleanApiBaseUrl(value);
  if (cleaned) localStorage.setItem(API_BASE_STORAGE_KEY, cleaned);
  else localStorage.removeItem(API_BASE_STORAGE_KEY);
  return cleaned;
}

export function apiUrl(path: string) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const baseUrl = getApiBaseUrl();
  return baseUrl ? `${baseUrl}${normalizedPath}` : normalizedPath;
}

type RemoteSong = {
  id?: string;
  name?: string;
  artist?: string;
  url?: string;
  pic?: string;
  cover?: string;
  source?: string;
  lrc?: string;
  verifiedPlayable?: boolean;
  durationMs?: number;
  br?: number | null;
  level?: string | null;
  audioType?: string | null;
  type?: string | null;
  quality?: string;
  time?: string | number;
  sign?: string;
  bvid?: string;
  cid?: number;
};

type RemotePlaylist = {
  id?: string;
  name?: string;
  cover?: string;
  coverPic?: string;
  picUrl?: string;
  trackCount?: number;
  creatorNickname?: string;
  songs?: RemoteSong[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalizeRemoteUrl(value: unknown) {
  const url = asString(value);
  return url.startsWith("/api/") ? apiUrl(url) : url;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(apiUrl(url));
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = isRecord(data) ? asString(data.message, asString(data.error, "请求失败")) : "请求失败";
    throw new Error(message);
  }
  return data as T;
}

export function normalizeRemoteSong(value: RemoteSong, index = 0): Song | null {
  const id = asString(value.id);
  if (!id) return null;
  const source = value.source === "bili" ? "bili" : value.source === "flac" ? "flac" : "netease";
  return {
    id: source === "bili" || source === "flac" ? id : id.startsWith("netease_") ? id : `netease_${id}`,
    name: asString(value.name, "未知歌曲"),
    artist: asString(value.artist, "未知歌手"),
    url: normalizeRemoteUrl(value.url),
    cover: asString(value.cover, asString(value.pic, cover(index + 1))),
    source,
    lrc: typeof value.lrc === "string" ? value.lrc : undefined,
    remotePlayable: true,
    verifiedPlayable: Boolean(value.verifiedPlayable) || Boolean(value.url),
    durationMs: typeof value.durationMs === "number" ? value.durationMs : undefined,
    br: typeof value.br === "number" ? value.br : null,
    level: typeof value.level === "string" ? value.level : null,
    audioType: typeof value.audioType === "string" ? value.audioType : typeof value.type === "string" ? value.type : null,
    quality: typeof value.quality === "string" ? value.quality : undefined,
    time: typeof value.time === "string" || typeof value.time === "number" ? value.time : undefined,
    sign: typeof value.sign === "string" ? value.sign : undefined,
    bvid: typeof value.bvid === "string" ? value.bvid : undefined,
    cid: typeof value.cid === "number" ? value.cid : undefined
  };
}

export async function checkProxy() {
  try {
    const result = await fetchJson<{ ok: boolean }>("/api/health");
    return Boolean(result.ok);
  } catch {
    return false;
  }
}

export async function searchNetease(keyword: string, quality: PlayQuality = "exhigh") {
  const data = await fetchJson<{ songs?: RemoteSong[] }>(`/api/netease/search?keyword=${encodeURIComponent(keyword)}&limit=60&quality=${encodeURIComponent(quality)}`);
  return (data.songs ?? []).map(normalizeRemoteSong).filter((song): song is Song => Boolean(song));
}

export async function searchBili(keyword: string) {
  const data = await fetchJson<{ songs?: RemoteSong[] }>(`/api/bili/search?keyword=${encodeURIComponent(keyword)}&limit=30`);
  return (data.songs ?? []).map(normalizeRemoteSong).filter((song): song is Song => Boolean(song));
}

export type SearchPageResult = {
  songs: Song[];
  page: number;
  pageSize: number;
  total: number | null;
  hasMore: boolean;
};

export const FLAC_SEARCH_PAGE_SIZE = 30;

export async function searchFlac(keyword: string, page = 1): Promise<SearchPageResult> {
  const data = await fetchJson<{ songs?: RemoteSong[]; page?: number; limit?: number; total?: number | string | null; hasMore?: boolean }>(`/api/flac/search?keyword=${encodeURIComponent(keyword)}&limit=${FLAC_SEARCH_PAGE_SIZE}&page=${page}`);
  const totalValue = Number(data.total);
  return {
    songs: (data.songs ?? []).map(normalizeRemoteSong).filter((song): song is Song => Boolean(song)),
    page: typeof data.page === "number" ? data.page : page,
    pageSize: typeof data.limit === "number" ? data.limit : FLAC_SEARCH_PAGE_SIZE,
    total: Number.isFinite(totalValue) && totalValue > 0 ? totalValue : null,
    hasMore: Boolean(data.hasMore)
  };
}

function flacSongId(song: Song) {
  return song.id.replace(/^flac_/, "");
}

function flacParams(song: Song) {
  const params = new URLSearchParams();
  if (song.url) {
    const url = new URL(song.url, window.location.href);
    for (const key of ["format", "bitrate", "time", "sign"]) {
      const value = url.searchParams.get(key);
      if (value) params.set(key, value);
    }
  }
  if (!params.has("format") && song.audioType) params.set("format", song.audioType);
  if (!params.has("bitrate") && typeof song.br === "number" && song.br > 0) params.set("bitrate", String(Math.round(song.br / 1000)));
  if (!params.has("time") && (typeof song.time === "string" || typeof song.time === "number")) params.set("time", String(song.time));
  if (!params.has("sign") && song.sign) params.set("sign", song.sign);
  return params;
}

async function refreshFlacSong(song: Song) {
  const id = flacSongId(song);
  const queries = Array.from(new Set([
    `${song.name} ${song.artist}`.trim(),
    song.name.trim()
  ].filter(Boolean)));
  for (const query of queries) {
    const { songs } = await searchFlac(query);
    const sameId = songs.find((item) => flacSongId(item) === id);
    if (sameId) return { ...song, ...sameId };
    const sameTitle = songs.find((item) => item.name === song.name && (!song.artist || item.artist === song.artist));
    if (sameTitle) return { ...song, ...sameTitle };
  }
  return null;
}

async function fetchResolvedFlacSong(song: Song) {
  const id = flacSongId(song);
  const params = flacParams(song);
  const suffix = params.size ? `?${params.toString()}` : "";
  const data = await fetchJson<{ url: string; durationMs?: number | null; verifiedPlayable?: boolean; br?: number | null; level?: string | null; audioType?: string | null; type?: string | null; quality?: string }>(`/api/flac/song/${encodeURIComponent(id)}${suffix}`);
  const resolvedUrl = normalizeRemoteUrl(data.url);
  const resolvedParams = new URL(data.url, window.location.href).searchParams;
  return {
    ...song,
    url: resolvedUrl,
    durationMs: typeof data.durationMs === "number" ? data.durationMs : song.durationMs,
    verifiedPlayable: Boolean(data.verifiedPlayable) || song.verifiedPlayable,
    br: typeof data.br === "number" ? data.br : song.br,
    level: typeof data.level === "string" ? data.level : song.level,
    audioType: typeof data.audioType === "string" ? data.audioType : typeof data.type === "string" ? data.type : song.audioType,
    quality: typeof data.quality === "string" ? data.quality : song.quality,
    time: resolvedParams.get("time") ?? song.time,
    sign: resolvedParams.get("sign") ?? song.sign
  };
}

export async function resolveNeteaseSong(song: Song, quality: PlayQuality = "exhigh") {
  const id = song.id.replace(/^netease_/, "");
  const data = await fetchJson<{ url: string; lrc?: string; durationMs?: number; verifiedPlayable?: boolean; br?: number | null; level?: string | null; audioType?: string | null; type?: string | null; quality?: string }>(`/api/netease/song/${encodeURIComponent(id)}?quality=${encodeURIComponent(quality)}`);
  return {
    ...song,
    url: normalizeRemoteUrl(data.url),
    lrc: data.lrc || song.lrc,
    durationMs: typeof data.durationMs === "number" ? data.durationMs : song.durationMs,
    verifiedPlayable: Boolean(data.verifiedPlayable) || song.verifiedPlayable,
    br: typeof data.br === "number" ? data.br : song.br,
    level: typeof data.level === "string" ? data.level : song.level,
    audioType: typeof data.audioType === "string" ? data.audioType : typeof data.type === "string" ? data.type : song.audioType,
    quality: typeof data.quality === "string" ? data.quality : quality
  };
}

export async function resolveBiliSong(song: Song) {
  const bvid = song.bvid || song.id.replace(/^bili_/, "").split("_")[0];
  const cid = song.cid;
  if (!bvid || !cid) throw new Error("Bili 歌曲缺少 bvid/cid");
  const data = await fetchJson<{ url: string; durationMs?: number | null; verifiedPlayable?: boolean; br?: number | null; level?: string | null; audioType?: string | null; type?: string | null; quality?: string }>(`/api/bili/song/${encodeURIComponent(bvid)}?cid=${encodeURIComponent(String(cid))}&quality=high`);
  return {
    ...song,
    url: normalizeRemoteUrl(data.url),
    durationMs: typeof data.durationMs === "number" ? data.durationMs : song.durationMs,
    verifiedPlayable: Boolean(data.verifiedPlayable) || song.verifiedPlayable,
    br: typeof data.br === "number" ? data.br : song.br,
    level: typeof data.level === "string" ? data.level : song.level,
    audioType: typeof data.audioType === "string" ? data.audioType : typeof data.type === "string" ? data.type : song.audioType,
    quality: typeof data.quality === "string" ? data.quality : song.quality
  };
}

export async function resolveFlacSong(song: Song) {
  try {
    return await fetchResolvedFlacSong(song);
  } catch (error) {
    const refreshed = await refreshFlacSong(song).catch(() => null);
    if (refreshed) return fetchResolvedFlacSong(refreshed);
    throw error;
  }
}

export function extractNeteasePlaylistId(value: string) {
  const trimmed = value.trim();
  return trimmed.match(/[?&]id=(\d+)/)?.[1] ?? trimmed.match(/^\d+$/)?.[0] ?? "";
}

export async function importNeteasePlaylist(raw: string, quality: PlayQuality = "exhigh") {
  const id = extractNeteasePlaylistId(raw);
  if (!id) throw new Error("请输入网易云歌单 ID 或分享链接");
  const data = await fetchJson<{ playlist?: RemotePlaylist }>(`/api/netease/playlist/${encodeURIComponent(id)}?quality=${encodeURIComponent(quality)}`);
  if (!data.playlist) throw new Error("没有找到这个歌单");
  return {
    id: asString(data.playlist.id),
    name: asString(data.playlist.name, "网易云歌单"),
    cover: asString(data.playlist.cover, asString(data.playlist.coverPic, data.playlist.songs?.[0]?.cover || cover(9))),
    songs: (data.playlist.songs ?? []).map((song, index) => normalizeRemoteSong(song, index)).filter((song): song is Song => Boolean(song)),
    source: "netease",
    trackCount: typeof data.playlist.trackCount === "number" ? data.playlist.trackCount : data.playlist.songs?.length ?? 0,
    creatorNickname: asString(data.playlist.creatorNickname)
  } satisfies Playlist;
}

function normalizeRemotePlaylist(playlist: RemotePlaylist, index = 0): Playlist | null {
  const id = asString(playlist.id);
  const source = id.startsWith("bili") ? "bili" : id.startsWith("netease") ? "netease" : "local";
  if (!id) return null;
  return {
    id,
    name: asString(playlist.name, source === "bili" ? "Bili 收藏夹" : "网易云歌单"),
    cover: asString(playlist.cover, asString(playlist.coverPic, playlist.songs?.[0]?.cover || cover(index + 1))),
    songs: (playlist.songs ?? []).map((song, songIndex) => normalizeRemoteSong(song, songIndex)).filter((song): song is Song => Boolean(song)),
    source,
    trackCount: typeof playlist.trackCount === "number" ? playlist.trackCount : playlist.songs?.length ?? 0,
    creatorNickname: asString(playlist.creatorNickname)
  };
}

async function postJson<T>(url: string, body?: unknown): Promise<T> {
  const response = await fetch(apiUrl(url), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {})
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = isRecord(data) ? asString(data.message, asString(data.error, "请求失败")) : "请求失败";
    throw new Error(message);
  }
  return data as T;
}

export async function loginNeteaseCookie(cookie: string) {
  return postJson<AccountState>("/api/netease/account/login", { cookie });
}

export async function logoutNeteaseCookie() {
  return postJson<AccountState>("/api/netease/account/logout");
}

export async function getNeteaseAccountStatus() {
  return fetchJson<AccountState>("/api/netease/account/status");
}

export async function syncNeteaseAccountPlaylists(quality: PlayQuality = "exhigh") {
  const data = await fetchJson<{ playlists?: RemotePlaylist[] }>(`/api/netease/account/playlists?quality=${encodeURIComponent(quality)}&limit=8`);
  return (data.playlists ?? []).map(normalizeRemotePlaylist).filter((playlist): playlist is Playlist => Boolean(playlist));
}

export async function loginBiliCookie(cookie: string) {
  return postJson<AccountState>("/api/bili/account/login", { cookie });
}

export async function logoutBiliCookie() {
  return postJson<AccountState>("/api/bili/account/logout");
}

export async function getBiliAccountStatus() {
  return fetchJson<AccountState>("/api/bili/account/status");
}

export async function syncBiliAccountPlaylists() {
  const data = await fetchJson<{ playlists?: RemotePlaylist[] }>("/api/bili/account/playlists?limit=8");
  return (data.playlists ?? []).map(normalizeRemotePlaylist).filter((playlist): playlist is Playlist => Boolean(playlist));
}

export async function fetchNeteaseHome(quality: PlayQuality = "exhigh") {
  const data = await fetchJson<{
    radarSongs?: RemoteSong[];
    hotSongs?: RemoteSong[];
    recommendedPlaylists?: RemotePlaylist[];
  }>(`/api/netease/home?quality=${encodeURIComponent(quality)}`);
  return {
    radarSongs: (data.radarSongs ?? []).map(normalizeRemoteSong).filter((song): song is Song => Boolean(song)),
    hotSongs: (data.hotSongs ?? []).map(normalizeRemoteSong).filter((song): song is Song => Boolean(song)),
    recommendedPlaylists: (data.recommendedPlaylists ?? []).map((playlist, index) => ({
      id: `netease_playlist_${asString(playlist.id)}`,
      name: asString(playlist.name, "推荐歌单"),
      cover: asString(playlist.cover, asString(playlist.coverPic, asString(playlist.picUrl, cover(index + 1)))),
      songs: [],
      source: "netease",
      trackCount: typeof playlist.trackCount === "number" ? playlist.trackCount : 0,
      creatorNickname: asString(playlist.creatorNickname)
    } satisfies Playlist)).filter((playlist) => playlist.id !== "netease_playlist_")
  };
}
