import {
  ArchiveRestore,
  ChevronLeft,
  ChevronRight,
  Cloud,
  Download,
  FileAudio,
  FileText,
  Flame,
  Heart,
  Home,
  Library,
  ListPlus,
  Music,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings,
  SkipBack,
  SkipForward,
  Square,
  SquareCheckBig,
  UserRound,
  Trash2,
  X
} from "lucide-react";
import { ChangeEvent, FormEvent, MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Modal from "./components/Modal";
import Player from "./components/Player";
import SongRow from "./components/SongRow";
import { ensureAudioEffects, setAudioEffects, setDebugHook } from "./lib/audio-effects";
import { applySharedTombstoneClears, deriveSharedTombstoneClears } from "./lib/shared-state";
import {
  checkProxy,
  fetchNeteaseHome,
  fetchLyricsForSong,
  getBiliAccountStatus,
  getNeteaseAccountStatus,
  importNeteasePlaylist,
  loginBiliCookie,
  loginNeteaseCookie,
  logoutBiliCookie,
  logoutNeteaseCookie,
  FLAC_SEARCH_PAGE_SIZE,
  prewarmFlacSongs,
  resolveBiliSong,
  resolveFlacSong,
  resolveNeteaseSong,
  searchFlac,
  syncBiliAccountPlaylists,
  syncNeteaseAccountPlaylists
} from "./lib/api";
import { activeLyricIndex, formatTime, parseLrc } from "./lib/lyrics";
import { createSharedStateWriter } from "./lib/shared-state-writer";
import { applyDesktopUpdate, CURRENT_VERSION, fetchLatestUpdate, UPDATE_CHECK_INTERVAL_MS } from "./lib/update";
import type { LatestUpdate } from "./lib/update";
import {
  deleteLocalFile,
  deriveSharedTombstones,
  downloadJson,
  downloadSongKey,
  hydrateLocalSongs,
  loadLocalFile,
  loadSharedState,
  loadState,
  makeBackup,
  mergeSharedState,
  mergeStates,
  normalizeState,
  replaceSharedState,
  restoreBackup,
  saveLocalFile,
  saveSharedState,
  saveState,
  SharedStateConflictError,
  sharedStateSignature,
  songKey,
  toSharedState,
  validateBackup
} from "./lib/storage";
import { FAVORITES_ID, RECENT_HISTORY_LIMIT, cover, recommendedKeywords } from "./data/seed";
import type { AccountState, AudioEffectsPreset, BackupPreview, LyricSource, PersistedState, PlayQuality, Playlist, ProgressStyle, SharedState, SharedTombstones, Song, Theme } from "./types";

type Tab = "home" | "search" | "mine";
type PlayMode = "sequence" | "repeat" | "shuffle";
type HomeData = {
  radarSongs: Song[];
  hotSongs: Song[];
  recommendedPlaylists: Playlist[];
};

type PendingSharedWrite = {
  state: SharedState;
  baseRevision: number;
  writeId: string;
  tombstoneClears: SharedTombstones;
};

function createOpaqueSharedId(prefix: "shared-write" | "shared_song" | "shared_playlist") {
  const separator = prefix === "shared-write" ? "-" : "_";
  return `${prefix}${separator}${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
}

function createSharedWriteId() {
  return createOpaqueSharedId("shared-write");
}

const FLAC_PAUSED_REFRESH_MS = 6 * 60 * 1000;
const AUDIO_FADE_DURATION_MS = 180;

declare global {
  interface Window {
    JianyinAndroid?: {
      setPlaybackState?: (active: boolean, title?: string, artist?: string) => void;
      setPlaybackInfo?: (present: boolean, playing: boolean, title?: string, artist?: string) => void;
      setPlaybackDetails?: (present: boolean, playing: boolean, title?: string, artist?: string, position?: number, duration?: number) => void;
      setPlaybackDetailsV2?: (present: boolean, playing: boolean, title?: string, artist?: string, position?: number, duration?: number, statusNotificationEnabled?: boolean) => void;
      downloadAndInstallUpdate?: (url: string, fileName: string, sha256: string, versionTag: string) => void;
    };
    JianyinAndroidBack?: () => boolean;
    JianyinAndroidMedia?: (command: "previous" | "toggle" | "next") => void;
    JianyinRecoverAudio?: () => void;
  }
}

const qualityOptions: { value: PlayQuality; label: string }[] = [
  { value: "jymaster", label: "超清母带" },
  { value: "sky", label: "沉浸环绕声" },
  { value: "jyeffect", label: "高清环绕声" },
  { value: "hires", label: "Hi-Res" },
  { value: "lossless", label: "无损" },
  { value: "exhigh", label: "极高" },
  { value: "standard", label: "标准" }
];

function qualityLabel(value: string | undefined) {
  return qualityOptions.find((item) => item.value === value)?.label ?? value ?? "未知";
}

function playableSongs(songs: Song[]) {
  return songs.filter((song) => !song.needsImport && (song.url || song.localKey || song.remotePlayable || isRemoteSong(song)));
}

function isRemoteSong(song: Song) {
  return song.source === "netease" || song.source === "bili" || song.source === "flac";
}

function verifiedUrlMatchesQuality(song: Song, quality: PlayQuality) {
  if (!song.url || song.url.startsWith("local-file:")) return false;
  if (song.source !== "netease") return false;
  if (!song.verifiedPlayable) return false;
  return song.url.includes(`quality=${encodeURIComponent(quality)}`) || song.quality === quality;
}

function createLocalSong(file: File, index: number): Song {
  const localKey = `local_${file.name}_${file.lastModified}_${file.size}_${index}`;
  return {
    id: localKey,
    sharedId: createOpaqueSharedId("shared_song"),
    name: file.name.replace(/\.[^.]+$/, ""),
    artist: "本地文件",
    url: URL.createObjectURL(file),
    cover: cover(index + 1),
    source: "local",
    localKey
  };
}

function uniqueSongs(songs: Song[]) {
  const seen = new Set<string>();
  return songs.filter((song) => {
    const key = songKey(song);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function playlistDisplayCount(playlist: Playlist) {
  return Number(playlist.trackCount) > 0 ? Number(playlist.trackCount) : playlist.songs.length;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function recentSongsWith(song: Song, songs: Song[]) {
  return uniqueSongs([song, ...songs]).slice(0, RECENT_HISTORY_LIMIT);
}

function downloadCacheKey(song: Song) {
  if (song.localKey?.startsWith("download_")) return song.localKey;
  if (song.url.startsWith("local-file:download_")) return song.url.slice("local-file:".length);
  return "";
}

function isDownloadCachedSong(song: Song) {
  return Boolean(downloadCacheKey(song));
}

function preserveDownloadedCache(existing: Song, incoming: Song) {
  const key = downloadCacheKey(existing);
  if (!key || downloadCacheKey(incoming)) return incoming;
  return {
    ...incoming,
    localKey: key,
    url: `local-file:${key}`,
    needsImport: false,
    remotePlayable: incoming.remotePlayable || existing.remotePlayable,
    verifiedPlayable: incoming.verifiedPlayable || existing.verifiedPlayable
  };
}

function preferDownloadedCache(song: Song, cached: Song | undefined) {
  const key = cached ? downloadCacheKey(cached) : "";
  if (!cached || !key) return song;
  return {
    ...song,
    name: song.name.replace(/（需重新导入）$/, ""),
    localKey: key,
    url: cached.url.startsWith("blob:") ? cached.url : `local-file:${key}`,
    needsImport: false,
    remotePlayable: song.remotePlayable || cached.remotePlayable,
    verifiedPlayable: song.verifiedPlayable || cached.verifiedPlayable
  };
}

function remoteCopyAfterDownloadDeleted(song: Song) {
  const next: Song = {
    ...song,
    url: "",
    localKey: undefined,
    verifiedPlayable: false,
    needsImport: false
  };
  if (next.source === "local") {
    next.needsImport = true;
    next.remotePlayable = false;
  } else {
    next.remotePlayable = true;
    next.verifiedPlayable = false;
  }
  return next;
}

function allLibrarySongs(playlists: Playlist[], history: Song[]) {
  return uniqueSongs([...playlists.flatMap((playlist) => playlist.songs), ...history]);
}

function stateContentScore(state: Pick<SharedState, "playlists" | "favorites">) {
  return state.playlists.reduce((total, playlist) => total + playlist.songs.length, 0) +
    state.favorites.length;
}

function shouldMergeSharedState(localState: PersistedState, sharedState: SharedState) {
  const localScore = stateContentScore(toSharedState(localState));
  const sharedScore = stateContentScore(sharedState);
  if (!localScore || sharedScore >= localScore) return true;
  const sharedLooksEmpty = sharedState.playlists.every((playlist) => playlist.songs.length === 0) &&
    sharedState.favorites.length === 0;
  if (sharedLooksEmpty) return false;
  return sharedScore >= Math.max(3, Math.floor(localScore * 0.5));
}

function coverAfterSongResolved(playlist: Playlist, originalKey: string, resolvedCover?: string) {
  const firstSong = playlist.songs[0];
  if (!firstSong || songKey(firstSong) !== originalKey) return playlist.cover;
  return resolvedCover || playlist.cover;
}

export default function App() {
  const initial = useMemo(loadState, []);
  const [tab, setTab] = useState<Tab>("home");
  const [playlists, setPlaylists] = useState(initial.playlists);
  const [favorites, setFavorites] = useState(initial.favorites);
  const [history, setHistory] = useState(initial.history);
  const [downloadHistory, setDownloadHistory] = useState(initial.downloadHistory);
  const [queue, setQueue] = useState(initial.queue);
  const [queueIndex, setQueueIndex] = useState(initial.queueIndex);
  const [searchHistory, setSearchHistory] = useState(initial.searchHistory);
  const [theme, setTheme] = useState<Theme>(initial.theme);
  const [playQuality, setPlayQuality] = useState<PlayQuality>(initial.playQuality);
  const [downloadQuality, setDownloadQuality] = useState<PlayQuality>(initial.downloadQuality);
  const [progressStyle, setProgressStyle] = useState<ProgressStyle>(initial.progressStyle);
  const [lyricSource, setLyricSource] = useState<LyricSource>(initial.lyricSource);
  const [autoLyricsEnabled, setAutoLyricsEnabled] = useState(initial.autoLyricsEnabled);
  const [playbackSpeed, setPlaybackSpeed] = useState(initial.playbackSpeed);
  const [fadeEnabled, setFadeEnabled] = useState(initial.fadeEnabled);
  const [eqPreset, setEqPreset] = useState<AudioEffectsPreset>(initial.eqPreset);
  const [eqIntensity, setEqIntensity] = useState(initial.eqIntensity);
  const [autoCacheEnabled, setAutoCacheEnabled] = useState(initial.autoCacheEnabled);
  const [keepQueueOnExit, setKeepQueueOnExit] = useState(initial.keepQueueOnExit);
  const [autoPlayOnStart, setAutoPlayOnStart] = useState(initial.autoPlayOnStart);
  const [autoUpdateEnabled, setAutoUpdateEnabled] = useState(initial.autoUpdateEnabled);
  const [androidStatusNotificationEnabled, setAndroidStatusNotificationEnabled] = useState(initial.androidStatusNotificationEnabled);
  const [homeData, setHomeData] = useState<HomeData>({
    radarSongs: [],
    hotSongs: [],
    recommendedPlaylists: []
  });
  const [homeLoading, setHomeLoading] = useState(false);
  const [playlistOpeningId, setPlaylistOpeningId] = useState<string | null>(null);
  const [homeError, setHomeError] = useState("");
  const [homeRefreshIndex, setHomeRefreshIndex] = useState(0);
  const [query, setQuery] = useState("");
  const [remoteResults, setRemoteResults] = useState<Song[]>([]);
  const [searchOfflineResults, setSearchOfflineResults] = useState(false);
  const [searchPageInfo, setSearchPageInfo] = useState({ page: 1, pageSize: FLAC_SEARCH_PAGE_SIZE, total: null as number | null, hasMore: false });
  const [searching, setSearching] = useState(false);
  const [proxyOnline, setProxyOnline] = useState(false);
  const [toast, setToast] = useState("");
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playerOpen, setPlayerOpen] = useState(false);
  const [activePlaylistId, setActivePlaylistId] = useState<string | null>(null);
  const [previewPlaylist, setPreviewPlaylist] = useState<Playlist | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<PlayMode>("sequence");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [neteaseOpen, setNeteaseOpen] = useState(false);
  const [neteaseInput, setNeteaseInput] = useState("");
  const [neteaseError, setNeteaseError] = useState("");
  const [neteaseBusy, setNeteaseBusy] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [neteaseAccount, setNeteaseAccount] = useState<AccountState>({ loggedIn: false });
  const [biliAccount, setBiliAccount] = useState<AccountState>({ loggedIn: false });
  const [accountCookie, setAccountCookie] = useState("");
  const [accountProvider, setAccountProvider] = useState<"netease" | "bili">("netease");
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountError, setAccountError] = useState("");
  const [updateStatus, setUpdateStatus] = useState("");
  const [updateInfo, setUpdateInfo] = useState<LatestUpdate | null>(null);
  const [restorePreview, setRestorePreview] = useState<BackupPreview | null>(null);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [stateHydrated, setStateHydrated] = useState(false);
  const [floatingLyric, setFloatingLyric] = useState(false);
  const [lyricsLoadingKey, setLyricsLoadingKey] = useState("");
  const [sleepTimerUntil, setSleepTimerUntil] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const restoreInputRef = useRef<HTMLInputElement | null>(null);
  const lrcInputRef = useRef<HTMLInputElement | null>(null);
  const coverInputRef = useRef<HTMLInputElement | null>(null);
  const searchRunRef = useRef(0);
  const sharedStateReadyRef = useRef(false);
  const initialSharedState = useMemo(() => toSharedState(initial), [initial]);
  const sharedStateSignatureRef = useRef(sharedStateSignature(initialSharedState));
  const sharedProjectionRef = useRef(initialSharedState);
  const sharedRevisionRef = useRef(initial.sharedRevision ?? 0);
  const sharedTombstonesRef = useRef(initialSharedState.tombstones);
  const sharedTombstoneClearsRef = useRef<SharedTombstones>(initial.sharedTombstoneClears ?? { playlistIds: [], favorites: [], playlistSongs: {} });
  const latestSharedStateRef = useRef<PendingSharedWrite | null>(null);
  const sharedStateDirtyRef = useRef(Boolean(initial.sharedSyncPending));
  const sharedRemoteKnownRef = useRef(false);
  const retrySharedStateLoadRef = useRef<() => void>(() => {});
  const lastLifecycleFlushVersionRef = useRef<number | null>(null);
  const lastStateUpdatedAtRef = useRef(initial.updatedAt ?? 0);
  const latestPersistedStateRef = useRef<PersistedState>(initial);
  const persistedStateVersionRef = useRef(0);
  const lastPersistedSnapshotRef = useRef<PersistedState | null>(null);
  const sharedWriteErrorRef = useRef<(error: unknown, write: PendingSharedWrite) => void>(() => {});
  const sharedStateWriterRef = useRef<ReturnType<typeof createSharedStateWriter<PendingSharedWrite>> | null>(null);
  const homeRequestRef = useRef<{ id: number; controller: AbortController | null }>({ id: 0, controller: null });
  const queueRef = useRef(queue);
  const queueIndexRef = useRef(queueIndex);
  const modeRef = useRef(mode);
  const playingRef = useRef(playing);
  const positionRef = useRef(position);
  const androidPlaybackPushRef = useRef({ key: "", playing: false, duration: 0, statusNotificationEnabled: false, lastPosition: -1, lastPushAt: 0 });
  const audioAttemptRef = useRef<{ song: Song; source: Song[] } | null>(null);
  const audioMutationOwnerRef = useRef(0);
  const playRequestRef = useRef(0);
  // 用户已主动发起播放（点击/自动续播）。hydration 完成时若为真，
  // 不得用持久化队列覆盖正在进行的播放（否则 currentSong 变 null，
  // Android bridge 会推 present=false → 停掉尚未 startForeground 的前台服务 → 崩溃）。
  const userStartedPlaybackRef = useRef(false);
  const playbackPauseRef = useRef(0);
  const audioRetryRef = useRef<{ key: string; at: number } | null>(null);
  const pausedPlaybackRef = useRef<{ key: string; at: number } | null>(null);
  const playbackRefreshRef = useRef(false);
  const autoPlayCheckedRef = useRef(false);
  const cacheInFlightRef = useRef(new Map<string, Promise<Song>>());
  const downloadCacheRef = useRef(new Map<string, Song>());
  const objectUrlsRef = useRef(new Set<string>());
  const hydratedObjectUrlsRef = useRef(new Set<string>());
  const updateCheckRef = useRef<AbortController | null>(null);
  const lyricsAutoFetchRef = useRef(new Set<string>());
  const audioFadeRef = useRef<{ frame: number; resolve: () => void } | null>(null);

  const persistedSnapshot = useMemo<PersistedState>(() => ({
    playlists,
    favorites,
    history,
    downloadHistory,
    queue: keepQueueOnExit ? queue : [],
    queueIndex: keepQueueOnExit ? queueIndex : -1,
    searchHistory,
    theme,
    playQuality,
    downloadQuality,
    progressStyle,
    lyricSource,
    autoLyricsEnabled,
    playbackSpeed,
    fadeEnabled,
    eqPreset,
    eqIntensity,
    autoCacheEnabled,
    keepQueueOnExit,
    autoPlayOnStart,
    autoUpdateEnabled,
    androidStatusNotificationEnabled,
    sharedSyncPending: sharedStateDirtyRef.current,
    sharedRevision: sharedRevisionRef.current,
    sharedTombstones: sharedTombstonesRef.current,
    sharedTombstoneClears: sharedTombstoneClearsRef.current,
    updatedAt: lastStateUpdatedAtRef.current || undefined
  }), [androidStatusNotificationEnabled, autoCacheEnabled, autoLyricsEnabled, autoPlayOnStart, autoUpdateEnabled, downloadHistory, downloadQuality, eqIntensity, eqPreset, fadeEnabled, favorites, history, keepQueueOnExit, lyricSource, playQuality, playbackSpeed, playlists, progressStyle, queue, queueIndex, searchHistory, theme]);
  if (lastPersistedSnapshotRef.current !== persistedSnapshot) {
    lastPersistedSnapshotRef.current = persistedSnapshot;
    latestPersistedStateRef.current = persistedSnapshot;
    persistedStateVersionRef.current += 1;
  }

  const currentSong = queue[queueIndex] ?? null;
  downloadCacheRef.current = new Map(
    [
      ...playlists.flatMap((playlist) => playlist.songs),
      ...favorites,
      ...history,
      ...queue,
      ...downloadHistory
    ]
      .filter(isDownloadCachedSong)
      .map((song) => [downloadSongKey(song), song])
  );
  const withDownloadedCache = useCallback((song: Song) => (
    preferDownloadedCache(song, downloadCacheRef.current.get(downloadSongKey(song)))
  ), []);
  const trackObjectUrl = useCallback((url: string) => {
    if (url.startsWith("blob:")) objectUrlsRef.current.add(url);
    return url;
  }, []);
  const replaceObjectUrls = useCallback((urls: string[]) => {
    hydratedObjectUrlsRef.current.forEach((url) => {
      URL.revokeObjectURL(url);
      objectUrlsRef.current.delete(url);
    });
    hydratedObjectUrlsRef.current = new Set(urls);
    urls.forEach((url) => objectUrlsRef.current.add(url));
  }, []);
  const cancelPendingPlayback = useCallback(() => {
    playRequestRef.current += 1;
    playbackPauseRef.current += 1;
    playingRef.current = false;
  }, []);
  if (!sharedStateWriterRef.current) {
    sharedStateWriterRef.current = createSharedStateWriter<PendingSharedWrite>(
      async (write, options) => {
        const saved = await saveSharedState(write.state, {
          ...options,
          baseRevision: write.baseRevision,
          writeId: write.writeId
        });
        sharedRevisionRef.current = saved.revision;
        sharedTombstonesRef.current = applySharedTombstoneClears(saved.tombstones, sharedTombstoneClearsRef.current);
        if (latestSharedStateRef.current?.writeId === write.writeId) {
          const tombstoneClears = applySharedTombstoneClears(sharedTombstoneClearsRef.current, write.tombstoneClears);
          sharedTombstoneClearsRef.current = tombstoneClears;
          sharedStateDirtyRef.current = false;
          const persisted = {
            ...latestPersistedStateRef.current,
            sharedSyncPending: false,
            sharedRevision: saved.revision,
            sharedTombstones: sharedTombstonesRef.current,
            sharedTombstoneClears: tombstoneClears
          };
          latestPersistedStateRef.current = persisted;
          try {
            saveState(persisted);
          } catch {
            // A stale pending marker only causes a safe duplicate retry on the next launch.
          }
        }
      },
      (error, write) => sharedWriteErrorRef.current(error, write)
    );
  }
  sharedWriteErrorRef.current = (error, failedWrite) => {
    const latestWrite = latestSharedStateRef.current;
    if (latestWrite && latestWrite.writeId !== failedWrite.writeId) return;
    if (error instanceof SharedStateConflictError) {
      const tombstoneClears = sharedTombstoneClearsRef.current;
      const remoteState = {
        ...error.state,
        tombstones: applySharedTombstoneClears(error.state.tombstones, tombstoneClears)
      };
      const reconciled = mergeSharedState(latestPersistedStateRef.current, remoteState);
      const updatedAt = Math.max(Date.now(), lastStateUpdatedAtRef.current + 1, error.state.updatedAt ?? 0);
      const persisted: PersistedState = {
        ...reconciled,
        sharedSyncPending: true,
        sharedRevision: error.state.revision,
        sharedTombstones: reconciled.sharedTombstones,
        sharedTombstoneClears: tombstoneClears,
        updatedAt
      };
      const state = toSharedState(persisted);
      const retry: PendingSharedWrite = {
        state,
        baseRevision: error.state.revision,
        writeId: createSharedWriteId(),
        tombstoneClears
      };
      lastStateUpdatedAtRef.current = updatedAt;
      sharedRevisionRef.current = error.state.revision;
      sharedTombstonesRef.current = state.tombstones;
      sharedProjectionRef.current = state;
      sharedStateSignatureRef.current = sharedStateSignature(state);
      latestSharedStateRef.current = retry;
      latestPersistedStateRef.current = persisted;
      persistedStateVersionRef.current += 1;
      setPlaylists(persisted.playlists);
      setFavorites(persisted.favorites);
      try {
        saveState(persisted);
      } catch {
        setToast("浏览器存储空间不足，本次修改可能不会保存");
        return;
      }
      sharedStateWriterRef.current!.enqueue(retry);
      return;
    }
    const detail = error instanceof Error ? error.message : String(error);
    setToast(detail.startsWith("共享歌单保存失败") ? detail : `共享歌单保存失败：${detail}`);
  };
  const favoriteKeys = useMemo(() => new Set(favorites.map(songKey)), [favorites]);
  const activePlaylist =
    playlists.find((playlist) => playlist.id === activePlaylistId) ??
    (previewPlaylist?.id === activePlaylistId ? previewPlaylist : null) ??
    homeData.recommendedPlaylists.find((playlist) => playlist.id === activePlaylistId) ??
    null;
  const activePlaylistSaved = Boolean(activePlaylist && playlists.some((playlist) => playlist.id === activePlaylist.id));
  const searchResults = useMemo(() => {
    if (!query.trim()) return [];
    return remoteResults;
  }, [query, remoteResults]);

  const checkForUpdates = useCallback(async (manual = false) => {
    updateCheckRef.current?.abort();
    const controller = new AbortController();
    updateCheckRef.current = controller;
    try {
      const latest = await fetchLatestUpdate(controller.signal);
      if (controller.signal.aborted) return;
      setUpdateInfo(latest);
      if (!latest.available) {
        if (manual) setUpdateStatus(`当前已是最新版本 ${latest.currentVersion}`);
        return;
      }
      setUpdateStatus(`发现 ${latest.tag}，请查看更新说明后手动更新`);
      if (manual) setToast(`发现新版本 ${latest.tag}`);
    } catch (error) {
      if (controller.signal.aborted) return;
      setUpdateStatus(error instanceof Error ? error.message : "更新检查失败");
      if (manual) setToast(error instanceof Error ? error.message : "更新检查失败");
    } finally {
      if (updateCheckRef.current === controller) updateCheckRef.current = null;
    }
  }, []);

  const applyAvailableUpdate = useCallback(async () => {
    const latest = updateInfo;
    if (!latest?.available) {
      await checkForUpdates(true);
      return;
    }
    const apk = latest.assets.apk;
    if (window.JianyinAndroid?.downloadAndInstallUpdate) {
      if (!apk?.url || !apk.sha256) {
        setUpdateStatus(`发现 ${latest.tag}，但 APK 缺少 SHA-256 校验值`);
        return;
      }
      setUpdateStatus(`发现 ${latest.tag}，正在下载 APK`);
      window.JianyinAndroid.downloadAndInstallUpdate(apk.url, apk.name, apk.sha256, latest.tag);
      return;
    }
    if (!latest.canApply) {
      setUpdateStatus(`发现 ${latest.tag}，请重启启动器完成更新`);
      return;
    }
    try {
      setUpdateStatus(`发现 ${latest.tag}，正在更新桌面服务`);
      const result = await applyDesktopUpdate(latest.tag);
      if (result.updated) {
        setToast("桌面版正在更新，服务重启后会自动刷新");
        window.setTimeout(() => window.location.reload(), 1500);
        return;
      }
      setUpdateStatus(result.message || `发现 ${latest.tag}，请重启启动器完成更新`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "桌面版更新失败";
      setUpdateStatus(message);
      setToast(message);
    }
  }, [checkForUpdates, updateInfo]);

  useEffect(() => {
    if (!stateHydrated || !autoUpdateEnabled) return;
    void checkForUpdates();
    const timer = window.setInterval(() => void checkForUpdates(), UPDATE_CHECK_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
      updateCheckRef.current?.abort();
    };
  }, [autoUpdateEnabled, checkForUpdates, stateHydrated]);

  const prewarmRemoteSongs = useCallback((songs: Song[], limit = 4) => {
    const currentKey = currentSong ? songKey(currentSong) : "";
    const targets = songs
      .map(withDownloadedCache)
      .filter((song) => !song.localKey && songKey(song) !== currentKey);
    if (!targets.length) return;
    void prewarmFlacSongs(targets, limit, (original, resolved) => {
      const originalKey = songKey(original);
      const replaceResolved = (item: Song) => songKey(item) === originalKey ? preserveDownloadedCache(item, resolved) : item;
      setRemoteResults((items) => items.map(replaceResolved));
      setQueue((items) => {
        const activeSong = audioAttemptRef.current?.song ?? items[queueIndexRef.current];
        const activeKey = activeSong ? songKey(activeSong) : "";
        return items.map((item) => songKey(item) === originalKey && originalKey !== activeKey ? replaceResolved(item) : item);
      });
      setHistory((items) => items.map(replaceResolved));
      setDownloadHistory((items) => items.map(replaceResolved));
      setFavorites((items) => items.map(replaceResolved));
      setPlaylists((items) => items.map((playlist) => ({ ...playlist, songs: playlist.songs.map(replaceResolved) })));
      setPreviewPlaylist((playlist) => playlist ? { ...playlist, songs: playlist.songs.map(replaceResolved) } : playlist);
      setHomeData((data) => ({
        ...data,
        recommendedPlaylists: data.recommendedPlaylists.map((playlist) => ({
          ...playlist,
          songs: playlist.songs.map(replaceResolved)
        }))
      }));
    });
  }, [currentSong, withDownloadedCache]);

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  useEffect(() => {
    queueIndexRef.current = queueIndex;
  }, [queueIndex]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    positionRef.current = position;
  }, [position]);

  useEffect(() => {
    if (!searchResults.length) return;
    prewarmRemoteSongs(searchResults, 4);
  }, [prewarmRemoteSongs, searchResults]);

  useEffect(() => {
    if (!activePlaylist?.songs.length) return;
    prewarmRemoteSongs(activePlaylist.songs, 4);
  }, [activePlaylist, prewarmRemoteSongs]);

  useEffect(() => {
    if (!queue.length) return;
    if (queueIndex < 0) {
      prewarmRemoteSongs(queue.slice(0, 2), 2);
      return;
    }
    const previous = queue[(queueIndex - 1 + queue.length) % queue.length];
    const next = queue[(queueIndex + 1) % queue.length];
    prewarmRemoteSongs([next, previous], 2);
  }, [prewarmRemoteSongs, queue, queueIndex]);

  useEffect(() => {
    try {
      // 未 hydration 前状态是中间态（持久化恢复尚未完成），推送会把
      // 错误的 present/playing 发给 Android 侧；恢复完成后本 effect 会
      // 随 stateHydrated 变化再次触发并推送正确状态。
      // 首次推送也不得为 present=false（初始空态推 STOP 会停掉
      // 正在启动的前台服务 → ForegroundServiceDidNotStartInTimeException）。
      const last = androidPlaybackPushRef.current;
      if (!stateHydrated || (!currentSong && last.lastPushAt === 0)) return;
      const key = currentSong ? songKey(currentSong) : "";
      const now = Date.now();
      const songChanged = key !== last.key;
      const stateChanged = playing !== last.playing;
      const durationChanged = Math.abs(duration - last.duration) >= 1;
      const statusNotificationChanged = androidStatusNotificationEnabled !== last.statusNotificationEnabled;
      const positionChangedEnough = Math.abs(position - last.lastPosition) >= 15;
      const enoughTimeElapsed = now - last.lastPushAt >= 15000;
      if (!songChanged && !stateChanged && !durationChanged && !statusNotificationChanged && (!positionChangedEnough || !enoughTimeElapsed)) {
        return;
      }
      androidPlaybackPushRef.current = { key, playing, duration, statusNotificationEnabled: androidStatusNotificationEnabled, lastPosition: position, lastPushAt: now };
      if (window.JianyinAndroid?.setPlaybackDetailsV2) {
        window.JianyinAndroid.setPlaybackDetailsV2(Boolean(currentSong), playing, currentSong?.name ?? "", currentSong?.artist ?? "", position, duration, androidStatusNotificationEnabled);
      } else if (window.JianyinAndroid?.setPlaybackDetails) {
        window.JianyinAndroid.setPlaybackDetails(Boolean(currentSong), playing, currentSong?.name ?? "", currentSong?.artist ?? "", position, duration);
      } else if (window.JianyinAndroid?.setPlaybackInfo) {
        window.JianyinAndroid.setPlaybackInfo(Boolean(currentSong), playing, currentSong?.name ?? "", currentSong?.artist ?? "");
      } else {
        window.JianyinAndroid?.setPlaybackState?.(playing && Boolean(currentSong), currentSong?.name ?? "", currentSong?.artist ?? "");
      }
    } catch {
      // Android bridge is only available inside the packaged app.
    }
  }, [androidStatusNotificationEnabled, currentSong, duration, playing, position, stateHydrated]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    const projected = toSharedState({
      playlists,
      favorites,
      sharedRevision: sharedRevisionRef.current,
      sharedTombstones: sharedTombstonesRef.current,
      updatedAt: lastStateUpdatedAtRef.current || undefined
    });
    const tombstones = deriveSharedTombstones(sharedProjectionRef.current, projected, sharedTombstonesRef.current);
    const tombstoneClears = deriveSharedTombstoneClears(
      sharedTombstoneClearsRef.current,
      sharedProjectionRef.current.tombstones,
      tombstones
    );
    const sharedCandidate = { ...projected, tombstones };
    const signature = sharedStateSignature(sharedCandidate);
    const sharedDataChanged = signature !== sharedStateSignatureRef.current;
    if (sharedDataChanged) {
      const updatedAt = Math.max(Date.now(), lastStateUpdatedAtRef.current + 1);
      lastStateUpdatedAtRef.current = updatedAt;
      sharedStateSignatureRef.current = signature;
      sharedTombstonesRef.current = tombstones;
      sharedTombstoneClearsRef.current = tombstoneClears;
      sharedProjectionRef.current = sharedCandidate;
      latestSharedStateRef.current = {
        state: { ...sharedCandidate, updatedAt },
        baseRevision: sharedRevisionRef.current,
        writeId: createSharedWriteId(),
        tombstoneClears
      };
      sharedStateDirtyRef.current = true;
      lastLifecycleFlushVersionRef.current = null;
    }
    const state: PersistedState = {
      playlists,
      favorites,
      history,
      downloadHistory,
      queue: keepQueueOnExit ? queue : [],
      queueIndex: keepQueueOnExit ? queueIndex : -1,
      searchHistory,
      theme,
      playQuality,
      downloadQuality,
      progressStyle,
      lyricSource,
      autoLyricsEnabled,
      playbackSpeed,
      fadeEnabled,
      eqPreset,
      eqIntensity,
      autoCacheEnabled,
      keepQueueOnExit,
      autoPlayOnStart,
      autoUpdateEnabled,
      androidStatusNotificationEnabled,
      sharedSyncPending: sharedStateDirtyRef.current,
      sharedRevision: sharedRevisionRef.current,
      sharedTombstones: sharedTombstonesRef.current,
      sharedTombstoneClears: sharedTombstoneClearsRef.current,
      updatedAt: lastStateUpdatedAtRef.current || undefined
    };
    try {
      saveState(state);
      latestPersistedStateRef.current = state;
      persistedStateVersionRef.current += 1;
    } catch {
      setToast("浏览器存储空间不足，本次修改可能不会保存");
      return;
    }
    if (sharedDataChanged && sharedRemoteKnownRef.current && latestSharedStateRef.current) {
      sharedStateWriterRef.current!.enqueue(latestSharedStateRef.current);
    }
  }, [androidStatusNotificationEnabled, autoCacheEnabled, autoLyricsEnabled, autoPlayOnStart, autoUpdateEnabled, downloadHistory, downloadQuality, eqIntensity, eqPreset, fadeEnabled, favorites, history, keepQueueOnExit, lyricSource, playQuality, playbackSpeed, playlists, progressStyle, queue, queueIndex, searchHistory, stateHydrated, theme]);

  useEffect(() => {
    setAudioEffects(eqPreset, eqIntensity);
    setDebugHook(true);
    // 播放中切换预设/强度时，若图尚未建立（如非手势启动的自动播放），
    // 在可安全运行的情况下补接线；ensureAudioEffects 自带手势门控，无法运行则保持直通。
    if (eqPreset !== "none") {
      const audio = audioRef.current;
      if (audio && !audio.paused) ensureAudioEffects(audio);
    }
  }, [eqIntensity, eqPreset]);

  // EQ 切换必须在用户手势内同步接线：change 事件处理栈内 navigator.userActivation
  // 仍为激活态，此时 new AudioContext() 才会以 running 创建；若在 useEffect 里
  // 接线，浏览器按自动播放策略以 suspended 创建，createMediaElementSource 接管
  // 元素后时钟冻结、声音卡死（原声 none 不接线所以正常）。
  const handleEqPresetChange = (preset: AudioEffectsPreset) => {
    setEqPreset(preset);
    setAudioEffects(preset, eqIntensity);
    if (preset !== "none") {
      const audio = audioRef.current;
      if (audio && !audio.paused) ensureAudioEffects(audio);
    }
  };
  const handleEqIntensityChange = (intensity: number) => {
    setEqIntensity(intensity);
    setAudioEffects(eqPreset, intensity);
    if (eqPreset !== "none") {
      const audio = audioRef.current;
      if (audio && !audio.paused) ensureAudioEffects(audio);
    }
  };

  useEffect(() => {
    const retryLatestSharedState = (keepalive: boolean) => {
      if (!sharedRemoteKnownRef.current) {
        if (!keepalive) retrySharedStateLoadRef.current();
        return;
      }
      const latest = latestSharedStateRef.current;
      if (!sharedStateReadyRef.current || !sharedStateDirtyRef.current || !latest) return;
      if (!keepalive) {
        lastLifecycleFlushVersionRef.current = null;
        sharedStateWriterRef.current!.enqueue(latest);
        return;
      }
      const version = latest.state.updatedAt ?? 0;
      if (lastLifecycleFlushVersionRef.current === version) return;
      lastLifecycleFlushVersionRef.current = version;
      sharedStateWriterRef.current!.flush(latest);
    };
    const handleVisibilityChange = () => {
      retryLatestSharedState(document.visibilityState === "hidden");
    };
    const handlePageHide = () => retryLatestSharedState(true);
    const handleOnline = () => retryLatestSharedState(false);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("online", handleOnline);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("online", handleOnline);
    };
  }, []);

  useEffect(() => {
    let live = true;
    let loadInFlight = false;
    const emptySharedState = toSharedState(normalizeState(null));
    const mergeForHydration = (localState: PersistedState, shared: SharedState | null) => {
      if (!shared) return localState;
      const remoteState = {
        ...shared,
        tombstones: applySharedTombstoneClears(shared.tombstones, localState.sharedTombstoneClears)
      };
      const remoteIsCompleteEnough = shouldMergeSharedState(localState, remoteState);
      const localUpdatedAt = localState.updatedAt ?? 0;
      const remoteUpdatedAt = remoteState.updatedAt ?? 0;
      if (!localState.sharedSyncPending && localUpdatedAt > 0 && remoteUpdatedAt >= localUpdatedAt && remoteIsCompleteEnough) {
        return replaceSharedState(localState, remoteState);
      }
      return mergeSharedState(localState, remoteState);
    };
    const revokeHydrationUrls = (urls: string[]) => urls.forEach((url) => URL.revokeObjectURL(url));
    const hydrateLatestState = async (shared: SharedState | null) => {
      while (live) {
        const version = persistedStateVersionRef.current;
        const merged = mergeForHydration(latestPersistedStateRef.current, shared);
        const result = await hydrateLocalSongs(merged);
        if (!live) {
          revokeHydrationUrls(result.urls);
          return null;
        }
        if (version === persistedStateVersionRef.current) return result;
        revokeHydrationUrls(result.urls);
      }
      return null;
    };
    const loadAndHydrateSharedState = () => {
      if (!live || loadInFlight) return;
      loadInFlight = true;
      void loadSharedState()
        .then(async (shared) => {
          const baseline = shared ?? emptySharedState;
          return { baseline, result: await hydrateLatestState(shared) };
        })
        .then(({ baseline, result }) => {
          if (!live || !result) {
            if (result) revokeHydrationUrls(result.urls);
            return;
          }
          const projected = toSharedState(result.state);
          const tombstoneClears = result.state.sharedTombstoneClears ?? { playlistIds: [], favorites: [], playlistSongs: {} };
          const needsInitialSync = sharedStateSignature(projected) !== sharedStateSignature(baseline);
          sharedRevisionRef.current = baseline.revision;
          sharedTombstonesRef.current = projected.tombstones;
          sharedTombstoneClearsRef.current = tombstoneClears;
          sharedRemoteKnownRef.current = true;
          sharedStateDirtyRef.current = Boolean(result.state.sharedSyncPending || needsInitialSync);
          lastStateUpdatedAtRef.current = Math.max(lastStateUpdatedAtRef.current, result.state.updatedAt ?? 0);
          if (sharedStateDirtyRef.current) {
            lastStateUpdatedAtRef.current = Math.max(Date.now(), lastStateUpdatedAtRef.current + 1, baseline.updatedAt ?? 0);
          }
          const hydratedState: PersistedState = {
            ...result.state,
            sharedSyncPending: sharedStateDirtyRef.current,
            sharedRevision: baseline.revision,
            sharedTombstones: projected.tombstones,
            sharedTombstoneClears: tombstoneClears,
            updatedAt: lastStateUpdatedAtRef.current || undefined
          };
          const candidate = { ...toSharedState(hydratedState), updatedAt: hydratedState.updatedAt };
          sharedProjectionRef.current = candidate;
          sharedStateSignatureRef.current = sharedStateSignature(candidate);
          latestSharedStateRef.current = sharedStateDirtyRef.current ? {
            state: candidate,
            baseRevision: baseline.revision,
            writeId: createSharedWriteId(),
            tombstoneClears
          } : null;
          setPlaylists(result.state.playlists);
          setFavorites(result.state.favorites);
          setHistory(result.state.history);
          setDownloadHistory(result.state.downloadHistory);
          if (!userStartedPlaybackRef.current) {
            setQueue(result.state.queue);
            setQueueIndex(result.state.queueIndex);
          }
          setSearchHistory(result.state.searchHistory);
          setTheme(result.state.theme);
          setPlayQuality(result.state.playQuality);
          setDownloadQuality(result.state.downloadQuality);
          setProgressStyle(result.state.progressStyle);
          setLyricSource(result.state.lyricSource);
          setAutoLyricsEnabled(result.state.autoLyricsEnabled);
          setPlaybackSpeed(result.state.playbackSpeed);
          setFadeEnabled(result.state.fadeEnabled);
          // EQ 为本地设置（共享状态不含设置字段，服务端返回的全是默认值，
          // 覆盖会把用户选择重置回 hiFi；其他设置字段保持既有行为）
          setAutoCacheEnabled(result.state.autoCacheEnabled);
          setKeepQueueOnExit(result.state.keepQueueOnExit);
          setAutoPlayOnStart(result.state.autoPlayOnStart);
          setAutoUpdateEnabled(result.state.autoUpdateEnabled);
          setAndroidStatusNotificationEnabled(result.state.androidStatusNotificationEnabled);
          replaceObjectUrls(result.urls);
          saveState(hydratedState);
          latestPersistedStateRef.current = hydratedState;
          sharedStateReadyRef.current = true;
          setStateHydrated(true);
          if (sharedStateDirtyRef.current && latestSharedStateRef.current) {
            sharedStateWriterRef.current!.enqueue(latestSharedStateRef.current);
          }
        })
        .catch(() => {
          if (live) {
            const localState = latestPersistedStateRef.current;
            const localSharedState = toSharedState(localState);
            sharedStateSignatureRef.current = sharedStateSignature(localSharedState);
            sharedProjectionRef.current = localSharedState;
            sharedRevisionRef.current = localState.sharedRevision ?? 0;
            sharedTombstonesRef.current = localSharedState.tombstones;
            sharedTombstoneClearsRef.current = localState.sharedTombstoneClears ?? { playlistIds: [], favorites: [], playlistSongs: {} };
            sharedRemoteKnownRef.current = false;
            sharedStateDirtyRef.current = Boolean(localState.sharedSyncPending);
            latestSharedStateRef.current = sharedStateDirtyRef.current ? {
              state: localSharedState,
              baseRevision: localState.sharedRevision ?? 0,
              writeId: createSharedWriteId(),
              tombstoneClears: sharedTombstoneClearsRef.current
            } : null;
            sharedStateReadyRef.current = true;
            setStateHydrated(true);
          }
        })
        .finally(() => {
          loadInFlight = false;
        });
    };
    retrySharedStateLoadRef.current = loadAndHydrateSharedState;
    loadAndHydrateSharedState();
    return () => {
      live = false;
      if (retrySharedStateLoadRef.current === loadAndHydrateSharedState) retrySharedStateLoadRef.current = () => {};
    };
  }, [replaceObjectUrls]);

  useEffect(() => () => {
    objectUrlsRef.current.forEach(URL.revokeObjectURL);
    objectUrlsRef.current.clear();
    hydratedObjectUrlsRef.current.clear();
  }, []);

  const refreshHome = useCallback(async (refresh = 0) => {
    const requestId = homeRequestRef.current.id + 1;
    homeRequestRef.current.controller?.abort();
    const controller = new AbortController();
    homeRequestRef.current = { id: requestId, controller };
    setHomeLoading(true);
    setHomeError("");
    try {
      const data = await fetchNeteaseHome(playQuality, refresh, { signal: controller.signal });
      if (homeRequestRef.current.id !== requestId) return;
      setHomeData({
        radarSongs: data.radarSongs,
        hotSongs: data.hotSongs,
        recommendedPlaylists: data.recommendedPlaylists
      });
      setProxyOnline(true);
    } catch (error) {
      if (controller.signal.aborted || homeRequestRef.current.id !== requestId) return;
      setHomeError(error instanceof Error ? error.message : "首页推荐加载失败");
      setProxyOnline(false);
      setHomeData({
        radarSongs: [],
        hotSongs: [],
        recommendedPlaylists: []
      });
    } finally {
      if (homeRequestRef.current.id === requestId) {
        homeRequestRef.current.controller = null;
        setHomeLoading(false);
      }
    }
  }, [playQuality]);

  useEffect(() => () => homeRequestRef.current.controller?.abort(), []);

  useEffect(() => {
    void refreshHome(0);
  }, [refreshHome]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    void checkProxy().then(setProxyOnline);
    void getNeteaseAccountStatus().then(setNeteaseAccount).catch(() => setNeteaseAccount({ loggedIn: false }));
    void getBiliAccountStatus().then(setBiliAccount).catch(() => setBiliAccount({ loggedIn: false }));
  }, []);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = playbackSpeed;
  }, [playbackSpeed]);

  useEffect(() => {
    if (!sleepTimerUntil) return;
    const delay = sleepTimerUntil - Date.now();
    if (delay <= 0) {
      audioRef.current?.pause();
      cancelPendingPlayback();
      setPlaying(false);
      setSleepTimerUntil(null);
      setToast("定时关闭已执行");
      return;
    }
    const timer = window.setTimeout(() => {
      audioRef.current?.pause();
      cancelPendingPlayback();
      setPlaying(false);
      setSleepTimerUntil(null);
      setToast("定时关闭已执行");
    }, delay);
    return () => window.clearTimeout(timer);
  }, [cancelPendingPlayback, sleepTimerUntil]);

  useEffect(() => {
    if (!("mediaSession" in navigator) || !currentSong) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentSong.name,
      artist: currentSong.artist,
      artwork: currentSong.cover ? [{ src: currentSong.cover, sizes: "512x512", type: "image/png" }] : []
    });
    navigator.mediaSession.playbackState = playing ? "playing" : "paused";
  }, [currentSong, playing]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentSong) return;
    if (currentSong.localKey && !currentSong.url.startsWith("blob:")) {
      if (!playing) audio.pause();
      return;
    }
    const targetSrc = currentSong.url ? new URL(currentSong.url, window.location.href).href : "";
    if (targetSrc && audio.src !== targetSrc) {
      audio.src = currentSong.url;
      positionRef.current = 0;
      setPosition(0);
      setDuration(0);
    }
    if (playing && currentSong.url) {
      const expectedSrc = targetSrc;
      audio.play().catch(() => {
        if (expectedSrc && audio.src !== expectedSrc) return;
        setPlaying(false);
        setToast("浏览器阻止了自动播放，请再次点击播放");
      });
    } else {
      audio.pause();
    }
  }, [currentSong, playing]);

  const resolvePlayable = useCallback(async (song: Song, options: { refresh?: boolean; fallbackToMp3?: boolean } = {}): Promise<Song> => {
    const preferred = withDownloadedCache(song);
    if (preferred.localKey) {
      if (!options.refresh && preferred.url.startsWith("blob:")) return preferred;
      const blob = await loadLocalFile(preferred.localKey);
      if (!blob) throw new Error("本地文件不在当前浏览器，请重新导入");
      const url = trackObjectUrl(URL.createObjectURL(blob));
      return { ...preferred, url, needsImport: false, name: preferred.name.replace(/（需重新导入）$/, "") };
    }
    if (!options.refresh && verifiedUrlMatchesQuality(preferred, playQuality)) return preferred;
    if (preferred.source === "netease") return resolveNeteaseSong(preferred, playQuality);
    if (preferred.source === "bili") return resolveBiliSong(preferred);
    if (preferred.source === "flac") return resolveFlacSong(preferred, { refresh: options.refresh ?? false, fallbackToMp3: options.fallbackToMp3 ?? false });
    if (preferred.url && !preferred.url.startsWith("local-file:")) return preferred;
    if (preferred.source === "local" && preferred.needsImport) throw new Error("本地文件不在当前浏览器，请重新导入");
    throw new Error("当前歌曲没有可播放链接");
  }, [playQuality, trackObjectUrl, withDownloadedCache]);

  const cancelAudioFade = useCallback((audio: HTMLAudioElement | null = audioRef.current) => {
    const active = audioFadeRef.current;
    if (active) {
      window.cancelAnimationFrame(active.frame);
      audioFadeRef.current = null;
      active.resolve();
    }
    if (audio) audio.volume = 1;
  }, []);

  const fadeAudioVolume = useCallback((audio: HTMLAudioElement, target: number) => {
    cancelAudioFade();
    const clampVolume = (value: number) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 1));
    const start = clampVolume(audio.volume);
    const safeTarget = clampVolume(target);
    if (Math.abs(start - safeTarget) < 0.01) {
      audio.volume = safeTarget;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      const startedAt = performance.now();
      const active = { frame: 0, resolve };
      const finish = () => {
        if (audioFadeRef.current === active) audioFadeRef.current = null;
        resolve();
      };
      const step = (now: number) => {
        if (audioFadeRef.current !== active) return;
        const progress = Math.min(1, (now - startedAt) / AUDIO_FADE_DURATION_MS);
        audio.volume = clampVolume(start + (safeTarget - start) * progress);
        if (progress >= 1) {
          finish();
          return;
        }
        active.frame = window.requestAnimationFrame(step);
      };
      audioFadeRef.current = active;
      active.frame = window.requestAnimationFrame(step);
    });
  }, [cancelAudioFade]);

  useEffect(() => () => cancelAudioFade(), [cancelAudioFade]);

  const playSong = useCallback(async (song: Song, source?: Song[], options: { quiet?: boolean; startAt?: number; refresh?: boolean; fallbackToMp3?: boolean } = {}) => {
    const requestId = playRequestRef.current + 1;
    playRequestRef.current = requestId;
    userStartedPlaybackRef.current = true;
    // 在首个 await 前同步接线 WebAudio 均衡图（常见路径都在用户手势内，
    // 保证 AudioContext 以 running 状态创建；非手势时内部自动延迟）。
    ensureAudioEffects(audioRef.current);
    const pauseGeneration = playbackPauseRef.current;
    let playbackAttempted = false;
    let sourceChanged = false;
    let previousAttempt: typeof audioAttemptRef.current = null;
    let previousAudioOwner = audioMutationOwnerRef.current;
    let previousPlayingIntent = playingRef.current;
    let previousAudio: { src: string; currentTime: number; paused: boolean; playbackRate: number; volume: number } | null = null;
    const restorePreviousPlayback = (forcePaused = false) => {
      cancelAudioFade();
      if (!playbackAttempted) return;
      playingRef.current = forcePaused ? false : previousPlayingIntent;
      audioAttemptRef.current = previousAttempt;
      audioMutationOwnerRef.current = previousAudioOwner;
      const audio = audioRef.current;
      if (!audio || !previousAudio || !sourceChanged) return;
      if (previousAudio.src) audio.src = previousAudio.src;
      else {
        audio.removeAttribute("src");
        audio.load();
      }
      audio.playbackRate = previousAudio.playbackRate;
      audio.volume = previousAudio.volume;
      try {
        audio.currentTime = previousAudio.currentTime;
      } catch {
        // The restored source will apply its saved position once metadata is available.
      }
      if (!forcePaused && !previousAudio.paused) {
        void audio.play().catch(() => {
          playingRef.current = false;
          setPlaying(false);
        });
      } else {
        audio.pause();
      }
    };
    try {
      const requested = withDownloadedCache(song);
      const resolved = await resolvePlayable(requested, { refresh: options.refresh, fallbackToMp3: options.fallbackToMp3 });
      if (requestId !== playRequestRef.current) return false;
      const playable = preserveDownloadedCache(requested, resolved);
      const originalKey = songKey(song);
      const playableKey = songKey(playable);
      const replaceResolved = (item: Song) => songKey(item) === originalKey ? preserveDownloadedCache(item, playable) : item;
      const nextQueue = playableSongs((source?.length ? source : [playable])
        .map(withDownloadedCache)
        .map((item) => songKey(item) === originalKey ? playable : item));
      const nextIndex = Math.max(0, nextQueue.findIndex((item) => songKey(item) === songKey(playable)));
      const audio = audioRef.current;
      const targetSrc = playable.url ? new URL(playable.url, window.location.href).href : "";
      const shouldFade = Boolean(fadeEnabled && audio && !audio.paused && targetSrc && (audio.currentSrc || audio.src) !== targetSrc);
      if (audio) {
        previousAudio = {
          src: audio.currentSrc || audio.src,
          currentTime: audio.currentTime,
          paused: audio.paused,
          playbackRate: audio.playbackRate,
          volume: audio.volume
        };
      }
      if (audio && shouldFade) {
        await fadeAudioVolume(audio, 0);
        if (requestId !== playRequestRef.current) {
          cancelAudioFade(audio);
          return false;
        }
      }
      previousAttempt = audioAttemptRef.current;
      previousAudioOwner = audioMutationOwnerRef.current;
      previousPlayingIntent = playingRef.current;
      playbackAttempted = true;
      playingRef.current = true;
      audioAttemptRef.current = { song: playable, source: nextQueue };
      audioMutationOwnerRef.current = requestId;
      const startAt = Math.max(0, options.startAt ?? 0);
      if (audio) {
        audio.volume = shouldFade ? 0 : 1;
        sourceChanged = Boolean(targetSrc && audio.src !== targetSrc);
        if (sourceChanged) audio.src = playable.url;
        audio.playbackRate = playbackSpeed;
        audio.currentTime = startAt;
        await audio.play();
      }
      if (requestId !== playRequestRef.current) {
        if (audioMutationOwnerRef.current === requestId) {
          restorePreviousPlayback(pauseGeneration !== playbackPauseRef.current);
        }
        return false;
      }
      setRemoteResults((items) => items.map(replaceResolved));
      setFavorites((items) => items.map(replaceResolved));
      setPlaylists((items) => items.map((playlist) => {
        const songs = playlist.songs.map(replaceResolved);
        return { ...playlist, songs, cover: coverAfterSongResolved(playlist, originalKey, playable.cover) };
      }));
      setPreviewPlaylist((playlist) => playlist ? {
        ...playlist,
        songs: playlist.songs.map(replaceResolved),
        cover: coverAfterSongResolved(playlist, originalKey, playable.cover)
      } : playlist);
      setHomeData((data) => ({
        ...data,
        recommendedPlaylists: data.recommendedPlaylists.map((playlist) => ({
          ...playlist,
          songs: playlist.songs.map(replaceResolved),
          cover: coverAfterSongResolved(playlist, originalKey, playable.cover)
        }))
      }));
      setQueue(nextQueue);
      setQueueIndex(nextIndex);
      setHistory((items) => [playable, ...items.filter((item) => {
        const key = songKey(item);
        return key !== originalKey && key !== playableKey;
      })].slice(0, RECENT_HISTORY_LIMIT));
      setPlaying(true);
      positionRef.current = startAt;
      setPosition(startAt);
      if (audio && shouldFade) void fadeAudioVolume(audio, 1);
      pausedPlaybackRef.current = null;
      return true;
    } catch (error) {
      if (requestId !== playRequestRef.current) {
        if (audioMutationOwnerRef.current === requestId) {
          restorePreviousPlayback(pauseGeneration !== playbackPauseRef.current);
        }
        return false;
      }
      restorePreviousPlayback();
      if (!options.quiet) {
        const details = error instanceof Error ? `${error.name} ${error.message}` : String(error);
        const message = /NotAllowedError|user did not interact|autoplay/i.test(details)
          ? "浏览器阻止了自动播放，请再次点击播放"
          : error instanceof Error ? error.message : "无法播放这首歌";
        setToast(message);
      }
      return false;
    }
  }, [cancelAudioFade, fadeAudioVolume, fadeEnabled, playbackSpeed, resolvePlayable, withDownloadedCache]);

  useEffect(() => {
    if (!stateHydrated || autoPlayCheckedRef.current || !autoPlayOnStart || !currentSong) return;
    autoPlayCheckedRef.current = true;
    void playSong(currentSong, queue);
  }, [autoPlayOnStart, currentSong, playSong, queue, stateHydrated]);

  const retryCurrentSongAfterAudioError = useCallback(async () => {
    if (playbackRefreshRef.current || !playingRef.current) return;
    const audio = audioRef.current;
    const attempt = audioAttemptRef.current;
    const queued = queueRef.current[queueIndexRef.current];
    const attempted = attempt?.song;
    const candidate = queued && attempted && songKey(queued) === songKey(attempted) ? queued : attempted ?? queued;
    const song = candidate ? withDownloadedCache(candidate) : null;
    if (!song || (!song.localKey && song.source !== "flac")) return;
    const resumeAt = Math.max(audio?.currentTime || 0, positionRef.current);
    const retryAt = Math.floor(resumeAt);
    const key = songKey(song);
    if (audioRetryRef.current?.key === key && Math.abs(audioRetryRef.current.at - retryAt) <= 1) return;
    audioRetryRef.current = { key, at: retryAt };
    const source = attempt?.source?.length ? attempt.source : queueRef.current;
    const localCache = Boolean(song.localKey);
    const fallbackToMp3 = !localCache && (song.audioType === "flac" || song.url.includes("format=flac"));
    playbackRefreshRef.current = true;
    try {
      const ok = await playSong(song, source, { quiet: true, startAt: resumeAt, refresh: true, fallbackToMp3 });
      const current = queueRef.current[queueIndexRef.current];
      if (!ok && current && songKey(current) === key) {
        audioRetryRef.current = null;
        playingRef.current = false;
        setPlaying(false);
        setToast(localCache ? "本地缓存读取失败，请重新下载" : "播放链接已过期，重新获取失败");
      }
    } finally {
      playbackRefreshRef.current = false;
    }
  }, [playSong, withDownloadedCache]);

  const shouldRefreshAfterLongPause = useCallback((song: Song) => {
    const paused = pausedPlaybackRef.current;
    const attempted = audioAttemptRef.current?.song;
    const resolvedInThisSession = attempted && songKey(attempted) === songKey(song);
    return Boolean(
      song.source === "flac" &&
      !song.localKey &&
      (
        !resolvedInThisSession ||
        (paused && paused.key === songKey(song) && Date.now() - paused.at >= FLAC_PAUSED_REFRESH_MS)
      )
    );
  }, []);

  const markPausedPlayback = useCallback(() => {
    const current = queueRef.current[queueIndexRef.current];
    const song = current ? withDownloadedCache(current) : null;
    pausedPlaybackRef.current = song?.source === "flac" && !song.localKey ? { key: songKey(song), at: Date.now() } : null;
  }, [withDownloadedCache]);

  const primePlaybackElement = useCallback((song: Song, startAt: number) => {
    const audio = audioRef.current;
    if (!audio || !song.url) return;
    ensureAudioEffects(audio);
    if (song.localKey && !song.url.startsWith("blob:")) return;
    const targetSrc = new URL(song.url, window.location.href).href;
    if (audio.src !== targetSrc) audio.src = song.url;
    if (startAt > 0) audio.currentTime = startAt;
    void audio.play().catch(() => {
      // Keep the user gesture attached to this element while a stale remote URL is refreshed.
    });
  }, []);

  const resumeCurrentSong = useCallback(() => {
    const items = queueRef.current;
    const current = items[queueIndexRef.current];
    if (!current) return;
    const preferred = withDownloadedCache(current);
    const audio = audioRef.current;
    const startAt = Math.max(audio?.currentTime || 0, positionRef.current);
    const refresh = shouldRefreshAfterLongPause(preferred);
    primePlaybackElement(preferred, startAt);
    pausedPlaybackRef.current = null;
    if (!refresh) {
      void playSong(preferred, items, { startAt });
      return;
    }
    playbackRefreshRef.current = true;
    void playSong(preferred, items, { refresh: true, startAt }).finally(() => {
      playbackRefreshRef.current = false;
    });
  }, [playSong, primePlaybackElement, shouldRefreshAfterLongPause, withDownloadedCache]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") markPausedPlayback();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [markPausedPlayback]);

  useEffect(() => {
    window.JianyinRecoverAudio = () => {
      void retryCurrentSongAfterAudioError();
    };
    return () => {
      delete window.JianyinRecoverAudio;
    };
  }, [retryCurrentSongAfterAudioError]);

  const playQueueIndex = useCallback((index: number) => {
    const items = queueRef.current;
    if (!items.length) return;
    const normalized = (index + items.length) % items.length;
    const target = items[normalized];
    if (target) void playSong(target, items);
  }, [playSong]);

  const playQueueIndexFromUserGesture = useCallback((index: number) => {
    const current = queueRef.current[queueIndexRef.current];
    if (current) primePlaybackElement(current, Math.max(audioRef.current?.currentTime || 0, positionRef.current));
    playQueueIndex(index);
  }, [playQueueIndex, primePlaybackElement]);

  const advanceQueue = useCallback(async (direction: -1 | 1, options: { quiet?: boolean } = {}) => {
    const items = queueRef.current;
    if (!items.length) return;
    const rawIndex = queueIndexRef.current;
    const currentIndex = rawIndex >= 0 && rawIndex < items.length ? rawIndex : direction > 0 ? -1 : 0;
    const indices = Array.from({ length: items.length }, (_, offset) => (currentIndex + direction * (offset + 1) + items.length) % items.length);
    const ordered = modeRef.current === "shuffle" ? [...indices].sort(() => Math.random() - 0.5) : indices;

    for (const index of ordered) {
      const target = items[index];
      if (target && await playSong(target, items, { quiet: true })) return;
    }

    setPlaying(false);
    if (!options.quiet) setToast("播放列表里的歌曲都无法播放");
  }, [playSong]);

  const nextSong = useCallback(() => {
    void advanceQueue(1);
  }, [advanceQueue]);

  const previousSong = useCallback(() => {
    void advanceQueue(-1);
  }, [advanceQueue]);

  const nextSongFromUserGesture = useCallback(() => {
    const current = queueRef.current[queueIndexRef.current];
    if (current) primePlaybackElement(current, Math.max(audioRef.current?.currentTime || 0, positionRef.current));
    nextSong();
  }, [nextSong, primePlaybackElement]);

  const previousSongFromUserGesture = useCallback(() => {
    const current = queueRef.current[queueIndexRef.current];
    if (current) primePlaybackElement(current, Math.max(audioRef.current?.currentTime || 0, positionRef.current));
    previousSong();
  }, [previousSong, primePlaybackElement]);

  const handleAudioEnded = useCallback(() => {
    if (modeRef.current === "repeat" && audioRef.current) {
      audioRef.current.currentTime = 0;
      void audioRef.current.play().catch(() => {
        setPlaying(false);
        setToast("无法继续播放当前歌曲");
      });
      return;
    }
    void advanceQueue(1, { quiet: true });
  }, [advanceQueue]);

  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    const setHandler = (action: MediaSessionAction, handler: MediaSessionActionHandler | null) => {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch {
        // Some browsers expose MediaSession but not every action.
      }
    };
    setHandler("play", () => {
      resumeCurrentSong();
    });
    setHandler("pause", () => {
      audioRef.current?.pause();
      cancelPendingPlayback();
      setPlaying(false);
    });
    setHandler("previoustrack", () => playQueueIndex(queueIndex - 1));
    setHandler("nexttrack", () => nextSong());
    setHandler("seekto", (details) => {
      if (typeof details.seekTime === "number" && audioRef.current) {
        audioRef.current.currentTime = details.seekTime;
        positionRef.current = details.seekTime;
        setPosition(details.seekTime);
      }
    });
  }, [cancelPendingPlayback, nextSong, playQueueIndex, queueIndex, resumeCurrentSong]);

  const togglePlayback = useCallback(() => {
    if (!queueRef.current[queueIndexRef.current]) return;
    const audioPlaying = audioRef.current ? !audioRef.current.paused : false;
    if (audioPlaying) {
      audioRef.current?.pause();
      cancelPendingPlayback();
      setPlaying(false);
      return;
    }
    resumeCurrentSong();
  }, [cancelPendingPlayback, resumeCurrentSong]);

  useEffect(() => {
    window.JianyinAndroidMedia = (command) => {
      if (command === "previous") {
        previousSong();
        return;
      }
      if (command === "next") {
        nextSong();
        return;
      }
      togglePlayback();
    };
    return () => {
      delete window.JianyinAndroidMedia;
    };
  }, [nextSong, previousSong, togglePlayback]);

  const toggleFavorite = useCallback((song: Song) => {
    const favoriteSong = isRemoteSong(song) ? { ...song, remotePlayable: true, needsImport: false } : song;
    setFavorites((items) => {
      const exists = items.some((item) => songKey(item) === songKey(favoriteSong));
      const next = exists ? items.filter((item) => songKey(item) !== songKey(favoriteSong)) : [favoriteSong, ...items];
      setPlaylists((playlists) => playlists.map((playlist) => playlist.id === FAVORITES_ID ? { ...playlist, songs: next, cover: next[0]?.cover ?? playlist.cover } : playlist));
      setToast(exists ? "已取消喜欢" : "已添加到我喜欢的音乐");
      return next;
    });
  }, []);

  const toggleSelectedSong = useCallback((song: Song) => {
    setSelected((items) => {
      const next = new Set(items);
      const key = songKey(song);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }, []);

  const addSongsToPlaylist = useCallback((playlistId: string, songs: Song[]) => {
    setPlaylists((items) => items.map((playlist) => {
      if (playlist.id !== playlistId) return playlist;
      const existing = new Set(playlist.songs.map(songKey));
      const additions = songs.filter((song) => !existing.has(songKey(song)));
      const nextSongs = [...additions, ...playlist.songs];
      setToast(`已添加 ${additions.length} 首到 ${playlist.name}`);
      return { ...playlist, songs: nextSongs, cover: nextSongs[0]?.cover ?? playlist.cover };
    }));
    setSelected(new Set());
  }, []);

  const addSongsToQueue = useCallback((songs: Song[]) => {
    const additions = playableSongs(songs);
    if (!additions.length) {
      setToast("没有可加入播放队列的歌曲");
      return;
    }
    setQueue((items) => uniqueSongs([...items, ...additions]));
    setToast(`已添加 ${additions.length} 首歌曲到播放队列`);
    setSelected(new Set());
  }, []);

  const updateSongEverywhere = useCallback((target: Song, updater: (song: Song) => Song, options: { preserveCurrentPlaybackSource?: boolean } = {}) => {
    const key = songKey(target);
    const update = (song: Song) => songKey(song) === key ? updater(song) : song;
    setQueue((items) => items.map((song, index) => {
      const updated = update(song);
      if (!options.preserveCurrentPlaybackSource || index !== queueIndexRef.current || songKey(song) !== key) return updated;
      return { ...updated, url: song.url };
    }));
    setHistory((items) => items.map(update));
    setDownloadHistory((items) => items.map(update));
    setFavorites((items) => items.map(update));
    setPlaylists((items) => items.map((playlist) => {
      const songs = playlist.songs.map(update);
      return { ...playlist, songs, cover: songKey(songs[0] ?? target) === key ? songs[0]?.cover ?? playlist.cover : playlist.cover };
    }));
    const attempt = audioAttemptRef.current;
    if (options.preserveCurrentPlaybackSource && attempt && songKey(attempt.song) === key) {
      const updateAttempt = (song: Song) => {
        if (songKey(song) !== key) return song;
        return { ...updater(song), url: song.url };
      };
      audioAttemptRef.current = {
        song: updateAttempt(attempt.song),
        source: attempt.source.map(updateAttempt)
      };
    }
  }, []);

  useEffect(() => {
    if (!autoLyricsEnabled || !currentSong || currentSong.source === "local") return;
    if (lyricSource === "embedded" && currentSong.lrc) return;
    const key = songKey(currentSong);
    const requestKey = `${key}:${lyricSource}`;
    if (lyricsAutoFetchRef.current.has(requestKey)) return;
    if (lyricsAutoFetchRef.current.size >= 256) lyricsAutoFetchRef.current.clear();
    lyricsAutoFetchRef.current.add(requestKey);
    let cancelled = false;
    setLyricsLoadingKey(key);
    void fetchLyricsForSong(currentSong)
      .then((lrc) => {
        if (cancelled || !lrc.trim()) return;
        updateSongEverywhere(currentSong, (song) => lyricSource === "network" ? { ...song, lrc } : song.lrc ? song : { ...song, lrc });
      })
      .catch(() => {
        // Lyrics are best-effort; playback should never be blocked by lyric lookup.
      })
      .finally(() => {
        if (!cancelled) setLyricsLoadingKey((value) => value === key ? "" : value);
      });
    return () => {
      cancelled = true;
    };
  }, [autoLyricsEnabled, currentSong, lyricSource, updateSongEverywhere]);

  const fetchLyricsForCurrentSong = useCallback(async (force = false) => {
    if (!currentSong) return;
    if (currentSong.source === "local") {
      setToast("本地音乐请导入 LRC 歌词文件");
      return;
    }
    if (currentSong.lrc && !force) {
      setToast("当前歌曲已有歌词");
      return;
    }
    const key = songKey(currentSong);
    setLyricsLoadingKey(key);
    setToast("正在获取歌词...");
    try {
      const lrc = await fetchLyricsForSong(currentSong);
      if (!lrc.trim()) {
        setToast("没有找到歌词");
        return;
      }
      updateSongEverywhere(currentSong, (song) => ({ ...song, lrc }));
      setToast("歌词已更新");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "歌词获取失败");
    } finally {
      setLyricsLoadingKey((value) => value === key ? "" : value);
    }
  }, [currentSong, updateSongEverywhere]);

  const cacheDownloadedSong = useCallback(async (original: Song, target: Song) => {
    if (target.localKey || !isRemoteSong(target) || !target.url || target.url.startsWith("local-file:")) return target;
    const key = downloadSongKey(original);
    const existing = cacheInFlightRef.current.get(key);
    if (existing) return existing;
    const task = (async () => {
      try {
        const response = await fetch(target.url);
        if (!response.ok) throw new Error("download cache failed");
        const blob = await response.blob();
        const localKey = `download_${target.source}_${target.id}`.replace(/[^a-zA-Z0-9_.-]/g, "_");
        await saveLocalFile(localKey, blob);
        const localUrl = trackObjectUrl(URL.createObjectURL(blob));
        const cached: Song = {
          ...target,
          localKey,
          url: localUrl,
          needsImport: false,
          remotePlayable: true
        };
        updateSongEverywhere(original, () => cached, { preserveCurrentPlaybackSource: true });
        return cached;
      } catch {
        return target;
      }
    })();
    cacheInFlightRef.current.set(key, task);
    try {
      return await task;
    } finally {
      if (cacheInFlightRef.current.get(key) === task) cacheInFlightRef.current.delete(key);
    }
  }, [trackObjectUrl, updateSongEverywhere]);

  useEffect(() => {
    if (!autoCacheEnabled || !playing || !currentSong || !isRemoteSong(currentSong) || currentSong.localKey || !currentSong.url || currentSong.url.startsWith("local-file:")) return;
    void cacheDownloadedSong(currentSong, currentSong).then((cached) => {
      if (cached.localKey) setDownloadHistory((items) => recentSongsWith(cached, items));
    });
  }, [autoCacheEnabled, cacheDownloadedSong, currentSong, playing]);

  const importLrcForCurrentSong = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !currentSong) return;
    const reader = new FileReader();
    reader.onload = () => {
      const lrc = String(reader.result ?? "");
      updateSongEverywhere(currentSong, (song) => ({ ...song, lrc }));
      setToast("已应用本地 LRC 歌词");
    };
    reader.onerror = () => setToast("LRC 文件读取失败");
    reader.readAsText(file);
  }, [currentSong, updateSongEverywhere]);

  const importCoverForCurrentSong = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !currentSong) return;
    if (!file.type.startsWith("image/")) {
      setToast("请选择图片文件");
      return;
    }
    const coverKey = `cover_${songKey(currentSong)}_${file.lastModified}_${file.size}`;
    await saveLocalFile(coverKey, file);
    const coverUrl = trackObjectUrl(URL.createObjectURL(file));
    updateSongEverywhere(currentSong, (song) => ({ ...song, cover: coverUrl, coverKey }));
    setToast("已应用本地封面");
  }, [currentSong, trackObjectUrl, updateSongEverywhere]);

  const moveQueueItem = useCallback((index: number, direction: -1 | 1) => {
    const items = queueRef.current;
    const toIndex = index + direction;
    if (index < 0 || index >= items.length || toIndex < 0 || toIndex >= items.length) return;
    const next = [...items];
    const [item] = next.splice(index, 1);
    next.splice(toIndex, 0, item);
    const current = queueIndexRef.current;
    const nextQueueIndex =
      current === index ? toIndex
        : index < current && toIndex >= current ? current - 1
          : index > current && toIndex <= current ? current + 1
            : current;
    setQueue(next);
    setQueueIndex(nextQueueIndex);
  }, []);

  const deleteDownloadedSongs = useCallback(async (songs: Song[]) => {
    const targets = songs;
    if (!targets.length) {
      setToast("没有可删除的下载歌曲");
      return;
    }
    const label = targets.length === 1 ? `“${targets[0].name}”` : `${targets.length} 首歌曲`;
    if (!window.confirm(`确认删除下载的 ${label}？本地缓存文件会被移除。`)) return;
    const keys = new Set(targets.map(downloadCacheKey).filter((key): key is string => Boolean(key)));
    const targetSongKeys = new Set(targets.map(songKey));
    try {
      await Promise.all([...keys].map((key) => deleteLocalFile(key)));
    } catch {
      setToast("本地缓存删除失败，请重试");
      return;
    }
    const isDeletedDownload = (song: Song) => {
      const key = downloadCacheKey(song);
      return Boolean(key && keys.has(key)) || targetSongKeys.has(songKey(song));
    };
    const replaceDeleted = (song: Song) => {
      const key = downloadCacheKey(song);
      return key && keys.has(key) ? remoteCopyAfterDownloadDeleted(song) : song;
    };
    setDownloadHistory((items) => items.filter((song) => !isDeletedDownload(song)));
    setHistory((items) => items.map(replaceDeleted));
    setFavorites((items) => items.map(replaceDeleted));
    setRemoteResults((items) => items.map(replaceDeleted));
    setPlaylists((items) => items.map((playlist) => {
      const nextSongs = playlist.songs.map(replaceDeleted);
      return { ...playlist, songs: nextSongs, cover: nextSongs[0]?.cover ?? playlist.cover };
    }));
    setPreviewPlaylist((playlist) => {
      if (!playlist) return playlist;
      if (playlist.id === "download_history_preview") {
        const nextSongs = playlist.songs.filter((song) => !isDeletedDownload(song));
        return { ...playlist, songs: nextSongs, cover: nextSongs[0]?.cover ?? playlist.cover, trackCount: nextSongs.length };
      }
      return { ...playlist, songs: playlist.songs.map(replaceDeleted) };
    });
    setQueue((items) => {
      const currentQueueSong = queueRef.current[queueIndexRef.current];
      const currentQueueSongKey = currentQueueSong ? songKey(currentQueueSong) : "";
      const currentLocalKey = currentQueueSong ? downloadCacheKey(currentQueueSong) : "";
      const next = items.filter((song) => {
        const key = downloadCacheKey(song);
        return !key || !keys.has(key);
      });
      setQueueIndex((index) => {
        if (!next.length) return -1;
        const currentNextIndex = currentQueueSongKey ? next.findIndex((song) => songKey(song) === currentQueueSongKey) : -1;
        return currentNextIndex >= 0 ? currentNextIndex : Math.min(Math.max(0, index), next.length - 1);
      });
      if (currentLocalKey && keys.has(currentLocalKey)) {
        audioRef.current?.pause();
        setPlaying(false);
      }
      return next;
    });
    setSelected((items) => {
      const next = new Set(items);
      targets.forEach((song) => next.delete(songKey(song)));
      return next;
    });
    setToast(`已删除 ${targets.length} 首下载歌曲`);
  }, []);

  const importAndOpenNeteasePlaylist = useCallback(async (playlistId: string) => {
    setPlaylistOpeningId(playlistId);
    try {
      const playlist = await importNeteasePlaylist(playlistId.replace(/^netease_playlist_/, ""), playQuality);
      setPreviewPlaylist(playlist);
      setActivePlaylistId(playlist.id);
      prewarmRemoteSongs(playlist.songs, 4);
      setProxyOnline(true);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "歌单打开失败");
      setProxyOnline(false);
    } finally {
      setPlaylistOpeningId(null);
    }
  }, [playQuality, prewarmRemoteSongs]);

  const submitSearch = useCallback(async (value = query, page = 1) => {
    const text = value.trim();
    if (!text) return;
    const runId = searchRunRef.current + 1;
    searchRunRef.current = runId;
    setQuery(text);
    setSearchHistory((items) => [text, ...items.filter((item) => item !== text)].slice(0, 12));
    setSelected(new Set());
    setSearching(true);
    try {
      const result = await searchFlac(text, page);
      if (searchRunRef.current !== runId) return;
      setRemoteResults(result.songs);
      setSearchPageInfo({ page: result.page, pageSize: result.pageSize, total: result.total, hasMore: result.hasMore });
      setSearchOfflineResults(false);
      setProxyOnline(true);
    } catch {
      if (searchRunRef.current !== runId) return;
      const normalized = text.toLocaleLowerCase();
      const localMatches = allLibrarySongs(playlists, history).filter((song) => [song.name, song.artist].some((value) => value.toLocaleLowerCase().includes(normalized)));
      setRemoteResults(localMatches);
      setSearchPageInfo({ page: 1, pageSize: FLAC_SEARCH_PAGE_SIZE, total: localMatches.length, hasMore: false });
      setSearchOfflineResults(true);
      setProxyOnline(false);
      setToast(`在线搜索失败，当前显示本地曲库 ${localMatches.length} 首`);
    } finally {
      if (searchRunRef.current === runId) setSearching(false);
    }
  }, [history, playlists, query]);

  const importFiles = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []).filter((file) => file.type.startsWith("audio/"));
    if (!files.length) {
      setToast("请选择音频文件");
      return;
    }
    const songs = files.map(createLocalSong);
    songs.forEach((song) => trackObjectUrl(song.url));
    await Promise.all(songs.map((song, index) => saveLocalFile(song.localKey!, files[index])));
    const playlist: Playlist = {
      id: `local_${Date.now()}`,
      sharedId: createOpaqueSharedId("shared_playlist"),
      name: `本地歌单_${songs.length}首`,
      cover: songs[0]?.cover ?? cover(1),
      songs,
      source: "local"
    };
    setPlaylists((items) => [playlist, ...items]);
    setActivePlaylistId(playlist.id);
    setTab("mine");
    setToast(`已导入 ${songs.length} 首本地音乐`);
    event.target.value = "";
  }, [trackObjectUrl]);

  const backup = useCallback(async () => {
    const state: PersistedState = { playlists, favorites, history, downloadHistory, queue, queueIndex, searchHistory, theme, playQuality, downloadQuality, progressStyle, lyricSource, autoLyricsEnabled, playbackSpeed, fadeEnabled, eqPreset, eqIntensity, autoCacheEnabled, keepQueueOnExit, autoPlayOnStart, autoUpdateEnabled, androidStatusNotificationEnabled, updatedAt: Date.now() };
    const payload = await makeBackup(state);
    downloadJson(`jianyin_web_clean_${new Date().toISOString().replace(/[:.]/g, "-")}.json`, payload);
    setToast(payload.localFiles?.length ? `已导出备份，包含 ${payload.localFiles.length} 个本地音频` : "已导出备份");
  }, [androidStatusNotificationEnabled, autoCacheEnabled, autoLyricsEnabled, autoPlayOnStart, autoUpdateEnabled, downloadHistory, downloadQuality, eqIntensity, eqPreset, fadeEnabled, favorites, history, keepQueueOnExit, lyricSource, playQuality, playbackSpeed, playlists, progressStyle, queue, queueIndex, searchHistory, theme]);

  const applyHydratedRestore = useCallback((hydrated: { state: PersistedState; urls: string[] }) => {
    lastStateUpdatedAtRef.current = Math.max(lastStateUpdatedAtRef.current, hydrated.state.updatedAt ?? 0);
    setPlaylists(hydrated.state.playlists);
    setFavorites(hydrated.state.favorites);
    setHistory(hydrated.state.history);
    setDownloadHistory(hydrated.state.downloadHistory);
    setQueue(hydrated.state.queue);
    setQueueIndex(hydrated.state.queueIndex);
    setSearchHistory(hydrated.state.searchHistory);
    setTheme(hydrated.state.theme);
    setPlayQuality(hydrated.state.playQuality);
    setDownloadQuality(hydrated.state.downloadQuality);
    setProgressStyle(hydrated.state.progressStyle);
    setLyricSource(hydrated.state.lyricSource);
    setAutoLyricsEnabled(hydrated.state.autoLyricsEnabled);
    setPlaybackSpeed(hydrated.state.playbackSpeed);
    setFadeEnabled(hydrated.state.fadeEnabled);
    setEqPreset(hydrated.state.eqPreset);
    setEqIntensity(hydrated.state.eqIntensity);
    setAutoCacheEnabled(hydrated.state.autoCacheEnabled);
    setKeepQueueOnExit(hydrated.state.keepQueueOnExit);
    setAutoPlayOnStart(hydrated.state.autoPlayOnStart);
    setAutoUpdateEnabled(hydrated.state.autoUpdateEnabled);
    setAndroidStatusNotificationEnabled(hydrated.state.androidStatusNotificationEnabled);
    setActivePlaylistId(null);
    setPreviewPlaylist(null);
    setSelected(new Set());
    replaceObjectUrls(hydrated.urls);
  }, [replaceObjectUrls]);

  const restore = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    void file.text()
      .then((text) => validateBackup(JSON.parse(text)))
      .then((preview) => {
        setRestorePreview(preview);
        setToast("备份已校验，请选择恢复方式");
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : "备份文件无法解析";
        setToast(`备份文件无效：${message}`);
      });
  }, []);

  const applyBackupRestore = useCallback(async (mode: "merge" | "overwrite") => {
    if (!restorePreview || restoreBusy) return;
    setRestoreBusy(true);
    try {
      const restored = await restoreBackup(restorePreview);
      const localState: PersistedState = {
        playlists,
        favorites,
        history,
        downloadHistory,
        queue,
        queueIndex,
        searchHistory,
        theme,
        playQuality,
        downloadQuality,
        progressStyle,
        lyricSource,
        autoLyricsEnabled,
        playbackSpeed,
        fadeEnabled,
        eqPreset,
        eqIntensity,
        autoCacheEnabled,
        keepQueueOnExit,
        autoPlayOnStart,
        autoUpdateEnabled,
        androidStatusNotificationEnabled,
        updatedAt: Date.now()
      };
      const next = mode === "merge" ? mergeStates(localState, restored) : restored;
      const hydrated = await hydrateLocalSongs(next);
      applyHydratedRestore(hydrated);
      setRestorePreview(null);
      setToast(mode === "merge" ? "备份已合并恢复" : "备份已覆盖恢复");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "备份恢复失败");
    } finally {
      setRestoreBusy(false);
    }
  }, [androidStatusNotificationEnabled, applyHydratedRestore, autoCacheEnabled, autoLyricsEnabled, autoPlayOnStart, autoUpdateEnabled, downloadHistory, downloadQuality, eqIntensity, eqPreset, fadeEnabled, favorites, history, keepQueueOnExit, lyricSource, playbackSpeed, playlists, progressStyle, queue, queueIndex, restoreBusy, restorePreview, searchHistory, theme]);

  const resolveDownloadable = useCallback(async (song: Song) => {
    if (song.localKey) return resolvePlayable(song);
    if (song.source === "netease") return resolveNeteaseSong(song, downloadQuality);
    if (song.source === "flac") return resolveFlacSong(song);
    return resolvePlayable(song);
  }, [downloadQuality, resolvePlayable]);

  const downloadSong = useCallback(async (song: Song) => {
    try {
      const target = await resolveDownloadable(song);
      const cached = await cacheDownloadedSong(song, target);
      setDownloadHistory((items) => recentSongsWith(cached, items));
      const anchor = document.createElement("a");
      anchor.href = target.url;
      anchor.download = `${target.name}-${target.artist}`.replace(/[\\/:*?"<>|]/g, "_");
      anchor.target = "_blank";
      anchor.rel = "noopener";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setToast("已发起下载");
    } catch (error) {
      setToast(error instanceof Error ? error.message : "无法下载这首歌");
    }
  }, [cacheDownloadedSong, resolveDownloadable]);

  const downloadSongs = useCallback((songs: Song[]) => {
    if (!songs.length) {
      setToast("请先选择歌曲");
      return;
    }
    songs.forEach((song) => void downloadSong(song));
    setSelected(new Set());
  }, [downloadSong]);

  const importNetease = useCallback(async () => {
    setNeteaseBusy(true);
    setNeteaseError("");
    try {
      const playlist = await importNeteasePlaylist(neteaseInput, playQuality);
      setPlaylists((items) => [playlist, ...items.filter((item) => item.id !== playlist.id)]);
      setActivePlaylistId(playlist.id);
      setTab("mine");
      setNeteaseOpen(false);
      setNeteaseInput("");
      setProxyOnline(true);
      setToast(`已导入网易云歌单：${playlist.name}`);
    } catch (error) {
      setNeteaseError(error instanceof Error ? error.message : "导入失败");
      setProxyOnline(false);
    } finally {
      setNeteaseBusy(false);
    }
  }, [neteaseInput, playQuality]);

  const mergeSyncedPlaylists = useCallback((incoming: Playlist[]) => {
    if (!incoming.length) {
      setToast("没有同步到可完整播放的歌单");
      return;
    }
    setPlaylists((items) => [...incoming, ...items.filter((item) => !incoming.some((playlist) => playlist.id === item.id))]);
    setActivePlaylistId(incoming[0].id);
    setTab("mine");
    setToast(`已同步 ${incoming.length} 个歌单`);
  }, []);

  const loginAccount = useCallback(async () => {
    setAccountBusy(true);
    setAccountError("");
    try {
      if (accountProvider === "netease") {
        const status = await loginNeteaseCookie(accountCookie);
        setNeteaseAccount(status);
        const synced = await syncNeteaseAccountPlaylists(playQuality);
        mergeSyncedPlaylists(synced);
      } else {
        const status = await loginBiliCookie(accountCookie);
        setBiliAccount(status);
        const synced = await syncBiliAccountPlaylists();
        mergeSyncedPlaylists(synced);
      }
      setAccountOpen(false);
      setAccountCookie("");
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : "账号验证失败");
      setAccountCookie("");
    } finally {
      setAccountBusy(false);
    }
  }, [accountCookie, accountProvider, mergeSyncedPlaylists, playQuality]);

  const syncAccounts = useCallback(async (provider: "netease" | "bili") => {
    setAccountBusy(true);
    setAccountError("");
    try {
      const synced = provider === "netease" ? await syncNeteaseAccountPlaylists(playQuality) : await syncBiliAccountPlaylists();
      mergeSyncedPlaylists(synced);
      setAccountOpen(false);
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : "同步失败");
    } finally {
      setAccountBusy(false);
    }
  }, [mergeSyncedPlaylists, playQuality]);

  const logoutAccount = useCallback(async (provider: "netease" | "bili") => {
    setAccountBusy(true);
    setAccountError("");
    try {
      if (provider === "netease") {
        await logoutNeteaseCookie();
        setNeteaseAccount({ loggedIn: false });
      } else {
        await logoutBiliCookie();
        setBiliAccount({ loggedIn: false });
        setPlaylists((items) => items.filter((playlist) => playlist.source !== "bili"));
      }
      setToast("已退出账号");
    } catch (error) {
      setAccountError(error instanceof Error ? error.message : "退出失败");
    } finally {
      setAccountBusy(false);
    }
  }, []);

  useEffect(() => {
    window.JianyinAndroidBack = () => {
      if (playerOpen) {
        setPlayerOpen(false);
        return true;
      }
      if (floatingLyric) {
        setFloatingLyric(false);
        return true;
      }
      if (activePlaylist) {
        setActivePlaylistId(null);
        if (!activePlaylistSaved) setPreviewPlaylist(null);
        return true;
      }
      if (settingsOpen) {
        setSettingsOpen(false);
        return true;
      }
      if (createOpen) {
        setCreateOpen(false);
        return true;
      }
      if (neteaseOpen) {
        setNeteaseOpen(false);
        return true;
      }
      if (accountOpen) {
        setAccountOpen(false);
        return true;
      }
      if (tab !== "home") {
        setTab("home");
        return true;
      }
      return false;
    };
    return () => {
      delete window.JianyinAndroidBack;
    };
  }, [accountOpen, activePlaylist, activePlaylistSaved, createOpen, floatingLyric, neteaseOpen, playerOpen, settingsOpen, tab]);

  const releaseNotes = Array.isArray(updateInfo?.releaseNotes) ? updateInfo.releaseNotes : [];
  const shellClassName = [
    "app-shell",
    currentSong ? "has-mini-player" : "",
    tab === "search" && Boolean(query.trim()) && (searchResults.length > 0 || searchPageInfo.page > 1 || searchPageInfo.hasMore) ? "has-search-pagination" : ""
  ].filter(Boolean).join(" ");

  return (
    <div className={shellClassName}>
      <audio
        ref={audioRef}
        preload="metadata"
        onTimeUpdate={(event) => {
          positionRef.current = event.currentTarget.currentTime;
          audioRetryRef.current = null;
          setPosition(event.currentTarget.currentTime);
        }}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
        onEnded={handleAudioEnded}
        onPause={markPausedPlayback}
        onError={() => void retryCurrentSongAfterAudioError()}
      />
      <input ref={fileInputRef} hidden type="file" accept="audio/*" multiple onChange={importFiles} />
      <input ref={restoreInputRef} hidden type="file" accept="application/json,.json" onChange={restore} />
      <input ref={lrcInputRef} hidden type="file" accept=".lrc,text/plain" onChange={importLrcForCurrentSong} />
      <input ref={coverInputRef} hidden type="file" accept="image/*" onChange={importCoverForCurrentSong} />

      <aside className="rail">
        <button className="brand" onClick={() => setTab("home")} aria-label="打开首页">
          <img src="/assets/icon.png" alt="" />
          <span>既见</span>
        </button>
        <nav>
          <NavButton active={tab === "home"} icon={<Home />} label="首页" onClick={() => setTab("home")} />
          <NavButton active={tab === "search"} icon={<Search />} label="搜索" onClick={() => setTab("search")} />
          <NavButton active={tab === "mine"} icon={<Library />} label="我的" onClick={() => setTab("mine")} />
        </nav>
        <div className="boundary-note">
          <strong>Web Clean</strong>
          <span>网易云/Bili 账号 Cookie 只保存在本机服务内存；悬浮窗、蓝牙监听等 Android 系统能力用浏览器 MediaSession 和页面内歌词等价覆盖。</span>
        </div>
      </aside>

      <main className="workspace">
        <MobileTopNav tab={tab} setTab={setTab} />
        {tab === "home" && (
          <HomeScreen
            data={homeData}
            loading={homeLoading}
            openingPlaylistId={playlistOpeningId}
            error={homeError}
            onPlay={playSong}
            onOpenPlaylist={setActivePlaylistId}
            onOpenRemotePlaylist={(playlist) => void importAndOpenNeteasePlaylist(playlist.id)}
            onRefresh={() => setHomeRefreshIndex((value) => {
              const next = value + 1;
              void refreshHome(next);
              return next;
            })}
            proxyOnline={proxyOnline}
          />
        )}
        {tab === "search" && (
          <SearchScreen
            query={query}
            setQuery={setQuery}
            results={searchResults}
            history={searchHistory}
            searching={searching}
            searchPage={searchPageInfo.page}
            searchPageSize={searchPageInfo.pageSize}
            searchTotal={searchPageInfo.total}
            searchHasMore={searchPageInfo.hasMore}
            offlineResults={searchOfflineResults}
            proxyOnline={proxyOnline}
            playlists={playlists}
            selected={selected}
            favoriteKeys={favoriteKeys}
            onSearch={submitSearch}
            onPage={(page) => submitSearch(query, page)}
            onPlay={(song) => playSong(song, searchResults)}
            onFavorite={toggleFavorite}
            onSelect={toggleSelectedSong}
            onSelectAllVisible={() => setSelected((items) => {
              const next = new Set(items);
              searchResults.forEach((song) => next.add(songKey(song)));
              return next;
            })}
            onDeselectAllVisible={() => setSelected((items) => {
              const next = new Set(items);
              searchResults.forEach((song) => next.delete(songKey(song)));
              return next;
            })}
            onClearSelection={() => setSelected(new Set())}
            onAdd={(playlistId) => addSongsToPlaylist(playlistId, searchResults.filter((song) => selected.has(songKey(song))))}
            onAddToQueue={() => addSongsToQueue(searchResults.filter((song) => selected.has(songKey(song))))}
            onDownloadSelected={() => downloadSongs(searchResults.filter((song) => selected.has(songKey(song))))}
            onCreatePlaylistWithSelected={(name) => {
              const songs = searchResults.filter((song) => selected.has(songKey(song)));
              const playlist: Playlist = { id: `local_${Date.now()}`, sharedId: createOpaqueSharedId("shared_playlist"), name, cover: songs[0]?.cover ?? cover(3), songs, source: "local" };
              setPlaylists((items) => [playlist, ...items]);
              setSelected(new Set());
              setToast(`已创建歌单并添加 ${songs.length} 首歌曲`);
            }}
            onHistoryClear={() => setSearchHistory([])}
            onDownload={downloadSong}
          />
        )}
        {tab === "mine" && (
          <MineScreen
            playlists={playlists}
            history={history}
            downloadHistory={downloadHistory}
            onPlay={playSong}
            onDeleteDownload={(songs) => void deleteDownloadedSongs(songs)}
            onOpenPlaylist={setActivePlaylistId}
            onOpenHistory={() => {
              if (!history.length) return;
              const playlist: Playlist = { id: "recent_history_preview", name: "最近播放", cover: history[0]?.cover ?? cover(8), songs: history, source: "local", trackCount: history.length };
              setPreviewPlaylist(playlist);
              setActivePlaylistId(playlist.id);
            }}
            onOpenDownloads={() => {
              if (!downloadHistory.length) return;
              const playlist: Playlist = { id: "download_history_preview", name: "下载管理", cover: downloadHistory[0]?.cover ?? cover(6), songs: downloadHistory, source: "local", trackCount: downloadHistory.length };
              setPreviewPlaylist(playlist);
              setActivePlaylistId(playlist.id);
            }}
            onCreate={() => setCreateOpen(true)}
            onImportLocal={() => fileInputRef.current?.click()}
            onImportNetease={() => setNeteaseOpen(true)}
            onAccounts={() => setAccountOpen(true)}
            onBackup={backup}
            onRestore={() => restoreInputRef.current?.click()}
            onSettings={() => setSettingsOpen(true)}
            onDelete={(playlist) => {
              if (playlist.id === FAVORITES_ID) {
                setToast("我喜欢的音乐不能删除");
                return;
              }
              if (!window.confirm(`确认删除歌单“${playlist.name}”？`)) return;
              setPlaylists((items) => items.filter((item) => item.id !== playlist.id));
            }}
          />
        )}
      </main>

      <NowPlaying song={currentSong} playing={playing} position={position} duration={duration} onOpen={() => setPlayerOpen(true)} onToggle={togglePlayback} onNext={nextSongFromUserGesture} />

      {activePlaylist && (
        <PlaylistDetail
          playlist={activePlaylist}
          saved={activePlaylistSaved}
          favoriteKeys={favoriteKeys}
          selected={selected}
          onClose={() => {
            setActivePlaylistId(null);
            if (!activePlaylistSaved) setPreviewPlaylist(null);
          }}
          onPlay={playSong}
          onFavorite={toggleFavorite}
          onDownload={downloadSong}
          onDownloadSelected={downloadSongs}
          onDeleteDownload={deleteDownloadedSongs}
          onAddToQueue={addSongsToQueue}
          onSelect={toggleSelectedSong}
          onSavePlaylist={() => {
            setPlaylists((items) => [activePlaylist, ...items.filter((item) => item.id !== activePlaylist.id)]);
            setPreviewPlaylist((playlist) => playlist?.id === activePlaylist.id ? null : playlist);
            setToast("已收藏歌单");
          }}
          onAddSelected={(songs) => activePlaylistSaved && addSongsToPlaylist(activePlaylist.id, songs)}
          onCreatePlaylistWithSelected={(name, songs) => {
            const playlist: Playlist = { id: `local_${Date.now()}`, sharedId: createOpaqueSharedId("shared_playlist"), name, cover: songs[0]?.cover ?? cover(3), songs, source: "local" };
            setPlaylists((items) => [playlist, ...items]);
            setSelected(new Set());
            setToast(`已创建歌单并添加 ${songs.length} 首歌曲`);
          }}
          onRemoveSelected={() => {
            if (!activePlaylistSaved) return;
            if (activePlaylist.id === FAVORITES_ID) {
              setToast("我喜欢的音乐不能移除歌曲");
              setSelected(new Set());
              return;
            }
            const keys = selected;
            setPlaylists((items) => items.map((playlist) => playlist.id === activePlaylist.id ? { ...playlist, songs: playlist.songs.filter((song) => !keys.has(songKey(song))) } : playlist));
            setSelected(new Set());
          }}
          onReverse={() => activePlaylistSaved && setPlaylists((items) => items.map((playlist) => playlist.id === activePlaylist.id ? { ...playlist, songs: [...playlist.songs].reverse() } : playlist))}
        />
      )}

      {playerOpen && currentSong && (
        <Player
          song={currentSong}
          queue={queue}
          queueIndex={queueIndex}
          playing={playing}
          position={position}
          duration={duration}
          favorite={favoriteKeys.has(songKey(currentSong))}
          mode={mode}
          onClose={() => setPlayerOpen(false)}
          onToggle={togglePlayback}
          onNext={nextSongFromUserGesture}
          onPrevious={previousSongFromUserGesture}
          onSeek={(value) => {
            if (audioRef.current) audioRef.current.currentTime = value;
            positionRef.current = value;
            setPosition(value);
          }}
          onMode={setMode}
          onFavorite={() => toggleFavorite(currentSong)}
          onQueuePlay={playQueueIndexFromUserGesture}
          onDownload={() => downloadSong(currentSong)}
          playbackSpeed={playbackSpeed}
          progressStyle={progressStyle}
          floatingLyric={floatingLyric}
          autoLyricsEnabled={autoLyricsEnabled}
          lyricsLoading={lyricsLoadingKey === songKey(currentSong)}
          sleepTimerUntil={sleepTimerUntil}
          playlists={playlists}
          selectedKeys={selected}
          onPlaybackSpeed={setPlaybackSpeed}
          onProgressStyle={setProgressStyle}
          eqPreset={eqPreset}
          eqIntensity={eqIntensity}
          onEqPreset={handleEqPresetChange}
          onEqIntensity={handleEqIntensityChange}
          onSleepTimer={(seconds) => {
            setSleepTimerUntil(Date.now() + seconds * 1000);
            setToast(`已设置定时关闭：${seconds < 60 ? `${seconds} 秒` : `${Math.round(seconds / 60)} 分钟`}`);
          }}
          onFloatingLyric={() => setFloatingLyric((value) => !value)}
          onFetchLyrics={() => void fetchLyricsForCurrentSong(true)}
          onPickLrc={() => lrcInputRef.current?.click()}
          onPickCover={() => coverInputRef.current?.click()}
          onQueueMove={moveQueueItem}
          onQueueRemove={(song) => {
            setQueue((items) => {
              const key = songKey(song);
              const removeIndex = items.findIndex((item) => songKey(item) === key);
              const next = items.filter((item) => songKey(item) !== key);
              setQueueIndex((index) => {
                if (!next.length) {
                  setPlaying(false);
                  audioRef.current?.pause();
                  return -1;
                }
                if (removeIndex < 0) return Math.min(index, next.length - 1);
                if (removeIndex < index) return Math.max(0, index - 1);
                if (removeIndex === index) return Math.min(index, next.length - 1);
                return Math.min(index, next.length - 1);
              });
              return next;
            });
          }}
          onQueueSelect={(song) => setSelected((items) => {
            const next = new Set(items);
            const key = songKey(song);
            next.has(key) ? next.delete(key) : next.add(key);
            return next;
          })}
          onAddQueueSelection={(playlistId, songs) => addSongsToPlaylist(playlistId, songs)}
          onDownloadSelected={downloadSongs}
        />
      )}

      {settingsOpen && (
        <Modal title="设置" onClose={() => setSettingsOpen(false)}>
          <div className="settings-list">
            <label>
              播放音质
              <select value={playQuality} onChange={(event) => setPlayQuality(event.target.value as PlayQuality)}>
                {qualityOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <label>
              下载音质
              <select value={downloadQuality} onChange={(event) => setDownloadQuality(event.target.value as PlayQuality)}>
                {qualityOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>
            <label>
              歌词来源
              <select value={lyricSource} onChange={(event) => setLyricSource(event.target.value as LyricSource)}>
                <option value="network">网络歌词优先</option>
                <option value="embedded">本地内嵌优先</option>
              </select>
            </label>
            <label className="switch-line"><span><FileText /> 自动获取歌词</span><input type="checkbox" checked={autoLyricsEnabled} onChange={(event) => setAutoLyricsEnabled(event.target.checked)} /></label>
            <label>
              主题
              <select value={theme} onChange={(event) => setTheme(event.target.value as Theme)}>
                <option value="light">浅色</option>
                <option value="dark">深色</option>
              </select>
            </label>
            <label className="switch-line"><span>歌曲淡入淡出</span><input type="checkbox" checked={fadeEnabled} onChange={(event) => setFadeEnabled(event.target.checked)} /></label>
            <label className="switch-line"><span>自动缓存</span><input type="checkbox" checked={autoCacheEnabled} onChange={(event) => setAutoCacheEnabled(event.target.checked)} /></label>
            <label className="switch-line"><span>离开后保留列表</span><input type="checkbox" checked={keepQueueOnExit} onChange={(event) => setKeepQueueOnExit(event.target.checked)} /></label>
            <label className="switch-line"><span>启动时播放</span><input type="checkbox" checked={autoPlayOnStart} disabled={!keepQueueOnExit} onChange={(event) => setAutoPlayOnStart(event.target.checked)} /></label>
            <label className="switch-line"><span>自动检查更新</span><input type="checkbox" checked={autoUpdateEnabled} onChange={(event) => setAutoUpdateEnabled(event.target.checked)} /></label>
            <div className="account-actions">
              <button onClick={() => void checkForUpdates(true)}>检查更新</button>
              <span className="muted">当前版本 {CURRENT_VERSION}{updateStatus ? ` · ${updateStatus}` : ""}</span>
            </div>
            {updateInfo?.available && (window.JianyinAndroid?.downloadAndInstallUpdate || updateInfo.canApply) && (
              <div className="account-actions">
                <button onClick={() => void applyAvailableUpdate()}>{window.JianyinAndroid?.downloadAndInstallUpdate ? "下载并安装 APK" : "更新桌面版"}</button>
                <span className="muted">更新仅在你点击后开始</span>
              </div>
            )}
            {updateInfo?.available && releaseNotes.length > 0 && (
              <section className="update-notes" aria-label="更新说明">
                <strong>更新到 {updateInfo.latestVersion} 的说明</strong>
                {releaseNotes.map((release) => (
                  <article key={release.tag}>
                    <h3>{release.tag}{release.publishedAt ? ` · ${release.publishedAt.slice(0, 10)}` : ""}</h3>
                    <p>{release.notes || "该版本未提供文字说明。"}</p>
                  </article>
                ))}
              </section>
            )}
            <label className="switch-line"><span>显示既见状态栏通知</span><input type="checkbox" checked={androidStatusNotificationEnabled} onChange={(event) => setAndroidStatusNotificationEnabled(event.target.checked)} /></label>
            <button className="wide-action" onClick={() => setAccountOpen(true)}><UserRound /> 账号管理</button>
            <button className="wide-action" onClick={backup}><Download /> 备份数据</button>
            <button className="wide-action" onClick={() => restoreInputRef.current?.click()}><ArchiveRestore /> 恢复备份</button>
            <p className="muted">默认音乐打开方式、蓝牙监听和 Android 系统悬浮窗属于系统能力；Web 端已用页面内浮动歌词与 MediaSession 覆盖可复刻部分。</p>
          </div>
        </Modal>
      )}

      {restorePreview && (
        <Modal title="恢复备份预览" onClose={() => { if (!restoreBusy) setRestorePreview(null); }}>
          <div className="form-stack">
            <strong>备份已校验，尚未写入本机数据</strong>
            <p>导出时间：{new Date(restorePreview.exportedAt).toLocaleString()}</p>
            <p>包含 {restorePreview.playlistCount} 个歌单 · {restorePreview.songCount} 首歌曲 · {restorePreview.localFileCount} 个本地音频（{formatFileSize(restorePreview.localFileBytes)}）</p>
            {restorePreview.state.playlists.length > 0 && <p className="muted">歌单：{restorePreview.state.playlists.map((playlist) => playlist.name).join("、")}</p>}
            <p className="muted">合并会保留本机已有数据；覆盖会以备份替换本机歌单、历史、队列和设置。</p>
            <div className="account-actions">
              <button className="primary-button" disabled={restoreBusy} onClick={() => void applyBackupRestore("merge")}>合并恢复（推荐）</button>
              <button className="danger-button" disabled={restoreBusy} onClick={() => void applyBackupRestore("overwrite")}>覆盖本机数据</button>
            </div>
          </div>
        </Modal>
      )}

      {createOpen && (
        <Modal title="创建新歌单" onClose={() => setCreateOpen(false)}>
          <form className="form-stack" onSubmit={(event: FormEvent) => {
            event.preventDefault();
            const name = newPlaylistName.trim();
            if (!name) {
              setToast("请输入歌单名称");
              return;
            }
            const playlist: Playlist = { id: `local_${Date.now()}`, sharedId: createOpaqueSharedId("shared_playlist"), name, cover: cover(3), songs: [], source: "local" };
            setPlaylists((items) => [playlist, ...items]);
            setActivePlaylistId(playlist.id);
            setCreateOpen(false);
            setNewPlaylistName("");
          }}>
            <input autoFocus value={newPlaylistName} onChange={(event) => setNewPlaylistName(event.target.value)} placeholder="歌单名称" />
            <button className="primary-button" type="submit"><Plus /> 创建</button>
          </form>
        </Modal>
      )}

      {neteaseOpen && (
        <Modal title="导入网易云歌单" onClose={() => setNeteaseOpen(false)}>
          <form className="form-stack" onSubmit={(event: FormEvent) => { event.preventDefault(); void importNetease(); }}>
            <input autoFocus value={neteaseInput} onChange={(event) => { setNeteaseInput(event.target.value); setNeteaseError(""); }} placeholder="歌单 ID 或分享链接" />
            {neteaseError && <p className="field-error">{neteaseError}</p>}
            <button className="primary-button" disabled={neteaseBusy} type="submit"><Cloud /> {neteaseBusy ? "导入中" : "导入"}</button>
          </form>
        </Modal>
      )}

      {accountOpen && (
        <Modal title="账号管理" onClose={() => setAccountOpen(false)}>
          <div className="settings-list">
            <div className="account-status-grid">
              <div>
                <strong>网易云账号</strong>
                <span>{neteaseAccount.loggedIn ? `已登录${neteaseAccount.nickname ? ` · ${neteaseAccount.nickname}` : ""}` : "未登录"}</span>
              </div>
              <div>
                <strong>Bili 账号</strong>
                <span>{biliAccount.loggedIn ? `已登录${biliAccount.nickname ? ` · ${biliAccount.nickname}` : ""}` : "未登录"}</span>
              </div>
            </div>
            <div className="segmented">
              <button className={accountProvider === "netease" ? "active" : ""} onClick={() => setAccountProvider("netease")}>网易云</button>
              <button className={accountProvider === "bili" ? "active" : ""} onClick={() => setAccountProvider("bili")}>Bili</button>
            </div>
            <textarea value={accountCookie} onChange={(event) => { setAccountCookie(event.target.value); setAccountError(""); }} placeholder={accountProvider === "netease" ? "粘贴 MUSIC_U 等网易云 Cookie" : "粘贴 SESSDATA / DedeUserID / bili_jct Cookie 或 JSON"} />
            {accountError && <p className="field-error">{accountError}</p>}
            <button className="primary-button" disabled={accountBusy || !accountCookie.trim()} onClick={() => void loginAccount()}><UserRound /> {accountBusy ? "验证中" : "验证并同步"}</button>
            <div className="account-actions">
              <button disabled={accountBusy || !neteaseAccount.loggedIn} onClick={() => void syncAccounts("netease")}>同步网易云歌单</button>
              <button disabled={accountBusy || !biliAccount.loggedIn} onClick={() => void syncAccounts("bili")}>同步 Bili 收藏夹</button>
              <button disabled={accountBusy || !neteaseAccount.loggedIn} onClick={() => void logoutAccount("netease")}>退出网易云</button>
              <button disabled={accountBusy || !biliAccount.loggedIn} onClick={() => void logoutAccount("bili")}>退出 Bili</button>
            </div>
            <p className="muted">Cookie 只用于本机代理向对应平台验证登录与同步歌单；验证失败不会保存，也不会创建假歌单。</p>
          </div>
        </Modal>
      )}

      {floatingLyric && currentSong && (
        <FloatingLyric song={currentSong} position={position} onClose={() => setFloatingLyric(false)} />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function NavButton({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return <button className={`nav-button ${active ? "active" : ""}`} onClick={onClick}>{icon}<span>{label}</span></button>;
}

function MobileTopNav({ tab, setTab }: { tab: Tab; setTab: (tab: Tab) => void }) {
  return (
    <header className="mobile-top-nav">
      <button className="mobile-brand" onClick={() => setTab("home")} aria-label="打开首页">
        <img src="/assets/icon.png" alt="" />
        <span>既见</span>
      </button>
      <nav aria-label="主导航">
        <NavButton active={tab === "home"} icon={<Home />} label="首页" onClick={() => setTab("home")} />
        <NavButton active={tab === "search"} icon={<Search />} label="搜索" onClick={() => setTab("search")} />
        <NavButton active={tab === "mine"} icon={<Library />} label="我的" onClick={() => setTab("mine")} />
      </nav>
    </header>
  );
}

function HomeScreen({ data, loading, openingPlaylistId, error, onPlay, onOpenPlaylist, onOpenRemotePlaylist, onRefresh, proxyOnline }: {
  data: HomeData;
  loading: boolean;
  openingPlaylistId: string | null;
  error: string;
  onPlay: (song: Song, source?: Song[]) => void;
  onOpenPlaylist: (id: string) => void;
  onOpenRemotePlaylist: (playlist: Playlist) => void;
  onRefresh: () => void;
  proxyOnline: boolean;
}) {
  return (
    <section className="screen">
      <header className="topbar">
        <div><span className="kicker">既见君子，云胡不喜</span><h1>既见</h1></div>
        <div className="top-actions">
          <span className={`status-pill ${proxyOnline ? "online" : ""}`}>{proxyOnline ? "网易云官方接口" : "本地兜底"}</span>
          <button className="icon-button" onClick={onRefresh} aria-label="刷新推荐" disabled={loading}><RefreshCw /></button>
        </div>
      </header>
      {error && <p className="field-error">{error}</p>}
      <div className="home-intro" aria-label="聆听概览">
        <div className="home-intro-copy">
          <span className="home-intro-kicker">PERSONAL LISTENING ROOM</span>
          <strong>让每一次播放，都有一点仪式感。</strong>
          <p>本地音乐、在线搜索和歌单，在一个安静的空间里流动。</p>
          <div className="home-intro-meta">
            <span><Music /> {data.radarSongs.length ? `${data.radarSongs.length} 首今日推荐` : "今日推荐待加载"}</span>
            <span><Cloud /> {proxyOnline ? "在线曲库已连接" : "本地优先模式"}</span>
          </div>
        </div>
        <div className="home-intro-art" aria-hidden="true">
          <span className="home-intro-orbit orbit-one" />
          <span className="home-intro-orbit orbit-two" />
          <span className="home-intro-orbit orbit-three" />
          <Music className="home-intro-glyph" />
        </div>
      </div>
      <SectionTitle icon={<Music />} title="今日推荐" />
      <div className="shelf-row today-shelf">
        {data.radarSongs.map((song) => <CoverSong key={songKey(song)} song={song} songs={data.radarSongs} onPlay={onPlay} />)}
      </div>
      {data.hotSongs.length > 0 && (
        <>
          <SectionTitle icon={<Flame />} title="热门歌曲" />
          <div className="shelf-row hot-shelf">
            {data.hotSongs.map((song) => <CoverSong key={songKey(song)} song={song} songs={data.hotSongs} onPlay={onPlay} />)}
          </div>
        </>
      )}
      <div className="playlist-grid">
        {data.recommendedPlaylists.map((playlist) => {
          const opening = openingPlaylistId === playlist.id;
          return (
          <button className="playlist-card cover-playlist" key={playlist.id} onClick={() => playlist.songs.length ? onOpenPlaylist(playlist.id) : onOpenRemotePlaylist(playlist)} disabled={opening}>
            <img src={playlist.cover || "/assets/icon.png"} alt="" />
            <span><strong>{playlist.name}</strong><small>{opening ? "打开中..." : `${playlistDisplayCount(playlist)} 首${playlist.creatorNickname ? ` · ${playlist.creatorNickname}` : ""}`}</small></span>
          </button>
          );
        })}
      </div>
      {loading && <p className="network-line">正在刷新推荐...</p>}
    </section>
  );
}

function CoverSong({ song, songs, onPlay, onDelete }: { song: Song; songs: Song[]; onPlay: (song: Song, source?: Song[]) => void; onDelete?: (song: Song) => void }) {
  return (
    <div className="cover-card-wrap">
      <button className="cover-card haze-card" onClick={() => onPlay(song, songs)}>
        <img src={song.cover || "/assets/icon.png"} alt="" />
        <span className="cover-caption"><strong>{song.name}</strong><small>{song.artist}</small></span>
      </button>
      {onDelete && (
        <button className="cover-delete icon-button danger" onClick={() => onDelete(song)} aria-label="删除下载">
          <Trash2 />
        </button>
      )}
    </div>
  );
}

function SearchScreen(props: {
  query: string;
  setQuery: (value: string) => void;
  results: Song[];
  history: string[];
  searching: boolean;
  searchPage: number;
  searchPageSize: number;
  searchTotal: number | null;
  searchHasMore: boolean;
  offlineResults: boolean;
  proxyOnline: boolean;
  playlists: Playlist[];
  selected: Set<string>;
  favoriteKeys: Set<string>;
  onSearch: (value?: string, page?: number) => void;
  onPage: (page: number) => void;
  onPlay: (song: Song) => void;
  onFavorite: (song: Song) => void;
  onSelect: (song: Song) => void;
  onSelectAllVisible: () => void;
  onDeselectAllVisible: () => void;
  onClearSelection: () => void;
  onAdd: (playlistId: string) => void;
  onAddToQueue: () => void;
  onDownloadSelected: () => void;
  onCreatePlaylistWithSelected: (name: string) => void;
  onHistoryClear: () => void;
  onDownload: (song: Song) => void;
}) {
  const [createName, setCreateName] = useState("");
  const totalPages = props.searchTotal ? Math.max(1, Math.ceil(props.searchTotal / props.searchPageSize)) : null;
  const firstVisible = props.results.length ? (props.searchPage - 1) * props.searchPageSize + 1 : 0;
  const lastVisible = props.results.length ? firstVisible + props.results.length - 1 : 0;
  const canPage = Boolean(props.query.trim()) && (props.results.length > 0 || props.searchPage > 1 || props.searchHasMore);
  const selectedVisibleCount = props.results.filter((song) => props.selected.has(songKey(song))).length;
  const allVisibleSelected = props.results.length > 0 && selectedVisibleCount === props.results.length;
  const paginationBar = (placement: "top" | "bottom") => canPage ? (
    <div className={`pagination-bar pagination-bar-${placement}`} aria-label={placement === "top" ? "测试源搜索分页" : "测试源搜索分页底部"}>
      <button type="button" disabled={props.searching || props.searchPage <= 1} onClick={() => props.onPage(props.searchPage - 1)} aria-label={placement === "top" ? "上一页" : "底部上一页"}><ChevronLeft /> 上一页</button>
      <span>
        第 {props.searchPage} 页
        {totalPages ? ` / ${totalPages} 页` : ""}
        {props.results.length ? ` · ${firstVisible}-${lastVisible}${props.searchTotal ? ` / ${props.searchTotal}` : ""}` : ""}
      </span>
      <button type="button" disabled={props.searching || !props.searchHasMore} onClick={() => props.onPage(props.searchPage + 1)} aria-label={placement === "top" ? "下一页" : "底部下一页"}>下一页 <ChevronRight /></button>
    </div>
  ) : null;
  return (
    <section className={canPage ? "screen search-screen has-pagination" : "screen search-screen"}>
      <header className="topbar"><div><span className="kicker">Search</span><h1>搜索</h1></div></header>
      <form className="search-box" onSubmit={(event) => {
        event.preventDefault();
        props.onSearch(String(new FormData(event.currentTarget).get("keyword") ?? props.query));
      }}>
        <Search />
        <input name="keyword" value={props.query} onChange={(event) => props.setQuery(event.target.value)} placeholder="搜索音乐/歌手" />
        <button className="primary-button" type="submit">{props.searching ? "搜索中" : "搜索"}</button>
      </form>
      <p className="network-line">{props.offlineResults ? `离线本地结果 · ${props.results.length} 首` : props.proxyOnline ? "测试源接口已连接；默认优先 FLAC，失败自动回退 320k。" : "测试源暂不可用，请稍后再试。"}</p>
      <div className="chips">
        {recommendedKeywords.map((item) => <button key={item} onClick={() => { props.setQuery(item); props.onSearch(item); }}>{item}</button>)}
        {props.history.map((item) => <button key={`h-${item}`} onClick={() => { props.setQuery(item); props.onSearch(item); }}>{item}</button>)}
        {props.history.length > 0 && <button onClick={props.onHistoryClear}>清空历史</button>}
      </div>
      {paginationBar("top")}
      {props.results.length > 0 && (
        <div className="result-actions" aria-label="搜索结果批量操作">
          <span>当前页 {props.results.length} 首{selectedVisibleCount ? ` · 已选 ${selectedVisibleCount} 首` : ""}</span>
          <div>
            <button type="button" onClick={allVisibleSelected ? props.onDeselectAllVisible : props.onSelectAllVisible}>
              {allVisibleSelected ? <Square /> : <SquareCheckBig />}
              {allVisibleSelected ? "取消全选当前页" : "全选当前页"}
            </button>
            <button type="button" disabled={!props.selected.size} onClick={props.onClearSelection}>取消选择</button>
          </div>
        </div>
      )}
      {props.selected.size > 0 && (
        <div className="selection-bar">
          <span>已选择 {props.selected.size} 首</span>
          <select onChange={(event) => props.onAdd(event.target.value)} defaultValue="">
            <option value="" disabled>添加到歌单</option>
            {props.playlists.map((playlist) => <option value={playlist.id} key={playlist.id}>{playlist.name}</option>)}
          </select>
          <button onClick={props.onAddToQueue}><ListPlus /> 播放队列</button>
          <button onClick={props.onDownloadSelected}><Download /> 下载</button>
          <form className="selection-create" onSubmit={(event) => {
            event.preventDefault();
            const name = createName.trim();
            if (!name) return;
            props.onCreatePlaylistWithSelected(name);
            setCreateName("");
          }}>
            <input value={createName} onChange={(event) => setCreateName(event.target.value)} placeholder="新歌单名" />
            <button type="submit" disabled={!createName.trim()}><Plus /> 创建</button>
          </form>
        </div>
      )}
      <div className="song-list">
        {props.results.map((song) => (
          <SongRow key={songKey(song)} song={song} selectable selected={props.selected.has(songKey(song))} favorite={props.favoriteKeys.has(songKey(song))} onPlay={props.onPlay} onFavorite={props.onFavorite} onSelect={props.onSelect} onDownload={props.onDownload} />
        ))}
        {props.query && !props.results.length && !props.searching && <p className="empty-text">没有找到结果</p>}
      </div>
      {paginationBar("bottom")}
    </section>
  );
}

function MineScreen({ playlists, history, downloadHistory, onPlay, onDeleteDownload, onOpenPlaylist, onOpenHistory, onOpenDownloads, onCreate, onImportLocal, onImportNetease, onAccounts, onBackup, onRestore, onSettings, onDelete }: {
  playlists: Playlist[];
  history: Song[];
  downloadHistory: Song[];
  onPlay: (song: Song, source?: Song[]) => void;
  onDeleteDownload: (songs: Song[]) => void;
  onOpenPlaylist: (id: string) => void;
  onOpenHistory: () => void;
  onOpenDownloads: () => void;
  onCreate: () => void;
  onImportLocal: () => void;
  onImportNetease: () => void;
  onAccounts: () => void;
  onBackup: () => void;
  onRestore: () => void;
  onSettings: () => void;
  onDelete: (playlist: Playlist) => void;
}) {
  const favoritePlaylist = playlists.find((playlist) => playlist.id === FAVORITES_ID);
  const favoriteSongs = favoritePlaylist?.songs ?? [];
  const recentSongs = history.slice(0, 10);
  const downloadedSongs = downloadHistory.slice(0, 10);
  return (
    <section className="screen">
      <header className="topbar"><div><span className="kicker">Library</span><h1>我的音乐</h1></div><button className="icon-button" onClick={onSettings} aria-label="设置"><Settings /></button></header>
      {recentSongs.length > 0 && (
        <>
          <SectionTitle icon={<ClockIcon />} title="最近播放" actionLabel={`全部 ${history.length}`} onAction={onOpenHistory} />
          <div className="shelf-row">
            {recentSongs.map((song) => <CoverSong key={songKey(song)} song={song} songs={recentSongs} onPlay={onPlay} />)}
          </div>
        </>
      )}
      <>
        <SectionTitle icon={<Download />} title="下载管理" actionLabel={downloadHistory.length ? `全部 ${downloadHistory.length}` : undefined} onAction={downloadHistory.length ? onOpenDownloads : undefined} />
        {downloadedSongs.length > 0 ? (
          <div className="shelf-row">
            {downloadedSongs.map((song) => <CoverSong key={songKey(song)} song={song} songs={downloadHistory} onPlay={onPlay} onDelete={(target) => onDeleteDownload([target])} />)}
          </div>
        ) : (
          <p className="empty-text">暂无下载记录</p>
        )}
      </>
      {favoriteSongs.length > 0 && (
        <>
          <SectionTitle icon={<Heart />} title="最近最爱" actionLabel={`全部 ${favoriteSongs.length}`} onAction={() => onOpenPlaylist(FAVORITES_ID)} />
          <div className="shelf-row">
            {favoriteSongs.slice(0, 10).map((song) => <CoverSong key={songKey(song)} song={song} songs={favoriteSongs} onPlay={onPlay} />)}
          </div>
        </>
      )}
      <div className="action-grid">
        <button onClick={onCreate}><Plus /> 创建歌单</button>
        <button onClick={onImportLocal}><FileAudio /> 导入本地音乐</button>
        <button onClick={onImportNetease}><Cloud /> 导入网易云歌单</button>
        <button onClick={onAccounts}><UserRound /> 账号同步</button>
        <button onClick={onBackup}><Download /> 备份数据</button>
        <button onClick={onRestore}><ArchiveRestore /> 恢复备份</button>
        <button onClick={onSettings}><Settings /> 设置</button>
      </div>
      <SectionTitle icon={<Library />} title="我的歌单" />
      <div className="playlist-list">
            {playlists.map((playlist) => (
          <div className="playlist-row" key={playlist.id}>
            <button onClick={() => onOpenPlaylist(playlist.id)}><img src={playlist.cover || "/assets/icon.png"} alt="" /><span><strong>{playlist.name}</strong><small>{playlistDisplayCount(playlist)} 首歌曲</small></span></button>
            <button className="icon-button danger" onClick={() => onDelete(playlist)} aria-label="删除歌单"><Trash2 /></button>
          </div>
        ))}
      </div>
    </section>
  );
}

function ClockIcon() {
  return <Music />;
}

function PlaylistDetail({ playlist, saved, favoriteKeys, selected, onClose, onPlay, onFavorite, onDownload, onDownloadSelected, onDeleteDownload, onAddToQueue, onSelect, onSavePlaylist, onAddSelected, onCreatePlaylistWithSelected, onRemoveSelected, onReverse }: {
  playlist: Playlist;
  saved: boolean;
  favoriteKeys: Set<string>;
  selected: Set<string>;
  onClose: () => void;
  onPlay: (song: Song, source?: Song[]) => void;
  onFavorite: (song: Song) => void;
  onDownload: (song: Song) => void;
  onDownloadSelected: (songs: Song[]) => void;
  onDeleteDownload: (songs: Song[]) => void;
  onAddToQueue: (songs: Song[]) => void;
  onSelect: (song: Song) => void;
  onSavePlaylist: () => void;
  onAddSelected: (songs: Song[]) => void;
  onCreatePlaylistWithSelected: (name: string, songs: Song[]) => void;
  onRemoveSelected: () => void;
  onReverse: () => void;
}) {
  const [filter, setFilter] = useState("");
  const [createName, setCreateName] = useState("");
  const normalizedFilter = filter.trim().toLowerCase();
  const visibleSongs = useMemo(() => normalizedFilter
    ? playlist.songs.filter((song) => [song.name, song.artist].some((value) => value.toLowerCase().includes(normalizedFilter)))
    : playlist.songs, [normalizedFilter, playlist.songs]);
  const selectedSongs = useMemo(() => visibleSongs.filter((song) => selected.has(songKey(song))), [selected, visibleSongs]);
  const isDownloadManager = playlist.id === "download_history_preview";
  const deletableSelectedSongs = isDownloadManager ? selectedSongs : selectedSongs.filter(isDownloadCachedSong);
  const playPlaylistSong = useCallback((song: Song) => onPlay(song, playlist.songs), [onPlay, playlist.songs]);
  const deleteDownloadedSong = useCallback((song: Song) => onDeleteDownload([song]), [onDeleteDownload]);
  return (
    <div className="detail-backdrop">
      <section className="detail" role="dialog" aria-modal="true" aria-label={playlist.name}>
        <header className="detail-head">
          <button className="plain-button" onClick={onClose}>返回</button>
          <img src={playlist.cover || "/assets/icon.png"} alt="" />
          <div><h2>{playlist.name}</h2><p>{playlistDisplayCount(playlist)} 首歌曲 · {playlist.source === "netease" ? "网易云公开歌单" : "本地歌单"}</p></div>
        </header>
        <form className="search-box compact-search" onSubmit={(event) => event.preventDefault()}>
          <Search />
          <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="搜索歌曲" />
          {filter && <button className="icon-button" type="button" onClick={() => setFilter("")} aria-label="清空搜索"><X /></button>}
        </form>
        <div className="detail-actions">
          <button className="primary-button" disabled={!playlist.songs.length} onClick={() => playlist.songs[0] && onPlay(playlist.songs[0], playlist.songs)}><Play /> 播放全部</button>
          <button disabled={!visibleSongs.length} onClick={() => visibleSongs.forEach(onSelect)}><ListPlus /> 全选可见</button>
          <button disabled={!selectedSongs.length} onClick={() => onAddToQueue(selectedSongs)}><ListPlus /> 加入队列</button>
          {isDownloadManager
            ? <button className="danger-button" disabled={!deletableSelectedSongs.length} onClick={() => onDeleteDownload(deletableSelectedSongs)}><Trash2 /> 删除所选</button>
            : <button disabled={!selectedSongs.length} onClick={() => onDownloadSelected(selectedSongs)}><Download /> 下载所选</button>}
          {!saved && !isDownloadManager && <button className="primary-button" onClick={onSavePlaylist}><Plus /> 收藏歌单</button>}
          {saved && <button onClick={onReverse}>反转排序</button>}
          {saved && <button onClick={() => onAddSelected(selectedSongs)} disabled={!selectedSongs.length}>加入当前歌单</button>}
          {saved && <button onClick={onRemoveSelected} disabled={!selected.size}>移除所选</button>}
        </div>
        {selectedSongs.length > 0 && !isDownloadManager && (
          <form className="inline-create" onSubmit={(event) => {
            event.preventDefault();
            const name = createName.trim();
            if (!name) return;
            onCreatePlaylistWithSelected(name, selectedSongs);
            setCreateName("");
          }}>
            <input value={createName} onChange={(event) => setCreateName(event.target.value)} placeholder="创建新歌单并添加所选" />
            <button className="primary-button" type="submit"><Plus /> 创建并添加</button>
          </form>
        )}
        <div className="playlist-only-column">
          <div><h3>当前歌单</h3><div className="song-list">{visibleSongs.map((song) => <SongRow key={songKey(song)} song={song} selectable selected={selected.has(songKey(song))} favorite={favoriteKeys.has(songKey(song))} onPlay={playPlaylistSong} onFavorite={isDownloadManager ? undefined : onFavorite} onSelect={onSelect} onDownload={isDownloadManager ? undefined : onDownload} onDelete={isDownloadManager ? deleteDownloadedSong : undefined} />)}{!visibleSongs.length && <p className="empty-text">没有匹配歌曲</p>}</div></div>
        </div>
      </section>
    </div>
  );
}

function NowPlaying({ song, playing, position, duration, onOpen, onToggle, onNext }: { song: Song | null; playing: boolean; position: number; duration: number; onOpen: () => void; onToggle: (event: MouseEvent) => void; onNext: (event: MouseEvent) => void }) {
  if (!song) return null;
  return (
    <div className="now-playing" onClick={onOpen} role="button" aria-label={`正在播放 ${song.name}`} tabIndex={0} onKeyDown={(event) => {
      if (event.key === "Enter" || event.key === " ") onOpen();
    }}>
      <img src={song.cover || "/assets/icon.png"} alt="" />
      <span className="now-playing-copy"><strong>{song.name}</strong><small>{song.artist}</small></span>
      <span className="now-playing-time" aria-label="播放时间">{formatTime(position)} / {formatTime(duration)}</span>
      <button className="icon-button" onClick={(event) => { event.stopPropagation(); onToggle(event); }} aria-label={playing ? "暂停" : "播放"} aria-pressed={playing}>{playing ? <Pause /> : <Play />}</button>
      <button className="icon-button" onClick={(event) => { event.stopPropagation(); onNext(event); }} aria-label="下一首"><SkipForward /></button>
      <span className="mini-progress" aria-hidden="true"><i style={{ width: `${duration ? Math.min(100, position / duration * 100) : 0}%` }} /></span>
    </div>
  );
}

function LiveNowPlaying({ song, playing, position, duration, onOpen, onToggle, onPrevious, onNext }: { song: Song | null; playing: boolean; position: number; duration: number; onOpen: () => void; onToggle: (event: MouseEvent) => void; onPrevious: (event: MouseEvent) => void; onNext: (event: MouseEvent) => void }) {
  if (!song) return null;
  const progressPercent = duration ? Math.min(100, Math.max(0, position / duration * 100)) : 0;
  return (
    <div className="now-playing live-now-playing" onClick={onOpen} role="button" tabIndex={0} onKeyDown={(event) => {
      if (event.key === "Enter" || event.key === " ") onOpen();
    }}>
      <img src={song.cover || "/assets/icon.png"} alt="" />
      <span className="now-playing-title"><strong>{song.name}</strong><small>{song.artist}</small></span>
      <span className="now-playing-wave" aria-hidden="true"><i /><i /><i /><i /><i /></span>
      <span className="now-playing-time"><b>{formatTime(position)}</b><span className="mini-progress"><i style={{ width: `${progressPercent}%` }} /></span><b>{formatTime(duration)}</b></span>
      <span className="now-playing-controls">
        <button className="icon-button" onClick={(event) => { event.stopPropagation(); onPrevious(event); }} aria-label="上一首"><SkipBack /></button>
        <button className="icon-button play-toggle" onClick={(event) => { event.stopPropagation(); onToggle(event); }} aria-label={playing ? "暂停" : "播放"} aria-pressed={playing}>{playing ? <Pause /> : <Play />}</button>
        <button className="icon-button" onClick={(event) => { event.stopPropagation(); onNext(event); }} aria-label="下一首"><SkipForward /></button>
      </span>
    </div>
  );
}

function FloatingLyric({ song, position, onClose }: { song: Song; position: number; onClose: () => void }) {
  const lyrics = parseLrc(song.lrc);
  const active = activeLyricIndex(lyrics, position);
  const line = lyrics[active]?.text || song.name;
  return (
    <div className="floating-lyric" role="dialog" aria-label="桌面歌词">
      <button className="icon-button" onClick={onClose} aria-label="关闭桌面歌词"><X /></button>
      <strong>{line}</strong>
      <span>{song.artist}</span>
    </div>
  );
}

function SectionTitle({ icon, title, actionLabel, onAction }: { icon: React.ReactNode; title: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <div className="section-title">
      <span className="section-title-main">{icon}<h2>{title}</h2></span>
      {actionLabel && onAction && <button type="button" className="section-action" onClick={onAction}>{actionLabel}<ChevronRight /></button>}
    </div>
  );
}
