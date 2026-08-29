import { ChevronRight, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { httpsCoverUrl } from "../lib/api";
import type { Playlist, Song } from "../types";

export function playlistDisplayCount(playlist: Playlist) {
  return Number(playlist.trackCount) > 0 ? Number(playlist.trackCount) : playlist.songs.length;
}

export function SectionTitle({ icon, title, actionLabel, onAction }: { icon: React.ReactNode; title: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <div className="section-title">
      <span className="section-title-main">{icon}<h2>{title}</h2></span>
      {actionLabel && onAction && <button type="button" className="section-action" onClick={onAction}>{actionLabel}<ChevronRight /></button>}
    </div>
  );
}

export function CoverSong({ song, songs, onPlay, onDelete }: { song: Song; songs: Song[]; onPlay: (song: Song, source?: Song[]) => void; onDelete?: (song: Song) => void }) {
  return (
    <div className="cover-card-wrap">
      <button className="cover-card haze-card" onClick={() => onPlay(song, songs)}>
        <img src={httpsCoverUrl(song.cover) || "/assets/icon.png"} alt="" />
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
