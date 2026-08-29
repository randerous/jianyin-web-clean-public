import express from "express";
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const require = createRequire(import.meta.url);
const defaultNetease = require("NeteaseCloudMusicApi");

const __dirname = dirname(fileURLToPath(import.meta.url));
const execFileAsync = promisify(execFile);
const UPDATE_REPOSITORY = "randerous/jianyin-web-clean-public";
const UPDATE_API_URL = `https://api.github.com/repos/${UPDATE_REPOSITORY}/releases/latest`;
const UPDATE_CACHE_TTL_MS = 5 * 60 * 1000;
const UPDATE_RESTART_EXIT_CODE = 75;
function isPackagedLauncher() {
  return process.env.JIANYIN_PACKAGED_LAUNCHER === "1";
}
const APP_VERSION = (() => {
  try {
    const packageJson = JSON.parse(readFileSync(resolve(__dirname, "package.json"), "utf8"));
    return typeof packageJson.version === "string" ? packageJson.version : "0.0.0";
  } catch {
    return "0.0.0";
  }
})();
const args = process.argv.slice(2);
const isDev = args.includes("--dev");
const portArgIndex = args.indexOf("--port");
const port = portArgIndex >= 0 ? Number(args[portArgIndex + 1]) || 5188 : Number(process.env.PORT) || 5188;
const sharedStatePath = process.env.JIANYIN_STATE_PATH
  ? resolve(process.env.JIANYIN_STATE_PATH)
  : resolve(__dirname, ".jianyin-shared-state.json");
const sharedStateLockTails = new Map();

