# 07 APK 真机性能

## 目标

验证 Android 真机上的冷启动、页面切换、播放、切歌、恢复数据性能。

## 环境

- APK：`android/app/build/outputs/apk/release/app-release.apk`
- adb：`/Volumes/Ventoy/tools/android-sdk/platform-tools/adb`
- 包名：`com.randerous.jianyin`

## 禁止事项

- 禁止 `adb uninstall`。
- 禁止 `pm clear`。
- 禁止删除 App 数据目录。
- 只能 `adb install -r` 覆盖安装。

## 用例

| ID | 场景 | 步骤 | 通过标准 |
|---|---|---|---|
| PERF-APK-01 | 冷启动 | force-stop 后 start | 首页 `< 5s` 可见 |
| PERF-APK-02 | 覆盖安装后启动 | `adb install -r` 后启动 | 数据保留，首页 `< 5s` |
| PERF-APK-03 | 我的页打开 | 点击“我的” | `< 1.5s` 可交互 |
| PERF-APK-04 | 下载管理打开 | 点击“全部 57” | `< 2s` 可见 |
| PERF-APK-05 | 本地恢复播放 | 点击恢复下载歌曲 | `blob:` 播放 `< 3s` |
| PERF-APK-06 | 下一首 | 恢复下载队列中下一首 | `< 3s` 进度增长 |
| PERF-APK-07 | 顶部布局 | 播放后切“我的” | 无顶部大留白 |
| PERF-APK-08 | 日志检查 | 播放后 `logcat -d -t 500` | 无 app crash/fatal |

## 推荐命令

```bash
ADB=/Volumes/Ventoy/tools/android-sdk/platform-tools/adb
$ADB devices -l
$ADB shell am force-stop com.randerous.jianyin
$ADB shell am start -n com.randerous.jianyin/.MainActivity
```

## 记录字段

```text
device:
versionName:
versionCode:
firstInstallTime:
cold_start_ms:
mine_open_ms:
download_manager_open_ms:
local_play_ms:
next_track_ms:
crash_logs:
```

## 通过标准

- 覆盖安装前后 `firstInstallTime` 不变。
- APK 证书 SHA-256 为 `09392c015136c81b1aa60be09958ba2d8218dccba822d275124f2d5dba226d92`。
- 恢复下载歌曲播放源为 `blob:`。
- 真机无明显卡顿和崩溃。
