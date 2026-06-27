# Jianyin Web Clean 20-Agent Functional Test Plan

## Non-Negotiable Standards

- Remote playable songs must be server verified before the UI can play them.
- Netease, Bili, and FLAC/test-source songs must reject missing URLs, trial fragments, and `durationMs <= 60000`.
- Stream endpoints must support byte-range playback and return non-empty audio bytes.
- UI success is not enough: every critical flow needs API status, persisted state, and browser audio checks.
- Login or sync failure must never create fake playlists or fake account success.
- Browser-local state is not accepted for remote playlists; a clean browser context must restore shared playlists from `/api/state`.
- Live smoke failures cannot be hidden by mocks. If a live source is unavailable, the report must show the upstream status and exact failing layer.

## 20-Agent Team

| Agent | Area | Required Evidence |
| --- | --- | --- |
| 01 Playback Integrity | audio element, controls, queue, lyrics, MediaSession fallback | E2E playback state, `duration > 60`, seek/currentTime, queue title changes |
| 02 Netease Full Playback | search/song/stream/playlist/home | API rejects no URL/trial/short, quality fallback order, Range 206 |
| 03 FLAC Test Source | `flac.music.hi.cn` | SafeLine retry, search/getUrl/stream, real smoke, FLAC bytes |
| 04 Bili Source | WBI search/view/playurl/stream | live search 200, `durationMs > 60000`, stream bytes, banned old endpoint handled |
| 05 Cross-Browser Persistence | `/api/state`, local merge, browser contexts | context A creates playlist; context B sees it; empty browser does not erase shared state |
| 06 Playlist Workflows | create/delete/add/remove/reorder/search | no lost songs, no duplicates, favorites protected |
| 07 Account Sync | Netease/Bili cookie flows | invalid cookies rejected, sync failures visible, no fake playlists |
| 08 Download/Backup/Restore | local import, JSON backup, downloads | backup includes audio dataUrl, clean context restores playable audio, download event fires |
| 09 Search UX and Races | slow requests, source switching, history | stale results cleared, old requests cannot overwrite new source, empty keyword sends no request |
| 10 Quality Gate | scripts, README, smoke commands | `npm run build`, scripts exist, docs match current tests |
| 11 Home Screen | recommendation sections, refresh, fallback | remote recommendations render, fallback seed data works, refresh errors are visible |
| 12 Player Edge Cases | autoplay block, ended/repeat, object URLs | blocked play shows toast, repeat restarts, object URLs revoked |
| 13 Lyrics and Cover | network lyrics, local LRC, local cover | LRC persists across reload, cover persists, malformed LRC does not crash |
| 14 Queue Management | add queue, remove, move, selection downloads | queue order stable, current index updates after removal/move |
| 15 Local Audio Boundary | IndexedDB, local-only cross-browser limits | same browser reload works; different browser requires backup/restore messaging |
| 16 Error Messaging | upstream failures, invalid JSON, 401/404/502 | user-visible messages identify real cause; no generic fake success |
| 17 Performance | search latency, batching, caching | Netease cache hit fast, batched URL verification bounded, FLAC/Bili live timings recorded |
| 18 Security/Privacy | cookies, shared state file, downloads | cookies not persisted in shared state; shared JSON contains no credentials |
| 19 Android 5 Parity | feature matrix vs release 5.0.0 | implemented/blocked/boundary list, browser-only substitutions documented |
| 20 Release Readiness | full gate orchestration | one command list, live smoke list, residual risks explicit |

## Automated Regression Matrix

## Agent Findings Integrated