export async function createApp({ neteaseClient = defaultNetease, fetchImpl = globalThis.fetch, dev = false, hmrPort = port + 10000, statePath = sharedStatePath } = {}) {
const app = express();
const netease = neteaseClient;
const updateRoot = resolve(process.env.JIANYIN_UPDATE_ROOT || __dirname);
statePath = resolve(statePath);
app.use("/api/state", express.json({ limit: "4mb" }));
app.use(express.json({ limit: "512kb" }));
	const MIN_FULL_SONG_MS = 60_000;
	const SEARCH_CANDIDATE_LIMIT = 180;
	const SEARCH_VERIFY_BATCH_SIZE = 10;
	const PLAYLIST_CANDIDATE_LIMIT = 1000;
	const PLAYLIST_INITIAL_PLAYABLE_LIMIT = 60;
	const DEFAULT_PLAY_QUALITY = "exhigh";
	const QUALITY_FALLBACK_ORDER = ["jymaster", "sky", "jyeffect", "hires", "lossless", "exhigh", "standard"];
const RESOLVED_URL_TTL_MS = 8 * 60 * 1000;
const SEARCH_CACHE_TTL_MS = 90 * 1000;
const PLAYLIST_DETAIL_CACHE_TTL_MS = 10 * 60 * 1000;
const HOT_SONGS_CACHE_TTL_MS = 10 * 60 * 1000;
const NETEASE_HOT_PLAYLIST_ID = "3778678"; // 云音乐热歌榜
const playlistTimeoutFromEnv = Number(process.env.JIANYIN_PLAYLIST_TIMEOUT_MS);
const PLAYLIST_UPSTREAM_TIMEOUT_MS = Number.isFinite(playlistTimeoutFromEnv) && playlistTimeoutFromEnv > 0
  ? Math.min(Math.trunc(playlistTimeoutFromEnv), 10_000)
  : 3_500;
const NETEASE_REFERER = "https://music.163.com/";
const NETEASE_USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36";
const BILI_REFERER = "https://www.bilibili.com";
const BILI_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const BILI_NAV_URL = "https://api.bilibili.com/x/web-interface/nav";
const BILI_PLAY_URL = "https://api.bilibili.com/x/player/wbi/playurl";
const BILI_SEARCH_URL = "https://api.bilibili.com/x/web-interface/wbi/search/type";
const BILI_VIEW_URL = "https://api.bilibili.com/x/web-interface/view";
const BILI_FAV_FOLDER_URL = "https://api.bilibili.com/x/v3/fav/folder/created/list-all";
const BILI_FAV_INFO_URL = "https://api.bilibili.com/x/v3/fav/folder/info";
const BILI_FAV_RESOURCE_URL = "https://api.bilibili.com/x/v3/fav/resource/list";
const BILI_UPSTREAM_TIMEOUT_MS = 8_000;
const BILI_PAGE_EXPAND_LIMIT = 12;
const FLAC_BASE_URL = "https://flac.music.hi.cn";
const FLAC_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
	const resolvedUrlCache = new Map();
	const searchCache = new Map();
	const flacSearchCache = new Map();
	const flacSearchInFlight = new Map();
	const playlistDetailCache = new Map();
	const playlistDetailInFlight = new Map();
	const hotSongsCache = new Map();
	const hotSongsInFlight = new Map();
	const radarSongsCache = new Map();
	const radarSongsInFlight = new Map();
	const biliStreamCache = new Map();
	const flacStreamCache = new Map();
	let latestUpdateCache = null;
	let latestUpdateInFlight = null;
	let flacCookie = "";
	let flacCookieAt = 0;
	let neteaseAccountCookie = "";
	let biliAccountCookie = "";
	let cachedBiliWbi = null;
	let cachedBiliWbiAt = 0;

	const BILI_MIXIN_INDEX = [
	  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35,
	  27, 43, 5, 49, 33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13,
	  37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
	  22, 25, 54, 21, 56, 62, 6, 63, 57, 20, 34, 52, 59, 11, 36, 44
	];

function cleanText(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

// 网易云图片接口返回 http:// 链接，但域名本身支持 https；
// Android WebView 以 https 加载页面且禁用混合内容，http 图会被整体拦截。
function httpsPicUrl(value) {
  const url = cleanText(value);
  return /^http:\/\/[^/]*music\.126\.net\//i.test(url) ? `https://${url.slice("http://".length)}` : url;
}

function stripHtml(value) {
  return cleanText(value).replace(/<[^>]+>/g, "").replace(/&amp;/g, "&");
}

function redactSensitiveText(value) {
  return cleanText(value)
    .replace(/(?:MUSIC_U|SESSDATA|bili_jct|csrf|token|credential)=?[^;\s&'",}]*/gi, "[redacted]")
    .replace(/(?:MUSIC_U|SESSDATA|bili_jct|csrf|token|credential)/gi, "[redacted]");
}

function errorMessage(error) {
  if (error?.body?.message) return redactSensitiveText(error.body.message);
  if (error?.body?.msg) return redactSensitiveText(error.body.msg);
  return redactSensitiveText(error instanceof Error ? error.message : String(error));
}

function reportSharedStateFailure(res, statePath, operation, error) {
  const diagnosticMessage = errorMessage(error)
    .replaceAll(statePath, "<shared-state-file>")
    .replaceAll(dirname(statePath), "<shared-state-directory>");
  console.error(`[shared-state] ${operation} failed`, {
    name: error instanceof Error ? error.name : typeof error,
    code: typeof error?.code === "string" ? error.code : "",
    syscall: typeof error?.syscall === "string" ? error.syscall : "",
    message: diagnosticMessage
  });
  const messages = {
    read: "共享歌单读取失败，请稍后重试",
    write: "共享歌单保存失败，请稍后重试",
    delete: "共享歌单删除失败，请稍后重试"
  };
  res.status(500).json({
    error: `state_${operation}_failed`,
    message: messages[operation] ?? "共享状态操作失败，请稍后重试"
  });
}

function releaseVersion(value) {
  const match = String(value ?? "").trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersions(left, right) {
  const a = releaseVersion(left) ?? [0, 0, 0];
  const b = releaseVersion(right) ?? [0, 0, 0];
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

function safeGithubDownloadUrl(value) {
  try {
    const url = new URL(String(value ?? ""));
    if (url.protocol !== "https:") return "";
    if (!["github.com", "objects.githubusercontent.com", "release-assets.githubusercontent.com"].includes(url.hostname)) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function mapUpdateAsset(asset) {
  const name = cleanText(asset?.name);
  const url = safeGithubDownloadUrl(asset?.browser_download_url);
  if (!name || !url) return null;
  const digest = cleanText(asset?.digest).replace(/^sha256:/i, "").toLowerCase();
  return {
    name,
    url,
    sha256: /^[0-9a-f]{64}$/.test(digest) ? digest : "",
    size: Number.isFinite(Number(asset?.size)) ? Number(asset.size) : null
  };
}

function pipeUpstreamBody(upstream, res, errorCode = "upstream_stream_failed") {
  const stream = Readable.fromWeb(upstream.body);
  stream.on("error", (error) => {
    if (!res.headersSent) {
      res.status(502).json({ error: errorCode, message: errorMessage(error) });
      return;
    }
    res.end();
  });
  stream.pipe(res);
}

function upstreamJsonError(url, response, text) {
  const sample = redactSensitiveText(text).slice(0, 120).replace(/\s+/g, " ");
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return String(url);
    }
  })();
  const isBili = host.includes("bilibili.com");
  const message = isBili
    ? `Bili 接口不可用或被风控: upstream status ${response.status}`
    : `upstream json unavailable from ${host}: status ${response.status}`;
  return new Error(sample ? `${message} ${sample}` : message);
}

function sharedCover(value) {
  const cover = boundedSharedString(value, 2_048);
  return /^(blob:|data:|local-file:)/i.test(cover) ? "" : cover;
}

const MAX_SHARED_PLAYLISTS = 1_000;
const MAX_SHARED_SONGS = 5_000;
const MAX_SHARED_TOMBSTONES = 10_000;
const MAX_SHARED_ID_LENGTH = 512;

function boundedSharedString(value, maxLength = 512) {
  if (typeof value !== "string") return "";
  const bounded = value.trim().slice(0, maxLength);
  return /(MUSIC_U=|SESSDATA=|bili_jct=)/i.test(bounded) ? "" : bounded;
}

function finiteSharedNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stableLegacySharedId(prefix, value) {
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

function stableFlacSharedId(name, artist) {
  const identity = `flac\u0000${typeof name === "string" ? name.trim() : ""}\u0000${typeof artist === "string" ? artist.trim() : ""}`;
  return identity.length > MAX_SHARED_ID_LENGTH ? stableLegacySharedId("shared_song", identity) : identity;
}

function canonicalFlacSharedIdentity(value) {
  if (!value.startsWith("flac\u0000")) return value;
  const artistSeparator = value.indexOf("\u0000", 5);
  if (artistSeparator < 0) return value;
  return stableFlacSharedId(value.slice(5, artistSeparator), value.slice(artistSeparator + 1));
}

function boundedSharedIds(value, prefix, ids, limit = MAX_SHARED_TOMBSTONES) {
  if (!Array.isArray(value)) return [];
  const strings = [];
  const seen = new Set();
  let inspected = 0;
  for (const item of value) {
    if (inspected >= limit) break;
    inspected += 1;
    const string = opaqueSharedId(item, prefix, ids);
    if (!string || seen.has(string)) continue;
    seen.add(string);
    strings.push(string);
    if (strings.length >= limit) break;
  }
  return strings;
}

function opaqueSharedId(value, prefix, ids) {
  if (typeof value !== "string") return "";
  const rawId = value;
  const trimmedId = rawId.trim();
  if (!trimmedId) return "";
  const id = rawId.startsWith("local_")
    ? rawId
    : prefix === "shared_song" ? canonicalFlacSharedIdentity(trimmedId) : trimmedId;
  if (!id.startsWith("local_") && id.length <= MAX_SHARED_ID_LENGTH) return boundedSharedString(id);
  if (!ids.has(id)) {
    ids.set(id, stableLegacySharedId(prefix, id));
  }
  return ids.get(id);
}

function sanitizeSharedSong(value, ids) {
  if (!value || typeof value !== "object") return null;
  const legacyLocal = typeof value.id === "string" && value.id.startsWith("local_");
  const source = legacyLocal ? "local" : ["local", "netease", "bili", "flac"].includes(value.source) ? value.source : "local";
  const id = source === "local" ? opaqueSharedId(value.id, "shared_song", ids.songIds) : boundedSharedString(value.id);
  if (!id) return null;
  const durationMs = finiteSharedNumber(value.durationMs);
  const cid = finiteSharedNumber(value.cid);
  const name = boundedSharedString(value.name) || "未知歌曲";
  const artist = boundedSharedString(value.artist) || "未知歌手";
  const identityName = typeof value.name === "string" ? value.name : "未知歌曲";
  const identityArtist = typeof value.artist === "string" ? value.artist : "未知歌手";
  const explicitSharedId = source === "flac" ? opaqueSharedId(value.sharedId, "shared_song", ids.songIds) : "";
  const sharedId = source === "flac" ? explicitSharedId || stableFlacSharedId(identityName, identityArtist) : "";
  return {
    id,
    ...(sharedId ? { sharedId } : {}),
    name,
    artist,
    url: "",
    cover: sharedCover(value.cover),
    source,
    remotePlayable: source !== "local",
    verifiedPlayable: false,
    ...(Number.isFinite(durationMs) && durationMs >= 0 ? { durationMs } : {}),
    ...(source === "bili" && boundedSharedString(value.bvid) ? { bvid: boundedSharedString(value.bvid) } : {}),
    ...(source === "bili" && Number.isFinite(cid) ? { cid } : {}),
    ...(source === "local" ? { needsImport: true } : {})
  };
}

function sanitizeSharedPlaylist(value, ids) {
  if (!value || typeof value !== "object") return null;
  const legacyLocal = typeof value.id === "string" && value.id.startsWith("local_");
  const source = legacyLocal ? "local" : ["local", "netease", "bili", "flac"].includes(value.source) ? value.source : "local";
  const id = source === "local" && value.id !== "favorites" ? opaqueSharedId(value.id, "shared_playlist", ids.playlistIds) : boundedSharedString(value.id);
  const name = boundedSharedString(value.name);
  if (!id || !name) return null;
  const trackCount = finiteSharedNumber(value.trackCount);
  return {
    id,
    name,
    cover: sharedCover(value.cover),
    songs: Array.isArray(value.songs) ? value.songs.slice(0, MAX_SHARED_SONGS).map((song) => sanitizeSharedSong(song, ids)).filter(Boolean) : [],
    source,
    ...(Number.isFinite(trackCount) && trackCount >= 0 ? { trackCount } : {}),
    ...(boundedSharedString(value.creatorNickname) ? { creatorNickname: boundedSharedString(value.creatorNickname) } : {})
  };
}

function sanitizeSharedTombstones(value, ids) {
  const tombstones = value && typeof value === "object" ? value : {};
  const playlistSongs = {};
  if (tombstones.playlistSongs && typeof tombstones.playlistSongs === "object" && !Array.isArray(tombstones.playlistSongs)) {
    let count = 0;
    let inspected = 0;
    for (const playlistIdValue in tombstones.playlistSongs) {
      if (!Object.hasOwn(tombstones.playlistSongs, playlistIdValue)) continue;
      if (inspected >= MAX_SHARED_PLAYLISTS) break;
      inspected += 1;
      const songIdsValue = tombstones.playlistSongs[playlistIdValue];
      const playlistId = opaqueSharedId(playlistIdValue, "shared_playlist", ids.playlistIds);
      const songIds = boundedSharedIds(songIdsValue, "shared_song", ids.songIds);
      if (!playlistId || ["__proto__", "constructor", "prototype"].includes(playlistId) || songIds.length === 0) continue;
      if (!Object.hasOwn(playlistSongs, playlistId)) {
        if (count >= MAX_SHARED_PLAYLISTS) continue;
        playlistSongs[playlistId] = [];
        count += 1;
      }
      playlistSongs[playlistId] = Array.from(new Set([...playlistSongs[playlistId], ...songIds])).slice(0, MAX_SHARED_TOMBSTONES);
    }
  }
  return {
    playlistIds: boundedSharedIds(tombstones.playlistIds, "shared_playlist", ids.playlistIds),
    favorites: boundedSharedIds(tombstones.favorites, "shared_song", ids.songIds),
    playlistSongs
  };
}

function sanitizeSharedState(value) {
  const state = value && typeof value === "object" ? value : {};
  const ids = { playlistIds: new Map(), songIds: new Map() };
  const updatedAt = finiteSharedNumber(state.updatedAt);
  const revision = Number.isSafeInteger(state.revision) && state.revision >= 0 ? state.revision : 0;
  const lastWriteId = boundedSharedString(state.lastWriteId, 256);
  return {
    schemaVersion: 2,
    revision,
    playlists: Array.isArray(state.playlists) ? state.playlists.slice(0, MAX_SHARED_PLAYLISTS).map((playlist) => sanitizeSharedPlaylist(playlist, ids)).filter(Boolean) : [],
    favorites: Array.isArray(state.favorites) ? state.favorites.slice(0, MAX_SHARED_SONGS).map((song) => sanitizeSharedSong(song, ids)).filter(Boolean) : [],
    tombstones: sanitizeSharedTombstones(state.tombstones, ids),
    ...(Number.isFinite(updatedAt) && updatedAt > 0 ? { updatedAt } : {}),
    ...(lastWriteId ? { lastWriteId } : {})
  };
}

function emptySharedState() {
  return sanitizeSharedState({});
}

function withSharedStateLock(operation) {
  const previous = sharedStateLockTails.get(statePath) ?? Promise.resolve();
  const result = previous.then(operation);
  const tail = result.catch(() => {});
  sharedStateLockTails.set(statePath, tail);
  void tail.finally(() => {
    if (sharedStateLockTails.get(statePath) === tail) sharedStateLockTails.delete(statePath);
  });
  return result;
}

function sharedStateBackupPath() {
  const timestamp = new Date().toISOString().replaceAll(":", "").replaceAll("-", "");
  return `${statePath}.bak-${timestamp}`;
}

async function createSharedStateBackup(source) {
  const basePath = sharedStateBackupPath();
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    const backupPath = attempt === 0 ? basePath : `${basePath}-${attempt}`;
    try {
      await writeFile(backupPath, source, { mode: 0o600, flag: "wx" });
      await chmod(backupPath, 0o600);
      return backupPath;
    } catch (error) {
      if (error?.code === "EEXIST") continue;
      await rm(backupPath, { force: true }).catch(() => {});
      throw error;
    }
  }
  throw new Error("unable to create a fresh shared state backup");
}

async function writeSharedStateAtomically(state) {
  await mkdir(dirname(statePath), { recursive: true });
  const temporaryPath = `${statePath}.tmp-${process.pid}-${randomUUID()}`;
  try {
    await writeFile(temporaryPath, JSON.stringify(state, null, 2), { mode: 0o600, flag: "wx" });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, statePath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

async function readSharedStateUnlocked({ migrate = true } = {}) {
  let source;
  try {
    source = await readFile(statePath);
  } catch (error) {
    if (error?.code === "ENOENT") return { state: emptySharedState(), migrationError: null };
    throw error;
  }

  const raw = JSON.parse(source.toString("utf8"));
  const isVersionTwo = raw?.schemaVersion === 2;
  const canonical = {
    ...sanitizeSharedState({
      playlists: raw?.playlists,
      favorites: raw?.favorites,
      tombstones: raw?.tombstones,
      updatedAt: raw?.updatedAt,
      revision: isVersionTwo ? raw?.revision : 0,
      lastWriteId: isVersionTwo ? raw?.lastWriteId : undefined
    }),
    savedAt: boundedSharedString(raw?.savedAt) || new Date().toISOString()
  };
  const canonicalJson = JSON.stringify(canonical, null, 2);
  const alreadyCanonical = isVersionTwo && source.toString("utf8") === canonicalJson;
  let migrationError = null;
  if (migrate && !alreadyCanonical) {
    try {
      await createSharedStateBackup(source);
      await writeSharedStateAtomically(canonical);
    } catch (error) {
      migrationError = error;
    }
  }
  return { state: canonical, migrationError };
}

function readSharedState() {
  return withSharedStateLock(async () => {
    const snapshot = await readSharedStateUnlocked();
    if (snapshot.migrationError) throw snapshot.migrationError;
    return snapshot.state;
  });
}

function writeSharedState(state, baseRevision, writeId) {
  return withSharedStateLock(async () => {
    const snapshot = await readSharedStateUnlocked();
    const existing = snapshot.state;
    const rawWriteId = typeof writeId === "string" ? writeId : "";
    const normalizedWriteId = rawWriteId.trim();
    const validWriteId = rawWriteId.length <= 256 && normalizedWriteId.length > 0;
    if (validWriteId && normalizedWriteId === existing.lastWriteId) {
      return { written: true, state: existing, idempotent: true };
    }
    if (!Number.isSafeInteger(baseRevision) || baseRevision < 0 || baseRevision !== existing.revision) {
      return { written: false, conflict: true, state: existing };
    }
    if (!validWriteId) return { written: false, conflict: false, state: existing };
    if (snapshot.migrationError) throw snapshot.migrationError;
    if (existing.revision >= Number.MAX_SAFE_INTEGER) throw new Error("shared state revision exhausted");
    const persisted = {
      ...sanitizeSharedState(state),
      revision: existing.revision + 1,
      lastWriteId: normalizedWriteId,
      savedAt: new Date().toISOString()
    };
    await writeSharedStateAtomically(persisted);
    return { written: true, conflict: false, state: persisted, idempotent: false };
  });
}

	function parseLimit(value, fallback, max) {
	  const parsed = Number(value);
	  if (!Number.isFinite(parsed)) return fallback;
	  return Math.min(Math.max(1, Math.trunc(parsed)), max);
	}

	function parsePage(value) {
	  const parsed = Number(value);
	  if (!Number.isFinite(parsed)) return 1;
	  return Math.max(1, Math.trunc(parsed));
	}

	function parseOffset(value, fallback = 0, max = 300) {
	  const parsed = Number(value);
	  if (!Number.isFinite(parsed)) return fallback;
	  return Math.min(Math.max(0, Math.trunc(parsed)), max);
	}

	function normalizeQuality(value) {
	  const quality = cleanText(value, DEFAULT_PLAY_QUALITY).toLowerCase();
	  return quality || DEFAULT_PLAY_QUALITY;
	}

	function buildQualityCandidates(preferredQuality) {
	  const normalized = normalizeQuality(preferredQuality);
	  const index = QUALITY_FALLBACK_ORDER.indexOf(normalized);
	  if (index >= 0) return QUALITY_FALLBACK_ORDER.slice(index);
	  return Array.from(new Set([normalized, DEFAULT_PLAY_QUALITY, "standard"]));
	}

	function parseCookieInput(value) {
	  if (!value) return "";
	  if (typeof value === "string") {
	    const trimmed = value.trim();
	    if (!trimmed) return "";
	    if (trimmed.startsWith("{")) {
	      try {
	        const parsed = JSON.parse(trimmed);
	        return Object.entries(parsed.cookies ?? parsed)
	          .filter(([, cookieValue]) => typeof cookieValue === "string" && cookieValue)
	          .map(([key, cookieValue]) => `${key}=${cookieValue}`)
	          .join("; ");
	      } catch {
	        return trimmed;
	      }
	    }
	    return trimmed;
	  }
	  if (typeof value === "object") {
	    return Object.entries(value.cookies ?? value)
	      .filter(([, cookieValue]) => typeof cookieValue === "string" && cookieValue)
	      .map(([key, cookieValue]) => `${key}=${cookieValue}`)
	      .join("; ");
	  }
	  return "";
	}

	function cookieHash(cookie) {
	  return cookie ? createHash("sha256").update(cookie).digest("hex").slice(0, 12) : "anon";
	}

	function setNeteaseCookie(cookie) {
	  neteaseAccountCookie = cleanText(cookie);
	  resolvedUrlCache.clear();
	  searchCache.clear();
	  flacSearchCache.clear();
	  flacSearchInFlight.clear();
	  hotSongsCache.clear();
	  radarSongsCache.clear();
	}

	function setBiliCookie(cookie) {
	  biliAccountCookie = cleanText(cookie);
	  cachedBiliWbi = null;
	  biliStreamCache.clear();
	}

	function apiHeaders(cookie = "") {
	  const headers = {
	    "User-Agent": BILI_USER_AGENT,
	    Referer: BILI_REFERER
	  };
	  if (cookie) headers.Cookie = cookie;
	  return headers;
	}

	function neteaseHeaders(cookie = "") {
	  const headers = {
	    "User-Agent": NETEASE_USER_AGENT,
	    Referer: NETEASE_REFERER,
	    Accept: "application/json,text/plain,*/*"
	  };
	  if (cookie) headers.Cookie = cookie;
	  return headers;
	}

	async function fetchJsonUrl(url, headers = {}) {
	  const response = await fetchImpl(url, { headers, redirect: "follow" });
	  const text = await response.text();
	  let body = {};
	  try {
	    body = text ? JSON.parse(text) : {};
	  } catch {
	    throw upstreamJsonError(url, response, text);
	  }
	  if (!response.ok) throw new Error(body.message || `upstream status ${response.status}`);
	  return body;
	}

	function md5(value) {
	  return createHash("md5").update(value).digest("hex");
	}

	function getBiliMixinKey(value) {
	  return BILI_MIXIN_INDEX.map((index) => value[index]).join("").slice(0, 32);
	}

	function cleanBiliSignValue(value) {
	  return String(value).replace(/[!'()*]/g, "");
	}

	function cookieHeaderFromValues(values) {
	  const cookies = new Map();
	  for (const value of values.filter(Boolean)) {
	    const regex = /(?:^|[,;]\s*)(sl-session|sl_jwt_session|sl_jwt_sign|sl-challenge-jwt)=([^;,]*)/g;
	    let match;
	    while ((match = regex.exec(String(value)))) cookies.set(match[1], match[2]);
	  }
	  return Array.from(cookies.entries()).map(([key, value]) => `${key}=${value}`).join("; ");
	}

	function cookieHeaderFromResponse(response) {
	  if (typeof response.headers.getSetCookie === "function") {
	    return cookieHeaderFromValues(response.headers.getSetCookie());
	  }
	  return cookieHeaderFromValues([response.headers.get("set-cookie")]);
	}

	function looksLikeFlacChallenge(text, contentType = "") {
	  const body = cleanText(text).slice(0, 2000);
	  return contentType.includes("text/html")
	    || body.includes("anticc_redirect")
	    || body.includes("SafeLineChallenge")
	    || body.includes("window.location=")
	    || /^<!doctype html/i.test(body)
	    || /^<html/i.test(body);
	}

	function getSafelineRedirect(html) {
	  const script = cleanText(html).match(/<script[^>]*>([\s\S]*?)<\/script>/i)?.[1] ?? "";
	  if (!script.includes("window.location=")) return "";
	  const parts = [];
	  const regex = /cbk_var\s*=\s*['"]([^'"]+)['"]\s*\+\s*cbk_var/g;
	  let match;
	  while ((match = regex.exec(script))) parts.unshift(match[1]);
	  const init = script.match(/cbk_var\s*=\s*['"]([^'"]+)['"]\s*;/)?.[1];
	  if (init) parts.unshift(init);
	  return parts.join("");
	}

	function calculateSafelineResult(input) {
	  let value = 1;
	  const sum = input.reduce((total, item) => total + item, 0);
	  let cycles = (6 + input.length + sum) % 6 + 6;
	  while (cycles > 0) {
	    value *= 6;
	    cycles -= 1;
	  }
	  if (value < 6666) value *= input.length;
	  if (value > 0x3f940aa) value = Math.floor(value / input.length);
	  for (let index = 0; index < input.length; index += 1) {
	    value += Math.pow(input[index], 3);
	    value ^= index;
	    value ^= input[index] + index;
	  }
	  const result = [];
	  while (value > 0) {
	    result.unshift(value & 63);
	    value >>= 6;
	  }
	  return result;
	}

	function flacHeaders(cookie = flacCookie) {
	  const headers = {
	    "User-Agent": FLAC_USER_AGENT,
	    Referer: `${FLAC_BASE_URL}/`,
	    Origin: FLAC_BASE_URL,
	    "X-Requested-With": "XMLHttpRequest"
	  };
	  if (cookie) headers.Cookie = cookie;
	  return headers;
	}

	async function refreshFlacCookie() {
	  const initial = await fetchImpl(`${FLAC_BASE_URL}/`, { headers: { "User-Agent": FLAC_USER_AGENT }, redirect: "follow" });
	  let body = await initial.text();
	  let cookie = cookieHeaderFromResponse(initial);
	  const redirect = getSafelineRedirect(body);
	  if (redirect) {
	    const redirected = await fetchImpl(`${FLAC_BASE_URL}${redirect}`, { headers: { "User-Agent": FLAC_USER_AGENT, Referer: `${FLAC_BASE_URL}/` }, redirect: "follow" });
	    body = await redirected.text();
	    cookie = cookieHeaderFromResponse(redirected) || cookie;
	  }
	  const slSession = cleanText(cookie.match(/sl-session=([^;]+)/)?.[1]);
	  const key = cleanText(body.match(/SafeLineChallenge\("([^"]+)"/)?.[1]);
	  if (!slSession || !key) {
	    flacCookie = cookie;
	    flacCookieAt = Date.now();
	    return flacCookie;
	  }
	  const issueResponse = await fetchImpl("https://challenge.rivers.chaitin.cn/challenge/v2/api/issue", {
	    method: "POST",
	    headers: { "Content-Type": "application/json", Origin: FLAC_BASE_URL, Referer: `${FLAC_BASE_URL}/` },
	    body: JSON.stringify({ client_id: key, level: 1 })
	  });
	  const issue = await issueResponse.json();
	  const verifyResponse = await fetchImpl("https://challenge.rivers.chaitin.cn/challenge/v2/api/verify", {
	    method: "POST",
	    headers: { "Content-Type": "application/json", Origin: FLAC_BASE_URL, Referer: `${FLAC_BASE_URL}/`, "User-Agent": FLAC_USER_AGENT },
	    body: JSON.stringify({
	      issue_id: issue.data?.issue_id,
	      result: calculateSafelineResult(issue.data?.data ?? []),
	      serials: [],
	      client: {
	        userAgent: FLAC_USER_AGENT,
	        platform: "Win32",
	        language: "zh-CN",
	        vendor: "Google Inc.",
	        screen: [1920, 1080],
	        visitorId: "99999999999999999999999999999999",
	        score: 0,
	        target: []
	      }
	    })
	  });
	  const verify = await verifyResponse.json();
	  const jwt = cleanText(verify.data?.jwt);
	  const final = await fetchImpl(`${FLAC_BASE_URL}/`, {
	    headers: {
	      "User-Agent": FLAC_USER_AGENT,
	      Referer: `${FLAC_BASE_URL}/`,
	      Cookie: `sl-session=${slSession}; sl-challenge-server=cloud; sl-challenge-jwt=${jwt}`
	    },
	    redirect: "follow"
	  });
	  const finalCookie = cookieHeaderFromResponse(final);
	  flacCookie = `sl-session=${slSession}; sl-challenge-server=cloud; ${finalCookie}`.trim();
	  flacCookieAt = Date.now();
	  return flacCookie;
	}

	async function getFlacCookie() {
	  if (flacCookie && Date.now() - flacCookieAt < 55 * 60 * 1000) return flacCookie;
	  return refreshFlacCookie();
	}

	async function postFlacApi(action, params, allowRetry = true) {
	  const cookie = await getFlacCookie();
	  const response = await fetchImpl(`${FLAC_BASE_URL}/ajax.php?act=${encodeURIComponent(action)}`, {
	    method: "POST",
	    headers: {
	      ...flacHeaders(cookie),
	      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
	      Accept: "application/json, text/javascript, */*; q=0.01"
	    },
	    body: new URLSearchParams(params)
	  });
	  const text = await response.text();
	  const contentType = cleanText(response.headers.get("content-type")).toLowerCase();
	  if ((response.status === 468 || looksLikeFlacChallenge(text, contentType)) && allowRetry) {
	    flacCookie = "";
	    await refreshFlacCookie();
	    return postFlacApi(action, params, false);
	  }
	  let body = {};
	  try {
	    body = JSON.parse(text);
	  } catch {
	    const sample = redactSensitiveText(text).slice(0, 120).replace(/\s+/g, " ");
	    const safeSample = /<html|<!doctype|SafeLineChallenge|anticc_redirect/i.test(sample) ? "" : sample;
	    throw new Error(`测试源接口不可用: upstream status ${response.status}${contentType ? ` ${contentType}` : ""}${safeSample ? ` ${safeSample}` : ""}`);
	  }
	  if (!response.ok) throw new Error(body.message || body.msg || `upstream status ${response.status}`);
	  if (body.code !== 0) throw new Error(body.msg || body.message || `flac ${action} failed`);
	  return body;
	}

	function chooseFlacQuality(item) {
	  const formats = Array.isArray(item?.minfo) ? item.minfo : [];
	  const score = (format) => {
	    const kind = cleanText(format?.format).toLowerCase();
	    const bitrate = Number(format?.bitrate ?? 0) || 0;
	    if (kind === "flac") return 1_000_000 + bitrate;
	    if (kind && kind !== "mp3") return 500_000 + bitrate;
	    return bitrate;
	  };
	  return [...formats].sort((a, b) => score(b) - score(a))[0]
	    ?? formats[0]
	    ?? { format: "mp3", bitrate: "320", level: "p" };
	}

	function mapFlacSong(item) {
	  const id = cleanText(item?.id);
	  const durationMs = Number(item?.duration ?? 0) * 1000;
	  if (!id || durationMs <= MIN_FULL_SONG_MS) return null;
	  const quality = chooseFlacQuality(item);
	  const format = cleanText(quality.format, "mp3").toLowerCase();
	  const bitrate = Number(quality.bitrate ?? 0) || (format === "flac" ? 2000 : 320);
	  return {
	    id: `flac_${id}`,
	    name: cleanText(item?.name, "未知歌曲"),
	    artist: cleanText(item?.artist, "未知歌手"),
	    url: `/api/flac/stream/${encodeURIComponent(id)}?format=${encodeURIComponent(format)}&bitrate=${encodeURIComponent(String(bitrate))}&time=${encodeURIComponent(String(item?.time ?? ""))}&sign=${encodeURIComponent(cleanText(item?.sign))}`,
	    pic: cleanText(item?.pic_url, ""),
	    cover: cleanText(item?.pic_url, ""),
	    source: "flac",
	    remotePlayable: true,
	    verifiedPlayable: true,
	    durationMs,
	    br: bitrate * 1000,
	    level: format === "flac" ? "flac" : `${bitrate}k`,
	    audioType: format,
	    type: format,
	    quality: format === "flac" ? "flac" : `${bitrate}k`,
	    time: item?.time,
	    sign: cleanText(item?.sign)
	  };
	}

	async function searchFlacSongs(keyword, page, limit) {
	  const normalizedKeyword = cleanText(keyword).toLowerCase();
	  const cacheKey = `${normalizedKeyword}:${page}:${limit}`;
	  const cached = flacSearchCache.get(cacheKey);
	  if (cached && cached.expiresAt > Date.now()) return { ...cached.data, cached: true };
	  const pending = flacSearchInFlight.get(cacheKey);
	  if (pending) return { ...await pending, cached: true };
	  const request = searchFlacSongsUncached(keyword, page, limit).then((data) => {
	    flacSearchCache.set(cacheKey, { data, expiresAt: Date.now() + SEARCH_CACHE_TTL_MS });
	    return data;
	  }).finally(() => {
	    flacSearchInFlight.delete(cacheKey);
	  });
	  flacSearchInFlight.set(cacheKey, request);
	  return { ...await request, cached: false };
	}

	async function searchFlacSongsUncached(keyword, page, limit) {
	  const upstreamSize = 20;
	  const targetStart = (page - 1) * limit;
	  const targetEnd = page * limit;
	  const songs = [];
	  const seen = new Set();
	  let playableSeen = 0;
	  let rawCount = 0;
	  let total = 0;
	  let upstreamPage = 1;
	  let reachedEnd = false;

	  while (playableSeen < targetEnd) {
	    const body = await postFlacApi("search", { keyword, page: String(upstreamPage), size: String(upstreamSize) });
	    const raw = Array.isArray(body.data?.list) ? body.data.list : [];
	    rawCount += raw.length;
	    total = Number(body.data?.total ?? total) || total;

	    for (const item of raw) {
	      const mapped = mapFlacSong(item);
	      if (!mapped || seen.has(mapped.id)) continue;
	      seen.add(mapped.id);
	      if (playableSeen >= targetStart && songs.length < limit) songs.push(mapped);
	      playableSeen += 1;
	      if (playableSeen >= targetEnd) break;
	    }

	    if (!raw.length || (total && upstreamPage * upstreamSize >= total)) {
	      reachedEnd = true;
	      break;
	    }
	    upstreamPage += 1;
	  }

	  const hasMore = songs.length >= limit && !reachedEnd;
	  return { songs, rawCount, total, hasMore };
	}

	function prewarmFlacSearchForSongs(songs, limit = 4) {
	  for (const song of songs.slice(0, limit)) {
	    if (song?.source !== "flac") continue;
	    const keyword = `${cleanText(song.name)} ${cleanText(song.artist)}`.trim();
	    if (!keyword) continue;
	    void searchFlacSongs(keyword, 1, 5).catch(() => null);
	  }
	}

	function flacCacheKey(id, format, bitrate, time, sign) {
	  return `${cleanText(id).replace(/^flac_/, "")}:${cleanText(format, "flac").toLowerCase()}:${cleanText(bitrate, cleanText(format).toLowerCase() === "flac" ? "2000" : "320")}:${cleanText(time)}:${cleanText(sign)}`;
	}

	function flacFallbackQuality(format, bitrate) {
	  const cleanFormat = cleanText(format, "flac").toLowerCase();
	  const cleanBitrate = cleanText(bitrate, cleanFormat === "flac" ? "2000" : "320");
	  if (cleanFormat === "mp3" && cleanBitrate === "320") return null;
	  return { format: "mp3", bitrate: "320" };
	}

	async function resolveFlacUrl(id, format, bitrate, time, sign, options = {}) {
	  const cleanId = cleanText(id).replace(/^flac_/, "");
	  const cleanFormat = cleanText(format, "flac").toLowerCase();
	  const cleanBitrate = cleanText(bitrate, cleanFormat === "flac" ? "2000" : "320");
	  const cleanTime = cleanText(time);
	  const cleanSign = cleanText(sign);
	  const cacheKey = flacCacheKey(cleanId, cleanFormat, cleanBitrate, cleanTime, cleanSign);
	  const cached = flacStreamCache.get(cacheKey);
	  if (!options.forceRefresh && cached && cached.expiresAt > Date.now()) return cached.data;
	  const body = await postFlacApi("getUrl", {
	    songid: cleanId,
	    format: cleanFormat,
	    bitrate: cleanBitrate,
	    time: cleanTime,
	    sign: cleanSign
	  });
	  const data = body.data ?? {};
	  const url = cleanText(data.url);
	  const durationMs = Number(data.duration ?? 0) * 1000;
	  if (!url || durationMs <= MIN_FULL_SONG_MS) throw new Error("测试源没有返回完整可播放地址");
	  const resolvedFormat = cleanText(data.format, cleanFormat).toLowerCase();
	  const resolvedBitrate = String(Number(data.bitrate ?? cleanBitrate) || cleanBitrate);
	  const resolved = {
	    url,
	    durationMs,
	    br: Number(resolvedBitrate) * 1000,
	    level: resolvedFormat === "flac" ? "flac" : `${resolvedBitrate}k`,
	    audioType: resolvedFormat,
	    type: resolvedFormat,
	    quality: resolvedFormat === "flac" ? "flac" : `${resolvedBitrate}k`,
	    format: resolvedFormat,
	    bitrate: resolvedBitrate
	  };
	  flacStreamCache.set(cacheKey, { data: resolved, expiresAt: Date.now() + RESOLVED_URL_TTL_MS });
	  return resolved;
	}

	async function resolveFlacUrlWithFallback(id, format, bitrate, time, sign, options = {}) {
	  try {
	    return await resolveFlacUrl(id, format, bitrate, time, sign, options);
	  } catch (error) {
	    const fallback = flacFallbackQuality(format, bitrate);
	    if (!fallback) throw error;
	    try {
	      const data = await resolveFlacUrl(id, fallback.format, fallback.bitrate, time, sign, { ...options, forceRefresh: true });
	      return { ...data, fallbackFrom: { format: cleanText(format, "flac").toLowerCase(), bitrate: cleanText(bitrate) } };
	    } catch {
	      throw error;
	    }
	  }
	}

	async function fetchFlacAudio(data, range) {
	  return fetchImpl(data.url, {
	    headers: {
	      "User-Agent": FLAC_USER_AGENT,
	      Referer: FLAC_BASE_URL,
	      Accept: "audio/*,*/*;q=0.8",
	      ...(range ? { Range: range } : {})
	    },
	    redirect: "follow"
	  });
	}

	async function resolveFlacStreamWithFallback(id, format, bitrate, time, sign, range) {
	  const attempts = [
	    { format, bitrate, forceRefresh: false },
	    { format, bitrate, forceRefresh: true },
	    flacFallbackQuality(format, bitrate)
	      ? { ...flacFallbackQuality(format, bitrate), forceRefresh: true, fallback: true }
	      : null
	  ].filter(Boolean);
	  let lastError = null;
	  for (const attempt of attempts) {
	    try {
	      const data = await resolveFlacUrl(id, attempt.format, attempt.bitrate, time, sign, { forceRefresh: attempt.forceRefresh });
	      const upstream = await fetchFlacAudio(data, range);
	      if (upstream.ok || upstream.status === 206) {
	        return { data: attempt.fallback ? { ...data, fallbackFrom: { format, bitrate } } : data, upstream };
	      }
	      flacStreamCache.delete(flacCacheKey(id, attempt.format, attempt.bitrate, time, sign));
	      lastError = new Error(`upstream status ${upstream.status}`);
	    } catch (error) {
	      lastError = error;
	    }
	  }
	  throw lastError ?? new Error("test source audio upstream failed");
	}

	async function getBiliWbiKeys() {
	  if (cachedBiliWbi && Date.now() - cachedBiliWbiAt < 10 * 60 * 1000) return cachedBiliWbi;
	  const body = await fetchJsonUrl(BILI_NAV_URL, apiHeaders(biliAccountCookie));
	  const image = body.data?.wbi_img ?? {};
	  const imgKey = cleanText(image.img_url).split("/").pop()?.split(".")[0] ?? "";
	  const subKey = cleanText(image.sub_url).split("/").pop()?.split(".")[0] ?? "";
	  if (!imgKey || !subKey) throw new Error("Bili WBI key unavailable");
	  cachedBiliWbi = { imgKey, subKey };
	  cachedBiliWbiAt = Date.now();
	  return cachedBiliWbi;
	}

	async function buildBiliWbiUrl(baseUrl, params) {
	  const { imgKey, subKey } = await getBiliWbiKeys();
	  const mixinKey = getBiliMixinKey(imgKey + subKey);
	  const signed = {
	    ...params,
	    wts: Math.floor(Date.now() / 1000)
	  };
	  const sorted = Object.keys(signed).sort();
	  const query = sorted.map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(cleanBiliSignValue(signed[key]))}`).join("&");
	  const wRid = md5(query + mixinKey);
	  return `${baseUrl}?${query}&w_rid=${wRid}`;
	}

	function parseBiliDuration(value) {
	  if (typeof value === "number" && Number.isFinite(value)) return value * 1000;
	  const text = cleanText(value);
	  if (!text) return 0;
	  const parts = text.split(":").map((part) => Number(part));
	  if (parts.some((part) => !Number.isFinite(part))) return 0;
	  return parts.reduce((total, part) => total * 60 + part, 0) * 1000;
	}

	function biliPartTitle(part) {
	  const text = stripHtml(part).trim();
	  const withoutIndex = text.replace(/^\d{1,4}\s*[.、\-—_]\s*/, "").trim();
	  return withoutIndex || text;
	}

	function mapBiliSong({ bvid, cid, name, artist, pic, durationMs, verifiedPlayable = false }) {
	  return {
	    id: `bili_${bvid}_${cid}`,
	    name: stripHtml(name) || "Bilibili 视频",
	    artist: stripHtml(artist) || "Bilibili",
	    url: `/api/bili/stream/${encodeURIComponent(bvid)}?cid=${encodeURIComponent(String(cid))}&quality=high`,
	    pic: cleanText(pic).replace(/^\/\//, "https://"),
	    source: "bili",
	    remotePlayable: true,
	    verifiedPlayable,
	    durationMs,
	    bvid,
	    cid,
	    br: null,
	    level: "high",
	    audioType: "dash",
	    quality: "high"
	  };
	}

	function mapBiliSearchItem(item, info = null) {
	  const bvid = cleanText(item?.bvid ?? info?.bvid);
	  const cid = Number(item?.cid ?? info?.cid ?? 0);
	  const numericDuration = Number(item?.durationMs);
	  const durationMs = Number.isFinite(numericDuration) && numericDuration > 0
	    ? numericDuration
	    : parseBiliDuration(item?.duration);
	  const pic = cleanText(item?.pic ?? info?.pic);
	  const artist = item?.owner?.name ?? item?.author ?? item?.owner ?? info?.owner;
	  if (!bvid || !cid || durationMs <= MIN_FULL_SONG_MS) return null;
	  const pages = Array.isArray(info?.pages)
	    ? info.pages.filter((page) => Number(page?.cid ?? 0) > 0)
	    : [];
	  if (pages.length > 1) {
	    const songs = [];
	    for (const [pageIndex, page] of pages.entries()) {
	      if (songs.length >= BILI_PAGE_EXPAND_LIMIT) break;
	      const pageCid = Number(page.cid);
	      const pageDurationMs = Number(page.durationMs ?? 0);
	      if (!pageCid || !Number.isFinite(pageDurationMs) || pageDurationMs <= MIN_FULL_SONG_MS) continue;
	      const pageName = biliPartTitle(page.part);
	      songs.push(mapBiliSong({
	        bvid,
	        cid: pageCid,
	        name: pageName || `${stripHtml(info?.title) || stripHtml(item?.title) || "Bilibili 视频"} · P${pageIndex + 1}`,
	        artist,
	        pic,
	        durationMs: pageDurationMs,
	        verifiedPlayable: false
	      }));
	    }
	    if (songs.length) return songs;
	  }
	  return mapBiliSong({
	    bvid,
	    cid,
	    name: info?.title ?? item?.title,
	    artist,
	    pic,
	    durationMs,
	    verifiedPlayable: false
	  });
	}

	function selectBiliStream(streams, preferred = "high") {
	  const sorted = streams
	    .filter((stream) => cleanText(stream.url || stream.baseUrl || stream.base_url))
	    .sort((a, b) => Number(b.bitrate ?? 0) - Number(a.bitrate ?? 0));
	  if (!sorted.length) return null;
	  if (preferred === "low") return sorted[sorted.length - 1];
	  if (preferred === "medium") return sorted[1] ?? sorted[0];
	  return sorted[0];
	}

	async function getBiliVideoInfo(bvid) {
	  const url = new URL(BILI_VIEW_URL);
	  url.searchParams.set("bvid", bvid);
	  const body = await withTimeout(
	    fetchJsonUrl(url.toString(), apiHeaders(biliAccountCookie)),
	    BILI_UPSTREAM_TIMEOUT_MS,
	    "bili view"
	  );
	  if (body.code !== 0) throw new Error(body.message || "Bili video unavailable");
	  const pages = (body.data?.pages ?? []).map((page) => ({
	    cid: Number(page?.cid ?? 0),
	    part: cleanText(page?.part),
	    durationMs: Number(page?.duration ?? 0) * 1000
	  })).filter((page) => page.cid > 0);
	  return {
	    bvid: cleanText(body.data?.bvid, bvid),
	    cid: Number(body.data?.cid ?? pages[0]?.cid ?? 0),
	    title: cleanText(body.data?.title, "Bilibili 视频"),
	    pic: cleanText(body.data?.pic),
	    owner: cleanText(body.data?.owner?.name, "Bilibili"),
	    durationMs: Number(body.data?.duration ?? 0) * 1000,
	    pages
	  };
	}

	async function resolveBiliStream(bvid, cid, preferred = "high") {
	  const cacheKey = `${cookieHash(biliAccountCookie)}:${bvid}:${cid}:${preferred}`;
	  const cached = biliStreamCache.get(cacheKey);
	  if (cached && cached.expiresAt > Date.now()) return cached.data;
	  const url = await buildBiliWbiUrl(BILI_PLAY_URL, {
	    bvid,
	    cid,
	    fnval: String(1 << 4 | 1 << 8),
	    fnver: "0",
	    fourk: "0",
	    platform: "pc"
	  });
	  const body = await withTimeout(
	    fetchJsonUrl(url, apiHeaders(biliAccountCookie)),
	    BILI_UPSTREAM_TIMEOUT_MS,
	    "bili playurl"
	  );
	  if (body.code !== 0) throw new Error(body.message || "Bili audio unavailable");
	  const stream = selectBiliStream(body.data?.dash?.audio ?? [], preferred);
	  const streamUrl = cleanText(stream?.baseUrl || stream?.base_url || stream?.url);
	  if (!streamUrl) throw new Error("Bili audio stream unavailable");
	  const data = {
	    url: streamUrl,
	    backupUrls: (stream?.backupUrl ?? stream?.backup_url ?? []).filter(Boolean),
	    br: Number(stream?.bandwidth ?? stream?.bitrate ?? 0) || null,
	    codec: cleanText(stream?.codecs, "dash"),
	    qualityId: Number(stream?.id ?? 0) || null
	  };
	  biliStreamCache.set(cacheKey, { data, expiresAt: Date.now() + RESOLVED_URL_TTL_MS });
	  return data;
	}

function mapSong(song) {
  const artists = song.ar ?? song.artists ?? [];
  const album = song.al ?? song.album ?? {};
  return {
    id: `netease_${String(song.id ?? "")}`,
    name: cleanText(song.name, "未知歌曲"),
    artist: artists.map((artist) => artist.name).filter(Boolean).join("/") || "未知歌手",
    url: "",
    pic: httpsPicUrl(album.picUrl),
    source: "netease",
    remotePlayable: true
  };
}

function normalizeMatchText(value) {
  return cleanText(value).toLowerCase().replace(/\s+/g, "");
}

function songArtistText(song) {
  const artists = song?.ar ?? song?.artists ?? [];
  return artists.map((artist) => cleanText(artist?.name)).filter(Boolean).join("/");
}

function lyricCall() {
  return typeof netease.lyric_new === "function" ? netease.lyric_new.bind(netease) : netease.lyric.bind(netease);
}

async function fetchNeteaseLyric(id) {
  try {
    const result = await lyricCall()({ id, cookie: neteaseAccountCookie });
    const lyric = parseLyricBody(result.body);
    if (lyric) return lyric;
  } catch {
    // Fall through to the direct web endpoint; the library call can fail when its upstream proxy resets.
  }
  return fetchNeteaseLyricDirect(id);
}

async function fetchNeteaseLyricDirect(id) {
  const url = new URL("https://music.163.com/api/song/lyric");
  url.searchParams.set("id", String(id));
  url.searchParams.set("lv", "1");
  url.searchParams.set("kv", "1");
  url.searchParams.set("tv", "-1");
  const body = await fetchJsonUrl(url.toString(), neteaseHeaders(neteaseAccountCookie));
  return parseLyricBody(body);
}

async function searchNeteaseSongsDirect(keyword, limit = 12) {
  const url = new URL("https://music.163.com/api/search/get/web");
  url.searchParams.set("s", keyword);
  url.searchParams.set("type", "1");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", "0");
  const body = await fetchJsonUrl(url.toString(), neteaseHeaders(neteaseAccountCookie));
  return body?.result?.songs ?? [];
}

async function findLyricCandidate(keyword, artist) {
  let songs = [];
  try {
    songs = await searchSongs(keyword, 12);
  } catch {
    songs = await searchNeteaseSongsDirect(keyword, 12);
  }
  if (!songs.length) songs = await searchNeteaseSongsDirect(keyword, 12);
  const wantedArtist = normalizeMatchText(artist);
  const wantedTitle = normalizeMatchText(keyword.replace(artist, ""));
  return songs.find((song) => {
    const title = normalizeMatchText(song?.name);
    const artists = normalizeMatchText(songArtistText(song));
    const titleMatches = wantedTitle ? title.includes(wantedTitle) || wantedTitle.includes(title) : true;
    const artistMatches = wantedArtist ? artists.includes(wantedArtist) || wantedArtist.includes(artists) : true;
    return titleMatches && artistMatches;
  }) ?? songs[0] ?? null;
}

function isFullPlayableUrlData(data) {
  const url = cleanText(data?.url);
  const time = Number(data?.time ?? 0);
  return Boolean(url) && !data?.freeTrialInfo && time > MIN_FULL_SONG_MS;
}

function playableRejectReason(data) {
  if (!cleanText(data?.url)) return "no_url";
  if (data?.freeTrialInfo) return "trial_fragment";
  if (Number(data?.time ?? 0) <= MIN_FULL_SONG_MS) return "too_short";
  return "";
}

	async function requestSongUrl(ids, quality, cookie = neteaseAccountCookie) {
	  if (typeof netease.song_url_v1 === "function") {
	    return netease.song_url_v1({ id: ids, level: quality, cookie });
	  }
	  return netease.song_url({ id: ids, br: quality === "standard" ? 128000 : 999000, cookie });
	}

	async function resolveSongUrl(id, preferredQuality = DEFAULT_PLAY_QUALITY, cookie = neteaseAccountCookie) {
	  const quality = normalizeQuality(preferredQuality);
	  const cacheKey = `${cookieHash(cookie)}:${quality}:${id}`;
	  const cached = resolvedUrlCache.get(cacheKey);
	  if (cached && cached.expiresAt > Date.now()) return cached.data;
	  let lastData = {};
	  for (const candidate of buildQualityCandidates(quality)) {
	    const result = await requestSongUrl(id, candidate, cookie);
	    const data = result.body?.data?.[0] ?? {};
	    if (data && Object.keys(data).length) lastData = data;
	    if (isFullPlayableUrlData(data)) {
	      resolvedUrlCache.set(cacheKey, { data, expiresAt: Date.now() + RESOLVED_URL_TTL_MS });
	      return data;
	    }
	  }
	  return lastData;
	}

	function streamPath(id, preferredQuality) {
	  return `/api/netease/stream/${encodeURIComponent(id)}?quality=${encodeURIComponent(normalizeQuality(preferredQuality))}`;
	}

	function mapVerifiedSong(song, data, preferredQuality = DEFAULT_PLAY_QUALITY) {
	  const mapped = mapSong(song);
	  if (mapped.id === "netease_") return null;
	  const id = mapped.id.replace(/^netease_/, "");
	  if (!isFullPlayableUrlData(data)) return null;
	  return {
	    ...mapped,
	    url: streamPath(id, preferredQuality),
	    durationMs: Number(data.time ?? 0),
	    br: data.br ?? null,
	    level: data.level ?? null,
	    audioType: data.type ?? null,
	    type: data.type ?? null,
	    quality: normalizeQuality(preferredQuality),
	    verifiedPlayable: true,
	    remotePlayable: true
	  };
	}

	async function resolveSongUrls(ids, preferredQuality = DEFAULT_PLAY_QUALITY, cookie = neteaseAccountCookie) {
	  const quality = normalizeQuality(preferredQuality);
	  const authKey = cookieHash(cookie);
	  const resolved = new Map();
	  const unresolved = new Set(ids);
	  const lastSeen = new Map();
	  for (const id of ids) {
	    const cached = resolvedUrlCache.get(`${authKey}:${quality}:${id}`);
	    if (cached && cached.expiresAt > Date.now()) {
	      resolved.set(id, cached.data);
	      unresolved.delete(id);
	    }
	  }
	  for (const candidate of buildQualityCandidates(quality)) {
	    const batch = Array.from(unresolved);
	    if (!batch.length) break;
	    const result = await requestSongUrl(batch.join(","), candidate, cookie);
	    for (const data of result.body?.data ?? []) {
	      const id = String(data?.id ?? "");
	      if (!id || !unresolved.has(id)) continue;
	      lastSeen.set(id, data);
	      if (isFullPlayableUrlData(data)) {
	        resolvedUrlCache.set(`${authKey}:${quality}:${id}`, { data, expiresAt: Date.now() + RESOLVED_URL_TTL_MS });
	        resolved.set(id, data);
	        unresolved.delete(id);
	      }
	    }
	  }
	  for (const id of unresolved) {
	    if (lastSeen.has(id)) resolved.set(id, lastSeen.get(id));
	  }
	  return resolved;
	}

	async function mapVerifiedSongs(songs, desiredLimit, preferredQuality = DEFAULT_PLAY_QUALITY, cookie = neteaseAccountCookie) {
	  const candidates = songs.filter(Boolean);
	  const ids = candidates.map((song) => String(song.id ?? "")).filter((id) => /^\d+$/.test(id));
	  if (!ids.length) return [];
	  const verified = [];
	  for (let offset = 0; offset < candidates.length && verified.length < desiredLimit; offset += SEARCH_VERIFY_BATCH_SIZE) {
	    const chunk = candidates.slice(offset, offset + SEARCH_VERIFY_BATCH_SIZE);
	    const chunkIds = chunk.map((song) => String(song.id ?? "")).filter((id) => /^\d+$/.test(id));
	    const cached = await resolveSongUrls(chunkIds, preferredQuality, cookie);
	    for (const song of chunk) {
	      if (verified.length >= desiredLimit) break;
	      const id = String(song.id ?? "");
	      const mapped = mapVerifiedSong(song, cached.get(id), preferredQuality);
	      if (mapped) verified.push(mapped);
	    }
	  }
	  return verified;
	}

	async function mapPlaylistSongsToFlac(tracks, desiredLimit = PLAYLIST_CANDIDATE_LIMIT) {
	  return tracks.filter(Boolean).slice(0, desiredLimit).map((track, index) => {
	    const id = cleanText(track?.id, `playlist_${index + 1}`);
	    const album = track?.al ?? track?.album ?? {};
	    return {
	      id: `flac_search_${id}`,
	      name: cleanText(track?.name, "未知歌曲"),
	      artist: songArtistText(track) || "未知歌手",
	      url: "",
	      pic: httpsPicUrl(album.picUrl),
	      cover: httpsPicUrl(album.picUrl),
	      source: "flac",
	      remotePlayable: true,
	      verifiedPlayable: false
	    };
	  });
	}

	async function searchSongs(keyword, limit) {
	  if (typeof netease.cloudsearch === "function") {
	    const response = await netease.cloudsearch({ keywords: keyword, limit, cookie: neteaseAccountCookie });
	    return response.body?.result?.songs ?? [];
	  }
	  const response = await netease.search({ keywords: keyword, limit, cookie: neteaseAccountCookie });
	  return response.body?.result?.songs ?? [];
	}

	async function expandPlaylistTracks(playlist, desiredLimit = PLAYLIST_CANDIDATE_LIMIT) {
	  const limit = Math.min(Math.max(1, Number(desiredLimit) || PLAYLIST_INITIAL_PLAYABLE_LIMIT), PLAYLIST_CANDIDATE_LIMIT);
	  const tracks = playlist.tracks ?? [];
	  const trackMap = new Map(tracks.map((track) => [String(track.id ?? ""), track]).filter(([id]) => /^\d+$/.test(id)));
	  const orderedIds = (playlist.trackIds ?? []).map((item) => String(item?.id ?? "")).filter((id) => /^\d+$/.test(id));
	  const ids = orderedIds.length ? orderedIds : tracks.map((track) => String(track.id ?? "")).filter((id) => /^\d+$/.test(id));
	  const wantedIds = ids.slice(0, limit);
	  return wantedIds.map((id) => trackMap.get(id) ?? { id }).filter(Boolean);
	}

	function playlistTrackCount(playlist, songs) {
	  return Number(playlist.trackCount ?? playlist.trackIds?.length ?? songs.length) || songs.length;
	}

	async function mapVerifiedPlaylist(playlist, preferredQuality = DEFAULT_PLAY_QUALITY, cookie = neteaseAccountCookie, desiredLimit = PLAYLIST_INITIAL_PLAYABLE_LIMIT) {
	  const limit = Math.min(Math.max(1, Number(desiredLimit) || PLAYLIST_INITIAL_PLAYABLE_LIMIT), PLAYLIST_CANDIDATE_LIMIT);
	  const tracks = await expandPlaylistTracks(playlist, limit);
	  const songs = await mapPlaylistSongsToFlac(tracks, limit);
	  return {
	    id: `netease_playlist_${String(playlist.id ?? "")}`,
	    name: cleanText(playlist.name, "网易云公开歌单"),
	    coverPic: httpsPicUrl(playlist.coverImgUrl) || httpsPicUrl(songs[0]?.pic),
    songs,
    trackCount: playlistTrackCount(playlist, songs),
    source: "netease"
	  };
	}

	async function mapPlayableNeteasePlaylist(playlist, preferredQuality = DEFAULT_PLAY_QUALITY, cookie = neteaseAccountCookie, desiredLimit = PLAYLIST_INITIAL_PLAYABLE_LIMIT) {
	  const limit = Math.min(Math.max(1, Number(desiredLimit) || PLAYLIST_INITIAL_PLAYABLE_LIMIT), PLAYLIST_CANDIDATE_LIMIT);
	  const tracks = await expandPlaylistTracks(playlist, limit);
	  const songs = await mapVerifiedSongs(tracks, limit, preferredQuality, cookie);
	  return {
	    id: `netease_playlist_${String(playlist.id ?? "")}`,
	    name: cleanText(playlist.name, "网易云公开歌单"),
	    coverPic: httpsPicUrl(playlist.coverImgUrl) || httpsPicUrl(songs[0]?.pic),
	    songs,
	    trackCount: playlistTrackCount(playlist, songs),
	    creatorNickname: cleanText(playlist.creator?.nickname, ""),
	    source: "netease"
	  };
	}

	function mapNeteaseUserPlaylistSummary(playlist) {
	  return {
	    id: `netease_playlist_${String(playlist.id ?? "")}`,
	    name: cleanText(playlist.name, "网易云歌单"),
	    cover: httpsPicUrl(playlist.coverImgUrl) || httpsPicUrl(playlist.picUrl),
	    coverPic: httpsPicUrl(playlist.coverImgUrl) || httpsPicUrl(playlist.picUrl),
	    trackCount: Number(playlist.trackCount ?? 0) || 0,
	    creatorNickname: cleanText(playlist.creator?.nickname, "")
	  };
	}

	function mapPlaylistSummary(playlist) {
	  return {
	    id: String(playlist?.id ?? ""),
	    name: cleanText(playlist?.name, "推荐歌单"),
	    cover: httpsPicUrl(playlist?.picUrl) || httpsPicUrl(playlist?.coverImgUrl),
	    trackCount: Number(playlist?.trackCount ?? playlist?.songCount ?? 0) || 0,
	    creatorNickname: cleanText(playlist?.creator?.nickname, "")
	  };
	}

	async function getRecommendedPlaylists(limit, offset = 0) {
	  if (offset > 0 && typeof netease.top_playlist === "function") {
	    const response = await netease.top_playlist({ limit, offset, order: "hot" });
	    return (response.body?.playlists ?? []).map(mapPlaylistSummary).filter((playlist) => playlist.id);
	  }
	  if (typeof netease.personalized === "function") {
	    const response = await netease.personalized({ limit });
	    return (response.body?.result ?? []).map(mapPlaylistSummary).filter((playlist) => playlist.id);
	  }
	  if (typeof netease.top_playlist === "function") {
	    const response = await netease.top_playlist({ limit, offset, order: "hot" });
	    return (response.body?.playlists ?? []).map(mapPlaylistSummary).filter((playlist) => playlist.id);
	  }
	  return [];
	}

	async function getHotTracks(cookie = neteaseAccountCookie, limit = 10) {
	  const safeLimit = Math.min(Math.max(1, Number(limit) || 10), 30);
	  const playlist = await getPlaylistDetailWithFallback(NETEASE_HOT_PLAYLIST_ID, cookie, Math.min(safeLimit * 2, PLAYLIST_CANDIDATE_LIMIT));
	  return Array.isArray(playlist?.tracks) ? playlist.tracks : [];
	}

	async function getHotSongs(limit, preferredQuality = DEFAULT_PLAY_QUALITY, cookie = neteaseAccountCookie) {
	  const safeLimit = Math.min(Math.max(1, Number(limit) || 10), 30);
	  const cacheKey = `${cookieHash(cookie)}:${safeLimit}:${normalizeQuality(preferredQuality)}`;
	  const cached = hotSongsCache.get(cacheKey);
	  if (cached && cached.expiresAt > Date.now()) return cached.songs;
	  const pending = hotSongsInFlight.get(cacheKey);
	  if (pending) return pending;
	  const request = (async () => {
	    const tracks = await getHotTracks(cookie, safeLimit);
	    let songs = [];
	    if (tracks.length) {
	      const verified = await mapVerifiedSongs(tracks, safeLimit, preferredQuality, cookie);
	      songs = verified.length ? verified : tracks.slice(0, safeLimit).map(mapSong);
	    }
	    hotSongsCache.set(cacheKey, { songs, expiresAt: Date.now() + HOT_SONGS_CACHE_TTL_MS });
	    return songs;
	  })().finally(() => {
	    hotSongsInFlight.delete(cacheKey);
	  });
	  hotSongsInFlight.set(cacheKey, request);
	  return request;
	}

	async function getRecommendedSongs(limit, preferredQuality = DEFAULT_PLAY_QUALITY, cookie = neteaseAccountCookie) {
	  const safeLimit = Math.min(Math.max(1, Number(limit) || 10), 30);
	  const cacheKey = `radar:${cookieHash(cookie)}:${safeLimit}:${normalizeQuality(preferredQuality)}`;
	  const cached = radarSongsCache.get(cacheKey);
	  if (cached && cached.expiresAt > Date.now()) return cached.songs;
	  const pending = radarSongsInFlight.get(cacheKey);
	  if (pending) return pending;
	  const request = (async () => {
	    let songs = [];
	    // 每日推荐需要登录；未登录或失败时回退「新歌速递」。
	    // 任何失败都返回空列表而不是 reject，避免拖垮整个首页接口。
	    try {
	      if (cookie && typeof netease.recommend_songs === "function") {
	        const response = await netease.recommend_songs({ limit: safeLimit, cookie });
	        songs = response.body?.data?.dailySongs ?? [];
	      }
	    } catch (error) {
	      console.log("recommend_songs failed:", errorMessage(error));
	    }
	    if (!songs.length && typeof netease.personalized_newsong === "function") {
	      try {
	        const response = await netease.personalized_newsong({ limit: safeLimit });
	        songs = (response.body?.result ?? []).map((item) => item.song).filter(Boolean);
	      } catch (error) {
	        console.log("personalized_newsong failed:", errorMessage(error));
	      }
	    }
	    if (songs.length) {
	      try {
	        const verified = await mapVerifiedSongs(songs, safeLimit, preferredQuality, cookie);
	        songs = verified.length ? verified : songs.slice(0, safeLimit).map(mapSong);
	      } catch (error) {
	        console.log("mapVerifiedSongs(radar) failed:", errorMessage(error));
	        songs = songs.slice(0, safeLimit).map(mapSong);
	      }
	    }
	    radarSongsCache.set(cacheKey, { songs, expiresAt: Date.now() + HOT_SONGS_CACHE_TTL_MS });
	    return songs;
	  })().finally(() => {
	    radarSongsInFlight.delete(cacheKey);
	  });
	  radarSongsInFlight.set(cacheKey, request);
	  return request;
	}

	async function retryNetease(requester, attempts = 3) {
	  let lastError;
	  for (let attempt = 0; attempt < attempts; attempt += 1) {
	    try {
	      return await requester();
	    } catch (error) {
	      lastError = error;
	      if (attempt < attempts - 1) await new Promise((resolve) => setTimeout(resolve, 350 * (attempt + 1)));
	    }
	  }
	  throw lastError;
	}

	function withTimeout(promise, ms, label) {
	  let timer;
	  const timeout = new Promise((_resolve, reject) => {
	    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
	  });
	  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
	}

	function playlistFromTracks(id, tracks) {
	  return {
	    id,
	    name: "网易云推荐歌单",
	    coverImgUrl: httpsPicUrl(tracks?.[0]?.al?.picUrl),
	    tracks: Array.isArray(tracks) ? tracks : [],
	    trackIds: Array.isArray(tracks) ? tracks.map((track) => ({ id: track?.id })).filter((item) => /^\d+$/.test(String(item.id ?? ""))) : []
	  };
	}

	async function getPlaylistTracksFallback(id, cookie = neteaseAccountCookie, trackLimit = PLAYLIST_INITIAL_PLAYABLE_LIMIT) {
	  if (typeof netease.playlist_track_all !== "function") return null;
	  const limit = Math.min(Math.max(1, Number(trackLimit) || PLAYLIST_INITIAL_PLAYABLE_LIMIT), PLAYLIST_CANDIDATE_LIMIT);
	  const tracks = await withTimeout(
	    retryNetease(() => netease.playlist_track_all({ id, limit, offset: 0, cookie }), 1),
	    PLAYLIST_UPSTREAM_TIMEOUT_MS,
	    "netease playlist_track_all"
	  );
	  const songs = tracks.body?.songs ?? [];
	  if (!Array.isArray(songs) || !songs.length) return null;
	  return playlistFromTracks(id, songs);
	}

	async function getPlaylistDetailWithFallback(id, cookie = neteaseAccountCookie, trackLimit = PLAYLIST_INITIAL_PLAYABLE_LIMIT) {
	  const limit = Math.min(Math.max(1, Number(trackLimit) || PLAYLIST_INITIAL_PLAYABLE_LIMIT), PLAYLIST_CANDIDATE_LIMIT);
	  const cacheKey = `${cookieHash(cookie)}:${id}:${limit}`;
	  const cached = playlistDetailCache.get(cacheKey);
	  if (cached && cached.expiresAt > Date.now()) return cached.playlist;
	  const pending = playlistDetailInFlight.get(cacheKey);
	  if (pending) return pending;
	  const request = (async () => {
	  let playlist = null;
	  try {
	    const detail = await withTimeout(
	      retryNetease(() => netease.playlist_detail({ id, s: 0, cookie }), 1),
	      PLAYLIST_UPSTREAM_TIMEOUT_MS,
	      "netease playlist_detail"
	    );
	    playlist = detail.body?.playlist ?? null;
	  } catch (error) {
	    playlist = await getPlaylistTracksFallback(id, cookie, limit).catch(() => null);
	  }
	  if (!playlist) return null;
	  const currentTracks = Array.isArray(playlist.tracks) ? playlist.tracks : [];
	  const advertisedCount = Number(playlist.trackCount ?? playlist.trackIds?.length ?? 0) || 0;
	  const needsFullTracks = !currentTracks.length || (advertisedCount > currentTracks.length && currentTracks.length < limit);
	  if (needsFullTracks && typeof netease.playlist_track_all === "function") {
	    try {
	      const tracks = await withTimeout(
	        retryNetease(() => netease.playlist_track_all({ id, limit, offset: 0, cookie }), 1),
	        PLAYLIST_UPSTREAM_TIMEOUT_MS,
	        "netease playlist_track_all"
	      );
	      const fullTracks = Array.isArray(tracks.body?.songs) ? tracks.body.songs : [];
	      if (fullTracks.length > currentTracks.length) playlist.tracks = fullTracks;
	    } catch {
	      // Keep the endpoint available; the detail response may still contain usable tracks.
	    }
	  }
	    playlistDetailCache.set(cacheKey, { playlist, expiresAt: Date.now() + PLAYLIST_DETAIL_CACHE_TTL_MS });
	  return playlist;
	  })().finally(() => {
	    playlistDetailInFlight.delete(cacheKey);
	  });
	  playlistDetailInFlight.set(cacheKey, request);
	  return request;
	}

	function normalizeLegacyLrcTimestamps(content) {
	  return cleanText(content).replace(/\[(\d{1,2}):(\d{2}):(\d{2,3})]/g, (_match, minutes, seconds, fraction) => {
	    return `[${String(minutes).padStart(2, "0")}:${seconds}.${fraction}]`;
	  });
	}

	function formatLrcTime(ms) {
	  const totalMs = Math.max(0, Number(ms) || 0);
	  const minutes = Math.floor(totalMs / 60000);
	  const seconds = Math.floor((totalMs % 60000) / 1000);
	  const millis = Math.floor(totalMs % 1000);
	  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
	}

	function normalizeYrcLyric(content) {
	  const raw = cleanText(content);
	  if (!raw) return "";
	  const lines = raw.split(/\r?\n/).map((line) => {
	    const trimmed = line.trim();
	    if (!trimmed) return "";
	    try {
	      const parsed = JSON.parse(trimmed);
	      const text = Array.isArray(parsed?.c)
	        ? parsed.c.map((item) => cleanText(item?.tx)).join("").replace(/:\s*/g, ": ").trim()
	        : cleanText(parsed?.tx);
	      if (!text) return "";
	      return `[${formatLrcTime(parsed?.t)}]${text}`;
	    } catch {
	      return "";
	    }
	  }).filter(Boolean);
	  return lines.join("\n");
	}

	function parseLyricBody(body) {
	  const lrc = cleanText(body?.lrc?.lyric);
	  if (lrc) return normalizeLegacyLrcTimestamps(lrc);
	  return normalizeYrcLyric(body?.yrc?.lyric);
	}

	function parseBiliCookieMid(cookie) {
	  return cookie.match(/(?:^|;\s*)DedeUserID=([^;]+)/)?.[1] ?? "";
	}

	async function validateBiliCookie(cookie = biliAccountCookie) {
	  if (!cookie) return { loggedIn: false };
	  const body = await fetchJsonUrl(BILI_NAV_URL, apiHeaders(cookie));
	  const loggedIn = body.code === 0 && body.data?.isLogin === true;
	  return {
	    loggedIn,
	    nickname: cleanText(body.data?.uname, ""),
	    userId: body.data?.mid ? String(body.data.mid) : parseBiliCookieMid(cookie)
	  };
	}

	async function validateNeteaseCookie(cookie = neteaseAccountCookie) {
	  if (!cookie) return { loggedIn: false };
	  if (typeof netease.login_status === "function") {
	    const result = await netease.login_status({ cookie });
	    const profile = result.body?.data?.profile ?? result.body?.profile ?? null;
	    const account = result.body?.data?.account ?? result.body?.account ?? null;
	    if (profile?.userId || account?.id) {
	      return {
	        loggedIn: true,
	        nickname: cleanText(profile?.nickname, ""),
	        userId: String(profile?.userId ?? account?.id)
	      };
	    }
	    return { loggedIn: false };
	  }
	  if (typeof netease.user_account === "function") {
	    const result = await netease.user_account({ cookie });
	    const profile = result.body?.profile ?? null;
	    const account = result.body?.account ?? null;
	    if (profile?.userId || account?.id) {
	      return {
	        loggedIn: true,
	        nickname: cleanText(profile?.nickname, ""),
	        userId: String(profile?.userId ?? account?.id)
	      };
	    }
	  }
	  return { loggedIn: false };
	}

	async function getBiliFavItems(mediaId, pageSize = 60) {
	  const items = [];
	  let page = 1;
	  let expectedCount = 0;
	  while (true) {
	    const url = new URL(BILI_FAV_RESOURCE_URL);
	    url.searchParams.set("media_id", String(mediaId));
	    url.searchParams.set("pn", String(page));
	    url.searchParams.set("ps", String(pageSize));
	    url.searchParams.set("order", "mtime");
	    url.searchParams.set("type", "0");
	    const body = await fetchJsonUrl(url.toString(), apiHeaders(biliAccountCookie));
	    if (body.code !== 0) throw new Error(body.message || "Bili favorite folder unavailable");
	    const medias = Array.isArray(body.data?.medias) ? body.data.medias : [];
	    const reportedCount = Number(body.data?.info?.media_count ?? body.data?.media_count ?? 0);
	    if (Number.isFinite(reportedCount) && reportedCount > 0) expectedCount = Math.max(expectedCount, reportedCount);
	    items.push(...medias);
	    if (!medias.length || medias.length < pageSize || (expectedCount > 0 && items.length >= expectedCount)) return items;
	    if (page >= 200) throw new Error("Bili 收藏夹分页异常，已拒绝返回不完整结果");
	    page += 1;
	  }
	}

	function mapBiliResourceItem(item) {
	  const bvid = cleanText(item?.bvid);
	  const cid = Number(item?.cid ?? item?.page?.cid ?? item?.pages?.[0]?.cid ?? 0);
	  const durationMs = Number(item?.duration ?? 0) * 1000;
	  if (!bvid || !cid || durationMs <= MIN_FULL_SONG_MS) return null;
	  return {
	    id: `bili_${bvid}_${cid}`,
	    name: stripHtml(item?.title) || "Bilibili 视频",
	    artist: stripHtml(item?.upper?.name ?? item?.owner ?? "") || "Bilibili",
	    url: `/api/bili/stream/${encodeURIComponent(bvid)}?cid=${encodeURIComponent(String(cid))}&quality=high`,
	    pic: cleanText(item?.cover ?? item?.pic).replace(/^\/\//, "https://"),
	    cover: cleanText(item?.cover ?? item?.pic).replace(/^\/\//, "https://"),
	    source: "bili",
	    remotePlayable: true,
	    verifiedPlayable: true,
	    durationMs,
	    bvid,
	    cid,
	    br: null,
	    level: "high",
	    audioType: "dash",
	    quality: "high"
	  };
	}

async function getLatestUpdate() {
  if (latestUpdateCache && latestUpdateCache.expiresAt > Date.now()) return latestUpdateCache.data;
  if (latestUpdateInFlight) return latestUpdateInFlight;
  latestUpdateInFlight = (async () => {
    const githubHeaders = {
      Accept: "application/vnd.github+json",
      "User-Agent": "jianyin-web-clean-update-check"
    };
    const response = await fetchImpl(UPDATE_API_URL, {
      headers: githubHeaders,
      redirect: "follow"
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`GitHub 更新接口不可用：${response.status}`);
    const tag = cleanText(body?.tag_name);
    if (!releaseVersion(tag)) throw new Error("GitHub Release 版本号无效");
    const available = compareVersions(tag, APP_VERSION) > 0;
    const latestNote = {
      version: tag.replace(/^v/, ""),
      tag,
      publishedAt: typeof body?.published_at === "string" ? body.published_at : null,
      notes: typeof body?.body === "string" ? body.body.slice(0, 4000) : ""
    };
    let releaseNotes = available ? [latestNote] : [];
    if (available) {
      try {
        const releasesResponse = await fetchImpl(`https://api.github.com/repos/${UPDATE_REPOSITORY}/releases?per_page=100`, {
          headers: githubHeaders,
          redirect: "follow"
        });
        const releases = await releasesResponse.json().catch(() => []);
        if (releasesResponse.ok && Array.isArray(releases)) {
          releaseNotes = releases
            .filter((release) => !release?.draft && !release?.prerelease)
            .map((release) => {
              const releaseTag = cleanText(release?.tag_name);
              if (!releaseVersion(releaseTag) || compareVersions(releaseTag, APP_VERSION) <= 0 || compareVersions(releaseTag, tag) > 0) return null;
              return {
                version: releaseTag.replace(/^v/, ""),
                tag: releaseTag,
                publishedAt: typeof release?.published_at === "string" ? release.published_at : null,
                notes: typeof release?.body === "string" ? release.body.slice(0, 4000) : ""
              };
            })
            .filter(Boolean)
            .sort((left, right) => compareVersions(left.tag, right.tag));
          if (!releaseNotes.length) releaseNotes = [latestNote];
        }
      } catch {
        // The latest release remains usable when historical notes are unavailable.
      }
    }
    const assets = Array.isArray(body?.assets) ? body.assets.map(mapUpdateAsset).filter(Boolean) : [];
    const data = {
      currentVersion: APP_VERSION,
      latestVersion: tag.replace(/^v/, ""),
      tag,
      available,
      releaseUrl: safeGithubDownloadUrl(body?.html_url) || `https://github.com/${UPDATE_REPOSITORY}/releases/tag/${encodeURIComponent(tag)}`,
      publishedAt: typeof body?.published_at === "string" ? body.published_at : null,
      notes: latestNote.notes,
      releaseNotes,
      canApply: process.env.JIANYIN_ENABLE_UPDATE === "1" && (isPackagedLauncher() || existsSync(resolve(updateRoot, ".git"))),
      assets: {
        apk: assets.find((asset) => asset.name === "app-release.apk") ?? null,
        windowsLauncher: assets.find((asset) => asset.name === "jianyin-windows-launcher.exe") ?? null
      }
    };
    latestUpdateCache = { data, expiresAt: Date.now() + UPDATE_CACHE_TTL_MS };
    return data;
  })().finally(() => {
    latestUpdateInFlight = null;
  });
  return latestUpdateInFlight;
}

async function runGit(argumentsList) {
  const result = await execFileAsync("git", argumentsList, {
    cwd: updateRoot,
    timeout: 15_000,
    maxBuffer: 512 * 1024
  });
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, provider: "NeteaseCloudMusicApi" });
});

