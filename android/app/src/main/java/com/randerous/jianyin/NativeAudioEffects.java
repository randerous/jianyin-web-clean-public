package com.randerous.jianyin;

import android.media.audiofx.Equalizer;
import android.util.Log;

import org.json.JSONException;
import org.json.JSONObject;

/**
 * Native Android equalizer for WebView audio.
 *
 * The APK plays audio through the embedded WebView, whose audio session is not
 * publicly addressable. Attaching android.media.audiofx.Equalizer to session 0
 * applies the effect to the global output mix, which includes WebView audio.
 * This is the stable native route: no WebAudio createMediaElementSource and no
 * captureStream, so the 1.0.32-1.0.38 freezes/silence/pops cannot happen.
 */
public final class NativeAudioEffects {
    private static final String TAG = "JianyinNativeEq";

    private static final int[] ISO_FREQUENCIES = {
        31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000
    };

    private static final double[][] PRESET_CURVES = {
        // none
        { 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 },
        // hiFi / Pop
        { -1, 1, 2, 3, 3, 1, 0, -1, -1, 0 },
        // full
        { 5, 4, 3, 1, 0, 0, -1, -1, 0, 0 },
        // vocal
        { -2, -1, 0, 1, 3, 4, 3, 1, 0, -1 },
        // classical
        { 0, 0, 0, 0, 0, 0, -1, -2, -3, -4 },
        // rock
        { 4, 3, 2, 0, -1, -1, 0, 2, 3, 4 }
    };

    private static final String[] PRESET_IDS = {
        "none", "hiFi", "full", "vocal", "classical", "rock"
    };

    private static Equalizer equalizer;
    private static String activePreset = "none";
    private static int activeIntensity = 100;
    private static String lastError = "";

    private NativeAudioEffects() {
    }

    public static synchronized String status() {
        JSONObject json = new JSONObject();
        try {
            json.put("available", isAvailable());
            json.put("enabled", equalizer != null && isEnabled());
            json.put("preset", activePreset);
            json.put("intensity", activeIntensity);
            json.put("bands", equalizer == null ? 0 : equalizer.getNumberOfBands());
            json.put("error", lastError);
        } catch (JSONException ignored) {
        }
        return json.toString();
    }

    public static synchronized String apply(String rawPreset, int rawIntensity) {
        String preset = normalizePreset(rawPreset);
        int intensity = Math.max(0, Math.min(100, rawIntensity));
        activePreset = preset;
        activeIntensity = intensity;
        lastError = "";

        try {
            if ("none".equals(preset)) {
                if (equalizer != null) {
                    equalizer.setEnabled(false);
                }
                return status();
            }
            ensureEffect();
            double[] curve = PRESET_CURVES[presetIndex(preset)];
            applyCurve(equalizer, curve, intensity);
            equalizer.setEnabled(true);
        } catch (Exception error) {
            lastError = error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
            Log.e(TAG, "apply failed: " + lastError);
            try {
                if (equalizer != null) {
                    equalizer.setEnabled(false);
                }
            } catch (Exception ignored) {
            }
        }
        return status();
    }

    private static boolean isAvailable() {
        if (equalizer != null) {
            return true;
        }
        try {
            ensureEffect();
            return true;
        } catch (Exception error) {
            lastError = error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
            return false;
        }
    }

    private static boolean isEnabled() {
        try {
            return equalizer.getEnabled();
        } catch (Exception ignored) {
            return false;
        }
    }

    private static void ensureEffect() throws Exception {
        if (equalizer != null) {
            return;
        }
        equalizer = new Equalizer(0, 0);
    }

    private static void applyCurve(Equalizer effect, double[] curve, int intensity) {
        short numberOfBands = effect.getNumberOfBands();
        short[] range = effect.getBandLevelRange();
        short minimum = range[0];
        short maximum = range[1];
        for (short band = 0; band < numberOfBands; band += 1) {
            int centerFrequency = effect.getCenterFreq(band);
            double gainDb = curveGainAtFrequency(curve, centerFrequency) * (intensity / 100.0);
            short millibels = (short) Math.round(gainDb * 100.0);
            millibels = (short) Math.max(minimum, Math.min(maximum, millibels));
            effect.setBandLevel(band, millibels);
        }
    }

    private static double curveGainAtFrequency(double[] curve, double frequency) {
        if (frequency <= ISO_FREQUENCIES[0]) {
            return curve[0];
        }
        if (frequency >= ISO_FREQUENCIES[ISO_FREQUENCIES.length - 1]) {
            return curve[curve.length - 1];
        }
        for (int index = 0; index < ISO_FREQUENCIES.length - 1; index += 1) {
            double lowFrequency = ISO_FREQUENCIES[index];
            double highFrequency = ISO_FREQUENCIES[index + 1];
            if (frequency >= lowFrequency && frequency <= highFrequency) {
                double ratio = (Math.log10(frequency / lowFrequency)) / (Math.log10(highFrequency / lowFrequency));
                return curve[index] + (curve[index + 1] - curve[index]) * ratio;
            }
        }
        return 0;
    }

    private static String normalizePreset(String raw) {
        if (raw == null) {
            return "none";
        }
        for (String preset : PRESET_IDS) {
            if (preset.equals(raw)) {
                return preset;
            }
        }
        return "none";
    }

    private static int presetIndex(String preset) {
        for (int index = 0; index < PRESET_IDS.length; index += 1) {
            if (PRESET_IDS[index].equals(preset)) {
                return index;
            }
        }
        return 0;
    }
}
