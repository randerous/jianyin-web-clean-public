package com.randerous.jianyin;

import android.app.DownloadManager;
import android.content.Context;
import android.content.Intent;
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
import androidx.activity.EdgeToEdge;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        EdgeToEdge.enable(this);
        super.onCreate(savedInstanceState);
        configureSystemBars();
        configureDownloads();
        configurePlaybackBridge();
        configureBackGesture();
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
                request.setDescription("拾音");
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
            Intent intent = new Intent(context, PlaybackKeepAliveService.class);
            intent.setAction(active ? PlaybackKeepAliveService.ACTION_START : PlaybackKeepAliveService.ACTION_STOP);
            intent.putExtra(PlaybackKeepAliveService.EXTRA_TITLE, title == null ? "" : title);
            intent.putExtra(PlaybackKeepAliveService.EXTRA_ARTIST, artist == null ? "" : artist);
            if (active) {
                context.startForegroundService(intent);
            } else {
                context.startService(intent);
            }
        }
    }
}
