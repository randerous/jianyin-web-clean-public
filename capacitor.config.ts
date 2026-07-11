import type { CapacitorConfig } from "@capacitor/cli";

const releaseBuild = process.env.JIANYIN_ANDROID_RELEASE === "1";

const config: CapacitorConfig = {
  appId: "com.randerous.jianyin",
  appName: "既见",
  webDir: "dist",
  bundledWebRuntime: false,
  android: {
    backgroundColor: "#eef3f7",
    allowMixedContent: true,
    captureInput: false,
    webContentsDebuggingEnabled: !releaseBuild
  },
  server: {
    androidScheme: "https",
    allowNavigation: ["127.0.0.1"]
  }
};

export default config;