app.get("/api/update/latest", async (_req, res) => {
  try {
    res.json(await getLatestUpdate());
  } catch (error) {
    res.status(502).json({ error: "update_check_failed", message: errorMessage(error) });
  }
});

app.post("/api/update/apply", async (req, res) => {
  if (process.env.JIANYIN_ENABLE_UPDATE !== "1" || (!isPackagedLauncher() && !existsSync(resolve(updateRoot, ".git")))) {
    res.status(403).json({ error: "update_apply_disabled", message: "当前服务不支持自动更新" });
    return;
  }
  try {
    const latest = await getLatestUpdate();
    const requestedTag = cleanText(req.body?.tag);
    if (requestedTag && requestedTag !== latest.tag) {
      res.status(409).json({ error: "update_release_changed", message: "更新版本已变化，请重新检查" });
      return;
    }
    if (!latest.available) {
      res.json({ ok: true, updated: false, tag: latest.tag, message: "当前已是最新版本" });
      return;
    }
    if (isPackagedLauncher()) {
      if (!latest.assets.windowsLauncher?.url || !latest.assets.windowsLauncher.sha256) {
        res.status(502).json({ error: "update_asset_unavailable", message: "Windows 更新包不可用或缺少校验值" });
        return;
      }
      res.json({ ok: true, updated: true, tag: latest.tag });
      setTimeout(() => process.exit(UPDATE_RESTART_EXIT_CODE), 250);
      return;
    }
    const status = await runGit(["status", "--porcelain"]);
    if (status.trim()) {
      res.status(409).json({ error: "update_workspace_dirty", message: "工作区有未提交修改，已跳过自动更新" });
      return;
    }
    const before = (await runGit(["rev-parse", "HEAD"])).trim();
    await runGit(["pull", "--ff-only"]);
    const after = (await runGit(["rev-parse", "HEAD"])).trim();
    const updated = Boolean(before && after && before !== after);
    res.json({ ok: true, updated, tag: latest.tag });
    if (updated) setTimeout(() => process.exit(UPDATE_RESTART_EXIT_CODE), 250);
  } catch (error) {
    res.status(502).json({ error: "update_apply_failed", message: errorMessage(error) });
  }
});

