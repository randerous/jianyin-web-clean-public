package com.randerous.jianyin;

import android.app.DownloadManager;
import android.Manifest;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.BroadcastReceiver;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelFileDescriptor;
import android.provider.Settings;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.URLUtil;
import android.view.View;
import android.view.Window;
import android.window.OnBackInvokedDispatcher;
import android.widget.Toast;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.activity.EdgeToEdge;
import androidx.activity.OnBackPressedCallback;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import com.getcapacitor.BridgeActivity;
import java.io.File;
import java.io.InputStream;
import java.security.MessageDigest;
import java.util.Locale;

public class MainActivity extends BridgeActivity {
    private static final String UPDATE_PREFS = "update_download";
    private static final String UPDATE_ID_KEY = "download_id";
    private static final String UPDATE_SHA256_KEY = "expected_sha256";
    private ActivityResultLauncher<String> notificationPermissionLauncher;
    private long updateDownloadId = -1L;
    private String updateExpectedSha256 = "";
    private final BroadcastReceiver updateDownloadReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (intent == null || !DownloadManager.ACTION_DOWNLOAD_COMPLETE.equals(intent.getAction())) {
                return;
            }
            long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L);
            if (id <= 0 || id != updateDownloadId) {
                return;
            }
            handleUpdateDownload(id);
        }
    };
    private final BroadcastReceiver mediaActionReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (intent == null || !PlaybackKeepAliveService.ACTION_MEDIA_CONTROL.equals(intent.getAction())) {
                return;
            }
            String command = intent.getStringExtra(PlaybackKeepAliveService.EXTRA_MEDIA_COMMAND);
            dispatchMediaCommand(command);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        EdgeToEdge.enable(this);
        notificationPermissionLauncher = registerForActivityResult(
                new ActivityResultContracts.RequestPermission(),
                granted -> {});
        super.onCreate(savedInstanceState);
        restorePendingUpdate();
        configureSystemBars();
        configureMediaPlayback();
        configureDownloads();
        configurePlaybackBridge();
        configureBackGesture();
        requestNotificationPermission();
        registerMediaActionReceiver();
        registerUpdateDownloadReceiver();
    }

    @Override
    public void onResume() {
        super.onResume();
        restorePendingUpdate();
        resumeCompletedUpdate();
    }

    @Override
    public void onDestroy() {
        try {
            unregisterReceiver(mediaActionReceiver);
        } catch (IllegalArgumentException ignored) {
        }
        try {
            unregisterReceiver(updateDownloadReceiver);
        } catch (IllegalArgumentException ignored) {
        }
        super.onDestroy();
    }

    private void configureSystemBars() {
        Window window = getWindow();
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            window.setNavigationBarDividerColor(Color.TRANSPARENT);
        }

        View decor = window.getDecorView();
        int flags = View.SYSTEM_UI_FLAG_LAYOUT_STABLE
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            flags |= View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR;
        }
        decor.setSystemUiVisibility(flags);
    }

    private void configureMediaPlayback() {
        if (getBridge() == null || getBridge().getWebView() == null) {
            return;
        }
        getBridge().getWebView().getSettings().setMediaPlaybackRequiresUserGesture(false);
    }

    private void configureBackGesture() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT,
                    this::handleAndroidBack);
        }
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                handleAndroidBack();
            }
        });
    }

    @Override
    public void onBackPressed() {
        handleAndroidBack();
    }

    private void handleAndroidBack() {
        if (getBridge() == null || getBridge().getWebView() == null) {
            moveTaskToBack(true);
            return;
        }
        getBridge().getWebView().evaluateJavascript(
                "Boolean(window.JianyinAndroidBack && window.JianyinAndroidBack())",
                result -> {
                    if ("true".equals(result)) {
                        return;
                    }
                    if (getBridge() != null && getBridge().getWebView() != null && getBridge().getWebView().canGoBack()) {
                        getBridge().getWebView().goBack();
                    } else {
                        moveTaskToBack(true);
                    }
                });
    }

    private void requestNotificationPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            return;
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
            return;
        }
        notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS);
    }

    private void registerMediaActionReceiver() {
        IntentFilter filter = new IntentFilter(PlaybackKeepAliveService.ACTION_MEDIA_CONTROL);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            registerReceiver(mediaActionReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            registerReceiver(mediaActionReceiver, filter);
        }
    }

    private void registerUpdateDownloadReceiver() {
        IntentFilter filter = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            // DownloadManager is a system process. The completion broadcast must be
            // delivered across the application boundary so the APK can be handed to
            // the system installer immediately after verification.
            registerReceiver(updateDownloadReceiver, filter, Context.RECEIVER_EXPORTED);
        } else {
            registerReceiver(updateDownloadReceiver, filter);
        }
    }

    private void downloadAndInstallUpdate(String rawUrl, String rawFileName, String rawSha256, String versionTag) {
        if (!isAllowedUpdateUrl(rawUrl)) {
            Toast.makeText(this, "更新地址不受信任", Toast.LENGTH_SHORT).show();
            return;
        }
        String expectedSha256 = rawSha256 == null ? "" : rawSha256.trim().toLowerCase(Locale.ROOT);
        if (!expectedSha256.matches("[0-9a-f]{64}")) {
            Toast.makeText(this, "更新缺少有效校验值", Toast.LENGTH_SHORT).show();
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getPackageManager().canRequestPackageInstalls()) {
            try {
                Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getPackageName()));
                startActivity(settings);
                Toast.makeText(this, "请允许既见安装更新包后重试", Toast.LENGTH_LONG).show();
            } catch (Exception ignored) {
                Toast.makeText(this, "系统未允许安装更新包", Toast.LENGTH_LONG).show();
            }
            return;
        }
        DownloadManager manager = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
        if (manager == null) {
            Toast.makeText(this, "系统下载服务不可用", Toast.LENGTH_SHORT).show();
            return;
        }
        if (updateDownloadId > 0) {
            manager.remove(updateDownloadId);
        }
        String fileName = rawFileName == null ? "jianyin-update.apk" : rawFileName.replaceAll("[^A-Za-z0-9._-]", "_");
        if (!fileName.toLowerCase(Locale.ROOT).endsWith(".apk")) fileName += ".apk";
        try {
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(rawUrl));
            request.setMimeType("application/vnd.android.package-archive");
            request.setTitle("既见 " + (versionTag == null ? "更新" : versionTag));
            request.setDescription("正在下载既见更新");
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setAllowedOverMetered(true);
            request.setAllowedOverRoaming(false);
            request.setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, fileName);
            // DownloadManager requires HTTP header values to be ASCII on some Android releases.
            request.addRequestHeader("User-Agent", "Jianyin Android updater");
            updateExpectedSha256 = expectedSha256;
            updateDownloadId = manager.enqueue(request);
            persistPendingUpdate();
            Toast.makeText(this, "已开始下载更新", Toast.LENGTH_SHORT).show();
        } catch (Exception error) {
            clearPendingUpdate();
            Toast.makeText(this, "更新下载失败", Toast.LENGTH_SHORT).show();
        }
    }

    private boolean isAllowedUpdateUrl(String rawUrl) {
        try {
            Uri uri = Uri.parse(rawUrl);
            String host = uri.getHost();
            return "https".equalsIgnoreCase(uri.getScheme())
                    && ("github.com".equalsIgnoreCase(host)
                    || "objects.githubusercontent.com".equalsIgnoreCase(host)
                    || "release-assets.githubusercontent.com".equalsIgnoreCase(host));
        } catch (Exception ignored) {
            return false;
        }
    }

    private void handleUpdateDownload(long id) {
        if (updateDownloadId != id) {
            restorePendingUpdate();
        }
        if (updateDownloadId != id || updateExpectedSha256.isEmpty()) {
            return;
        }
        DownloadManager manager = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
        if (manager == null) return;
        Cursor cursor = manager.query(new DownloadManager.Query().setFilterById(id));
        if (cursor == null) return;
        int status = DownloadManager.STATUS_FAILED;
        try {
            if (cursor.moveToFirst()) {
                status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
            }
        } finally {
            cursor.close();
        }
        if (status != DownloadManager.STATUS_SUCCESSFUL) {
            Toast.makeText(this, "更新下载失败", Toast.LENGTH_SHORT).show();
            clearPendingUpdate();
            return;
        }
        if (!verifyDownloadedSha256(manager, id, updateExpectedSha256)) {
            manager.remove(id);
            Toast.makeText(this, "更新包校验失败，已取消安装", Toast.LENGTH_LONG).show();
            clearPendingUpdate();
            return;
        }
        Uri uri = manager.getUriForDownloadedFile(id);
        if (uri == null) {
            Toast.makeText(this, "找不到更新包", Toast.LENGTH_SHORT).show();
            clearPendingUpdate();
            return;
        }
        try {
            Uri installUri = fileProviderUri(manager, id, uri);
            Intent install = new Intent(Intent.ACTION_INSTALL_PACKAGE);
            install.setDataAndType(installUri, "application/vnd.android.package-archive");
            install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            install.setClipData(ClipData.newRawUri("既见更新包", installUri));
            grantInstallUri(install, installUri);
            try {
                startActivity(install);
            } catch (ActivityNotFoundException ignored) {
                Intent fallback = new Intent(Intent.ACTION_VIEW);
                fallback.setDataAndType(installUri, "application/vnd.android.package-archive");
                fallback.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                fallback.setClipData(ClipData.newRawUri("既见更新包", installUri));
                grantInstallUri(fallback, installUri);
                startActivity(fallback);
            }
            Toast.makeText(this, "正在打开系统安装器，请确认更新", Toast.LENGTH_LONG).show();
        } catch (Exception error) {
            Toast.makeText(this, "无法打开系统安装器", Toast.LENGTH_LONG).show();
        } finally {
            clearPendingUpdate();
        }
    }

    private void resumeCompletedUpdate() {
        if (updateDownloadId <= 0L) return;
        DownloadManager manager = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
        if (manager == null) return;
        Cursor cursor = manager.query(new DownloadManager.Query().setFilterById(updateDownloadId));
        if (cursor == null) return;
        int status = DownloadManager.STATUS_PENDING;
        try {
            if (cursor.moveToFirst()) {
                status = cursor.getInt(cursor.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
            }
        } finally {
            cursor.close();
        }
        if (status == DownloadManager.STATUS_SUCCESSFUL || status == DownloadManager.STATUS_FAILED) {
            handleUpdateDownload(updateDownloadId);
        }
    }

    private void persistPendingUpdate() {
        getSharedPreferences(UPDATE_PREFS, Context.MODE_PRIVATE)
                .edit()
                .putLong(UPDATE_ID_KEY, updateDownloadId)
                .putString(UPDATE_SHA256_KEY, updateExpectedSha256)
                .apply();
    }

    private void restorePendingUpdate() {
        SharedPreferences preferences = getSharedPreferences(UPDATE_PREFS, Context.MODE_PRIVATE);
        long id = preferences.getLong(UPDATE_ID_KEY, -1L);
        String sha256 = preferences.getString(UPDATE_SHA256_KEY, "");
        if (id > 0L && sha256 != null && sha256.matches("[0-9a-f]{64}")) {
            updateDownloadId = id;
            updateExpectedSha256 = sha256;
        }
    }

    private void clearPendingUpdate() {
        updateDownloadId = -1L;
        updateExpectedSha256 = "";
        getSharedPreferences(UPDATE_PREFS, Context.MODE_PRIVATE).edit().clear().apply();
    }

    private Uri fileProviderUri(DownloadManager manager, long id, Uri fallback) {
        Cursor cursor = manager.query(new DownloadManager.Query().setFilterById(id));
        if (cursor == null) return fallback;
        try {
            if (!cursor.moveToFirst()) return fallback;
            int filenameIndex = cursor.getColumnIndex(DownloadManager.COLUMN_LOCAL_FILENAME);
            if (filenameIndex < 0) return fallback;
            String filename = cursor.getString(filenameIndex);
            if (filename == null || filename.isEmpty()) return fallback;
            File file = new File(filename);
            if (!file.isFile()) return fallback;
            return FileProvider.getUriForFile(this, getPackageName() + ".fileprovider", file);
        } catch (Exception ignored) {
            return fallback;
        } finally {
            cursor.close();
        }
    }

    private void grantInstallUri(Intent intent, Uri uri) {
        PackageManager packageManager = getPackageManager();
        for (android.content.pm.ResolveInfo info : packageManager.queryIntentActivities(intent, PackageManager.MATCH_DEFAULT_ONLY)) {
            grantUriPermission(info.activityInfo.packageName, uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        }
    }

    private boolean verifyDownloadedSha256(DownloadManager manager, long id, String expected) {
        if (expected == null || !expected.matches("[0-9a-f]{64}")) return false;
        try (ParcelFileDescriptor descriptor = manager.openDownloadedFile(id);
             InputStream input = new ParcelFileDescriptor.AutoCloseInputStream(descriptor)) {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] buffer = new byte[16 * 1024];
            int count;
            while ((count = input.read(buffer)) >= 0) {
                if (count > 0) digest.update(buffer, 0, count);
            }
            StringBuilder actual = new StringBuilder();
            for (byte value : digest.digest()) actual.append(String.format(Locale.ROOT, "%02x", value));
            return expected.equals(actual.toString());
        } catch (Exception ignored) {
            return false;
        }
    }

    private void dispatchMediaCommand(String command) {
        if (command == null || getBridge() == null || getBridge().getWebView() == null) {
            return;
        }
        String script = "window.JianyinAndroidMedia && window.JianyinAndroidMedia(" + quoteJs(command) + ")";
        getBridge().getWebView().post(() -> getBridge().getWebView().evaluateJavascript(script, null));
    }

    private static String quoteJs(String value) {
        return "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
    }

    private void configurePlaybackBridge() {
        if (getBridge() == null || getBridge().getWebView() == null) {
            return;
        }
        getBridge().getWebView().addJavascriptInterface(new PlaybackBridge(this), "JianyinAndroid");
    }

    private void configureDownloads() {
        if (getBridge() == null || getBridge().getWebView() == null) {
            return;
        }
        getBridge().getWebView().setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            try {
                String fileName = URLUtil.guessFileName(url, contentDisposition, mimeType);
                DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                request.setMimeType(mimeType);
                request.setTitle(fileName);
                request.setDescription("既见");
                request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);
                if (userAgent != null) {
                    request.addRequestHeader("User-Agent", userAgent);
                }
                String cookies = CookieManager.getInstance().getCookie(url);
                if (cookies != null) {
                    request.addRequestHeader("Cookie", cookies);
                }
                DownloadManager manager = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                if (manager == null) {
                    throw new IllegalStateException("DownloadManager unavailable");
                }
                manager.enqueue(request);
                Toast.makeText(this, "已开始下载 " + fileName, Toast.LENGTH_SHORT).show();
            } catch (Exception error) {
                Toast.makeText(this, "下载失败", Toast.LENGTH_SHORT).show();
            }
        });
    }

    public static final class PlaybackBridge {
        private final Context context;

        private final MainActivity activity;

        PlaybackBridge(MainActivity activity) {
            this.activity = activity;
            this.context = activity.getApplicationContext();
        }

        @JavascriptInterface
        public void setPlaybackState(boolean active, String title, String artist) {
            setPlaybackInfo(active, active, title, artist);
        }

        @JavascriptInterface
        public void setPlaybackInfo(boolean present, boolean playing, String title, String artist) {
            setPlaybackDetails(present, playing, title, artist, 0, 0);
        }

        @JavascriptInterface
        public void setPlaybackDetails(boolean present, boolean playing, String title, String artist, double position, double duration) {
            updatePlaybackDetails(present, playing, title, artist, position, duration, false);
        }

        @JavascriptInterface
        public void setPlaybackDetailsV2(boolean present, boolean playing, String title, String artist, double position, double duration, boolean statusNotificationEnabled) {
            updatePlaybackDetails(present, playing, title, artist, position, duration, statusNotificationEnabled);
        }

        @JavascriptInterface
        public String getEqualizerStatus() {
            return NativeAudioEffects.status();
        }

        @JavascriptInterface
        public String setEqualizer(String preset, int intensity) {
            return NativeAudioEffects.apply(preset, intensity);
        }

        @JavascriptInterface
        public void downloadAndInstallUpdate(String url, String fileName, String sha256, String versionTag) {
            activity.runOnUiThread(() -> activity.downloadAndInstallUpdate(url, fileName, sha256, versionTag));
        }

        private long lastStartSentAt = 0L;
        private final Handler bridgeHandler = new Handler(Looper.getMainLooper());
        private final Runnable deferredStopRunnable = new Runnable() {
            @Override
            public void run() {
                // 服务已进入前台，或 START 发出已久（服务理应早已 startForeground），可以安全 stop。
                if (PlaybackKeepAliveService.startedForeground || System.currentTimeMillis() - lastStartSentAt > 10000) {
                    context.startService(stopIntent);
                } else {
                    bridgeHandler.postDelayed(this, 300);
                }
            }
        };
        private Intent stopIntent;

        private void updatePlaybackDetails(boolean present, boolean playing, String title, String artist, double position, double duration, boolean statusNotificationEnabled) {
            Intent intent = new Intent(context, PlaybackKeepAliveService.class);
            intent.setAction(present ? PlaybackKeepAliveService.ACTION_START : PlaybackKeepAliveService.ACTION_STOP);
            intent.putExtra(PlaybackKeepAliveService.EXTRA_PLAYING, playing);
            intent.putExtra(PlaybackKeepAliveService.EXTRA_TITLE, title == null ? "" : title);
            intent.putExtra(PlaybackKeepAliveService.EXTRA_ARTIST, artist == null ? "" : artist);
            intent.putExtra(PlaybackKeepAliveService.EXTRA_POSITION_MS, Math.max(0, (long) (position * 1000)));
            intent.putExtra(PlaybackKeepAliveService.EXTRA_DURATION_MS, Math.max(0, (long) (duration * 1000)));
            intent.putExtra(PlaybackKeepAliveService.EXTRA_STATUS_NOTIFICATION_ENABLED, statusNotificationEnabled);
            if (present) {
                lastStartSentAt = System.currentTimeMillis();
                bridgeHandler.removeCallbacks(deferredStopRunnable);
                // 新 START 会重建前台状态，清掉旧标志，避免用旧实例的
                // startedForeground=true 误跳过 STOP 延迟（新实例尚未 startForeground 时 stop 会崩）。
                PlaybackKeepAliveService.startedForeground = false;
                context.startForegroundService(intent);
            } else {
                // 服务可能刚被 startForegroundService 创建、尚未调用 startForeground
                //（主线程繁忙时 onCreate 可延迟数秒）。此时立即 stopService 会让
                // AMS 抛 ForegroundServiceDidNotStartInTimeException 杀掉进程，
                // 因此延迟到服务真正 startForeground（或超时）后再 stop。
                stopIntent = intent;
                if (PlaybackKeepAliveService.startedForeground) {
                    context.startService(intent);
                } else {
                    bridgeHandler.removeCallbacks(deferredStopRunnable);
                    bridgeHandler.postDelayed(deferredStopRunnable, 300);
                }
            }
        }
    }
}
