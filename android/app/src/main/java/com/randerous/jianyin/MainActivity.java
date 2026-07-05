package com.randerous.jianyin;

import android.app.DownloadManager;
import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.BroadcastReceiver;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
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

public class MainActivity extends BridgeActivity {
    private ActivityResultLauncher<String> notificationPermissionLauncher;
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
        configureDownloads();
        configurePlaybackBridge();
        configureBackGesture();
        requestNotificationPermission();
        registerMediaActionReceiver();
    }

    @Override
    public void onDestroy() {
        try {
            unregisterReceiver(mediaActionReceiver);
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

        PlaybackBridge(Context context) {
            this.context = context.getApplicationContext();
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
            Intent intent = new Intent(context, PlaybackKeepAliveService.class);
            intent.setAction(present ? PlaybackKeepAliveService.ACTION_START : PlaybackKeepAliveService.ACTION_STOP);
            intent.putExtra(PlaybackKeepAliveService.EXTRA_PLAYING, playing);
            intent.putExtra(PlaybackKeepAliveService.EXTRA_TITLE, title == null ? "" : title);
            intent.putExtra(PlaybackKeepAliveService.EXTRA_ARTIST, artist == null ? "" : artist);
            intent.putExtra(PlaybackKeepAliveService.EXTRA_POSITION_MS, Math.max(0, (long) (position * 1000)));
            intent.putExtra(PlaybackKeepAliveService.EXTRA_DURATION_MS, Math.max(0, (long) (duration * 1000)));
            if (present) {
                context.startForegroundService(intent);
            } else {
                context.startService(intent);
            }
        }
    }
}
