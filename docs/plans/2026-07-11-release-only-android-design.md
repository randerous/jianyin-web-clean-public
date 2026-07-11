# Android Release-only 发行设计

## 目标

手机和 GitHub Release 只接收 Android Release 变体。Debug APK 仅保留为本机开发能力，不再作为 `npm run android:apk` 的产物，也不下发到设备。

## 兼容性约束

- 包名保持 `com.randerous.jianyin`。
- v1.0.12 使用版本号 `versionCode 13`、`versionName 1.0.12`。
- Release 继续使用 v1.0.11 已采用的证书，证书 SHA-256 为 `09392c015136c81b1aa60be09958ba2d8218dccba822d275124f2d5dba226d92`，保证已有安装可以原地升级。
- 签名文件和密码只通过环境变量传入，不提交仓库。

## 构建行为

`npm run android:apk` 依次构建 Web 资源、同步 Capacitor、准备内嵌 Node 后端并执行 `assembleRelease`，最终输出 `android/app/build/outputs/apk/release/app-release.apk`。构建脚本继续验证前端、内嵌后端和 arm64-v8a 原生库。

Release 构建显式设置 `debuggable false`。Capacitor 配置通过构建环境区分开发与发行：本地开发允许 WebView 调试，Release 同步时关闭 WebView 调试。最终验收同时检查 APK 变体、manifest、证书、包名、版本、ABI 和内嵌资源。

## 测试与发布

桌面门禁保持 build、确定性 API、功能 E2E 和生产性能测试。手机只安装已校验的 `app-release.apk`，使用黑盒方式验证启动、首页、搜索、播放、切歌、后台播放、通知、返回手势、崩溃和资源占用，不运行会安装或卸载目标应用的 Gradle instrumentation/UTP。通过后提交代码、推送 `main`、创建 `v1.0.12` 标签并上传 Release APK。
