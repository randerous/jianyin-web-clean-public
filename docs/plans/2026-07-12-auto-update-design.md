# 自动更新设计

## 范围

- APK 和桌面本地网页共用同一个设置开关“自动检查更新”，默认关闭。
- 开启后启动时检查一次，之后每 6 小时检查；手动“检查更新”不受开关影响。
- 更新源固定为 `randerous/jianyin-web-clean-public` 的 GitHub 正式 Release，版本只接受 `v<major>.<minor>.<patch>`。

## 数据流

1. 前端请求同源 `/api/update/latest`，Node 服务代理 GitHub Release API，避免浏览器和 APK 直接依赖 GitHub API 的跨域行为。
2. 服务返回当前版本、最新版本、Release 地址、APK 资产及 GitHub 提供的 SHA-256 digest。
3. Android 仅在 URL、资产名和 SHA-256 均有效时通过原生 DownloadManager 下载，完成后再次计算 SHA-256，再交给系统安装器。安装器负责签名一致性和用户确认；应用不卸载、不清数据。
4. 桌面本地服务只有在启动脚本/Windows launcher 显式设置 `JIANYIN_ENABLE_UPDATE=1`、Git 工作区干净时才允许 `/api/update/apply`。服务执行 `git pull --ff-only`，返回成功后退出码 75，由父启动器重新构建并重启。普通远程网页或脏工作区只显示提示。

## 安全和失败处理

- GitHub 主机、HTTPS、Release tag 和 APK digest 均由服务端/Android 原生层校验。
- GitHub 请求失败、版本号无效、资产缺失、下载失败、digest 不匹配、工作区有未提交修改时均不安装、不覆盖用户数据。
- 更新检查是单飞请求并缓存 5 分钟；前端定时器每 6 小时运行，避免频繁访问 GitHub。

## 测试

- API：固定仓库、版本比较、资产 digest、缓存和 apply 禁用门禁。
- E2E：开关关闭不请求，打开后请求并持久化，重载后开关保持。
- APK：release 构建编译原生 bridge，安装包保持现有签名和 arm64-v8a 限制。
