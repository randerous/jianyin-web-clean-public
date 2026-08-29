import { ChevronLeft, ChevronRight, Download, ListPlus, Plus, Search, Square, SquareCheckBig } from "lucide-react";
import { useState } from "react";
import SongRow from "../components/SongRow";
import { recommendedKeywords } from "../data/seed";
import { songKey } from "../lib/storage";
import type { Playlist, Song } from "../types";

export function SearchScreen(props: {
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
  sourceStats: { flac: number; netease: number; bili: number } | null;
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
      {!props.offlineResults && props.sourceStats && (
        <p className="network-line">{props.sourceStats.netease || props.sourceStats.bili
          ? `测试源无结果，已用兜底源：网易云 ${props.sourceStats.netease} 首 · B站 ${props.sourceStats.bili} 首。`
          : `测试源结果 ${props.sourceStats.flac} 首。`}</p>
      )}
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
