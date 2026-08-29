export type Source = "local" | "netease" | "bili" | "flac";

export type Song = {
  id: string;
  sharedId?: string;
  name: string;
  artist: string;
  url: string;
  cover: string;
  source: Source;
  lrc?: string;
  localKey?: string;
  coverKey?: string;
  remotePlayable?: boolean;
  verifiedPlayable?: boolean;
  durationMs?: number;
  br?: number | null;
  level?: string | null;
  audioType?: string | null;
  quality?: string;
  time?: string | number;
  sign?: string;
  needsImport?: boolean;
  bvid?: string;
  cid?: number;
};

export type Playlist = {
  id: string;
  sharedId?: string;
  name: string;
  cover: string;
  songs: Song[];
  source: Source;
  trackCount?: number;
  creatorNickname?: string;
};

export type Theme = "light" | "dark";
export type PlayQuality = "jymaster" | "sky" | "jyeffect" | "hires" | "lossless" | "exhigh" | "standard";
export type ProgressStyle = "default" | "round" | "audio";
export type LyricSource = "network" | "embedded";
export type AudioEffectsPreset = "none" | "hiFi" | "full" | "vocal" | "classical" | "rock";

export type PersistedState = {
  playlists: Playlist[];
  favorites: Song[];
  history: Song[];
  downloadHistory: Song[];
  queue: Song[];
  queueIndex: number;
  searchHistory: string[];
  theme: Theme;
  playQuality: PlayQuality;
  downloadQuality: PlayQuality;
  progressStyle: ProgressStyle;
  lyricSource: LyricSource;
  autoLyricsEnabled: boolean;
  playbackSpeed: number;
  fadeEnabled: boolean;
  eqPreset: AudioEffectsPreset;
  eqIntensity: number;
  autoCacheEnabled: boolean;
  keepQueueOnExit: boolean;
  autoPlayOnStart: boolean;
  autoUpdateEnabled: boolean;
  androidStatusNotificationEnabled: boolean;
  sharedSyncPending?: boolean;
  sharedRevision?: number;
  sharedTombstones?: SharedTombstones;
  sharedTombstoneClears?: SharedTombstones;
  updatedAt?: number;
};

export type SharedTombstones = {
  playlistIds: string[];
  favorites: string[];
  playlistSongs: Record<string, string[]>;
};

export type SharedState = {
  schemaVersion: 2;
  revision: number;
  playlists: Playlist[];
  favorites: Song[];
  tombstones: SharedTombstones;
  lastWriteId?: string;
  updatedAt?: number;
};

export type AccountState = {
  loggedIn: boolean;
  nickname?: string;
  userId?: string;
};

export type LyricLine = {
  time: number;
  text: string;
};

export type BackupPayload = PersistedState & {
  localFiles?: LocalFileBackup[];
  exportedAt: string;
  app: "jianyin-web-clean";
};

export type LocalFileBackup = {
  key: string;
  type: string;
  dataUrl: string;
};

export type BackupPreview = {
  state: PersistedState;
  localFiles: LocalFileBackup[];
  exportedAt: string;
  playlistCount: number;
  songCount: number;
  localFileCount: number;
  localFileBytes: number;
};

export type Tab = "home" | "search" | "mine";

export type HomeData = {
  radarSongs: Song[];
  hotSongs: Song[];
  recommendedPlaylists: Playlist[];
};
