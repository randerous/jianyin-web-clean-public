# Android Media Notification Fix

Verified device: OnePlus 13 / ColorOS / Android 15.

## Verified Behavior

- `1001` is the foreground-service media notification. It must stay as `NotificationCompat.MediaStyle` with an active `MediaSessionCompat`. This is what feeds the ColorOS control-center media card.
- A custom playback UI posted as an ongoing/status/media-style-adjacent notification can be accepted by `NotificationManager` but still hidden from the notification shade. In `dumpsys notification`, the hidden records show `mVisibleSinceMs=0`.
- A normal app notification is visible in the shade when `mVisibleSinceMs` has a real timestamp.

## Current Working Shape

- `startForeground(MEDIA_NOTIFICATION_ID, buildMediaNotification(...))`
- `buildMediaNotification(...)` uses:
  - `NotificationCompat.MediaStyle`
  - active `MediaSessionCompat` token
  - category `NotificationCompat.CATEGORY_TRANSPORT`
  - media actions
- `showStatusNotification(...)` posts a separate visible notification:
  - notification id `1099`
  - channel `jijian_playback_visible_v1`
  - custom `RemoteViews`
  - no `CATEGORY_STATUS`
  - no `ongoing`
  - silent
- The service cancels old hidden status notification id `1002` before posting `1099`.

## Verification

After building and installing with `adb install -r`, real playback was triggered in the app. The fixed build showed:

- Notification shade: visible "既见" playback card with previous/play-next controls.
- Control center: media card still visible and controllable.
- `dumpsys notification`: `id=1099` has non-zero `mVisibleSinceMs`; `id=1001` remains the media foreground notification.

## Do Not Regress

- Do not use the custom `RemoteViews` notification as the foreground-service notification.
- Do not make the visible shade card `ongoing`.
- Do not reuse the old hidden status id `1002` for the visible card.
- Do not judge notification visibility only from `NotificationManager` records. Confirm `mVisibleSinceMs` and a real phone screenshot.
- Install test builds with `adb install -r`; never uninstall or clear app data.
