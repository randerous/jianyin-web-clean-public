package com.randerous.jianyin;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import android.widget.RemoteViews;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.media.app.NotificationCompat.MediaStyle;

public class PlaybackKeepAliveService extends Service {
    public static final String ACTION_START = "com.randerous.jianyin.PLAYBACK_START";
    public static final String ACTION_STOP = "com.randerous.jianyin.PLAYBACK_STOP";
    public static final String ACTION_MEDIA_CONTROL = "com.randerous.jianyin.MEDIA_CONTROL";
    public static final String COMMAND_PREVIOUS = "previous";
    public static final String COMMAND_TOGGLE = "toggle";
    public static final String COMMAND_NEXT = "next";
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_ARTIST = "artist";
    public static final String EXTRA_MEDIA_COMMAND = "command";
    public static final String EXTRA_PLAYING = "playing";
    public static final String EXTRA_POSITION_MS = "positionMs";
    public static final String EXTRA_DURATION_MS = "durationMs";
    public static final String EXTRA_STATUS_NOTIFICATION_ENABLED = "statusNotificationEnabled";

    private static final String MEDIA_CHANNEL_ID = "shiyin_media_playback_v3";
    private static final String STATUS_CHANNEL_ID = "jijian_playback_visible_v1";
    private static final int MEDIA_NOTIFICATION_ID = 1001;
    private static final int LEGACY_STATUS_NOTIFICATION_ID = 1002;
    private static final int STATUS_NOTIFICATION_ID = 1099;

    private PowerManager.WakeLock wakeLock;
    private MediaSessionCompat mediaSession;