- Agent01-04 locked remote playback standards: Netease, Bili, and FLAC must reject missing URL, trial fragments, and `<=60000ms`; Bili search must use WBI signing; FLAC live must prove real audio bytes.
- Agent05/08/15 locked persistence boundaries: remote playlists must restore through `/api/state` in a clean browser context; local audio metadata without IndexedDB blob must show `需重新导入` and must not pretend playable; backup JSON must include local audio `dataUrl`.
- Agent07/18 locked privacy: `/api/state`, localStorage, backups, and account error UI must not expose `MUSIC_U`, `SESSDATA`, `bili_jct`, `cookie`, `token`, or `credential` material.
- Agent09 locked search races: blank keyword sends zero requests; source switching clears stale results and immediately exits loading.
- Agent10/20 locked release gates: live failures cannot be replaced by mocks; E2E and playlist smoke must run against the isolated test state path, not the real 5188 shared state.
- Agent11/13/14/16/19 found residual gaps for future tightening: home partial-failure markers, local cover reload assertion, queue deletion matrix, stream error copy, settings with UI but no behavior, and Android-only capability boundaries.

## Fixes Landed From This Team Pass

- Added `JIANYIN_STATE_PATH` so Playwright can isolate `/api/state` from the real `.jianyin-shared-state.json`.
- Added recursive shared-state credential redaction and server error-message redaction.
- Changed Bili search to use WBI-signed URLs and sanitized Bili/FLAC HTML or bad JSON failures.
- Forced Bili playback to resolve through `/api/bili/song` and added Bili stream-side duration validation.
- Added Netease `/song` and `/stream` quality-fallback tests, lyric-failure playback test, FLAC `getUrl` negative tests, and Bili WBI/error tests.
- Replaced the old cross-browser playlist smoke with a true remote Netease playlist import restored in a clean browser context.
- Added E2E checks for backup JSON local audio `dataUrl`, clean-context local audio reimport boundary, blank keyword zero requests, source-switch loading reset, and account error/localStorage privacy.
- Protected `我喜欢的音乐` from detail-page bulk removal and fixed queue removal index adjustment.

### API Gate

Command:

```bash
npm run test:api
```

Required pass criteria:

- Netease search only returns verified full playable songs.
- Netease song resolve rejects no URL, trial fragments, 30s, and exactly 60s data.
- Netease stream revalidates playback and forwards Range.
- Quality fallback order is `jymaster -> sky -> jyeffect -> hires -> lossless -> exhigh -> standard`.
- Playlist and home endpoints filter unplayable tracks.
- FLAC mocked source filters short songs, passes `time/sign`, and proxies Range.
- FLAC challenge HTML triggers cookie refresh and retry.
- FLAC bad HTML/JSON failures do not expose `invalid json`, HTML, or credential material.
- Netease/Bili account invalid cookies fail; sync failures do not fake success.
- Bili WBI search, view duration, playurl, and stream proxy pass with mocks.
- `/api/state` redacts credential fields before persisting.

### Browser E2E Gate

Command:

```bash
CI=1 npm run test:e2e
```

Required pass criteria:

- Home sections render and playable home songs have `audio.duration > 60`.
- Player controls pause/resume/seek/next/previous/mode/speed/lyrics.
- Search can create playlists, add selected songs, and download selected songs.
- Cross-browser shared playlist persistence passes in a clean context.
- Local import persists across reload and plays.
- Backup JSON includes local audio `dataUrl`, no `blob:` URLs, and restores local audio in a clean context.
- A clean context with local metadata but no IndexedDB blob shows `需重新导入`, cannot play, and cannot add that song to queue as playable.
- Netease, Bili, and FLAC mocked playback flows resolve and play full songs.
- Bili playback must call `/api/bili/song` before stream playback; search-result URLs alone are not enough.
- Slow search response cannot overwrite newer results.
- Switching source clears stale results and ignores old source responses.
- Blank search input sends no source request.
- Account panel shows auth/sync errors and never adds fake playlists.
- Account error UI and localStorage do not expose credential material.

## Live Smoke Matrix

### FLAC/Test Source

Command:

```bash
npm run test:smoke:flac
```

Required evidence:

- Search `September Earth Wind Fire` returns at least one `source=flac` song.
- First result has `durationMs > 60000`.
- `/api/flac/song/:id` returns `verifiedPlayable=true`.
- `/api/flac/stream/:id` with `Range: bytes=0-65535` returns `206`, audio content type, and exactly 65536 bytes.

