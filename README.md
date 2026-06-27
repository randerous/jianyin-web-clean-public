# 简音 Web Clean

一个基于 React、Vite、Express 和 Capacitor 的音乐播放器项目，包含桌面 Web 版和 Android 版。

## 功能

- 首页推荐、搜索、我的歌单、播放列表、歌词页和全屏歌曲页
- 测试源搜索与播放，支持分页加载
- 收藏、下载、本地缓存、播放队列
- 播放模式：列表循环、单曲循环、随机播放
- Android 版内置本地 Node 服务，不依赖电脑后端
- 桌面版通过本地服务运行在 `http://127.0.0.1:5188/`

## 桌面版运行

```powershell
npm install
npm run build
.\start-jianyin-web-clean.ps1
```

启动脚本会自动拉起本地服务并打开浏览器。

## Android 构建

```powershell
npm install
npm run build
npx cap sync android
node .\scripts\prepare-android-embedded-backend.mjs
cd android
.\gradlew.bat assembleDebug -PjianyinAbi=arm64-v8a
```

生成的 APK 位于：

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

Android 内嵌后端会固定使用 `express@4.21.2`，用于兼容 nodejs-mobile 运行时。

## 测试

```powershell
npm run build
npm run test:api
npm run test:e2e
```

需要真实测试源时：

```powershell
npm run test:smoke:flac
```

## 数据与安全

本地运行产生的状态文件、日志、构建产物和安装包不会提交到仓库，包括：

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