app.get("/api/state", async (_req, res) => {
  try {
    res.json({ state: await readSharedState() });
  } catch (error) {
    reportSharedStateFailure(res, statePath, "read", error);
  }
});

app.post("/api/state", async (req, res) => {
  try {
    const result = await writeSharedState(
      req.body?.state ?? {},
      req.body?.baseRevision,
      req.body?.writeId
    );
    if (!result.written && result.conflict) {
      res.status(409).json({ error: "state_revision_conflict", message: "共享歌单已有更新，请重新加载后再保存", state: result.state });
      return;
    }
    if (!result.written) {
      res.status(400).json({ error: "state_write_id_invalid", message: "writeId must be a non-empty string of at most 256 characters", state: result.state });
      return;
    }
    res.json({ ok: true, state: result.state });
  } catch (error) {
    reportSharedStateFailure(res, statePath, "write", error);
  }
});

app.delete("/api/state", async (_req, res) => {
  try {
    await withSharedStateLock(() => rm(statePath, { force: true }));
    res.json({ ok: true });
  } catch (error) {
    reportSharedStateFailure(res, statePath, "delete", error);
  }
});

app.get("/api/netease/search", async (req, res) => {
  const keyword = cleanText(req.query.keyword);
  if (!keyword) {
    res.status(400).json({ error: "keyword_required", message: "keyword is required" });
    return;
  }

  try {
	    const limit = parseLimit(req.query.limit, 60, 100);
	    const quality = normalizeQuality(req.query.quality);
	    const cacheKey = `${cookieHash(neteaseAccountCookie)}:${quality}:${limit}:${keyword.toLowerCase()}`;
	    const cached = searchCache.get(cacheKey);
	    if (cached && cached.expiresAt > Date.now()) {
	      res.json({ ...cached.data, cached: true });
	      return;
	    }
	    const candidateLimit = Math.min(SEARCH_CANDIDATE_LIMIT, Math.max(limit * 3, 60));
	    const songs = await searchSongs(keyword, candidateLimit);
	    const candidates = songs.slice(0, candidateLimit);
	    const verified = await mapVerifiedSongs(candidates, limit, quality, neteaseAccountCookie);
	    const data = { songs: verified, filtered: Math.max(0, candidates.length - verified.length), quality };
	    searchCache.set(cacheKey, { data, expiresAt: Date.now() + SEARCH_CACHE_TTL_MS });
	    res.json({ ...data, cached: false });
	  } catch (error) {
	    res.status(502).json({ error: "netease_search_failed", message: errorMessage(error) });
	  }
	});

	app.get("/api/netease/account/status", async (_req, res) => {
	  try {
	    res.json(await validateNeteaseCookie());
	  } catch (error) {
	    res.status(502).json({ error: "netease_account_failed", message: errorMessage(error), loggedIn: false });
	  }
	});

	app.post("/api/netease/account/login", async (req, res) => {
	  const cookie = parseCookieInput(req.body?.cookie ?? req.body);
	  if (!cookie) {
	    res.status(400).json({ error: "cookie_required", message: "请输入网易云 Cookie" });
	    return;
	  }
	  try {
	    const status = await validateNeteaseCookie(cookie);
	    if (!status.loggedIn) {
	      res.status(401).json({ error: "netease_login_invalid", message: "网易云 Cookie 无法验证" });
	      return;
	    }
	    setNeteaseCookie(cookie);
	    res.json(status);
	  } catch (error) {
	    res.status(502).json({ error: "netease_login_failed", message: errorMessage(error) });
	  }
	});

	app.post("/api/netease/account/logout", (_req, res) => {
	  setNeteaseCookie("");
	  res.json({ loggedIn: false });
	});

	app.get("/api/netease/account/playlists", async (req, res) => {
	  try {
	    const status = await validateNeteaseCookie();
	    if (!status.loggedIn || !status.userId) {
	      res.status(401).json({ error: "netease_login_required", message: "请先导入并验证网易云 Cookie" });
	      return;
	    }
	    const quality = normalizeQuality(req.query.quality);
	    const limit = parseLimit(req.query.limit, 8, 30);
	    const response = await netease.user_playlist({ uid: status.userId, limit, cookie: neteaseAccountCookie });
	    const summaries = (response.body?.playlist ?? []).map(mapNeteaseUserPlaylistSummary).filter((playlist) => playlist.id !== "netease_playlist_");
	    const playlists = [];
	    for (const summary of summaries) {
	      if (playlists.length >= limit) break;
	      const detail = await getPlaylistDetailWithFallback(summary.id.replace(/^netease_playlist_/, ""), neteaseAccountCookie, PLAYLIST_CANDIDATE_LIMIT);
	      const mapped = await mapPlayableNeteasePlaylist(detail ?? {}, quality, neteaseAccountCookie, PLAYLIST_CANDIDATE_LIMIT);
	      if (mapped.songs.length) playlists.push({ ...mapped, coverPic: summary.coverPic || mapped.coverPic, trackCount: summary.trackCount, creatorNickname: summary.creatorNickname });
	    }
	    res.json({ loggedIn: true, playlists, quality });
	  } catch (error) {
	    res.status(502).json({ error: "netease_sync_failed", message: errorMessage(error) });
	  }
	});

