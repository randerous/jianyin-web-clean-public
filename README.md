# 既见

既见是一款桌面端与 Android 端共用核心功能的音乐播放器。名字取自“既见君子，云胡不喜”。

## 功能

- 首页推荐、搜索、我的歌单、播放队列、歌词页和完整播放页
- 测试源搜索与播放，支持分页加载和播放前预热缓存
- 收藏、下载、本地缓存、最近播放、最近最爱
- 播放模式：列表循环、单曲循环、随机播放
- Android 版内置本地 Node 服务，不依赖电脑后端
- 桌面版通过本地服务运行在 `http://127.0.0.1:5188/`

## 桌面版运行

```powershell
npm install
npm run build
.\start-jianyin-web-clean.ps1
```

启动脚本会拉起本地服务并打开浏览器。

## Android 构建

```powershell
npm install
npm run android:apk
```

生成的 APK 位于：

```text
android/app/build/outputs/apk/release/app-release.apk
```

Android 内嵌后端会随 APK 一起打包，手机端可独立完成搜索、播放、下载和缓存。

## 测试

```powershell
npm run build
npm run test:api
npm run test:e2e
```

需要真实测试源冒烟测试时：

```powershell
npm run test:smoke:flac
```

## 数据与安全

本地运行产生的状态文件、日志、构建产物和安装包不提交到仓库，包括：

- `.jianyin-shared-state.json`
- `logs/`
- `dist/`
- `build/`
- `android/**/build/`
- `*.apk`
- `*.aab`
- `*.keystore`
- `*.jks`

公开发布前不要提交个人 Cookie、账号数据、下载文件或签名密钥。
