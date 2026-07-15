# Responsive Mobile Layout Design

## Problem

The final playlist skin applied a two-column cover-card grid to playlist rows.
That made the entire playlist content button 64px wide, leaving no flexible
space for its artwork and text. A separate fixed negative topbar margin also
diverged from the new fluid page gutter at very narrow widths.

## Layout Contract

- Playlist rows use `minmax(0, 1fr) auto`: flexible content plus a fixed control.
- Artwork uses a bounded `clamp()` size; text always receives the remaining
  width and long titles use a single-line ellipsis.
- Mobile page gutters use one shared `clamp()` variable. The sticky navigation
  and screen topbar derive their margins and padding from the same variable.
- Fixed pixels remain only for minimum touch targets, icons, and decorative
  radii where fluid sizing would reduce usability.

## Verification

Automated layout checks run at 320, 360, 390, 430, and 768 CSS pixels. They
verify playlist text width, single-line counts, row overflow, navigation bounds,
screen-heading placement, action-grid bounds, and document overflow. Visual
checks cover 320px and 390px renders of the Mine screen.