app.get("/api/netease/song/:id", async (req, res) => {
  const id = cleanText(req.params.id).replace(/^netease_/, "");
  if (!/^\d+$/.test(id)) {
    res.status(400).json({ error: "invalid_song_id", message: "invalid song id" });
    return;
  }

  try {
	    const quality = normalizeQuality(req.query.quality);
	    const [urlResult, lyricResult] = await Promise.allSettled([
	      resolveSongUrl(id, quality, neteaseAccountCookie),
	      fetchNeteaseLyric(id)
	    ]);
    if (urlResult.status === "rejected") throw urlResult.reason;
    const data = urlResult.value ?? {};
    if (!isFullPlayableUrlData(data)) {
      res.status(404).json({
        error: "song_url_unavailable",
        reason: playableRejectReason(data),
        message: data.message ?? "当前歌曲不可完整播放"
      });
      return;
    }
	    const lrc = lyricResult.status === "fulfilled" ? lyricResult.value : "";
	    res.json({
	      url: streamPath(id, quality),
	      lrc,
	      durationMs: Number(data.time ?? 0),
	      verifiedPlayable: true,
	      br: data.br ?? null,
	      level: data.level ?? null,
	      audioType: data.type ?? null,
	      type: data.type ?? null,
	      quality
	    });
  } catch (error) {
    res.status(502).json({ error: "netease_song_failed", message: errorMessage(error) });
  }
});

