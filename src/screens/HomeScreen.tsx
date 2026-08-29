import { Cloud, Flame, Music, RefreshCw } from "lucide-react";
import { httpsCoverUrl } from "../lib/api";
import { songKey } from "../lib/storage";
import type { HomeData, Playlist, Song } from "../types";
import { CoverSong, SectionTitle, playlistDisplayCount } from "./shared";

export function HomeScreen({ data, loading, openingPlaylistId, error, onPlay, onOpenPlaylist, onOpenRemotePlaylist, onRefresh, proxyOnline }: {
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
            <img src={httpsCoverUrl(playlist.cover) || "/assets/icon.png"} alt="" />
            <span><strong>{playlist.name}</strong><small>{opening ? "打开中..." : `${playlistDisplayCount(playlist)} 首${playlist.creatorNickname ? ` · ${playlist.creatorNickname}` : ""}`}</small></span>
          </button>
          );
        })}
      </div>
      {loading && <p className="network-line">正在刷新推荐...</p>}
    </section>
  );
}
