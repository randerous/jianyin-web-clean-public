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
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

public class PlaybackKeepAliveService extends Service {
    public static final String ACTION_START = "com.randerous.jianyin.PLAYBACK_START";
    public static final String ACTION_STOP = "com.randerous.jianyin.PLAYBACK_STOP";
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_ARTIST = "artist";

    private static final String CHANNEL_ID = "jianyin_playback";
    private static final int NOTIFICATION_ID = 1001;
    private PowerManager.WakeLock wakeLock;

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? ACTION_START : intent.getAction();
        if (ACTION_STOP.equals(action)) {
            stopPlaybackKeepAlive();
            return START_NOT_STICKY;
        }

        String title = intent == null ? "" : intent.getStringExtra(EXTRA_TITLE);
        String artist = intent == null ? "" : intent.getStringExtra(EXTRA_ARTIST);
        startForeground(NOTIFICATION_ID, buildNotification(title, artist));
        acquireWakeLock();
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        releaseWakeLock();
        super.onDestroy();
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    private void stopPlaybackKeepAlive() {
        releaseWakeLock();
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

    private Notification buildNotification(String title, String artist) {
        Intent launchIntent = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent pendingIntent = PendingIntent.getActivity(
            this,
            0,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        String safeTitle = title == null || title.isEmpty() ? "拾音" : title;
        String safeArtist = artist == null || artist.isEmpty() ? "Playing music" : artist;
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(getApplicationInfo().icon)
            .setContentTitle(safeTitle)
            .setContentText(safeArtist)
            .setContentIntent(pendingIntent)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build();
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
            "拾音 playback",
            NotificationManager.IMPORTANCE_LOW
        );
        channel.setShowBadge(false);
        manager.createNotificationChannel(channel);
    }
}
