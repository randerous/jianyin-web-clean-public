# 既见

既见是一款桌面端与 Android 端共用核心功能的音乐播放器。名字取自“既见君子，云胡不喜”。

## 功能

- 首页推荐、搜索、我的歌单、播放队列、歌词页和完整播放页
- 测试源搜索与播放，支持分页加载和播放前预热缓存
- 收藏、下载、本地缓存、最近播放、最近最爱
- 播放模式：列表循环、单曲循环、随机播放
- Android 版内置本地 Node 服务，不依赖电脑后端
- 桌面版通过本地服务运行在 `http://127.0.0.1:5188/`

## 桌面版一键运行

在 GitHub 项目页面点击 `Code → Download ZIP` 并解压，或者用 Git 拉取仓库。进入项目目录后直接运行对应文件：

- Windows：双击 `启动既见.exe`
- macOS：双击 `start-jianyin-macos.command`

Windows EXE 会自动完成以下操作：

1. 设置页或系统托盘检查固定 GitHub Release；用户点击更新后下载并校验 Windows EXE 的 SHA-256，再替换启动器并自动重启。
2. 从 EXE 内置生产运行包启动，不执行 `npm install`；缺少 Node.js 时从 Node.js 官方站点下载并校验 SHA-256。
3. 优先使用 `5188`，被占用时自动选择空闲端口。
4. 自动打开默认浏览器；服务在系统托盘后台运行，从托盘退出即可停止服务。

用户状态和日志保存在 Windows 用户数据目录 `%LOCALAPPDATA%\\Jianyin`；启动器更新不会删除或覆盖该目录中的状态文件。

也可以在终端中启动：

```bash
# macOS
./start-jianyin-macos.command
```

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