app.get("/api/lyrics", async (req, res) => {
  const rawId = cleanText(req.query.id).replace(/^netease_/, "");
  const name = cleanText(req.query.name);
  const artist = cleanText(req.query.artist);
  try {
    let id = /^\d+$/.test(rawId) ? rawId : "";
    if (!id) {
      const keyword = [name, artist].filter(Boolean).join(" ").trim();
      if (!keyword) {
        res.status(400).json({ error: "song_required", message: "song id or name is required" });
        return;
      }
      const candidate = await findLyricCandidate(keyword, artist);
      id = String(candidate?.id ?? "");
    }
    if (!/^\d+$/.test(id)) {
      res.status(404).json({ error: "lyrics_not_found", message: "没有找到歌词" });
      return;
    }
    const lrc = await fetchNeteaseLyric(id);
    if (!lrc) {
      res.status(404).json({ error: "lyrics_not_found", message: "没有找到歌词" });
      return;
    }
    res.json({ lrc, provider: "netease", id: `netease_${id}` });
  } catch (error) {
    res.status(502).json({ error: "lyrics_failed", message: errorMessage(error) });
  }
});

app.get("/api/netease/stream/:id", async (req, res) => {
  const id = cleanText(req.params.id).replace(/^netease_/, "");
  if (!/^\d+$/.test(id)) {
    res.status(400).json({ error: "invalid_song_id", message: "invalid song id" });
    return;
  }

  try {
	    const quality = normalizeQuality(req.query.quality);
	    const data = await resolveSongUrl(id, quality, neteaseAccountCookie);
    if (!isFullPlayableUrlData(data)) {
      res.status(404).json({
        error: "song_stream_unavailable",
        reason: playableRejectReason(data),
        message: "当前歌曲不可完整播放"
      });
      return;
    }

    const headers = {
      "User-Agent": NETEASE_USER_AGENT,
      Referer: NETEASE_REFERER,
      Accept: "audio/*,*/*;q=0.8"
    };
    if (req.headers.range) headers.Range = req.headers.range;

    const upstream = await fetchImpl(cleanText(data.url), { headers, redirect: "follow" });
    if (!upstream.ok && upstream.status !== 206) {
      res.status(502).json({ error: "upstream_stream_failed", message: `upstream status ${upstream.status}` });
      return;
    }
    if (!upstream.body) {
      res.status(502).json({ error: "upstream_stream_empty", message: "upstream stream is empty" });
      return;
    }

    res.status(upstream.status);
    for (const header of ["content-type", "content-length", "content-range", "accept-ranges"]) {
      const value = upstream.headers.get(header);
      if (value) res.setHeader(header, value);
    }
    res.setHeader("Cache-Control", "no-store");
    pipeUpstreamBody(upstream, res, "netease_stream_failed");
  } catch (error) {
    res.status(502).json({ error: "netease_stream_failed", message: errorMessage(error) });
  }
});

