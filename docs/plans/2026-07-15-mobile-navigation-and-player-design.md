# Mobile Navigation And Mini Player Design

## Decision

Mobile navigation moves to a sticky top bar. The bottom edge is reserved for a
single mini player. Desktop keeps its existing left rail and bottom player.

## Mobile Structure

- The top bar contains the Jianyin brand and Home, Search, and Mine tabs.
- The mini player contains artwork, song and artist text, play/pause, next, and
  a thin progress indicator.
- Tapping the song area opens the full player for seeking, playback mode,
  lyrics, and queue management.
- When no song is active, no bottom surface is rendered.

## Responsive Behavior

- At 390px and below, the brand wordmark hides while the app icon remains.
- Safe-area insets are applied independently at the top and bottom.
- Search pagination and toast messages sit above the mini player.

## Verification

- Mobile navigation changes all three screens at 390px.
- No mobile navigation element exists at the bottom.
- The mini player is the only fixed bottom bar.
- 390px, 430px, and 1440px screenshots receive visual review.
- The production build and full desktop E2E suite pass before release.