    @Override
    public void onCreate() {
        super.onCreate();
        createChannels();
        mediaSession = new MediaSessionCompat(this, "JijianPlayback");
        mediaSession.setFlags(MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS | MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS);
        mediaSession.setCallback(new MediaSessionCompat.Callback() {
            @Override
            public void onPlay() {
                sendMediaCommand(COMMAND_TOGGLE);
            }

            @Override
            public void onPause() {
                sendMediaCommand(COMMAND_TOGGLE);
            }

            @Override
            public void onSkipToPrevious() {
                sendMediaCommand(COMMAND_PREVIOUS);
            }

            @Override
            public void onSkipToNext() {
                sendMediaCommand(COMMAND_NEXT);
            }
        });
        mediaSession.setActive(true);
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? ACTION_START : intent.getAction();
        if (ACTION_STOP.equals(action)) {
            stopPlaybackKeepAlive();
            return START_NOT_STICKY;
        }
        if (ACTION_MEDIA_CONTROL.equals(action)) {
            sendMediaCommand(intent == null ? "" : intent.getStringExtra(EXTRA_MEDIA_COMMAND));
            return START_STICKY;
        }

        String title = intent == null ? "" : intent.getStringExtra(EXTRA_TITLE);
        String artist = intent == null ? "" : intent.getStringExtra(EXTRA_ARTIST);
        boolean playing = intent == null || intent.getBooleanExtra(EXTRA_PLAYING, true);
        long positionMs = intent == null ? 0 : intent.getLongExtra(EXTRA_POSITION_MS, 0);
        long durationMs = intent == null ? 0 : intent.getLongExtra(EXTRA_DURATION_MS, 0);
        boolean statusNotificationEnabled = intent != null && intent.getBooleanExtra(EXTRA_STATUS_NOTIFICATION_ENABLED, false);
        String safeTitle = title == null || title.isEmpty() ? "既见" : title;
        String safeArtist = artist == null || artist.isEmpty() ? "正在播放" : artist;
        PendingIntent launchIntent = buildLaunchIntent();

        updateMediaSession(safeTitle, safeArtist, playing, positionMs, durationMs, launchIntent);
        startForeground(MEDIA_NOTIFICATION_ID, buildMediaNotification(safeTitle, safeArtist, playing, positionMs, durationMs, launchIntent));
        if (statusNotificationEnabled) {
            showStatusNotification(safeTitle, safeArtist, playing, positionMs, durationMs, launchIntent);
        } else {
            cancelStatusNotification();
        }

        if (playing) {
            acquireWakeLock();
        } else {
            releaseWakeLock();
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        releaseWakeLock();
        cancelMediaNotification();
        cancelStatusNotification();
        if (mediaSession != null) {
            mediaSession.setActive(false);
            mediaSession.release();
            mediaSession = null;
        }
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void stopPlaybackKeepAlive() {
        releaseWakeLock();
        cancelMediaNotification();
        cancelStatusNotification();
        if (mediaSession != null) {
            mediaSession.setActive(false);
        }
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    private void acquireWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) {
            return;
        }
        PowerManager powerManager = (PowerManager) getSystemService(POWER_SERVICE);
        if (powerManager == null) {
            return;
        }
        wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Jijian:Playback");
        wakeLock.setReferenceCounted(false);
        wakeLock.acquire();
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
        wakeLock = null;
    }

    private PendingIntent buildLaunchIntent() {
        Intent launchIntent = getPackageManager().getLaunchIntentForPackage(getPackageName());
        return PendingIntent.getActivity(
            this,
            0,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private Notification buildMediaNotification(String title, String artist, boolean playing, long positionMs, long durationMs, PendingIntent launchIntent) {
        NotificationCompat.Builder builder = basePlaybackNotification(MEDIA_CHANNEL_ID, title, artist, playing, launchIntent, true)
            .setStyle(new MediaStyle()
                .setMediaSession(mediaSession == null ? null : mediaSession.getSessionToken())
                .setShowActionsInCompactView(0, 1, 2))
            .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE);
        return builder.build();
    }

    private void showMediaNotification(String title, String artist, boolean playing, long positionMs, long durationMs, PendingIntent launchIntent) {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.notify(MEDIA_NOTIFICATION_ID, buildMediaNotification(title, artist, playing, positionMs, durationMs, launchIntent));
        }
    }

    private Notification buildStatusNotification(String title, String artist, boolean playing, long positionMs, long durationMs, PendingIntent launchIntent) {
        RemoteViews contentView = buildStatusContentView(title, artist, playing, positionMs, durationMs, R.layout.notification_playback);
        return basePlaybackNotification(STATUS_CHANNEL_ID, title, artist, playing, launchIntent, false, false)
            .setCustomContentView(contentView)
            .setCustomBigContentView(contentView)
            .setStyle(new NotificationCompat.DecoratedCustomViewStyle())
            .setSilent(true)
            .build();
    }

    private RemoteViews buildStatusContentView(String title, String artist, boolean playing, long positionMs, long durationMs, int layoutId) {
        RemoteViews views = new RemoteViews(getPackageName(), layoutId);
        views.setTextViewText(R.id.notification_title, title);
        views.setTextViewText(R.id.notification_artist, artist);
        if (layoutId == R.layout.notification_playback_big) {
            views.setProgressBar(R.id.notification_progress, (int) Math.min(Integer.MAX_VALUE, Math.max(1, durationMs)), (int) Math.min(Integer.MAX_VALUE, Math.max(0, positionMs)), durationMs <= 0);
            views.setTextViewText(R.id.notification_position, formatDuration(positionMs));
            views.setTextViewText(R.id.notification_duration, durationMs > 0 ? formatDuration(durationMs) : "--:--");
        }
        views.setImageViewResource(R.id.notification_toggle, playing ? R.drawable.ic_notify_pause : R.drawable.ic_notify_play);
        views.setOnClickPendingIntent(R.id.notification_previous, mediaIntent(COMMAND_PREVIOUS, 11));
        views.setOnClickPendingIntent(R.id.notification_toggle, mediaIntent(COMMAND_TOGGLE, 12));
        views.setOnClickPendingIntent(R.id.notification_next, mediaIntent(COMMAND_NEXT, 13));
        return views;
    }

    private NotificationCompat.Builder basePlaybackNotification(String channelId, String title, String artist, boolean playing, PendingIntent launchIntent) {
        return basePlaybackNotification(channelId, title, artist, playing, launchIntent, true, true);
    }

    private NotificationCompat.Builder basePlaybackNotification(String channelId, String title, String artist, boolean playing, PendingIntent launchIntent, boolean includeActions) {
        return basePlaybackNotification(channelId, title, artist, playing, launchIntent, includeActions, true);
    }

    private NotificationCompat.Builder basePlaybackNotification(String channelId, String title, String artist, boolean playing, PendingIntent launchIntent, boolean includeActions, boolean ongoing) {
        int toggleIcon = playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play;
        String toggleTitle = playing ? "Pause" : "Play";
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, channelId)
            .setSmallIcon(getApplicationInfo().icon)
            .setContentTitle(title)
            .setContentText(artist)
            .setContentIntent(launchIntent)
            .setOngoing(ongoing)
            .setOnlyAlertOnce(true)
            .setShowWhen(false)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC);
        if (includeActions) {
            builder
                .addAction(android.R.drawable.ic_media_previous, "Previous", mediaIntent(COMMAND_PREVIOUS, 1))
                .addAction(toggleIcon, toggleTitle, mediaIntent(COMMAND_TOGGLE, 2))
                .addAction(android.R.drawable.ic_media_next, "Next", mediaIntent(COMMAND_NEXT, 3));
        }
        return builder;
    }

    private void showStatusNotification(String title, String artist, boolean playing, long positionMs, long durationMs, PendingIntent launchIntent) {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.cancel(LEGACY_STATUS_NOTIFICATION_ID);
            manager.notify(STATUS_NOTIFICATION_ID, buildStatusNotification(title, artist, playing, positionMs, durationMs, launchIntent));
        }
    }

    private String formatDuration(long millis) {
        long totalSeconds = Math.max(0, millis / 1000);
        long minutes = totalSeconds / 60;
        long seconds = totalSeconds % 60;
        return String.format("%02d:%02d", minutes, seconds);
    }

    private void cancelStatusNotification() {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.cancel(STATUS_NOTIFICATION_ID);
            manager.cancel(LEGACY_STATUS_NOTIFICATION_ID);
        }
    }

    private void cancelMediaNotification() {
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.cancel(MEDIA_NOTIFICATION_ID);
        }
    }

    private PendingIntent mediaIntent(String command, int requestCode) {
        Intent intent = new Intent(this, PlaybackKeepAliveService.class);
        intent.setAction(ACTION_MEDIA_CONTROL);
        intent.putExtra(EXTRA_MEDIA_COMMAND, command);
        return PendingIntent.getService(
            this,
            requestCode,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
    }

    private void sendMediaCommand(String command) {
        if (command == null || command.isEmpty()) {
            return;
        }
        Intent broadcast = new Intent(ACTION_MEDIA_CONTROL);
        broadcast.setPackage(getPackageName());
        broadcast.putExtra(EXTRA_MEDIA_COMMAND, command);
        sendBroadcast(broadcast);
    }

    private void updateMediaSession(String title, String artist, boolean playing, long positionMs, long durationMs, PendingIntent launchIntent) {
        if (mediaSession == null) {
            return;
        }
        mediaSession.setSessionActivity(launchIntent);
        mediaSession.setMetadata(new MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, artist)
            .build());
        long actions = PlaybackStateCompat.ACTION_PLAY_PAUSE
            | PlaybackStateCompat.ACTION_PAUSE
            | PlaybackStateCompat.ACTION_PLAY
            | PlaybackStateCompat.ACTION_SKIP_TO_NEXT
            | PlaybackStateCompat.ACTION_SKIP_TO_PREVIOUS;
        mediaSession.setPlaybackState(new PlaybackStateCompat.Builder()
            .setActions(actions)
            .setState(playing ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED, PlaybackStateCompat.PLAYBACK_POSITION_UNKNOWN, 1f)
            .build());
        mediaSession.setActive(true);
    }

    private void createChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) {
            return;
        }
        NotificationChannel mediaChannel = new NotificationChannel(
            MEDIA_CHANNEL_ID,
            "Media playback",
            NotificationManager.IMPORTANCE_HIGH
        );
        mediaChannel.setDescription("System media controls for playback.");
        mediaChannel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        mediaChannel.setSound(null, null);
        mediaChannel.setShowBadge(false);
        manager.createNotificationChannel(mediaChannel);

        NotificationChannel statusChannel = new NotificationChannel(
            STATUS_CHANNEL_ID,
            "Playback notification",
            NotificationManager.IMPORTANCE_HIGH
        );
        statusChannel.setDescription("Visible playback notification with transport controls.");
        statusChannel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        statusChannel.setSound(null, null);
        statusChannel.setShowBadge(false);
        manager.createNotificationChannel(statusChannel);
    }
}