app.get("/api/netease/playlist/:id", async (req, res) => {
  const id = cleanText(req.params.id);
  if (!/^\d+$/.test(id)) {
    res.status(400).json({ error: "invalid_playlist_id", message: "请输入有效的网易云歌单 ID" });
    return;
  }

  try {
	    const quality = normalizeQuality(req.query.quality);
	    const playlist = await getPlaylistDetailWithFallback(id, neteaseAccountCookie, PLAYLIST_CANDIDATE_LIMIT);
    if (!playlist) {
      res.status(404).json({ error: "playlist_not_found", message: "没有找到这个歌单" });
      return;
    }
	    const mapped = await mapVerifiedPlaylist(playlist, quality, neteaseAccountCookie, PLAYLIST_CANDIDATE_LIMIT);
    if (!mapped.songs.length) {
      res.status(404).json({ error: "playlist_empty", message: "这个公开歌单没有可完整播放歌曲" });
      return;
    }
	    prewarmFlacSearchForSongs(mapped.songs, 4);
	    res.json({ playlist: mapped, quality });
	  } catch (error) {
	    res.status(502).json({ error: "netease_playlist_failed", message: errorMessage(error) });
	  }
	});

	app.get("/api/netease/home", async (req, res) => {
	  try {
	    const limit = parseLimit(req.query.playlistLimit, 20, 30);
	    const hotLimit = parseLimit(req.query.hotLimit, 10, 20);
	    const radarLimit = parseLimit(req.query.radarLimit, 10, 20);
	    const refresh = parseOffset(req.query.refresh, 0, 99);
	    const offset = parseOffset(req.query.offset, refresh ? (refresh * limit) % 300 : 0, 300);
	    const quality = normalizeQuality(req.query.quality);
	    const [recommendedPlaylists, hotSongs, radarSongs] = await Promise.allSettled([
	      getRecommendedPlaylists(limit, offset),
	      getHotSongs(hotLimit, quality, neteaseAccountCookie),
	      getRecommendedSongs(radarLimit, quality, neteaseAccountCookie)
	    ]);
	    if (recommendedPlaylists.status === "rejected") throw recommendedPlaylists.reason;
	    res.json({
	      radarSongs: radarSongs.status === "fulfilled" ? radarSongs.value : [],
	      hotSongs: hotSongs.status === "fulfilled" ? hotSongs.value : [],
	      recommendedPlaylists: recommendedPlaylists.value,
	      quality,
	      refresh,
	      offset
	    });
	  } catch (error) {
	    res.status(502).json({ error: "netease_home_failed", message: errorMessage(error) });
	  }
	});

	app.get("/api/bili/search", async (req, res) => {
	  const keyword = cleanText(req.query.keyword);
	  if (!keyword) {
	    res.status(400).json({ error: "keyword_required", message: "keyword is required" });
	    return;
	  }
	  try {
	    const limit = parseLimit(req.query.limit, 30, 50);
	    const url = await buildBiliWbiUrl(BILI_SEARCH_URL, {
	      keyword,
	      page: "1",
	      limit: String(Math.max(limit, 30)),
	      page_size: String(Math.max(limit, 30)),
	      search_type: "video"
	    });
	    const body = await withTimeout(
	      fetchJsonUrl(url, apiHeaders(biliAccountCookie)),
	      BILI_UPSTREAM_TIMEOUT_MS,
	      "bili search"
	    );
	    if (body.code !== 0) throw new Error(body.message || "Bili search failed");
	    const raw = Array.isArray(body.data?.result)
	      ? body.data.result
	      : body.data?.result?.list ?? [];
	    const enriched = await Promise.allSettled(raw.slice(0, Math.max(limit, 30)).map(async (item) => {
	      if (item.cid) return mapBiliSearchItem(item, null);
	      const info = await getBiliVideoInfo(cleanText(item.bvid));
	      return mapBiliSearchItem(item, info);
	    }));
	    const seenIds = new Set();
	    const songs = [];
	    let videosWithSongs = 0;
	    for (const result of enriched) {
	      if (result.status !== "fulfilled" || !result.value) continue;
	      const mapped = Array.isArray(result.value) ? result.value : [result.value];
	      if (!mapped.length) continue;
	      videosWithSongs += 1;
	      for (const song of mapped) {
	        if (seenIds.has(song.id) || songs.length >= limit) continue;
	        seenIds.add(song.id);
	        songs.push(song);
	      }
	    }
	    res.json({
	      songs,
	      filtered: Math.max(0, raw.length - videosWithSongs),
	      sourceVideos: raw.length,
	      expandedVideos: raw.filter((item) => !item.cid).length
	    });
	  } catch (error) {
	    res.status(502).json({ error: "bili_search_failed", message: errorMessage(error) });
	  }
	});

	app.get("/api/flac/search", async (req, res) => {
	  const keyword = cleanText(req.query.keyword);
	  if (!keyword) {
	    res.status(400).json({ error: "keyword_required", message: "keyword is required" });
	    return;
	  }
	  try {
	    const limit = parseLimit(req.query.limit, 30, 60);
	    const page = parsePage(req.query.page);
	    const { songs, rawCount, total, hasMore, cached } = await searchFlacSongs(keyword, page, limit);
	    res.json({ songs, filtered: Math.max(0, rawCount - songs.length), page, limit, total, hasMore, cached });
	  } catch (error) {
	    res.status(502).json({ error: "flac_search_failed", message: errorMessage(error) });
	  }
	});

	app.get("/api/flac/song/:id", async (req, res) => {
	  const id = cleanText(req.params.id).replace(/^flac_/, "");
	  if (!/^\d+$/.test(id)) {
	    res.status(400).json({ error: "invalid_flac_id", message: "invalid test source song id" });
	    return;
	  }
	  try {
	    const format = cleanText(req.query.format, "flac");
	    const bitrate = cleanText(req.query.bitrate, format === "flac" ? "2000" : "320");
	    const data = await resolveFlacUrlWithFallback(id, format, bitrate, req.query.time, req.query.sign);
	    const resolvedFormat = cleanText(data.format, format);
	    const resolvedBitrate = cleanText(data.bitrate, bitrate);
	    res.json({
	      url: `/api/flac/stream/${encodeURIComponent(id)}?format=${encodeURIComponent(resolvedFormat)}&bitrate=${encodeURIComponent(resolvedBitrate)}&time=${encodeURIComponent(cleanText(req.query.time))}&sign=${encodeURIComponent(cleanText(req.query.sign))}`,
	      durationMs: data.durationMs,
	      verifiedPlayable: true,
	      br: data.br,
	      level: data.level,
	      audioType: data.audioType,
	      type: data.type,
	      quality: data.quality,
	      fallbackFrom: data.fallbackFrom
	    });
	  } catch (error) {
	    res.status(404).json({ error: "flac_song_unavailable", message: errorMessage(error) });
	  }
	});

	app.get("/api/flac/stream/:id", async (req, res) => {
	  const id = cleanText(req.params.id).replace(/^flac_/, "");
	  if (!/^\d+$/.test(id)) {
	    res.status(400).json({ error: "invalid_flac_id", message: "invalid test source song id" });
	    return;
	  }
	  try {
	    const { upstream } = await resolveFlacStreamWithFallback(id, req.query.format, req.query.bitrate, req.query.time, req.query.sign, req.headers.range);
	    if (!upstream.body) {
	      res.status(502).json({ error: "flac_upstream_empty", message: "test source audio upstream failed" });
	      return;
	    }
	    res.status(upstream.status);
	    for (const header of ["content-type", "content-length", "content-range", "accept-ranges"]) {
	      const value = upstream.headers.get(header);
	      if (value) res.setHeader(header, value);
	    }
	    res.setHeader("Cache-Control", "no-store");
	    pipeUpstreamBody(upstream, res, "flac_stream_failed");
	  } catch (error) {
	    res.status(502).json({ error: "flac_stream_failed", message: errorMessage(error) });
	  }
	});

	app.get("/api/bili/song/:bvid", async (req, res) => {
	  const bvid = cleanText(req.params.bvid).replace(/^bili_/, "");
	  const cid = Number(req.query.cid ?? 0);
	  if (!/^BV[a-zA-Z0-9]+$/.test(bvid) || !Number.isFinite(cid) || cid <= 0) {
	    res.status(400).json({ error: "invalid_bili_id", message: "invalid Bili bvid/cid" });
	    return;
	  }
	  try {
	    const quality = cleanText(req.query.quality, "high");
	    const [stream, info] = await Promise.all([resolveBiliStream(bvid, cid, quality), getBiliVideoInfo(bvid)]);
	    if (info.durationMs <= MIN_FULL_SONG_MS) {
	      res.status(404).json({ error: "bili_song_unavailable", reason: "too_short", message: "Bili 视频时长不足，已过滤" });
	      return;
	    }
	    res.json({
	      url: `/api/bili/stream/${encodeURIComponent(bvid)}?cid=${encodeURIComponent(String(cid))}&quality=${encodeURIComponent(quality)}`,
	      durationMs: info.durationMs,
	      verifiedPlayable: true,
	      br: stream.br,
	      level: quality,
	      audioType: stream.codec,
	      type: stream.codec,
	      quality
	    });
	  } catch (error) {
	    res.status(404).json({ error: "bili_song_unavailable", message: errorMessage(error) });
	  }
	});

	app.get("/api/bili/stream/:bvid", async (req, res) => {
	  const bvid = cleanText(req.params.bvid).replace(/^bili_/, "");
	  const cid = Number(req.query.cid ?? 0);
	  if (!/^BV[a-zA-Z0-9]+$/.test(bvid) || !Number.isFinite(cid) || cid <= 0) {
	    res.status(400).json({ error: "invalid_bili_id", message: "invalid Bili bvid/cid" });
	    return;
	  }
	  try {
	    const quality = cleanText(req.query.quality, "high");
	    const info = await getBiliVideoInfo(bvid);
	    if (info.durationMs <= MIN_FULL_SONG_MS) {
	      res.status(404).json({ error: "bili_stream_unavailable", reason: "too_short", message: "Bili 视频时长不足，已过滤" });
	      return;
	    }
	    const stream = await resolveBiliStream(bvid, cid, quality);
	    const urls = [stream.url, ...stream.backupUrls].filter(Boolean);
	    let upstream = null;
	    for (const url of urls) {
	      upstream = await fetchImpl(url, {
	        headers: {
	          ...apiHeaders(biliAccountCookie),
	          Accept: "audio/*,*/*;q=0.8",
	          ...(req.headers.range ? { Range: req.headers.range } : {})
	        },
	        redirect: "follow"
	      });
	      if (upstream.ok || upstream.status === 206) break;
	    }
	    if (!upstream || (!upstream.ok && upstream.status !== 206) || !upstream.body) {
	      res.status(502).json({ error: "bili_upstream_failed", message: "Bili audio upstream failed" });
	      return;
	    }
	    res.status(upstream.status);
	    for (const header of ["content-type", "content-length", "content-range", "accept-ranges"]) {
	      const value = upstream.headers.get(header);
	      if (value) res.setHeader(header, value);
	    }
	    res.setHeader("Cache-Control", "no-store");
	    pipeUpstreamBody(upstream, res, "bili_stream_failed");
	  } catch (error) {
	    res.status(502).json({ error: "bili_stream_failed", message: errorMessage(error) });
	  }
	});

	app.get("/api/bili/account/status", async (_req, res) => {
	  try {
	    res.json(await validateBiliCookie());
	  } catch (error) {
	    res.status(502).json({ error: "bili_account_failed", message: errorMessage(error), loggedIn: false });
	  }
	});

	app.post("/api/bili/account/login", async (req, res) => {
	  const cookie = parseCookieInput(req.body?.cookie ?? req.body);
	  if (!cookie) {
	    res.status(400).json({ error: "cookie_required", message: "请输入 Bili Cookie" });
	    return;
	  }
	  try {
	    const status = await validateBiliCookie(cookie);
	    if (!status.loggedIn) {
	      res.status(401).json({ error: "bili_login_invalid", message: "Bili Cookie 无法验证" });
	      return;
	    }
	    setBiliCookie(cookie);
	    res.json(status);
	  } catch (error) {
	    res.status(502).json({ error: "bili_login_failed", message: errorMessage(error) });
	  }
	});

	app.post("/api/bili/account/logout", (_req, res) => {
	  setBiliCookie("");
	  res.json({ loggedIn: false });
	});

	app.get("/api/bili/account/playlists", async (req, res) => {
	  try {
	    const status = await validateBiliCookie();
	    if (!status.loggedIn || !status.userId) {
	      res.status(401).json({ error: "bili_login_required", message: "请先导入并验证 Bili Cookie" });
	      return;
	    }
	    const url = new URL(BILI_FAV_FOLDER_URL);
	    url.searchParams.set("up_mid", status.userId);
	    const body = await fetchJsonUrl(url.toString(), apiHeaders(biliAccountCookie));
	    if (body.code !== 0) throw new Error(body.message || "Bili favorite folders unavailable");
	    const folders = Array.isArray(body.data?.list) ? body.data.list : [];
	    const playlists = [];
	    for (const folder of folders) {
	      const items = await getBiliFavItems(folder.id, 60);
	      const songs = items.map(mapBiliResourceItem).filter(Boolean);
	      if (!songs.length) continue;
	      playlists.push({
	        id: `bili_playlist_${String(folder.id)}`,
	        name: cleanText(folder.title, "Bili 收藏夹"),
	        cover: cleanText(folder.cover, songs[0]?.cover ?? ""),
	        coverPic: cleanText(folder.cover, songs[0]?.cover ?? ""),
	        songs,
	        source: "bili",
	        trackCount: songs.length,
	        creatorNickname: status.nickname
	      });
	    }
	    res.json({ loggedIn: true, playlists });
	  } catch (error) {
	    res.status(502).json({ error: "bili_sync_failed", message: errorMessage(error) });
	  }
	});

if (dev) {
  const { createServer } = await import("vite");
  const vite = await createServer({
    server: { middlewareMode: true, hmr: { port: hmrPort } },
    appType: "spa"
  });
  app.use(vite.middlewares);
} else {
  app.use(express.static(resolve(__dirname, "dist")));
  app.use((req, res, next) => {
    if (req.path.startsWith("/api/")) {
      next();
      return;
    }
    res.sendFile(resolve(__dirname, "dist/index.html"));
  });
}

app.use((error, _req, res, next) => {
  if (error?.status === 413 || error?.type === "entity.too.large") {
    res.status(413).json({ error: "payload_too_large", message: "请求数据过大" });
    return;
  }
  if (error?.status === 400 && error?.type === "entity.parse.failed") {
    res.status(400).json({ error: "invalid_json", message: "请求数据格式无效" });
    return;
  }
  next(error);
});

return app;
}

export async function startServer({ listenPort = port, dev = isDev } = {}) {
  const app = await createApp({ dev, hmrPort: listenPort + 10000 });
  return app.listen(listenPort, "127.0.0.1", () => {
    console.log(`拾音 running at http://127.0.0.1:${listenPort}/`);
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await startServer();
}
