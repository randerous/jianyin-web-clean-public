import { Pause, Play, SkipBack, SkipForward, X } from "lucide-react";
import type { MouseEvent } from "react";
import { httpsCoverUrl } from "../lib/api";
import { activeLyricIndex, formatTime, parseLrc } from "../lib/lyrics";
import type { Song } from "../types";

export function NowPlaying({ song, playing, position, duration, onOpen, onToggle, onNext }: { song: Song | null; playing: boolean; position: number; duration: number; onOpen: () => void; onToggle: (event: MouseEvent) => void; onNext: (event: MouseEvent) => void }) {
  if (!song) return null;
  return (
    <div className="now-playing" onClick={onOpen} role="button" aria-label={`正在播放 ${song.name}`} tabIndex={0} onKeyDown={(event) => {
      if (event.key === "Enter" || event.key === " ") onOpen();
    }}>
      <img src={httpsCoverUrl(song.cover) || "/assets/icon.png"} alt="" />
      <span className="now-playing-copy"><strong>{song.name}</strong><small>{song.artist}</small></span>
      <span className="now-playing-time" aria-label="播放时间">{formatTime(position)} / {formatTime(duration)}</span>
      <button className="icon-button" onClick={(event) => { event.stopPropagation(); onToggle(event); }} aria-label={playing ? "暂停" : "播放"} aria-pressed={playing}>{playing ? <Pause /> : <Play />}</button>
      <button className="icon-button" onClick={(event) => { event.stopPropagation(); onNext(event); }} aria-label="下一首"><SkipForward /></button>
      <span className="mini-progress" aria-hidden="true"><i style={{ width: `${duration ? Math.min(100, position / duration * 100) : 0}%` }} /></span>
    </div>
  );
}

export function LiveNowPlaying({ song, playing, position, duration, onOpen, onToggle, onPrevious, onNext }: { song: Song | null; playing: boolean; position: number; duration: number; onOpen: () => void; onToggle: (event: MouseEvent) => void; onPrevious: (event: MouseEvent) => void; onNext: (event: MouseEvent) => void }) {
  if (!song) return null;
  const progressPercent = duration ? Math.min(100, Math.max(0, position / duration * 100)) : 0;
  return (
    <div className="now-playing live-now-playing" onClick={onOpen} role="button" tabIndex={0} onKeyDown={(event) => {
      if (event.key === "Enter" || event.key === " ") onOpen();
    }}>
      <img src={httpsCoverUrl(song.cover) || "/assets/icon.png"} alt="" />
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

export function FloatingLyric({ song, position, onClose }: { song: Song; position: number; onClose: () => void }) {
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
