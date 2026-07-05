import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.randerous.jianyin",
  appName: "既见",
  webDir: "dist",
  bundledWebRuntime: false,
  android: {
    backgroundColor: "#eef3f7",
    allowMixedContent: true,
    captureInput: false,
    webContentsDebuggingEnabled: true
  },
  server: {
    androidScheme: "https",
    allowNavigation: ["127.0.0.1"]
  }
};

export default config;
