# Changelog

## 1.0.13 - 2026-07-11

- 修复搜索临时播放队列长时间暂停、进入后台或 App/WebView 重载后无法恢复播放。
- 恢复播放时刷新过期 FLAC 签名，并保留浏览器用户手势授权。
- 播放、上一首、下一首和队列选歌共用同一恢复逻辑，同时适用于桌面端与 Android。
- 新增持久化临时队列 reload 回归测试。
- 修复 Android Release 构建时 AppleDouble 清理器与 CMake 临时文件的 ENOENT 竞态。
