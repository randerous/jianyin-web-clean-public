# 14 APK 与真机测试

## 环境

- APK 路径：`android/app/build/outputs/apk/release/app-release.apk`
- adb：`/Volumes/Ventoy/tools/android-sdk/platform-tools/adb`
- 包名：`com.randerous.jianyin`

## 用例

| ID | 测试点 | 方法 | 通过标准 |
|---|---|---|---|
| APK-01 | APK 构建 | `npm run android:apk` | BUILD SUCCESSFUL |
| APK-02 | ABI 检查 | `unzip -l app-release.apk | grep '^lib/'` | 只有 `lib/arm64-v8a/...` |
| APK-03 | 版本检查 | `aapt dump badging` | `versionName=1.0.14`，`versionCode=15` |
| APK-04 | 覆盖安装 | `adb install -r app-release.apk` | Success，数据未清空 |
| APK-05 | 签名检查 | `apksigner verify --print-certs app-release.apk` | SHA-256 为 `09392c015136c81b1aa60be09958ba2d8218dccba822d275124f2d5dba226d92` |
| APK-06 | 启动检查 | `adb shell am start -n com.randerous.jianyin/.MainActivity` | App 打开，无崩溃 |
| APK-07 | 本地播放 | 下载管理点恢复歌曲 | `audio.currentSrc` 为 `blob:` |
| APK-08 | 顶部留白 | 真机播放后切“我的” | 无 1/4 留白，root 为 `has-mini-player` |

## 通过标准

- 禁止 `adb uninstall`。
- 覆盖安装后 `firstInstallTime` 不应改变。
