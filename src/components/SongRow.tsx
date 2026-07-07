import { Download, Heart, Play, Square, SquareCheckBig, Trash2 } from "lucide-react";
import type { Song } from "../types";

export function sourceLabel(source: Song["source"]) {
  if (source === "netease") return "网易云";
  if (source === "bili") return "Bilibili";
  if (source === "flac") return "测试源";
  return "本地";
}

type Props = {
  song: Song;
  active?: boolean;
  favorite?: boolean;
  selectable?: boolean;
  selected?: boolean;
  onPlay: (song: Song) => void;
  onFavorite?: (song: Song) => void;
  onSelect?: (song: Song) => void;
  onDownload?: (song: Song) => void;
  onDelete?: (song: Song) => void;
};

export default function SongRow({ song, active, favorite, selectable, selected, onPlay, onFavorite, onSelect, onDownload, onDelete }: Props) {
  return (
    <div className={`song-row ${active ? "active" : ""}`}>
      <button className="song-hit" onClick={() => onPlay(song)} aria-label={`${song.name} ${song.artist} · ${sourceLabel(song.source)}`}>
        <img src={song.cover || "/assets/icon.png"} alt="" />
        <span>
          <strong>{song.name}</strong>
          <small>{song.artist} · {sourceLabel(song.source)}{song.needsImport ? " · 需重新导入" : ""}</small>
        </span>
      </button>
      <div className="song-actions">
        {selectable && (
          <button className={`icon-button ${selected ? "selected" : ""}`} onClick={() => onSelect?.(song)} aria-label="选择歌曲" aria-pressed={selected}>
            {selected ? <SquareCheckBig /> : <Square />}
          </button>
        )}
        <button className="icon-button" onClick={() => onPlay(song)} aria-label="播放">
          <Play />
        </button>
        {onFavorite && (
          <button className={`icon-button ${favorite ? "selected" : ""}`} onClick={() => onFavorite(song)} aria-label={favorite ? "取消喜欢" : "添加到喜欢"} aria-pressed={favorite}>
            <Heart />
          </button>
        )}
        {onDownload && (
          <button className="icon-button" onClick={() => onDownload(song)} aria-label="下载">
            <Download />
          </button>
        )}
        {onDelete && (
          <button className="icon-button danger" onClick={() => onDelete(song)} aria-label="删除下载">
            <Trash2 />
          </button>
        )}
      </div>
    </div>
  );
}
