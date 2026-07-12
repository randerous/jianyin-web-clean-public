export type Source = "local" | "netease" | "bili" | "flac";

export type Song = {
  id: string;
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
  autoCacheEnabled: boolean;
  keepQueueOnExit: boolean;
  autoPlayOnStart: boolean;
  androidStatusNotificationEnabled: boolean;
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
