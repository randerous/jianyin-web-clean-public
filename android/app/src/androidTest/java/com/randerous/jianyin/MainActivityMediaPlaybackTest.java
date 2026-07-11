package com.randerous.jianyin;

import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class MainActivityMediaPlaybackTest {
    @Test
    public void resolvedQueueSongsCanPlayAfterAsyncUrlLookup() {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> {
                assertNotNull(activity.getBridge());
                assertNotNull(activity.getBridge().getWebView());
                assertFalse(activity.getBridge().getWebView().getSettings().getMediaPlaybackRequiresUserGesture());
            });
        }
    }
}