### Shared Playlist Smoke

Command:

```bash
CI=1 npm run test:smoke:playlist
```

Required evidence:

- Browser context A creates a playlist.
- Browser context B, with clean storage, sees the playlist from `/api/state`.
- The restored playlist is a remote Netease playlist and the restored song plays with `audio.duration > 60`.

### Bili Live Smoke

Manual command, fail-fast:

```bash
node --input-type=module <<'EOF'
const base = "http://127.0.0.1:5188";
async function getJson(path) {
  const res = await fetch(`${base}${path}`);
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} HTTP ${res.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text);
}
const search = await getJson("/api/bili/search?keyword=lofi&limit=2");
const first = search.songs?.find((song) => song?.bvid && song?.cid && Number(song.durationMs) > 60000);
if (!first) throw new Error(`Bili live search has no full playable result: ${JSON.stringify(search).slice(0, 500)}`);
const song = await getJson(`/api/bili/song/${encodeURIComponent(first.bvid)}?cid=${encodeURIComponent(first.cid)}`);
if (!song.url || !song.verifiedPlayable || Number(song.durationMs) <= 60000) {
  throw new Error(`Bili live resolve failed full-song gate: ${JSON.stringify(song).slice(0, 500)}`);
}
const stream = await fetch(new URL(song.url, base), { headers: { Range: "bytes=0-4095" } });
const bytes = await stream.arrayBuffer();
if (![200, 206].includes(stream.status) || bytes.byteLength === 0) {
  throw new Error(`Bili live stream failed: status=${stream.status}, bytes=${bytes.byteLength}`);
}
console.log("Bili live smoke passed", { bvid: first.bvid, cid: first.cid, durationMs: song.durationMs, status: stream.status, bytes: bytes.byteLength });
EOF
```

Required evidence:

- Search status is 200.
- First result has `durationMs > 60000`.
- Song resolve returns `durationMs > 60000`.
- Stream returns 200 or 206 and non-empty bytes.

## Manual Exploratory Checklist

- In `http://127.0.0.1:5188/`, create a remote playlist in one browser and verify it appears in another browser.
- Search FLAC source, play first result, verify now-playing title, quality, and non-zero progress.
- Search Bili source, play a long result, verify stream starts and duration is not 30s.
- Try invalid Netease and Bili cookies; verify errors and no new playlist.
- Import a local audio file, reload, play it, export backup, restore in a clean browser.
- Delete a normal playlist and attempt deleting `我喜欢的音乐`; only the normal playlist may disappear.

## Failure Rules

- Any remote result with missing URL, trial metadata, or `durationMs <= 60000` is a blocker.
- Any stream endpoint that cannot serve Range or returns empty bytes is a blocker.
- Any browser-context-only remote playlist persistence is a blocker.
- Any login/sync flow that creates a playlist after auth failure is a blocker.
- Any stale search result shown under a newly selected source is a blocker.
- Any credential material in `/api/state`, localStorage, backup JSON, or user-visible error text is a blocker.
- Any live source failure must be reported with upstream status/body sample; do not replace it with mock success.

## Current Gate Commands

```bash
cd /Users/chenguotao/jianyin-web-clean
npm run build
npm run test:api
CI=1 npm run test:e2e
npm run test:smoke:flac
CI=1 npm run test:smoke:playlist
```

## Residual Risks

- Bili live smoke is still a manual gate and must be recorded before release; mock Bili tests are not release evidence.
- Netease live smoke is not automated; current Netease confidence is mock/API behavior plus user-provided account flows.
- Some Android 5 system capabilities are browser substitutions only: foreground service, notification controls, Bluetooth listener, floating window, and system storage permissions.
- Some visible settings remain boundary items unless implemented with behavior tests: fade, automatic cache/preload, startup autoplay, and lyric source preference.
- Home partial-failure semantics still need stricter section-error reporting if release requires distinguishing remote failure from local fallback.
