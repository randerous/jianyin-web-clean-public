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

    private static final String CHANNEL_ID = "shiyin_media_playback_v3";
    private static final int NOTIFICATION_ID = 1001;
    private PowerManager.WakeLock wakeLock;
    private MediaSessionCompat mediaSession;

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
        mediaSession = new MediaSessionCompat(this, "ShiyinPlayback");
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
        startForeground(NOTIFICATION_ID, buildNotification(title, artist, playing));
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
        wakeLock = powerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Shiyin:Playback");
        wakeLock.setReferenceCounted(false);
        wakeLock.acquire();
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
        wakeLock = null;
    }

    private Notification buildNotification(String title, String artist, boolean playing) {
        Intent launchIntent = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent pendingIntent = PendingIntent.getActivity(
            this,
            0,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        if (mediaSession != null) {
            mediaSession.setSessionActivity(pendingIntent);
        }
        String safeTitle = title == null || title.isEmpty() ? "拾音" : title;
        String safeArtist = artist == null || artist.isEmpty() ? "Playing music" : artist;
        updateMediaSession(safeTitle, safeArtist, playing);
        int toggleIcon = playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play;
        String toggleTitle = playing ? "暂停" : "播放";
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(getApplicationInfo().icon)
            .setContentTitle(safeTitle)
            .setContentText(safeArtist)
            .setContentIntent(pendingIntent)
            .addAction(android.R.drawable.ic_media_previous, "上一首", mediaIntent(COMMAND_PREVIOUS, 1))
            .addAction(toggleIcon, toggleTitle, mediaIntent(COMMAND_TOGGLE, 2))
            .addAction(android.R.drawable.ic_media_next, "下一首", mediaIntent(COMMAND_NEXT, 3))
            .setStyle(new MediaStyle()
                .setMediaSession(mediaSession == null ? null : mediaSession.getSessionToken())
                .setShowActionsInCompactView(0, 1, 2))
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build();
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

    private void updateMediaSession(String title, String artist, boolean playing) {
        if (mediaSession == null) {
            return;
        }
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

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager == null) {
            return;
        }
        NotificationChannel channel = new NotificationChannel(
            CHANNEL_ID,
            "播放控制",
            NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("显示当前播放歌曲和上一首、播放暂停、下一首控制");
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        channel.setSound(null, null);
        channel.setShowBadge(false);
        manager.createNotificationChannel(channel);
    }
}
