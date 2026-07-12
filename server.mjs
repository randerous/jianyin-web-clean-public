import express from "express";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const defaultNetease = require("NeteaseCloudMusicApi");

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const isDev = args.includes("--dev");
const portArgIndex = args.indexOf("--port");
const port = portArgIndex >= 0 ? Number(args[portArgIndex + 1]) || 5188 : Number(process.env.PORT) || 5188;
const sharedStatePath = process.env.JIANYIN_STATE_PATH
  ? resolve(process.env.JIANYIN_STATE_PATH)
  : resolve(__dirname, ".jianyin-shared-state.json");

export async function createApp({ neteaseClient = defaultNetease, fetchImpl = globalThis.fetch, dev = false, hmrPort = port + 10000, statePath = sharedStatePath } = {}) {
const app = express();
const netease = neteaseClient;
let sharedStateWriteTail = Promise.resolve();
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
const FLAC_BASE_URL = "https://flac.music.hi.cn";
const FLAC_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
	const resolvedUrlCache = new Map();
	const searchCache = new Map();
	const flacSearchCache = new Map();
	const flacSearchInFlight = new Map();
	const playlistDetailCache = new Map();
	const playlistDetailInFlight = new Map();
	const biliStreamCache = new Map();
	const flacStreamCache = new Map();
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

function redactSharedState(value, key = "") {
  const secretKey = /cookie|credential|token|music_u|sessdata|bili_jct|csrf/i.test(key);
  if (secretKey) return undefined;
  if (Array.isArray(value)) {
    return value
      .map((item) => redactSharedState(item))
      .filter((item) => item !== undefined);
  }
  if (value && typeof value === "object") {
    const sanitized = {};
    for (const [entryKey, entryValue] of Object.entries(value)) {
      const next = redactSharedState(entryValue, entryKey);
      if (next !== undefined) sanitized[entryKey] = next;
    }
    return sanitized;
  }
  if (typeof value === "string" && /(MUSIC_U=|SESSDATA=|bili_jct=)/i.test(value)) return undefined;
  return value;
}

async function readSharedState() {
  try {
    return JSON.parse(await readFile(statePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function writeSharedState(state) {
  const operation = sharedStateWriteTail.then(async () => {
    await mkdir(dirname(statePath), { recursive: true });
    const existing = await readSharedState();
    const incomingUpdatedAt = Number(state?.updatedAt);
    const existingUpdatedAt = Number(existing?.updatedAt);
    if (Number.isFinite(incomingUpdatedAt) && Number.isFinite(existingUpdatedAt) && incomingUpdatedAt < existingUpdatedAt) return;
    await writeFile(statePath, JSON.stringify({ ...state, savedAt: new Date().toISOString() }, null, 2));
  });
  sharedStateWriteTail = operation.catch(() => {});
  return operation;
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

	function mapBiliSearchItem(item, index = 0) {
	  const bvid = cleanText(item?.bvid);
	  const cid = Number(item?.cid ?? item?.pages?.[0]?.cid ?? 0);
	  const durationMs = parseBiliDuration(item?.duration);
	  if (!bvid || !cid || durationMs <= MIN_FULL_SONG_MS) return null;
	  return {
	    id: `bili_${bvid}_${cid}`,
	    name: stripHtml(item?.title) || "Bilibili 视频",
	    artist: stripHtml(item?.owner?.name ?? item?.author ?? item?.owner) || "Bilibili",
	    url: `/api/bili/stream/${encodeURIComponent(bvid)}?cid=${encodeURIComponent(String(cid))}&quality=high`,
	    pic: cleanText(item?.pic).replace(/^\/\//, "https://"),
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
	  const body = await fetchJsonUrl(url.toString(), apiHeaders(biliAccountCookie));
	  if (body.code !== 0) throw new Error(body.message || "Bili video unavailable");
	  const pages = body.data?.pages ?? [];
	  return {
	    bvid: cleanText(body.data?.bvid, bvid),
	    cid: Number(body.data?.cid ?? pages[0]?.cid ?? 0),
	    title: cleanText(body.data?.title, "Bilibili 视频"),
	    pic: cleanText(body.data?.pic),
	    owner: cleanText(body.data?.owner?.name, "Bilibili"),
	    durationMs: Number(body.data?.duration ?? 0) * 1000
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
	  const body = await fetchJsonUrl(url, apiHeaders(biliAccountCookie));
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
    pic: cleanText(album.picUrl, ""),
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
	      pic: cleanText(album.picUrl, ""),
	      cover: cleanText(album.picUrl, ""),
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
	    coverPic: cleanText(playlist.coverImgUrl, songs[0]?.pic ?? ""),
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
	    coverPic: cleanText(playlist.coverImgUrl, songs[0]?.pic ?? ""),
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
	    cover: cleanText(playlist.coverImgUrl, cleanText(playlist.picUrl, "")),
	    coverPic: cleanText(playlist.coverImgUrl, cleanText(playlist.picUrl, "")),
	    trackCount: Number(playlist.trackCount ?? 0) || 0,
	    creatorNickname: cleanText(playlist.creator?.nickname, "")
	  };
	}

	function mapPlaylistSummary(playlist) {
	  return {
	    id: String(playlist?.id ?? ""),
	    name: cleanText(playlist?.name, "推荐歌单"),
	    cover: cleanText(playlist?.picUrl, cleanText(playlist?.coverImgUrl, "")),
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
	    coverImgUrl: cleanText(tracks?.[0]?.al?.picUrl, ""),
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
	  const url = new URL(BILI_FAV_RESOURCE_URL);
	  url.searchParams.set("media_id", String(mediaId));
	  url.searchParams.set("pn", "1");
	  url.searchParams.set("ps", String(pageSize));
	  url.searchParams.set("order", "mtime");
	  url.searchParams.set("type", "0");
	  const body = await fetchJsonUrl(url.toString(), apiHeaders(biliAccountCookie));
	  if (body.code !== 0) throw new Error(body.message || "Bili favorite folder unavailable");
	  return body.data?.medias ?? [];
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

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, provider: "NeteaseCloudMusicApi" });
});

app.get("/api/state", async (_req, res) => {
  try {
    res.json({ state: await readSharedState() });
  } catch (error) {
    res.status(500).json({ error: "state_read_failed", message: errorMessage(error) });
  }
});

app.post("/api/state", async (req, res) => {
  try {
    await writeSharedState(redactSharedState(req.body?.state ?? req.body ?? {}) ?? {});
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: "state_write_failed", message: errorMessage(error) });
  }
});

app.delete("/api/state", async (_req, res) => {
  try {
    await rm(statePath, { force: true });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ error: "state_delete_failed", message: errorMessage(error) });
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
	    const refresh = parseOffset(req.query.refresh, 0, 99);
	    const offset = parseOffset(req.query.offset, refresh ? (refresh * limit) % 300 : 0, 300);
	    const recommendedPlaylists = await getRecommendedPlaylists(limit, offset);
	    res.json({ radarSongs: [], hotSongs: [], recommendedPlaylists, quality: normalizeQuality(req.query.quality), refresh, offset });
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
	    const body = await fetchJsonUrl(url, apiHeaders(biliAccountCookie));
	    if (body.code !== 0) throw new Error(body.message || "Bili search failed");
	    const raw = Array.isArray(body.data?.result)
	      ? body.data.result
	      : body.data?.result?.list ?? [];
	    const enriched = await Promise.allSettled(raw.slice(0, Math.max(limit, 30)).map(async (item, index) => {
	      if (item.cid) return mapBiliSearchItem(item, index);
	      const info = await getBiliVideoInfo(cleanText(item.bvid));
	      return mapBiliSearchItem({ ...item, cid: info.cid, duration: info.durationMs / 1000, pic: item.pic || info.pic, owner: { name: item.author || info.owner } }, index);
	    }));
	    const songs = enriched
	      .map((result) => result.status === "fulfilled" ? result.value : null)
	      .filter(Boolean)
	      .slice(0, limit);
	    res.json({ songs, filtered: Math.max(0, raw.length - songs.length) });
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
	    const limit = parseLimit(req.query.limit, 30, 30);
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
	    const limit = parseLimit(req.query.limit, 8, 20);
	    const url = new URL(BILI_FAV_FOLDER_URL);
	    url.searchParams.set("up_mid", status.userId);
	    const body = await fetchJsonUrl(url.toString(), apiHeaders(biliAccountCookie));
	    if (body.code !== 0) throw new Error(body.message || "Bili favorite folders unavailable");
	    const folders = (body.data?.list ?? []).slice(0, limit);
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
	        trackCount: Number(folder.media_count ?? songs.length) || songs.length,
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
