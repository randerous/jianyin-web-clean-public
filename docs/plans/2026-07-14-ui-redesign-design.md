# 2026-07-14 UI redesign

## Goal

Improve the visual hierarchy and interaction feel of the existing music app without changing playback, search, playlist, account, storage, or update behavior.

## Direction

Use an editorial listening-room aesthetic: warm paper-like light surfaces, ink text, indigo primary actions, coral highlights, and a deep immersive player. The home screen gets a compact listening overview card so an empty or offline recommendation state still has a clear visual anchor. Cards and controls use consistent 16–22px radii, soft layered shadows, and short transform/color transitions.

## Scope

- Replace the final CSS token layer and normalize navigation, buttons, cards, rows, dialogs, search, and the mini-player.
- Add the presentation-only `.home-intro` block to `HomeScreen`.
- Keep all existing handlers, labels, state, API calls, and responsive breakpoints intact.
- Add visible focus states and reduced-motion behavior.

## States and verification

- Home: populated, loading, offline/error, and empty shelves remain readable.
- Search: idle, loading, result list, selection bar, pagination, and empty result states retain their current controls.
- Mine/detail/player/modal: existing actions remain reachable on desktop and mobile widths.
- Verify with production build, existing E2E tests, and a browser screenshot at desktop and narrow mobile viewports.
