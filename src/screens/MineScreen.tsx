import { ArchiveRestore, Cloud, Download, FileAudio, Heart, Library, Music, Plus, Settings, Trash2, UserRound } from "lucide-react";
import { httpsCoverUrl } from "../lib/api";
import { FAVORITES_ID } from "../data/seed";
import { songKey } from "../lib/storage";
import type { Playlist, Song } from "../types";
import { CoverSong, SectionTitle, playlistDisplayCount } from "./shared";

export function ClockIcon() {
  return <Music />;
}

export function MineScreen({ playlists, history, downloadHistory, onPlay, onDeleteDownload, onOpenPlaylist, onOpenHistory, onOpenDownloads, onCreate, onImportLocal, onImportNetease, onAccounts, onBackup, onRestore, onSettings, onDelete }: {
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
            <button onClick={() => onOpenPlaylist(playlist.id)}><img src={httpsCoverUrl(playlist.cover) || "/assets/icon.png"} alt="" /><span><strong>{playlist.name}</strong><small>{playlistDisplayCount(playlist)} 首歌曲</small></span></button>
            <button className="icon-button danger" onClick={() => onDelete(playlist)} aria-label="删除歌单"><Trash2 /></button>
          </div>
        ))}
      </div>
    </section>
  );
}
