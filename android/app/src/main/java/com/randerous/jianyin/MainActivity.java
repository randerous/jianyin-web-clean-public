package com.randerous.jianyin;

import android.app.DownloadManager;
import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.BroadcastReceiver;
import android.database.Cursor;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
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
import com.getcapacitor.BridgeActivity;
import java.io.InputStream;
import java.security.MessageDigest;
import java.util.Locale;

public class MainActivity extends BridgeActivity {
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
            registerReceiver(updateDownloadReceiver, filter, Context.RECEIVER_NOT_EXPORTED);
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
            Toast.makeText(this, "已开始下载更新", Toast.LENGTH_SHORT).show();
        } catch (Exception error) {
            updateDownloadId = -1L;
            updateExpectedSha256 = "";
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
            updateDownloadId = -1L;
            return;
        }
        if (!verifyDownloadedSha256(manager, id, updateExpectedSha256)) {
            manager.remove(id);
            Toast.makeText(this, "更新包校验失败，已取消安装", Toast.LENGTH_LONG).show();
            updateDownloadId = -1L;
            updateExpectedSha256 = "";
            return;
        }
        Uri uri = manager.getUriForDownloadedFile(id);
        if (uri == null) {
            Toast.makeText(this, "找不到更新包", Toast.LENGTH_SHORT).show();
            updateDownloadId = -1L;
            return;
        }
        try {
            Intent install = new Intent(Intent.ACTION_VIEW);
            install.setDataAndType(uri, "application/vnd.android.package-archive");
            install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(install);
            Toast.makeText(this, "请在系统安装器中确认更新", Toast.LENGTH_LONG).show();
        } catch (Exception error) {
            Toast.makeText(this, "无法打开系统安装器", Toast.LENGTH_LONG).show();
        } finally {
            updateDownloadId = -1L;
            updateExpectedSha256 = "";
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
        public void downloadAndInstallUpdate(String url, String fileName, String sha256, String versionTag) {
            activity.runOnUiThread(() -> activity.downloadAndInstallUpdate(url, fileName, sha256, versionTag));
        }

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
                context.startForegroundService(intent);
            } else {
                context.startService(intent);
            }
        }
    }
}
