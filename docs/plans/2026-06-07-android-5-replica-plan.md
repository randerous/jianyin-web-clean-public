# Jianyin Android 5.0.0 Web Replica Matrix

Source of truth:
- GitHub latest release API, tag `5.0.0`, published `2026-06-06T02:26:35Z`.
- Release note: `更换网易云接口为官方 / 重写主页ui / 歌单详情页ui优化`.
- Verified Android source in `/Users/chenguotao/jianyin-android-5.0.0-keyfiles`.

Scope:
- Work only in `/Users/chenguotao/jianyin-web-clean`.
- Keep Web service on `http://127.0.0.1:5188/`.
- Never show a Netease result as playable unless server verified URL exists, no `freeTrialInfo`, and `durationMs > 60000`.
- Because of that invariant, Web search is intentionally stricter than Android display search: candidates are batch-verified before they become playable UI rows.

## P0 Feature Matrix

| Area | Android 5.0.0 behavior | Source evidence | Web equivalent | Tests |
| --- | --- | --- | --- | --- |
| Main shell | Bottom tabs `首页 / 搜索 / 我的`; mini player above navigation; full player slides over app. | `MainActivity.kt:944-1047`, `MiniPlayer.kt:27-66` | Same three tabs, mini player, full player overlay; desktop rail can coexist with mobile bottom nav. | E2E navigation, mini player, full player. |
| Home | Large `简音` top app bar with refresh. Sections: `今日推荐`, `热歌推荐`, `个性化推荐`. | `HomeScreen.kt:148-270`, `HomeScreenViewModel.kt:66-127` | Fetch `/api/netease/home`, render three Android-named sections, refresh action, loading/error states. | API home mock, E2E visible sections, refresh. |
| Home playback | Recommended songs play through Netease URL resolution. | `HomeScreen.kt:197-202`, `HomeScreen.kt:230-235` | Home cards use already verified stream URLs and still re-resolve before play. | E2E click first recommendation, audio duration > 60. |
| Playlist detail | Opens recommended playlist, header image, play all, search songs, selection mode, add to playlist, download. | `HomeScreen.kt:277-391` | Detail dialog/sheet with header, search box, play all, selectable rows, add selected, download selected, create target playlist. | E2E search within playlist, select, add, download. |
| Search | Search field, search history, recommended tags, live results, selection mode, add to playlist/current queue/download. | `SearchScreen.kt:70-184`, `SearchScreen.kt:194-464` | Netease official `cloudsearch` with 90s cache, batched URL verification, stale-request guard, Android-style selection actions, add to queue/download/create playlist; explicit Bili search toggle. | E2E search/history/selection/race guard; API cache and batch tests. |
| Playback invariant | Netease play URL is fetched with chosen quality and only then played. | `MusicViewModel.kt:634-695`, `NeteaseApiService.kt:151-181` | Server verifies URL before exposing; stream endpoint revalidates. | API rejects no URL/trial/30s; real smoke duration > 60. |
| Quality | Android fallback chain `jymaster, sky, jyeffect, hires, lossless, exhigh, standard`. | `NeteaseApiService.kt:151-209` | Request preferred quality and fall back through same chain; expose `br/level/type` in UI/API. | API test asserts fallback attempts and metadata. |
| Lyrics | Prefer YRC, then LRC; translated lyric available when present. | `MusicViewModel.kt:660-669`, `NeteaseApiService.kt:267-300` | Use `lyric_new` when available; expose lyric text, normalize older LRC timestamps. | API lyric preference test, player lyric visible. |
| Full player | Blurred cover background, cover/lyric toggle, progress, prev/play/next, mode/favorite/desktop lyric/queue. | `MainActivity.kt:1135-1394` | Blurred cover overlay, cover/lyric toggle, progress style switch, favorite, MediaSession metadata/actions, in-page floating lyric, queue panel. | E2E player menu, MediaSession-covered controls, queue. |
| More menu | Download song, local LRC/cover, restore defaults, sleep timer, playback speed, progress bar style. | `MainActivity.kt:1512-1847`, `MainActivity.kt:2515-2659` | Menu with remote download, local LRC/cover pickers persisted through IndexedDB-backed state, sleep timer, speed, progress style. | E2E menu actions, local LRC/cover persistence, audio playbackRate assert. |
| Queue | Playlist queue, song queue, selection, add selected to playlist, remove, reorder modes. | `MainActivity.kt:1853-2514`, `MusicViewModel.kt:1441-1706` | Queue panel with current queue, play/remove, selection, add selected to playlist/download, up/down reorder. | E2E queue open/play/remove/select/reorder. |
| Mine | `我的音乐`, recent play shelf, favorites shelf, my playlists, add playlist sources. | `MyMusicScreenV2.kt:319-583` | My page with recent play, favorites, my playlists, add dialog for Netease/local/Bili/new playlist. | E2E sections and add dialog. |
| Accounts | Netease and Bili login states, sync playlists after login. | `MainActivity.kt:226-320`, `MusicViewModel.kt:313-393` | Browser-safe account panel with real cookie validation endpoints, server-memory cookie storage, Netease user playlist sync, Bili favorite-folder sync; no fake success. | API account sync tests; E2E validates Netease and Bili sync. |
| Settings | Audio quality, lyric source, fade, auto cache, default opener, dark mode, startup, backup, update. | `MyMusicScreenV2.kt:154-236` | Settings dialog with Web-applicable controls: theme, play quality, lyric source, backup/restore; OS-only items labelled as Web unavailable. | E2E settings controls persist. |

## P1/P2 Follow-up

P1:
- Playlist queue reorder beyond the currently playing song queue.
- Optional persistent encrypted account storage, if explicitly approved; current Web build keeps cookies in server memory only.
- Real-device browser smoke with user-provided Netease/Bili cookies for private or VIP-only catalogs.

P2:
- Android onboarding, update checker, audio focus/Bluetooth disconnect, background service.
- Desktop lyric exact equivalent requires an Electron or desktop wrapper; browser version can only provide in-page floating lyrics.

## First Acceptance Gate

Run after the P0 replica pass:
- `npm test`
- `npm run build`
- Browser smoke on `http://127.0.0.1:5188/`: search `周杰伦`, play one result, assert `<audio>.duration > 60`, inspect displayed quality metadata.

Latest completed gate:
- `npm test`: API 10/10, E2E 17/17 passed.
- `npm run build`: passed.
