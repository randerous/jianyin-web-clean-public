import { Download, ListPlus, Play, Plus, Search, Trash2, X } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import SongRow from "../components/SongRow";
import { httpsCoverUrl } from "../lib/api";
import { isDownloadCachedSong } from "../lib/download-key";
import { songKey } from "../lib/storage";
import type { Playlist, Song } from "../types";
import { playlistDisplayCount } from "./shared";

export function PlaylistDetail({ playlist, saved, favoriteKeys, selected, onClose, onPlay, onFavorite, onDownload, onDownloadSelected, onDeleteDownload, onAddToQueue, onSelect, onSavePlaylist, onAddSelected, onCreatePlaylistWithSelected, onRemoveSelected, onReverse }: {
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
          <img src={httpsCoverUrl(playlist.cover) || "/assets/icon.png"} alt="" />
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
