import type { Playlist, Song } from "../types";

export const FAVORITES_ID = "favorites";
export const STORAGE_KEY = "jianyin-web-clean-state-v1";
export const LOCAL_DB_NAME = "jianyin-web-clean-audio";
export const LOCAL_STORE_NAME = "files";

export function asset(path: string) {
  return `/assets/${path}`;
}

export function cover(index: number) {
  return asset(`miku_${((index - 1) % 9) + 1}.png`);
}

export const demoLrc = `[00:00.00]拾音
[00:03.00]从 Android 5.0.0 核心体验重建
[00:08.00]搜索、播放、队列、歌词和歌单
[00:13.00]本地文件保存在你的浏览器里`;

export const seedSongs: Song[] = [
  ["jay", "周杰伦 本地试听", "拾音示例曲库", 1],
  ["eason", "陈奕迅 本地试听", "拾音示例曲库", 2],
  ["jj", "林俊杰 本地试听", "拾音示例曲库", 3],
  ["mayday", "五月天 本地试听", "拾音示例曲库", 4],
  ["gem", "邓紫棋 本地试听", "拾音示例曲库", 5],
  ["balloon", "告白气球 本地试听", "拾音示例曲库", 6],
  ["tenyears", "十年 本地试听", "拾音示例曲库", 7],
  ["ordinary", "平凡之路 本地试听", "拾音示例曲库", 8]
].map(([id, name, artist, index]) => ({
  id: `demo_${id}`,
  name: String(name),
  artist: String(artist),
  url: asset("full-song-65s.wav"),
  cover: cover(Number(index)),
  source: "local",
  lrc: demoLrc
}));

export const seedPlaylists: Playlist[] = [
  {
    id: FAVORITES_ID,
    name: "我喜欢的音乐",
    cover: cover(1),
    songs: [seedSongs[0]],
    source: "local"
  },
  {
    id: "daily",
    name: "今日推荐",
    cover: cover(2),
    songs: seedSongs.slice(0, 4),
    source: "local"
  },
  {
    id: "hot",
    name: "热歌推荐",
    cover: cover(5),
    songs: [seedSongs[4], seedSongs[1], seedSongs[7], seedSongs[0]],
    source: "local"
  }
];

export const recommendedKeywords = ["周杰伦", "陈奕迅", "林俊杰", "五月天", "邓紫棋", "平凡之路"];
