import { ArrowLeft, ChevronDown, ChevronUp, Disc3, Download, FileText, Gauge, Heart, Image, ListMusic, MoreVertical, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, SlidersHorizontal, Timer, Waves, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { EQ_PRESETS } from "../lib/audio-effects";
import { activeLyricIndex, formatTime, parseLrc } from "../lib/lyrics";
import { songKey } from "../lib/storage";
import type { AudioEffectsPreset, Playlist, ProgressStyle, Song } from "../types";

type PlayerMode = "sequence" | "repeat" | "shuffle";

type Props = {
  song: Song;
  queue: Song[];
  queueIndex: number;
  playing: boolean;
  position: number;
  duration: number;
  favorite: boolean;
  mode: PlayerMode;
  playbackSpeed: number;
  progressStyle: ProgressStyle;
  floatingLyric: boolean;
  autoLyricsEnabled: boolean;
  lyricsLoading: boolean;
  sleepTimerUntil: number | null;
  eqPreset: AudioEffectsPreset;
  eqIntensity: number;
  playlists: Playlist[];
  selectedKeys: Set<string>;
  onClose: () => void;
  onToggle: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onSeek: (value: number) => void;
  onMode: (mode: PlayerMode) => void;
  onFavorite: () => void;
  onQueuePlay: (index: number) => void;
  onDownload: () => void;
  onPlaybackSpeed: (value: number) => void;
  onProgressStyle: (value: ProgressStyle) => void;
  onSleepTimer: (seconds: number) => void;
  onEqPreset: (value: AudioEffectsPreset) => void;
  onEqIntensity: (value: number) => void;
  onFloatingLyric: () => void;
  onFetchLyrics: () => void;
  onQueueRemove: (song: Song) => void;
  onQueueSelect: (song: Song) => void;
  onQueueMove: (index: number, direction: -1 | 1) => void;
  onPickLrc: () => void;
  onPickCover: () => void;
  onAddQueueSelection: (playlistId: string, songs: Song[]) => void;
  onDownloadSelected: (songs: Song[]) => void;
};

function qualityText(song: Song) {
  const parts = [song.level, song.audioType, song.br ? `${Math.round(song.br / 1000)}kbps` : ""].filter(Boolean);
  if (parts.length) return parts.join(" · ");
  if (song.source === "netease") return "网易云已验证完整音源";
  if (song.source === "flac") return "测试源完整音源";
  return "本地音源";
}

function WaveProgress({ value, max, onSeek }: { value: number; max: number; onSeek: (value: number) => void }) {
  const progress = max ? Math.min(1, value / max) : 0;
  return (
    <button className="wave-progress" onClick={(event) => {
      const rect = event.currentTarget.getBoundingClientRect();
      onSeek(((event.clientX - rect.left) / rect.width) * max);
    }} aria-label="播放进度">
      {Array.from({ length: 31 }).map((_, index) => <i key={index} className={index / 31 <= progress ? "active" : ""} />)}
    </button>
  );
}

export default function Player(props: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [view, setView] = useState<"cover" | "lyrics">("lyrics");
  const [queueOpen, setQueueOpen] = useState(false);
  const lyricPanelRef = useRef<HTMLDivElement | null>(null);
  const activeLyricRef = useRef<HTMLParagraphElement | null>(null);
  const lyrics = parseLrc(props.song.lrc);
  const active = lyrics.length ? Math.max(0, activeLyricIndex(lyrics, props.position)) : -1;
  const selectedQueueSongs = props.queue.filter((item) => props.selectedKeys.has(songKey(item)));
  const sleepLabel = props.sleepTimerUntil ? `剩余 ${Math.max(0, Math.ceil((props.sleepTimerUntil - Date.now()) / 1000))} 秒` : "未设置";
  const pickLrc = () => {
    props.onPickLrc();
    setMenuOpen(false);
  };
  const pickCover = () => {
    props.onPickCover();
    setMenuOpen(false);
  };
  const modeOptions: Array<{ value: PlayerMode; label: string; icon: ReactNode }> = [
    { value: "sequence", label: "列表循环", icon: <Repeat /> },
    { value: "repeat", label: "单曲循环", icon: <Repeat1 /> },
    { value: "shuffle", label: "随机播放", icon: <Shuffle /> }
  ];

  useEffect(() => {
    if (view !== "lyrics" || !activeLyricRef.current || !lyricPanelRef.current) return;
    const panel = lyricPanelRef.current;
    const line = activeLyricRef.current;
    const nextTop = line.offsetTop - panel.clientHeight / 2 + line.clientHeight / 2;
    panel.scrollTo({ top: Math.max(0, nextTop), behavior: "smooth" });
  }, [active, view]);
  const queueContent = (
    <>
      <div className="queue-title"><ListMusic /> 播放列表</div>
      {selectedQueueSongs.length > 0 && (
        <div className="queue-actions">
          <span>已选择 {selectedQueueSongs.length} 首</span>
          <select onChange={(event) => props.onAddQueueSelection(event.target.value, selectedQueueSongs)} defaultValue="">
            <option value="" disabled>添加到歌单</option>
            {props.playlists.map((playlist) => <option value={playlist.id} key={playlist.id}>{playlist.name}</option>)}
          </select>
          <button onClick={() => props.onDownloadSelected(selectedQueueSongs)}><Download /> 下载</button>
        </div>
      )}
      {props.queue.map((item, index) => (
        <div className={`queue-row ${index === props.queueIndex ? "active" : ""}`} key={`${item.id}-${index}`}>
          <button className="queue-hit" onClick={() => props.onQueuePlay(index)} aria-label={`播放 ${item.name}`}>
            <img src={item.cover || "/assets/icon.png"} alt="" />
            <span>
              <strong>{item.name}</strong>
              <small>{item.artist} · {qualityText(item)}</small>
            </span>
          </button>
          <div className="queue-inline-actions">
            <button className={`icon-button ${props.selectedKeys.has(songKey(item)) ? "selected" : ""}`} onClick={() => props.onQueueSelect(item)} aria-label="选择歌曲" aria-pressed={props.selectedKeys.has(songKey(item))}><ListMusic /></button>
            <button className="icon-button" onClick={() => props.onQueueMove(index, -1)} aria-label="上移" disabled={index === 0}><ChevronUp /></button>
            <button className="icon-button" onClick={() => props.onQueueMove(index, 1)} aria-label="下移" disabled={index === props.queue.length - 1}><ChevronDown /></button>
            <button className="icon-button" onClick={() => props.onQueueRemove(item)} aria-label="移除"><X /></button>
          </div>
        </div>
      ))}
    </>
  );

  return (
    <main className="player-backdrop" aria-label="正在播放">
      <section className="player-sheet immersive-player" aria-label={props.song.name}>
        <img className="player-bg" src={props.song.cover || "/assets/icon.png"} alt="" />
        <header className="player-head">
          <button className="icon-button player-back-button" onClick={props.onClose} aria-label="返回">
            <ArrowLeft />
          </button>
          <div>
            <strong>{props.song.name}</strong>
            <span>{props.song.artist} · {qualityText(props.song)}</span>
          </div>
          <div className="more-menu">
            <button className="icon-button" onClick={() => setMenuOpen((value) => !value)} aria-label="更多选项" aria-expanded={menuOpen}><MoreVertical /></button>
            {menuOpen && <div className="more-panel">
              <strong>更多选项</strong>
              <button onClick={props.onDownload}><Download /> 下载歌曲</button>
              <button onClick={() => { props.onFetchLyrics(); setMenuOpen(false); }} disabled={props.lyricsLoading}><FileText /> {props.song.lrc ? "重新获取歌词" : props.lyricsLoading ? "正在获取歌词" : "获取歌词"}</button>
              <button onClick={pickLrc}><FileText /> 选择 LRC 文件</button>
              <button onClick={pickCover}><Image /> 选择封面</button>
              <button onClick={() => props.onSleepTimer(15)}><Timer /> 定时关闭 <span>{sleepLabel}</span></button>
              <label><Gauge /> 播放速度 <input type="range" min={0.25} max={4} step={0.1} value={props.playbackSpeed} onChange={(event) => props.onPlaybackSpeed(Number(event.target.value))} aria-label="播放速度" /></label>
              <div className="speed-buttons">
                {[0.5, 1, 1.5].map((speed) => <button key={speed} onClick={() => props.onPlaybackSpeed(speed)}>{speed.toFixed(1)}x</button>)}
              </div>
              <label><Waves /> 进度条样式 <select value={props.progressStyle} onChange={(event) => props.onProgressStyle(event.target.value as ProgressStyle)} aria-label="进度条样式"><option value="default">默认样式</option><option value="round">圆条样式</option><option value="audio">音频波形图样式</option></select></label>
              <label><SlidersHorizontal /> 音效 <select value={props.eqPreset} onChange={(event) => props.onEqPreset(event.target.value as AudioEffectsPreset)} aria-label="均衡器预设">{EQ_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}</select></label>
              <label><SlidersHorizontal /> 均衡器强度 <input type="range" min={0} max={100} step={1} value={props.eqIntensity} onChange={(event) => props.onEqIntensity(Number(event.target.value))} aria-label="均衡器强度" /> <span className="muted">{props.eqIntensity}%</span></label>
              <p className="muted">均衡器使用浏览器原生 10 段 ISO 滤波器（WebAudio）；选择"原声（关闭）"时完全绕过，不产生任何处理。</p>
            </div>}
          </div>
        </header>

        <div className="player-tabs" role="tablist" aria-label="播放器页面">
          <button className={view === "cover" ? "active" : ""} onClick={() => setView("cover")} role="tab" aria-selected={view === "cover"}><Disc3 /> 封面</button>
          <button className={view === "lyrics" ? "active" : ""} onClick={() => setView("lyrics")} role="tab" aria-selected={view === "lyrics"}><FileText /> 歌词</button>
          <button onClick={() => setQueueOpen(true)} type="button" aria-haspopup="dialog" aria-expanded={queueOpen}><ListMusic /> 播放列表</button>
        </div>

        <div className="player-grid">
          <button className={`album-stage player-pane ${view === "cover" ? "active" : ""}`} onClick={props.onFloatingLyric} aria-label={props.floatingLyric ? "关闭桌面歌词" : "开启桌面歌词"}>
            <img src={props.song.cover || "/assets/icon.png"} alt="" />
          </button>
          <div ref={lyricPanelRef} className={`lyric-panel player-pane ${view === "lyrics" ? "active" : ""}`}>
            {lyrics.length ? (
              <>
                <div className="lyric-scroll-spacer" aria-hidden="true" />
                {lyrics.map((line, index) => (
                  <p
                    key={`${line.time}-${line.text}`}
                    ref={index === active ? activeLyricRef : null}
                    className={index === active ? "current" : ""}
                  >
                    {line.text}
                  </p>
                ))}
                <div className="lyric-scroll-spacer" aria-hidden="true" />
              </>
            ) : (
              <div className="lyric-empty-state">
                <p className="empty-text">{props.lyricsLoading ? "正在获取歌词..." : props.autoLyricsEnabled ? "暂无歌词" : "自动获取歌词已关闭"}</p>
                {props.song.source !== "local" && (
                  <button className="lyric-fetch-button" onClick={props.onFetchLyrics} disabled={props.lyricsLoading}>
                    <FileText /> {props.lyricsLoading ? "正在获取" : "获取歌词"}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="player-controls">
          <div className="mode-switch" role="group" aria-label="播放模式">
            {modeOptions.map((item) => (
              <button key={item.value} className={props.mode === item.value ? "active" : ""} onClick={() => props.onMode(item.value)} aria-pressed={props.mode === item.value}>
                {item.icon}
                <span>{item.label}</span>
              </button>
            ))}
          </div>
          <div className={`time-line ${props.progressStyle}`}>
            <span>{formatTime(props.position)}</span>
            {props.progressStyle === "audio"
              ? <WaveProgress value={props.position} max={props.duration || 0} onSeek={props.onSeek} />
              : <input className={props.progressStyle === "round" ? "round-range" : ""} type="range" min={0} max={props.duration || 0} value={Math.min(props.position, props.duration || 0)} onChange={(event) => props.onSeek(Number(event.target.value))} aria-label="播放进度" />}
            <span>{formatTime(props.duration)}</span>
          </div>
          <div className="control-row">
            <button className="icon-button" onClick={props.onFavorite} aria-label={props.favorite ? "取消收藏" : "收藏"} aria-pressed={props.favorite}><Heart /></button>
            <button className="icon-button" onClick={props.onPrevious} aria-label="上一首"><SkipBack /></button>
            <button className="round-play" onClick={props.onToggle} aria-label={props.playing ? "暂停" : "播放"} aria-pressed={props.playing}>{props.playing ? <Pause /> : <Play />}</button>
            <button className="icon-button" onClick={props.onNext} aria-label="下一首"><SkipForward /></button>
            <button className="icon-button" onClick={() => setQueueOpen(true)} aria-label="打开播放列表" aria-haspopup="dialog" aria-expanded={queueOpen}><ListMusic /></button>
          </div>
        </div>
        {queueOpen && (
          <div className="queue-drawer-backdrop" role="presentation" onClick={() => setQueueOpen(false)}>
            <aside className="queue-drawer" role="dialog" aria-label="播放列表" aria-modal="true" onClick={(event) => event.stopPropagation()}>
              <header className="queue-drawer-head">
                <strong><ListMusic /> 播放列表</strong>
                <button className="icon-button" onClick={() => setQueueOpen(false)} aria-label="关闭播放列表"><X /></button>
              </header>
              <div className="queue-panel queue-drawer-panel">
                {queueContent}
              </div>
            </aside>
          </div>
        )}
      </section>
    </main>
  );
}
